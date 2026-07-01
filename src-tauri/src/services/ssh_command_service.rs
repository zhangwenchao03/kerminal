//! SSH 非交互命令执行服务。
//!
//! @author kongweiguang

use std::{
    io::{Read, Write},
    process::{ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

mod native;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        ssh_command::{SshCommandOutput, SshCommandRequest},
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService, process_command::silent_command,
        remote_host_service::RemoteHostService, ssh_credential_resolver::SshCredentialResolver,
        ssh_identity_file::resolve_identity_file_path,
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

use native::{
    build_native_command_execution, build_native_connection_execution,
    connect_native_command_target, disconnect_native_connection, execute_native_ssh_command,
    resolve_native_auth_material, NativeHostKeyPolicy, NativeSshAuthMaterial, NativeSshPrivateKey,
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
        remote_hosts: &RemoteHostService,
        request: SshCommandRequest,
    ) -> AppResult<SshCommandOutput> {
        let host = remote_hosts.require_host(&request.host_id)?;
        let plan = build_ssh_command_plan(&host, request)?;
        execute_ssh_command_plan(&host, &plan)
    }

    /// 在已保存 SSH 主机上通过 native russh 执行非交互命令。
    ///
    /// 该路径先从 encrypted vault 物化运行态密码、内联私钥或私钥路径，
    /// 不把 secret 暴露到本地进程参数。
    pub async fn execute_native(
        &self,
        paths: &KerminalPaths,
        request: SshCommandRequest,
    ) -> AppResult<SshCommandOutput> {
        let host = resolve_remote_host_from_files(paths, &request.host_id)?;
        let host = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()))
            .resolve_runtime_host(&host)?
            .host;
        let execution = build_native_command_execution(&host, paths, request)?;
        execute_native_ssh_command(&host, execution).await
    }

    /// 测试未保存或已保存 SSH 主机配置能否完成 native 连接与认证。
    pub async fn test_connection(&self, paths: &KerminalPaths, host: &RemoteHost) -> AppResult<()> {
        let timeout_seconds = normalize_timeout_seconds(Some(u64::from(
            host.ssh_options.terminal.connect_timeout_seconds,
        )));
        let execution = build_native_connection_execution(host, paths, timeout_seconds)?;
        let timeout = Duration::from_secs(timeout_seconds);
        match tokio::time::timeout(timeout, async {
            let connection =
                connect_native_command_target(&execution, NativeHostKeyPolicy::TrustUnknown)
                    .await?;
            disconnect_native_connection(connection, "connection test completed").await;
            Ok(())
        })
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AppError::SshCommand(format!(
                "SSH 连接测试超时（{} 秒）",
                timeout.as_secs()
            ))),
        }
    }
}

#[doc(hidden)]
pub mod rules {
    use std::{io::Read, path::PathBuf};

    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum NativeAuthMaterialSummary {
        Agent,
        Password(String),
        PrivateKeyPath(PathBuf),
        PrivateKeyPem {
            content: String,
            passphrase: Option<String>,
        },
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct LimitedOutputSummary {
        pub text: String,
        pub captured_bytes: usize,
        pub truncated: bool,
    }

    impl From<LimitedOutput> for LimitedOutputSummary {
        fn from(output: LimitedOutput) -> Self {
            Self {
                text: output.text,
                captured_bytes: output.captured_bytes,
                truncated: output.truncated,
            }
        }
    }

    pub fn resolve_native_auth_material_summary(
        host: &RemoteHost,
    ) -> AppResult<NativeAuthMaterialSummary> {
        match resolve_native_auth_material(host)? {
            NativeSshAuthMaterial::Agent => Ok(NativeAuthMaterialSummary::Agent),
            NativeSshAuthMaterial::Password(password) => {
                Ok(NativeAuthMaterialSummary::Password(password))
            }
            NativeSshAuthMaterial::PrivateKey(NativeSshPrivateKey::Path(path)) => {
                Ok(NativeAuthMaterialSummary::PrivateKeyPath(path))
            }
            NativeSshAuthMaterial::PrivateKey(NativeSshPrivateKey::Pem {
                content,
                passphrase,
            }) => Ok(NativeAuthMaterialSummary::PrivateKeyPem {
                content,
                passphrase,
            }),
        }
    }

    pub fn normalize_command_script(command: &str) -> AppResult<String> {
        super::normalize_command_script(command)
    }

    pub fn read_limited_output_summary<R: Read>(
        reader: R,
        max_bytes: usize,
    ) -> std::io::Result<LimitedOutputSummary> {
        super::read_limited_output(reader, max_bytes).map(Into::into)
    }

    pub fn limited_output_summary_from_chunks(
        max_bytes: usize,
        chunks: &[&[u8]],
    ) -> LimitedOutputSummary {
        let mut buffer = LimitedOutputBuffer::new(max_bytes);
        for chunk in chunks {
            buffer.push(chunk);
        }
        buffer.finish().into()
    }
}

fn resolve_remote_host_from_files(paths: &KerminalPaths, host_id: &str) -> AppResult<RemoteHost> {
    ConfigFileStore::new(paths.root.clone())
        .remote_host_by_id(host_id)
        .map_err(config_file_error)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
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
    if normalized_credential_secret(host).is_some() {
        return Err(AppError::InvalidInput(
            "内联 SSH 私钥需要使用 native SSH 命令路径执行".to_owned(),
        ));
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
        return Err(AppError::InvalidInput(
            "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容".to_owned(),
        ));
    }
    let identity_path = resolve_identity_file_path(credential_ref)?;
    Ok(vec![
        "-i".to_owned(),
        identity_path.to_string_lossy().into_owned(),
    ])
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
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
