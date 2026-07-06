//! native russh 非交互命令执行链。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use russh::{
    client,
    keys::{
        self, agent::AgentIdentity, load_secret_key, PrivateKey, PrivateKeyWithHashAlg, PublicKey,
    },
    Channel, ChannelMsg, Pty,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions},
        ssh_command::{SshCommandOutput, SshCommandRequest},
    },
    paths::KerminalPaths,
    services::{
        ssh_identity_file::resolve_identity_file_path,
        ssh_route_plan::build_ssh_route_plan,
        ssh_runtime::{SshRuntimeExecRawOutput, SshRuntimeSftpStream, SshRuntimeShellRequest},
    },
};

use super::{
    normalize_command_script, normalize_output_bytes, normalize_timeout_seconds,
    LimitedOutputBuffer, DEFAULT_OUTPUT_BYTES,
};

#[derive(Clone)]
pub(crate) struct NativeSshCommandExecution {
    jumps: Vec<NativeSshHopExecution>,
    max_output_bytes: usize,
    script: String,
    target: NativeSshHopExecution,
    timeout_seconds: u64,
}

#[derive(Clone)]
struct NativeSshHopExecution {
    auth: NativeSshAuthMaterial,
    host: String,
    known_hosts_path: PathBuf,
    port: u16,
    username: String,
}

pub(crate) struct NativeSshConnectionChain {
    jumps: Vec<client::Handle<NativeCommandClientHandler>>,
    target: client::Handle<NativeCommandClientHandler>,
}

#[derive(Clone)]
pub(crate) struct NativeDirectTcpipProxyRequest {
    pub target_host: String,
    pub target_port: u16,
    pub originator_host: String,
    pub originator_port: u16,
}

#[derive(Clone)]
pub(crate) enum NativeSshAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(NativeSshPrivateKey),
}

#[derive(Clone)]
pub(crate) enum NativeSshPrivateKey {
    Path {
        path: PathBuf,
        passphrase: Option<String>,
    },
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug)]
struct NativeCommandClientHandler {
    host: String,
    host_key_policy: NativeHostKeyPolicy,
    known_hosts_path: PathBuf,
    port: u16,
    remote_forwards: NativeRemoteForwardRegistry,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct NativeRemoteForwardRegistry {
    inner: Arc<Mutex<HashMap<NativeRemoteForwardKey, NativeRemoteForwardTarget>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct NativeRemoteForwardKey {
    address: String,
    port: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NativeRemoteForwardTarget {
    Local { host: String, port: u16 },
    Socks5LocalDynamic,
}

impl NativeRemoteForwardTarget {
    pub(crate) fn new(host: impl Into<String>, port: u16) -> Self {
        Self::Local {
            host: host.into(),
            port,
        }
    }

    pub(crate) fn socks5_local_dynamic() -> Self {
        Self::Socks5LocalDynamic
    }
}

impl NativeRemoteForwardRegistry {
    pub(crate) fn register(
        &self,
        address: impl Into<String>,
        port: u32,
        target: NativeRemoteForwardTarget,
    ) -> AppResult<()> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("native remote forward registry"))?
            .insert(
                NativeRemoteForwardKey {
                    address: address.into(),
                    port,
                },
                target,
            );
        Ok(())
    }

    pub(crate) fn unregister(&self, address: &str, port: u32) {
        let Ok(mut forwards) = self.inner.lock() else {
            return;
        };
        forwards.remove(&NativeRemoteForwardKey {
            address: address.to_owned(),
            port,
        });
    }

    fn resolve(&self, address: &str, port: u32) -> Option<NativeRemoteForwardTarget> {
        self.inner.lock().ok().and_then(|forwards| {
            forwards
                .get(&NativeRemoteForwardKey {
                    address: address.to_owned(),
                    port,
                })
                .cloned()
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum NativeHostKeyPolicy {
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

    fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send {
        let target = self
            .remote_forwards
            .resolve(connected_address, connected_port);
        async move {
            if let Some(target) = target {
                tokio::spawn(async move {
                    let _ = proxy_forwarded_tcpip_to_target(channel, target).await;
                });
            }
            Ok(())
        }
    }
}

pub(crate) fn build_native_command_execution(
    host: &RemoteHost,
    paths: &KerminalPaths,
    request: SshCommandRequest,
) -> AppResult<NativeSshCommandExecution> {
    let _route_plan = build_ssh_route_plan(host)?;
    let known_hosts_path = paths.root.join("known_hosts");
    build_native_command_execution_for_known_hosts(host, known_hosts_path, request)
}

pub(crate) fn build_native_command_execution_for_known_hosts(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    request: SshCommandRequest,
) -> AppResult<NativeSshCommandExecution> {
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

pub(crate) fn build_native_connection_execution(
    host: &RemoteHost,
    paths: &KerminalPaths,
    timeout_seconds: u64,
) -> AppResult<NativeSshCommandExecution> {
    let _route_plan = build_ssh_route_plan(host)?;
    let known_hosts_path = paths.root.join("known_hosts");
    build_native_connection_execution_for_known_hosts(host, known_hosts_path, timeout_seconds)
}

pub(crate) fn build_native_connection_execution_for_known_hosts(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    timeout_seconds: u64,
) -> AppResult<NativeSshCommandExecution> {
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

pub(crate) async fn execute_native_ssh_command(
    host: &RemoteHost,
    execution: NativeSshCommandExecution,
    cancel_token: CancellationToken,
) -> AppResult<SshCommandOutput> {
    if cancel_token.is_cancelled() {
        return Err(exec_cancelled_error());
    }
    let started = Instant::now();
    let timeout = Duration::from_secs(execution.timeout_seconds);
    match tokio::select! {
        result = tokio::time::timeout(timeout, execute_native_ssh_command_inner(host, execution)) => result,
        _ = cancel_token.cancelled() => return Err(exec_cancelled_error()),
    } {
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

pub(crate) async fn connect_native_command_target(
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
) -> AppResult<NativeSshConnectionChain> {
    connect_native_command_target_with_remote_forward_registry(
        execution,
        host_key_policy,
        NativeRemoteForwardRegistry::default(),
    )
    .await
}

pub(crate) async fn connect_native_command_target_with_remote_forward_registry(
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
) -> AppResult<NativeSshConnectionChain> {
    if execution.jumps.is_empty() {
        let mut target = connect_native_ssh(
            &execution.target,
            execution.timeout_seconds,
            host_key_policy,
            remote_forwards,
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
        NativeRemoteForwardRegistry::default(),
    )
    .await?;
    authenticate_native_ssh(&mut upstream, &execution.jumps[0]).await?;

    for jump in execution.jumps.iter().skip(1) {
        let mut next = connect_native_ssh_through_direct_tcpip(
            &upstream,
            jump,
            execution.timeout_seconds,
            host_key_policy,
            NativeRemoteForwardRegistry::default(),
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
        remote_forwards,
    )
    .await?;
    authenticate_native_ssh(&mut target, &execution.target).await?;
    jumps.push(upstream);

    Ok(NativeSshConnectionChain { jumps, target })
}

pub(crate) async fn disconnect_native_connection(
    connection: NativeSshConnectionChain,
    reason: &str,
) {
    disconnect_native_connection_ref(&connection, reason).await;
}

pub(crate) async fn disconnect_native_connection_ref(
    connection: &NativeSshConnectionChain,
    reason: &str,
) {
    let _ = connection
        .target
        .disconnect(russh::Disconnect::ByApplication, reason, "")
        .await;
    for jump in connection.jumps.iter().rev() {
        let _ = jump
            .disconnect(russh::Disconnect::ByApplication, reason, "")
            .await;
    }
}

pub(crate) async fn ping_native_connection_ref(
    connection: &NativeSshConnectionChain,
) -> AppResult<()> {
    connection
        .target
        .send_ping()
        .await
        .map_err(native_ssh_error)
}

pub(crate) async fn execute_script_on_native_connection(
    connection: &NativeSshConnectionChain,
    script: String,
    max_output_bytes: usize,
) -> AppResult<SshRuntimeExecRawOutput> {
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
        .data_bytes(script.into_bytes())
        .await
        .map_err(native_ssh_error)?;
    channel.eof().await.map_err(native_ssh_error)?;

    let mut stdout = LimitedRawOutputBuffer::new(max_output_bytes);
    let mut stderr = LimitedRawOutputBuffer::new(max_output_bytes);
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

    if exec_request_failed {
        return Err(AppError::SshCommand(
            "远端拒绝执行非交互命令请求".to_owned(),
        ));
    }

    Ok(SshRuntimeExecRawOutput {
        exit_code,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
    })
}

pub(crate) async fn open_streaming_exec_on_native_connection(
    connection: &NativeSshConnectionChain,
    command: String,
) -> AppResult<Channel<client::Msg>> {
    let channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    channel
        .exec(true, command)
        .await
        .map_err(native_ssh_error)?;
    Ok(channel)
}

pub(crate) async fn open_shell_on_native_connection(
    connection: &NativeSshConnectionChain,
    request: SshRuntimeShellRequest,
) -> AppResult<Channel<client::Msg>> {
    let channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    for (name, value) in request.env {
        channel
            .set_env(true, name, value)
            .await
            .map_err(native_ssh_error)?;
    }
    channel
        .request_pty(
            true,
            &request.term,
            u32::from(request.cols.max(1)),
            u32::from(request.rows.max(1)),
            request.pixel_width,
            request.pixel_height,
            &[] as &[(Pty, u32)],
        )
        .await
        .map_err(native_ssh_error)?;
    channel
        .request_shell(true)
        .await
        .map_err(native_ssh_error)?;
    Ok(channel)
}

pub(crate) async fn open_sftp_on_native_connection(
    connection: &NativeSshConnectionChain,
) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
    let channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(native_ssh_error)?;
    Ok(Box::new(channel.into_stream()))
}

pub(crate) async fn open_direct_tcpip_channel_on_native_connection(
    connection: &NativeSshConnectionChain,
    request: &NativeDirectTcpipProxyRequest,
) -> AppResult<Channel<client::Msg>> {
    connection
        .target
        .channel_open_direct_tcpip(
            request.target_host.clone(),
            u32::from(request.target_port),
            request.originator_host.clone(),
            u32::from(request.originator_port),
        )
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法打开 direct-tcpip 到 {}:{}: {error}",
                request.target_host, request.target_port
            ))
        })
}

pub(crate) async fn proxy_direct_tcpip_channel_to_stream(
    channel: Channel<client::Msg>,
    mut stream: tokio::net::TcpStream,
    target_host: &str,
    target_port: u16,
) -> AppResult<(u64, u64)> {
    let mut channel_stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut channel_stream)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "direct-tcpip 数据转发失败 {target_host}:{target_port}: {error}"
            ))
        })
}

pub(crate) async fn start_remote_tcpip_forward_on_native_connection(
    connection: &NativeSshConnectionChain,
    bind_host: String,
    bind_port: u16,
) -> AppResult<u32> {
    let requested_port = u32::from(bind_port);
    let allocated_port = connection
        .target
        .tcpip_forward(bind_host.clone(), requested_port)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法启动 remote tcpip-forward {}:{}: {error}",
                bind_host, bind_port
            ))
        })?;
    if requested_port == 0 {
        Ok(allocated_port)
    } else {
        Ok(requested_port)
    }
}

pub(crate) async fn cancel_remote_tcpip_forward_on_native_connection(
    connection: &NativeSshConnectionChain,
    bind_host: String,
    bind_port: u32,
) -> AppResult<()> {
    connection
        .target
        .cancel_tcpip_forward(bind_host.clone(), bind_port)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法取消 remote tcpip-forward {}:{}: {error}",
                bind_host, bind_port
            ))
        })
}

const SOCKS5_SUCCESS_REPLY: &[u8] = &[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
const SOCKS5_GENERAL_FAILURE_REPLY: &[u8] = &[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0];

async fn proxy_forwarded_tcpip_to_target(
    channel: Channel<client::Msg>,
    target: NativeRemoteForwardTarget,
) -> AppResult<(u64, u64)> {
    match target {
        NativeRemoteForwardTarget::Local { host, port } => {
            proxy_forwarded_tcpip_to_local_target(channel, host, port).await
        }
        NativeRemoteForwardTarget::Socks5LocalDynamic => {
            proxy_forwarded_tcpip_to_local_socks_target(channel).await
        }
    }
}

async fn proxy_forwarded_tcpip_to_local_target(
    channel: Channel<client::Msg>,
    host: String,
    port: u16,
) -> AppResult<(u64, u64)> {
    let mut local_stream = tokio::net::TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法连接 forwarded-tcpip 本机目标 {}:{}: {error}",
                host, port
            ))
        })?;
    let mut channel_stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut channel_stream, &mut local_stream)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "forwarded-tcpip 数据转发失败 {}:{}: {error}",
                host, port
            ))
        })
}

async fn proxy_forwarded_tcpip_to_local_socks_target(
    channel: Channel<client::Msg>,
) -> AppResult<(u64, u64)> {
    let mut channel_stream = channel.into_stream();
    let request = match read_socks5_connect_request(&mut channel_stream).await {
        Ok(request) => request,
        Err(error) => {
            let _ = channel_stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
            return Err(error);
        }
    };
    let mut local_stream =
        match tokio::net::TcpStream::connect((request.target_host.as_str(), request.target_port))
            .await
        {
            Ok(stream) => stream,
            Err(error) => {
                let _ = channel_stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
                return Err(AppError::SshCommand(format!(
                    "无法连接 remote dynamic SOCKS5 本机目标 {}:{}: {error}",
                    request.target_host, request.target_port
                )));
            }
        };
    channel_stream
        .write_all(SOCKS5_SUCCESS_REPLY)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!("SOCKS5 remote dynamic 成功响应写入失败: {error}"))
        })?;
    tokio::io::copy_bidirectional(&mut channel_stream, &mut local_stream)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "remote dynamic SOCKS5 数据转发失败 {}:{}: {error}",
                request.target_host, request.target_port
            ))
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Socks5ConnectRequest {
    target_host: String,
    target_port: u16,
}

async fn read_socks5_connect_request<S>(stream: &mut S) -> AppResult<Socks5ConnectRequest>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut greeting = [0_u8; 2];
    stream
        .read_exact(&mut greeting)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 握手读取失败: {error}")))?;
    if greeting[0] != 0x05 {
        return Err(AppError::SshCommand("只支持 SOCKS5 协议".to_owned()));
    }
    let method_count = usize::from(greeting[1]);
    let mut methods = vec![0_u8; method_count];
    stream
        .read_exact(&mut methods)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 认证方法读取失败: {error}")))?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await.map_err(|error| {
            AppError::SshCommand(format!("SOCKS5 认证拒绝响应写入失败: {error}"))
        })?;
        return Err(AppError::SshCommand(
            "SOCKS5 客户端未提供 no-auth 方法".to_owned(),
        ));
    }
    stream
        .write_all(&[0x05, 0x00])
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 认证响应写入失败: {error}")))?;

    let mut header = [0_u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 CONNECT 请求读取失败: {error}")))?;
    if header[0] != 0x05 {
        return Err(AppError::SshCommand(
            "SOCKS5 CONNECT 请求版本无效".to_owned(),
        ));
    }
    if header[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await
            .map_err(|error| AppError::SshCommand(format!("SOCKS5 拒绝响应写入失败: {error}")))?;
        return Err(AppError::SshCommand(
            "SOCKS5 只支持 CONNECT 命令".to_owned(),
        ));
    }
    let target_host = match header[3] {
        0x01 => {
            let mut octets = [0_u8; 4];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::SshCommand(format!("SOCKS5 IPv4 地址读取失败: {error}"))
            })?;
            std::net::Ipv4Addr::from(octets).to_string()
        }
        0x03 => {
            let mut length = [0_u8; 1];
            stream.read_exact(&mut length).await.map_err(|error| {
                AppError::SshCommand(format!("SOCKS5 域名长度读取失败: {error}"))
            })?;
            let mut domain = vec![0_u8; usize::from(length[0])];
            stream
                .read_exact(&mut domain)
                .await
                .map_err(|error| AppError::SshCommand(format!("SOCKS5 域名读取失败: {error}")))?;
            String::from_utf8(domain)
                .map_err(|_| AppError::SshCommand("SOCKS5 域名不是有效 UTF-8".to_owned()))?
        }
        0x04 => {
            let mut octets = [0_u8; 16];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::SshCommand(format!("SOCKS5 IPv6 地址读取失败: {error}"))
            })?;
            std::net::Ipv6Addr::from(octets).to_string()
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(|error| {
                    AppError::SshCommand(format!("SOCKS5 地址类型拒绝响应写入失败: {error}"))
                })?;
            return Err(AppError::SshCommand(
                "SOCKS5 CONNECT 地址类型不支持".to_owned(),
            ));
        }
    };
    let mut port_bytes = [0_u8; 2];
    stream
        .read_exact(&mut port_bytes)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 目标端口读取失败: {error}")))?;
    let target_port = u16::from_be_bytes(port_bytes);
    if target_port == 0 {
        return Err(AppError::SshCommand(
            "SOCKS5 CONNECT 目标端口必须大于 0".to_owned(),
        ));
    }
    Ok(Socks5ConnectRequest {
        target_host,
        target_port,
    })
}

async fn connect_native_ssh(
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: hop.host.clone(),
        host_key_policy,
        known_hosts_path: hop.known_hosts_path.clone(),
        port: hop.port,
        remote_forwards,
    };
    let timeout = Duration::from_secs(timeout_seconds.max(1));
    match tokio::time::timeout(
        timeout,
        client::connect(Arc::new(config), (hop.host.as_str(), hop.port), handler),
    )
    .await
    {
        Ok(result) => result.map_err(native_ssh_error),
        Err(_) => Err(AppError::SshCommand(format!(
            "SSH 连接超时（{} 秒）: {}@{}:{}",
            timeout.as_secs(),
            hop.username,
            hop.host,
            hop.port
        ))),
    }
}

fn exec_cancelled_error() -> AppError {
    AppError::SshCommand("远程命令已取消".to_owned())
}

async fn connect_native_ssh_through_direct_tcpip(
    upstream: &client::Handle<NativeCommandClientHandler>,
    hop: &NativeSshHopExecution,
    timeout_seconds: u64,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
) -> AppResult<client::Handle<NativeCommandClientHandler>> {
    let timeout = Duration::from_secs(timeout_seconds.max(1));
    let channel = match tokio::time::timeout(
        timeout,
        upstream.channel_open_direct_tcpip(hop.host.clone(), u32::from(hop.port), "127.0.0.1", 0),
    )
    .await
    {
        Ok(result) => result.map_err(|error| {
            AppError::SshCommand(format!(
                "无法通过跳板打开 direct-tcpip 到 {}@{}:{}: {error}",
                hop.username, hop.host, hop.port
            ))
        })?,
        Err(_) => {
            return Err(AppError::SshCommand(format!(
                "通过跳板打开 direct-tcpip 超时（{} 秒）: {}@{}:{}",
                timeout.as_secs(),
                hop.username,
                hop.host,
                hop.port
            )));
        }
    };
    let config = client::Config {
        inactivity_timeout: None,
        ..Default::default()
    };
    let handler = NativeCommandClientHandler {
        host: hop.host.clone(),
        host_key_policy,
        known_hosts_path: hop.known_hosts_path.clone(),
        port: hop.port,
        remote_forwards,
    };
    match tokio::time::timeout(
        timeout,
        client::connect_stream(Arc::new(config), channel.into_stream(), handler),
    )
    .await
    {
        Ok(result) => result.map_err(native_ssh_error),
        Err(_) => Err(AppError::SshCommand(format!(
            "SSH 跳板链路连接超时（{} 秒）: {}@{}:{}",
            timeout.as_secs(),
            hop.username,
            hop.host,
            hop.port
        ))),
    }
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

pub(crate) fn resolve_native_auth_material(host: &RemoteHost) -> AppResult<NativeSshAuthMaterial> {
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
                        passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
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
                NativeSshPrivateKey::Path {
                    path: resolve_identity_file_path(credential_ref)?,
                    passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
                },
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
                        passphrase: normalized_jump_key_passphrase_secret(jump)
                            .map(ToOwned::to_owned),
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
                NativeSshPrivateKey::Path {
                    path: resolve_identity_file_path(credential_ref)?,
                    passphrase: normalized_jump_key_passphrase_secret(jump).map(ToOwned::to_owned),
                },
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

fn normalized_key_passphrase_secret(host: &RemoteHost) -> Option<&str> {
    host.key_passphrase_secret
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

fn normalized_jump_key_passphrase_secret(jump: &SshJumpHostOptions) -> Option<&str> {
    jump.key_passphrase_secret
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

#[derive(Debug)]
struct LimitedRawOutputBuffer {
    captured: Vec<u8>,
    max_bytes: usize,
}

impl LimitedRawOutputBuffer {
    fn new(max_bytes: usize) -> Self {
        Self {
            captured: Vec::with_capacity(max_bytes.min(8 * 1024)),
            max_bytes,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        let remaining = self.max_bytes.saturating_sub(self.captured.len());
        if remaining == 0 {
            return;
        }
        let visible = bytes.len().min(remaining);
        self.captured.extend_from_slice(&bytes[..visible]);
    }

    fn finish(self) -> Vec<u8> {
        self.captured
    }
}

fn load_native_private_key(private_key: &NativeSshPrivateKey) -> AppResult<PrivateKey> {
    match private_key {
        NativeSshPrivateKey::Path { path, passphrase } => {
            load_secret_key(path, passphrase.as_deref()).map_err(key_error)
        }
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
