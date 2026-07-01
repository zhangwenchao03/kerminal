//! native russh 非交互命令执行链。
//!
//! @author kongweiguang

use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use russh::{
    client,
    keys::{
        self, agent::AgentIdentity, load_secret_key, PrivateKey, PrivateKeyWithHashAlg, PublicKey,
    },
    ChannelMsg,
};

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions},
        ssh_command::{SshCommandOutput, SshCommandRequest},
    },
    paths::KerminalPaths,
    services::{
        ssh_identity_file::resolve_identity_file_path, ssh_route_plan::build_ssh_route_plan,
    },
};

use super::{
    normalize_command_script, normalize_output_bytes, normalize_timeout_seconds,
    LimitedOutputBuffer, DEFAULT_OUTPUT_BYTES,
};

pub(super) struct NativeSshCommandExecution {
    jumps: Vec<NativeSshHopExecution>,
    max_output_bytes: usize,
    script: String,
    target: NativeSshHopExecution,
    timeout_seconds: u64,
}

struct NativeSshHopExecution {
    auth: NativeSshAuthMaterial,
    host: String,
    known_hosts_path: PathBuf,
    port: u16,
    username: String,
}

pub(super) struct NativeSshConnectionChain {
    jumps: Vec<client::Handle<NativeCommandClientHandler>>,
    target: client::Handle<NativeCommandClientHandler>,
}

pub(super) enum NativeSshAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(NativeSshPrivateKey),
}

pub(super) enum NativeSshPrivateKey {
    Path(PathBuf),
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug)]
struct NativeCommandClientHandler {
    host: String,
    host_key_policy: NativeHostKeyPolicy,
    port: u16,
    known_hosts_path: PathBuf,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum NativeHostKeyPolicy {
    RequireKnown,
    TrustUnknown,
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
            Ok(true) => Ok(true),
            Ok(false) => match self.host_key_policy {
                NativeHostKeyPolicy::RequireKnown => Ok(false),
                NativeHostKeyPolicy::TrustUnknown => Ok(keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    server_public_key,
                    &self.known_hosts_path,
                )
                .is_ok()),
            },
            Err(_) => Ok(false),
        }
    }
}

pub(super) fn build_native_command_execution(
    host: &RemoteHost,
    paths: &KerminalPaths,
    request: SshCommandRequest,
) -> AppResult<NativeSshCommandExecution> {
    let _route_plan = build_ssh_route_plan(host)?;
    let known_hosts_path = paths.root.join("known_hosts");
    Ok(NativeSshCommandExecution {
        jumps: host
            .ssh_options
            .jump_hosts
            .iter()
            .enumerate()
            .map(|(index, jump)| build_native_jump_execution(index, jump, known_hosts_path.clone()))
            .collect::<AppResult<Vec<_>>>()?,
        max_output_bytes: normalize_output_bytes(request.max_output_bytes),
        script: normalize_command_script(&request.command)?,
        target: build_native_target_execution(host, known_hosts_path)?,
        timeout_seconds: normalize_timeout_seconds(request.timeout_seconds),
    })
}

pub(super) fn build_native_connection_execution(
    host: &RemoteHost,
    paths: &KerminalPaths,
    timeout_seconds: u64,
) -> AppResult<NativeSshCommandExecution> {
    let _route_plan = build_ssh_route_plan(host)?;
    let known_hosts_path = paths.root.join("known_hosts");
    Ok(NativeSshCommandExecution {
        jumps: host
            .ssh_options
            .jump_hosts
            .iter()
            .enumerate()
            .map(|(index, jump)| build_native_jump_execution(index, jump, known_hosts_path.clone()))
            .collect::<AppResult<Vec<_>>>()?,
        max_output_bytes: DEFAULT_OUTPUT_BYTES,
        script: String::new(),
        target: build_native_target_execution(host, known_hosts_path)?,
        timeout_seconds,
    })
}

pub(super) async fn execute_native_ssh_command(
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
    let connection =
        connect_native_command_target(&execution, NativeHostKeyPolicy::RequireKnown).await?;

    let mut channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
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
    disconnect_native_connection(connection, "command completed").await;

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

fn build_native_target_execution(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
) -> AppResult<NativeSshHopExecution> {
    Ok(NativeSshHopExecution {
        auth: resolve_native_auth_material(host)?,
        host: required_native_text(&host.host, "目标主机 host")?,
        known_hosts_path,
        port: required_native_port(host.port, "目标主机 port")?,
        username: required_native_text(&host.username, "目标主机 username")?,
    })
}

fn build_native_jump_execution(
    index: usize,
    jump: &SshJumpHostOptions,
    known_hosts_path: PathBuf,
) -> AppResult<NativeSshHopExecution> {
    let label = format!("跳板主机 jump-{index}");
    Ok(NativeSshHopExecution {
        auth: resolve_native_jump_auth_material(jump, &label)?,
        host: required_native_text(&jump.host, &format!("{label} host"))?,
        known_hosts_path,
        port: required_native_port(jump.port, &format!("{label} port"))?,
        username: required_native_text(&jump.username, &format!("{label} username"))?,
    })
}

pub(super) async fn connect_native_command_target(
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
) -> AppResult<NativeSshConnectionChain> {
    if execution.jumps.is_empty() {
        let mut target = connect_native_ssh(
            &execution.target,
            execution.timeout_seconds,
            host_key_policy,
        )
        .await?;
        authenticate_native_ssh(&mut target, &execution.target).await?;
        return Ok(NativeSshConnectionChain {
            jumps: Vec::new(),
            target,
        });
    }

    let mut jumps = Vec::with_capacity(execution.jumps.len());
    let mut upstream = connect_native_ssh(
        &execution.jumps[0],
        execution.timeout_seconds,
        host_key_policy,
    )
    .await?;
    authenticate_native_ssh(&mut upstream, &execution.jumps[0]).await?;

    for jump in execution.jumps.iter().skip(1) {
        let mut next = connect_native_ssh_through_direct_tcpip(
            &upstream,
            jump,
            execution.timeout_seconds,
            host_key_policy,
        )
        .await?;
        authenticate_native_ssh(&mut next, jump).await?;
        jumps.push(upstream);
        upstream = next;
    }

    let mut target = connect_native_ssh_through_direct_tcpip(
        &upstream,
        &execution.target,
        execution.timeout_seconds,
        host_key_policy,
    )
    .await?;
    authenticate_native_ssh(&mut target, &execution.target).await?;
    jumps.push(upstream);

    Ok(NativeSshConnectionChain { jumps, target })
}

pub(super) async fn disconnect_native_connection(
    connection: NativeSshConnectionChain,
    reason: &str,
) {
    let _ = connection
        .target
        .disconnect(russh::Disconnect::ByApplication, reason, "")
        .await;
    for jump in connection.jumps.into_iter().rev() {
        let _ = jump
            .disconnect(russh::Disconnect::ByApplication, reason, "")
            .await;
    }
}

async fn connect_native_ssh(
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    host_key_policy: NativeHostKeyPolicy,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let config = client::Config {
        inactivity_timeout: Some(Duration::from_secs(timeout_seconds)),
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: hop.host.clone(),
        host_key_policy,
        port: hop.port,
        known_hosts_path: hop.known_hosts_path.clone(),
    };
    client::connect(Arc::new(config), (hop.host.as_str(), hop.port), handler)
        .await
        .map_err(native_ssh_error)
}

async fn connect_native_ssh_through_direct_tcpip(
    upstream: &client::Handle<NativeCommandClientHandler>,
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    host_key_policy: NativeHostKeyPolicy,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let channel = upstream
        .channel_open_direct_tcpip(hop.host.clone(), u32::from(hop.port), "127.0.0.1", 0)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法通过跳板打开 direct-tcpip 到 {}@{}:{}: {error}",
                hop.username, hop.host, hop.port
            ))
        })?;
    let config = client::Config {
        inactivity_timeout: Some(Duration::from_secs(timeout_seconds)),
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: hop.host.clone(),
        host_key_policy,
        port: hop.port,
        known_hosts_path: hop.known_hosts_path.clone(),
    };
    client::connect_stream(Arc::new(config), channel.into_stream(), handler)
        .await
        .map_err(native_ssh_error)
}

async fn authenticate_native_ssh(
    ssh: &mut client::Handle<NativeCommandClientHandler>,
    hop: &NativeSshHopExecution,
) -> AppResult<()> {
    let username = hop.username.clone();
    let authenticated = match &hop.auth {
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
            hop.username, hop.host, hop.port
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

pub(super) fn resolve_native_auth_material(host: &RemoteHost) -> AppResult<NativeSshAuthMaterial> {
    match host.auth_type {
        RemoteHostAuthType::Agent => Ok(NativeSshAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_credential_secret(host, "密码认证需要已保存 SSH 密码")?;
            Ok(NativeSshAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_credential_secret(host) {
                return Ok(NativeSshAuthMaterial::PrivateKey(
                    NativeSshPrivateKey::Pem {
                        content: secret.to_owned(),
                        passphrase: None,
                    },
                ));
            }
            let credential_ref = required_credential_ref(host)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(
                    "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                        .to_owned(),
                ));
            }
            Ok(NativeSshAuthMaterial::PrivateKey(
                NativeSshPrivateKey::Path(resolve_identity_file_path(credential_ref)?),
            ))
        }
    }
}

fn resolve_native_jump_auth_material(
    jump: &SshJumpHostOptions,
    label: &str,
) -> AppResult<NativeSshAuthMaterial> {
    match jump.auth_type {
        RemoteHostAuthType::Agent => Ok(NativeSshAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_jump_credential_secret(
                jump,
                &format!("{label} 密码认证需要已保存 SSH 密码"),
            )?;
            Ok(NativeSshAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_jump_credential_secret(jump) {
                return Ok(NativeSshAuthMaterial::PrivateKey(
                    NativeSshPrivateKey::Pem {
                        content: secret.to_owned(),
                        passphrase: None,
                    },
                ));
            }
            let credential_ref = required_jump_credential_ref(jump, label)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(format!(
                    "{label} 不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                )));
            }
            Ok(NativeSshAuthMaterial::PrivateKey(
                NativeSshPrivateKey::Path(resolve_identity_file_path(credential_ref)?),
            ))
        }
    }
}

fn required_credential_ref(host: &RemoteHost) -> AppResult<&str> {
    host.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::InvalidInput("密钥认证需要保存私钥路径或明文私钥内容".to_owned()))
}

fn required_credential_secret(host: &RemoteHost, message: &str) -> AppResult<String> {
    normalized_credential_secret(host)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn required_jump_credential_ref<'a>(
    jump: &'a SshJumpHostOptions,
    label: &str,
) -> AppResult<&'a str> {
    jump.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!("{label} 密钥认证需要保存私钥路径或明文私钥内容"))
        })
}

fn required_jump_credential_secret(jump: &SshJumpHostOptions, message: &str) -> AppResult<String> {
    normalized_jump_credential_secret(jump)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_jump_credential_secret(jump: &SshJumpHostOptions) -> Option<&str> {
    jump.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn required_native_text(value: &str, field: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        Err(AppError::InvalidInput(format!("{field} 不能为空")))
    } else {
        Ok(normalized.to_owned())
    }
}

fn required_native_port(port: u16, field: &str) -> AppResult<u16> {
    if port == 0 {
        Err(AppError::InvalidInput(format!("{field} 必须大于 0")))
    } else {
        Ok(port)
    }
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

fn native_ssh_error(error: russh::Error) -> AppError {
    AppError::SshCommand(error.to_string())
}

fn key_error(error: keys::Error) -> AppError {
    AppError::SshCommand(format!("SSH 私钥解析失败: {error}"))
}

fn agent_error(error: keys::Error) -> AppError {
    AppError::SshCommand(format!("SSH agent 连接失败: {error}"))
}
