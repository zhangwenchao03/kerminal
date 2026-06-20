//! SSH 非交互命令执行服务。
//!
//! @author kongweiguang

use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{ExitStatus, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use russh::{
    client,
    keys::{
        self, agent::AgentIdentity, load_secret_key, PrivateKey, PrivateKeyWithHashAlg, PublicKey,
    },
    ChannelMsg,
};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        ssh_command::{SshCommandOutput, SshCommandRequest},
    },
    paths::KerminalPaths,
    services::credential_service::CredentialService,
    services::process_command::silent_command,
    storage::SqliteStore,
};

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MIN_TIMEOUT_SECONDS: u64 = 1;
const MAX_TIMEOUT_SECONDS: u64 = 300;
const DEFAULT_OUTPUT_BYTES: usize = 16 * 1024;
const MIN_OUTPUT_BYTES: usize = 256;
const MAX_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_COMMAND_CHARS: usize = 16 * 1024;

/// SSH 非交互命令业务入口。
#[derive(Debug, Default)]
pub struct SshCommandService;

impl SshCommandService {
    /// 创建 SSH 非交互命令服务。
    pub fn new() -> Self {
        Self
    }

    /// 在已保存 SSH 主机上执行非交互命令。
    pub fn execute(
        &self,
        storage: &SqliteStore,
        request: SshCommandRequest,
    ) -> AppResult<SshCommandOutput> {
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        let plan = build_ssh_command_plan(&host, request)?;
        execute_ssh_command_plan(&host, &plan)
    }

    /// 在已保存 SSH 主机上通过 native russh 执行非交互命令。
    ///
    /// 该路径用于需要读取 Kerminal 凭据仓库的调用方，支持 password、内联私钥和
    /// 私钥路径，不把 secret 暴露到本地进程参数。
    pub async fn execute_with_credentials(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SshCommandRequest,
    ) -> AppResult<SshCommandOutput> {
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        let execution = build_native_command_execution(&host, credentials, paths, request)?;
        execute_native_ssh_command(&host, execution).await
    }
}

/// 受控 SSH 远程命令计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshCommandPlan {
    /// SSH 可执行文件。
    pub executable: String,
    /// SSH 参数。
    pub args: Vec<String>,
    /// 通过 stdin 传入远端 `sh -s` 的脚本。
    pub script: String,
    /// 超时时间，单位秒。
    pub timeout_seconds: u64,
    /// stdout/stderr 各自最多保留的字节数。
    pub max_output_bytes: usize,
}

struct NativeSshCommandExecution {
    auth: NativeSshAuthMaterial,
    known_hosts_path: PathBuf,
    max_output_bytes: usize,
    script: String,
    timeout_seconds: u64,
}

enum NativeSshAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(NativeSshPrivateKey),
}

enum NativeSshPrivateKey {
    Path(PathBuf),
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPrivateKey {
    private_key: String,
    passphrase: Option<String>,
}

#[derive(Debug)]
struct NativeCommandClientHandler {
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
}

impl client::Handler for NativeCommandClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        match keys::known_hosts::check_known_hosts_path(
            &self.host,
            self.port,
            server_public_key,
            &self.known_hosts_path,
        ) {
            Ok(trusted) => Ok(trusted),
            Err(_) => Ok(false),
        }
    }
}

/// 使用指定 SSH 可执行文件构建远程命令计划，供测试验证参数边界。
pub fn build_ssh_command_plan_with_executable(
    host: &RemoteHost,
    executable: String,
    request: SshCommandRequest,
) -> AppResult<SshCommandPlan> {
    let script = normalize_command_script(&request.command)?;
    let mut args = vec![
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "BatchMode=yes".to_owned(),
        "-o".to_owned(),
        "ConnectTimeout=10".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.extend(identity_file_args(host)?);
    args.push(format!("{}@{}", host.username, host.host));
    args.push("sh".to_owned());
    args.push("-s".to_owned());

    Ok(SshCommandPlan {
        executable,
        args,
        script,
        timeout_seconds: normalize_timeout_seconds(request.timeout_seconds),
        max_output_bytes: normalize_output_bytes(request.max_output_bytes),
    })
}

fn build_ssh_command_plan(
    host: &RemoteHost,
    request: SshCommandRequest,
) -> AppResult<SshCommandPlan> {
    build_ssh_command_plan_with_executable(host, resolve_ssh_executable()?, request)
}

fn build_native_command_execution(
    host: &RemoteHost,
    credentials: &CredentialService,
    paths: &KerminalPaths,
    request: SshCommandRequest,
) -> AppResult<NativeSshCommandExecution> {
    Ok(NativeSshCommandExecution {
        auth: resolve_native_auth_material(host, credentials)?,
        known_hosts_path: paths.root.join("known_hosts"),
        max_output_bytes: normalize_output_bytes(request.max_output_bytes),
        script: normalize_command_script(&request.command)?,
        timeout_seconds: normalize_timeout_seconds(request.timeout_seconds),
    })
}

async fn execute_native_ssh_command(
    host: &RemoteHost,
    execution: NativeSshCommandExecution,
) -> AppResult<SshCommandOutput> {
    let started = Instant::now();
    let timeout = Duration::from_secs(execution.timeout_seconds);
    match tokio::time::timeout(timeout, execute_native_ssh_command_inner(host, execution)).await {
        Ok(result) => result.map(|mut output| {
            output.duration_ms = started.elapsed().as_millis();
            output
        }),
        Err(_) => Err(AppError::SshCommand(format!(
            "远程命令执行超时（{} 秒）",
            timeout.as_secs()
        ))),
    }
}

async fn execute_native_ssh_command_inner(
    host: &RemoteHost,
    execution: NativeSshCommandExecution,
) -> AppResult<SshCommandOutput> {
    let mut ssh =
        connect_native_ssh(host, execution.known_hosts_path, execution.timeout_seconds).await?;
    authenticate_native_ssh(&mut ssh, host, &execution.auth).await?;

    let mut channel = ssh.channel_open_session().await.map_err(native_ssh_error)?;
    channel
        .exec(true, "sh -s")
        .await
        .map_err(native_ssh_error)?;
    channel
        .data_bytes(execution.script.into_bytes())
        .await
        .map_err(native_ssh_error)?;
    channel.eof().await.map_err(native_ssh_error)?;

    let mut stdout = LimitedOutputBuffer::new(execution.max_output_bytes);
    let mut stderr = LimitedOutputBuffer::new(execution.max_output_bytes);
    let mut exit_code = None;
    let mut exec_request_failed = false;

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout.push(data.as_ref()),
            ChannelMsg::ExtendedData { data, .. } => stderr.push(data.as_ref()),
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).ok();
            }
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                if !error_message.trim().is_empty() {
                    stderr.push(error_message.as_bytes());
                    stderr.push(b"\n");
                }
                stderr.push(
                    format!("remote process terminated by signal: {signal_name:?}\n").as_bytes(),
                );
            }
            ChannelMsg::Failure => {
                exec_request_failed = true;
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    let _ = ssh
        .disconnect(russh::Disconnect::ByApplication, "command completed", "")
        .await;

    if exec_request_failed {
        return Err(AppError::SshCommand(
            "远端拒绝执行非交互命令请求".to_owned(),
        ));
    }

    let stdout = stdout.finish();
    let stderr = stderr.finish();
    let success = exit_code == Some(0);
    Ok(SshCommandOutput {
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        exit_code,
        success,
        stdout: stdout.text,
        stderr: stderr.text,
        stdout_bytes: stdout.captured_bytes,
        stderr_bytes: stderr.captured_bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        max_output_bytes: execution.max_output_bytes,
        duration_ms: 0,
    })
}

async fn connect_native_ssh(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    timeout_seconds: u64,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let config = client::Config {
        inactivity_timeout: Some(Duration::from_secs(timeout_seconds)),
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: host.host.clone(),
        port: host.port,
        known_hosts_path,
    };
    client::connect(Arc::new(config), (host.host.as_str(), host.port), handler)
        .await
        .map_err(native_ssh_error)
}

async fn authenticate_native_ssh(
    ssh: &mut client::Handle<NativeCommandClientHandler>,
    host: &RemoteHost,
    auth: &NativeSshAuthMaterial,
) -> AppResult<()> {
    let username = host.username.clone();
    let authenticated = match auth {
        NativeSshAuthMaterial::Password(password) => ssh
            .authenticate_password(username, password.clone())
            .await
            .map_err(native_ssh_error)?
            .success(),
        NativeSshAuthMaterial::PrivateKey(private_key) => {
            let key = load_native_private_key(private_key)?;
            let hash = ssh
                .best_supported_rsa_hash()
                .await
                .map_err(native_ssh_error)?
                .flatten();
            ssh.authenticate_publickey(username, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(native_ssh_error)?
                .success()
        }
        NativeSshAuthMaterial::Agent => authenticate_with_agent(ssh, username).await?,
    };

    if authenticated {
        Ok(())
    } else {
        Err(AppError::SshCommand(format!(
            "SSH 认证失败: {}@{}:{}",
            host.username, host.host, host.port
        )))
    }
}

async fn authenticate_with_agent(
    ssh: &mut client::Handle<NativeCommandClientHandler>,
    username: String,
) -> AppResult<bool> {
    let mut agent = connect_agent().await?;
    let identities = agent.request_identities().await.map_err(agent_error)?;
    for identity in identities {
        let key = match &identity {
            AgentIdentity::PublicKey { key, .. } => key.clone(),
            AgentIdentity::Certificate { .. } => identity.public_key().into_owned(),
        };
        let hash = ssh
            .best_supported_rsa_hash()
            .await
            .map_err(native_ssh_error)?
            .flatten();
        let result = ssh
            .authenticate_publickey_with(username.clone(), key, hash, &mut agent)
            .await
            .map_err(|error| AppError::SshCommand(format!("SSH agent 认证失败: {error}")))?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(unix)]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    keys::agent::client::AgentClient::connect_env()
        .await
        .map(|client| client.dynamic())
        .map_err(agent_error)
}

#[cfg(windows)]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

    match keys::agent::client::AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE).await {
        Ok(client) => Ok(client.dynamic()),
        Err(openssh_error) => keys::agent::client::AgentClient::connect_pageant()
            .await
            .map(|client| client.dynamic())
            .map_err(|pageant_error| {
                AppError::SshCommand(format!(
                    "SSH agent 连接失败: OpenSSH agent ({OPENSSH_AGENT_PIPE}) {openssh_error}; Pageant {pageant_error}"
                ))
            }),
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    Err(AppError::SshCommand(
        "当前平台不支持 SSH agent 认证，请改用密码或私钥凭据".to_owned(),
    ))
}

fn resolve_native_auth_material(
    host: &RemoteHost,
    credentials: &CredentialService,
) -> AppResult<NativeSshAuthMaterial> {
    match host.auth_type {
        RemoteHostAuthType::Agent => Ok(NativeSshAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let credential_ref = required_credential_ref(host)?;
            let password = credentials.get_secret(credential_ref)?.ok_or_else(|| {
                AppError::Credential(format!("未找到 SSH 密码凭据: {credential_ref}"))
            })?;
            Ok(NativeSshAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            let credential_ref = required_credential_ref(host)?;
            if credential_ref.starts_with("credential:") {
                let secret = credentials.get_secret(credential_ref)?.ok_or_else(|| {
                    AppError::Credential(format!("未找到 SSH 私钥凭据: {credential_ref}"))
                })?;
                return Ok(NativeSshAuthMaterial::PrivateKey(
                    parse_native_private_key_secret(&secret),
                ));
            }
            validate_identity_file_path(credential_ref)?;
            Ok(NativeSshAuthMaterial::PrivateKey(
                NativeSshPrivateKey::Path(PathBuf::from(credential_ref)),
            ))
        }
    }
}

fn required_credential_ref(host: &RemoteHost) -> AppResult<&str> {
    host.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::InvalidInput("该 SSH 认证方式需要配置凭据引用".to_owned()))
}

fn parse_native_private_key_secret(secret: &str) -> NativeSshPrivateKey {
    serde_json::from_str::<StoredPrivateKey>(secret)
        .map(|stored| NativeSshPrivateKey::Pem {
            content: stored.private_key,
            passphrase: stored.passphrase,
        })
        .unwrap_or_else(|_| NativeSshPrivateKey::Pem {
            content: secret.to_owned(),
            passphrase: None,
        })
}

fn load_native_private_key(private_key: &NativeSshPrivateKey) -> AppResult<PrivateKey> {
    match private_key {
        NativeSshPrivateKey::Path(path) => load_secret_key(path, None).map_err(key_error),
        NativeSshPrivateKey::Pem {
            content,
            passphrase,
        } => keys::decode_secret_key(content, passphrase.as_deref()).map_err(key_error),
    }
}

fn execute_ssh_command_plan(
    host: &RemoteHost,
    plan: &SshCommandPlan,
) -> AppResult<SshCommandOutput> {
    let started = Instant::now();
    let mut child = silent_command(&plan.executable)
        .args(&plan.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError::SshCommand(format!("无法启动 SSH 客户端: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .map(|reader| spawn_output_reader(reader, plan.max_output_bytes));
    let stderr = child
        .stderr
        .take()
        .map(|reader| spawn_output_reader(reader, plan.max_output_bytes));

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(plan.script.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::SshCommand(format!(
                "无法写入远程命令脚本: {error}"
            )));
        }
    }

    let status = wait_for_child(&mut child, Duration::from_secs(plan.timeout_seconds))?;
    let stdout = join_output_reader(stdout)?;
    let stderr = join_output_reader(stderr)?;

    Ok(SshCommandOutput {
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        exit_code: status.code(),
        success: status.success(),
        stdout: stdout.text,
        stderr: stderr.text,
        stdout_bytes: stdout.captured_bytes,
        stderr_bytes: stderr.captured_bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        max_output_bytes: plan.max_output_bytes,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn wait_for_child(child: &mut std::process::Child, timeout: Duration) -> AppResult<ExitStatus> {
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| AppError::SshCommand(format!("无法读取远程命令状态: {error}")))?
        {
            return Ok(status);
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::SshCommand(format!(
                "远程命令执行超时（{} 秒）",
                timeout.as_secs()
            )));
        }

        thread::sleep(Duration::from_millis(25));
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LimitedOutput {
    text: String,
    captured_bytes: usize,
    truncated: bool,
}

#[derive(Debug)]
struct LimitedOutputBuffer {
    captured: Vec<u8>,
    max_bytes: usize,
    total_bytes: usize,
}

impl LimitedOutputBuffer {
    fn new(max_bytes: usize) -> Self {
        Self {
            captured: Vec::with_capacity(max_bytes.min(8 * 1024)),
            max_bytes,
            total_bytes: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        let remaining = self.max_bytes.saturating_sub(self.captured.len());
        if remaining > 0 {
            let visible = bytes.len().min(remaining);
            self.captured.extend_from_slice(&bytes[..visible]);
        }
    }

    fn finish(self) -> LimitedOutput {
        LimitedOutput {
            text: String::from_utf8_lossy(&self.captured).into_owned(),
            captured_bytes: self.captured.len(),
            truncated: self.total_bytes > self.captured.len(),
        }
    }
}

fn spawn_output_reader<R>(
    reader: R,
    max_bytes: usize,
) -> thread::JoinHandle<std::io::Result<LimitedOutput>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || read_limited_output(reader, max_bytes))
}

fn join_output_reader(
    handle: Option<thread::JoinHandle<std::io::Result<LimitedOutput>>>,
) -> AppResult<LimitedOutput> {
    match handle {
        Some(handle) => handle
            .join()
            .map_err(|_| AppError::SshCommand("读取远程命令输出线程异常退出".to_owned()))?
            .map_err(|error| AppError::SshCommand(format!("无法读取远程命令输出: {error}"))),
        None => Ok(LimitedOutput {
            text: String::new(),
            captured_bytes: 0,
            truncated: false,
        }),
    }
}

fn read_limited_output<R: Read>(mut reader: R, max_bytes: usize) -> std::io::Result<LimitedOutput> {
    let mut captured = Vec::with_capacity(max_bytes.min(8 * 1024));
    let mut total_bytes = 0usize;
    let mut buffer = [0u8; 8 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read);
        let remaining = max_bytes.saturating_sub(captured.len());
        if remaining > 0 {
            let visible = read.min(remaining);
            captured.extend_from_slice(&buffer[..visible]);
        }
    }

    Ok(LimitedOutput {
        text: String::from_utf8_lossy(&captured).into_owned(),
        captured_bytes: captured.len(),
        truncated: total_bytes > captured.len(),
    })
}

fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn identity_file_args(host: &RemoteHost) -> AppResult<Vec<String>> {
    if host.auth_type != RemoteHostAuthType::Key {
        return Ok(Vec::new());
    }
    let Some(credential_ref) = host
        .credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(Vec::new());
    };
    if credential_ref.starts_with("credential:") {
        return Ok(Vec::new());
    }
    validate_identity_file_path(credential_ref)?;
    Ok(vec!["-i".to_owned(), credential_ref.to_owned()])
}

fn validate_identity_file_path(path: &str) -> AppResult<()> {
    if path.contains('\n') || path.contains('\r') || path.contains('\0') {
        return Err(AppError::InvalidInput(
            "SSH 私钥路径不能包含控制字符".to_owned(),
        ));
    }
    Ok(())
}

fn resolve_ssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::SshCommand(
                "未找到 OpenSSH 客户端，请安装 ssh 或确认 ssh 已加入 PATH".to_owned(),
            )
        })
}

fn normalize_command_script(command: &str) -> AppResult<String> {
    if command.contains('\0') {
        return Err(AppError::InvalidInput(
            "远程命令不能包含 NUL 字符".to_owned(),
        ));
    }

    let normalized = command.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("远程命令不能为空".to_owned()));
    }
    if trimmed.chars().count() > MAX_COMMAND_CHARS {
        return Err(AppError::InvalidInput(format!(
            "远程命令长度不能超过 {MAX_COMMAND_CHARS} 个字符"
        )));
    }

    if trimmed.ends_with('\n') {
        Ok(trimmed.to_owned())
    } else {
        Ok(format!("{trimmed}\n"))
    }
}

fn normalize_timeout_seconds(timeout_seconds: Option<u64>) -> u64 {
    timeout_seconds
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
        .clamp(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
}

fn normalize_output_bytes(max_output_bytes: Option<usize>) -> usize {
    max_output_bytes
        .unwrap_or(DEFAULT_OUTPUT_BYTES)
        .clamp(MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
}

fn native_ssh_error(error: russh::Error) -> AppError {
    AppError::SshCommand(error.to_string())
}

fn key_error(error: keys::Error) -> AppError {
    AppError::SshCommand(format!("SSH 私钥解析失败: {error}"))
}

fn agent_error(error: keys::Error) -> AppError {
    AppError::SshCommand(format!("SSH agent 连接失败: {error}"))
}

#[cfg(test)]
mod tests;
