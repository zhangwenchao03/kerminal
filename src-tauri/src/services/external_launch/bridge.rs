//! External SSH launch bridge envelope, endpoint, and local transport.
//!
//! @author kongweiguang

use std::{
    fmt,
    path::Path,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    sync::Semaphore,
    time::sleep,
};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    intake::{
        ExternalLaunchAcceptOutcome, ExternalLaunchEventPayload, ExternalLaunchIntake,
        ExternalLaunchQueued, ExternalLaunchRejected,
    },
    model::{ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchSourceTool},
};

mod codec;
mod descriptor;
mod support;

use codec::{read_bridge_frame, write_bridge_frame};
use descriptor::{load_bridge_descriptor, prepare_server_endpoint};
use support::{
    direct_parent_command_line_for_args_bounded_impl, direct_parent_command_line_for_args_impl,
};

pub const EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION: u16 = 2;
const EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES: usize = 64 * 1024;
const EXTERNAL_LAUNCH_BRIDGE_MAX_DESCRIPTOR_BYTES: u64 = 8 * 1024;
const EXTERNAL_LAUNCH_BRIDGE_MAX_CONNECTIONS: usize = 16;
const EXTERNAL_LAUNCH_BRIDGE_CONNECT_RETRY_DELAY: Duration = Duration::from_millis(15);
const EXTERNAL_LAUNCH_BRIDGE_IO_TIMEOUT: Duration = Duration::from_secs(2);
const EXTERNAL_LAUNCH_BRIDGE_MAX_ENVELOPE_AGE: Duration = Duration::from_secs(10 * 60);
const EXTERNAL_LAUNCH_BRIDGE_MAX_FUTURE_SKEW: Duration = Duration::from_secs(60);
const EXTERNAL_LAUNCH_BRIDGE_RESTART_MIN_DELAY: Duration = Duration::from_millis(50);
const EXTERNAL_LAUNCH_BRIDGE_RESTART_MAX_DELAY: Duration = Duration::from_secs(2);

pub type ExternalLaunchBridgeEventSink =
    Arc<dyn Fn(ExternalLaunchEventPayload) + Send + Sync + 'static>;

/// Bridge 平台安全边界的可审计声明；`false` 表示真实残余，不能在发布口径中伪装为已落地。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeSecurityPolicy {
    pub capability_nonce_bits: usize,
    pub maximum_connections: usize,
    pub windows_reject_remote_clients: bool,
    pub windows_current_user_sid_acl: bool,
    pub unix_owner_only_socket: bool,
    pub unix_peer_uid_validation: bool,
}

pub const fn external_launch_bridge_security_policy() -> ExternalLaunchBridgeSecurityPolicy {
    ExternalLaunchBridgeSecurityPolicy {
        capability_nonce_bits: 256,
        maximum_connections: EXTERNAL_LAUNCH_BRIDGE_MAX_CONNECTIONS,
        windows_reject_remote_clients: true,
        windows_current_user_sid_acl: true,
        unix_owner_only_socket: true,
        unix_peer_uid_validation: true,
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeEnvelope {
    #[serde(rename = "protocolVersion", alias = "schemaVersion")]
    pub schema_version: u16,
    /// 调用方生成的稳定请求标识；重试必须复用它，供 intake 做幂等去重。
    #[serde(default)]
    pub request_id: String,
    /// 服务端进程代际。发送前由 descriptor 绑定，旧进程请求必须 fail closed。
    #[serde(default)]
    pub app_generation: String,
    /// descriptor 中的 capability；不得写入 Debug、日志或 diagnostics。
    #[serde(default)]
    pub nonce: String,
    /// envelope 创建时的 Unix 毫秒时间，用于拒绝过期或明显超前的重放。
    #[serde(default)]
    pub timestamp_ms: u64,
    pub persona: ExternalLaunchSourceTool,
    pub argv: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_command_line: Option<String>,
}

impl ExternalLaunchBridgeEnvelope {
    pub fn new(
        persona: ExternalLaunchSourceTool,
        argv: Vec<String>,
        cwd: Option<String>,
    ) -> AppResult<Self> {
        if argv.is_empty() {
            return Err(AppError::InvalidInput(
                "external launch bridge argv must not be empty".to_owned(),
            ));
        }
        Ok(Self {
            schema_version: EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION,
            request_id: Uuid::new_v4().to_string(),
            app_generation: String::new(),
            nonce: String::new(),
            timestamp_ms: unix_timestamp_ms(),
            persona,
            argv,
            cwd: cwd
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
            parent_command_line: None,
        })
    }

    pub fn with_parent_command_line(mut self, parent_command_line: Option<String>) -> Self {
        self.parent_command_line = parent_command_line
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        self
    }

    pub fn parse_input(&self) -> ExternalLaunchParseInput {
        ExternalLaunchParseInput::from_args_with_parent_command_line(
            ExternalLaunchEntrypoint::ShimIpc,
            Some(self.persona),
            Some(self.persona.as_str().to_owned()),
            self.argv.clone(),
            self.parent_command_line.clone(),
        )
    }

    pub fn redacted_argv(&self) -> Vec<String> {
        super::redaction::public_argv_shape(&self.argv)
    }

    pub fn diagnostics(&self) -> ExternalLaunchBridgeDiagnostics {
        ExternalLaunchBridgeDiagnostics {
            schema_version: self.schema_version,
            persona: self.persona,
            argv_redacted: self.redacted_argv(),
            argv_count: self.argv.len(),
            cwd_present: self.cwd.is_some(),
        }
    }
}

impl fmt::Debug for ExternalLaunchBridgeEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchBridgeEnvelope")
            .field("schema_version", &self.schema_version)
            .field(
                "request_hash",
                &super::redaction::opaque_id_hash(&self.request_id),
            )
            .field("app_generation", &self.app_generation)
            .field("timestamp_ms", &self.timestamp_ms)
            .field("persona", &self.persona)
            .field("argv_redacted", &self.redacted_argv())
            .field("argv_count", &self.argv.len())
            .field("cwd_present", &self.cwd.is_some())
            .field(
                "parent_command_line_present",
                &self.parent_command_line.is_some(),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeDiagnostics {
    pub schema_version: u16,
    pub persona: ExternalLaunchSourceTool,
    pub argv_redacted: Vec<String>,
    pub argv_count: usize,
    pub cwd_present: bool,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeEndpoint {
    pub scope_id: String,
    pub windows_pipe_name: String,
    pub unix_socket_path: String,
    pub descriptor_path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub app_generation: String,
    #[serde(skip)]
    pub nonce: String,
}

impl fmt::Debug for ExternalLaunchBridgeEndpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchBridgeEndpoint")
            .field("scope_id", &self.scope_id)
            .field("windows_pipe_name", &self.windows_pipe_name)
            .field("unix_socket_path", &self.unix_socket_path)
            .field("descriptor_path", &self.descriptor_path)
            .field("app_generation", &self.app_generation)
            .field("nonce_present", &(!self.nonce.is_empty()))
            .finish()
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalLaunchBridgeDescriptor {
    protocol_version: u16,
    scope_id: String,
    windows_pipe_name: String,
    unix_socket_path: String,
    app_generation: String,
    nonce: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeResponse {
    pub ok: bool,
    pub request_hash: Option<String>,
    pub pending_count: usize,
    pub message: Option<String>,
    pub event: Option<ExternalLaunchEventPayload>,
}

pub fn external_launch_bridge_endpoint(root: &Path) -> ExternalLaunchBridgeEndpoint {
    let scope_id = bridge_scope_id(root);
    let runtime_dir = root.join("runtime");
    ExternalLaunchBridgeEndpoint {
        windows_pipe_name: format!(r"\\.\pipe\kerminal-external-launch-{scope_id}"),
        unix_socket_path: runtime_dir
            .join(format!("external-launch-{scope_id}.sock"))
            .to_string_lossy()
            .into_owned(),
        descriptor_path: runtime_dir
            .join(format!("external-launch-{scope_id}.json"))
            .to_string_lossy()
            .into_owned(),
        app_generation: String::new(),
        nonce: String::new(),
        scope_id,
    }
}

pub fn direct_parent_command_line_for_args(argv: &[String]) -> Option<String> {
    direct_parent_command_line_for_args_impl(argv)
}

/// 在 blocking worker 中执行有进程级 deadline 的父命令行发现，供窗口启动回调异步派发。
pub async fn direct_parent_command_line_for_args_bounded(argv: Vec<String>) -> Option<String> {
    direct_parent_command_line_for_args_bounded_impl(argv).await
}

fn bridge_scope_id(root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub async fn send_external_launch_bridge_envelope(
    endpoint: &ExternalLaunchBridgeEndpoint,
    mut envelope: ExternalLaunchBridgeEnvelope,
    timeout: Duration,
) -> AppResult<ExternalLaunchBridgeResponse> {
    // descriptor 不可用时也要先拒绝本地超大输入，避免错误重试掩盖资源策略。
    if serde_json::to_vec(&envelope)?.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES {
        return Err(AppError::InvalidInput(
            "external launch bridge envelope is too large".to_owned(),
        ));
    }
    let deadline = Instant::now()
        .checked_add(timeout)
        .unwrap_or_else(Instant::now);
    loop {
        let resolved_endpoint = match load_bridge_descriptor(endpoint).await {
            Ok(endpoint) => endpoint,
            Err(_) if Instant::now() < deadline => {
                sleep(EXTERNAL_LAUNCH_BRIDGE_CONNECT_RETRY_DELAY).await;
                continue;
            }
            Err(_) => return Err(bridge_unavailable_error()),
        };
        envelope.app_generation = resolved_endpoint.app_generation.clone();
        envelope.nonce = resolved_endpoint.nonce.clone();
        match connect_bridge_stream(&resolved_endpoint).await {
            Ok(stream) => {
                return tokio::time::timeout(
                    remaining_timeout(deadline),
                    send_envelope_over_stream(stream, envelope.clone()),
                )
                .await
                .map_err(|_| bridge_unavailable_error())?;
            }
            Err(_) if Instant::now() < deadline => {
                sleep(EXTERNAL_LAUNCH_BRIDGE_CONNECT_RETRY_DELAY).await;
            }
            Err(_) => return Err(bridge_unavailable_error()),
        }
    }
}

pub async fn run_external_launch_bridge_server(
    endpoint: ExternalLaunchBridgeEndpoint,
    intake: ExternalLaunchIntake,
    event_sink: ExternalLaunchBridgeEventSink,
) -> AppResult<()> {
    let mut retry_delay = EXTERNAL_LAUNCH_BRIDGE_RESTART_MIN_DELAY;
    loop {
        let prepared = match prepare_server_endpoint(endpoint.clone()).await {
            Ok(prepared) => prepared,
            Err(error) => {
                intake.set_bridge_listening(false, None).ok();
                intake.record_bridge_restart().ok();
                tauri_plugin_log::log::warn!(
                    target: "external_launch.bridge",
                    "bridge descriptor preparation failed; retrying: {error}"
                );
                sleep(retry_delay).await;
                retry_delay = (retry_delay * 2).min(EXTERNAL_LAUNCH_BRIDGE_RESTART_MAX_DELAY);
                continue;
            }
        };
        intake
            .set_bridge_listening(true, Some(&prepared.app_generation))
            .ok();
        match run_bridge_server(prepared, intake.clone(), event_sink.clone()).await {
            Ok(()) => {
                intake.set_bridge_listening(false, None).ok();
                return Ok(());
            }
            Err(error) => {
                intake.set_bridge_listening(false, None).ok();
                intake.record_bridge_restart().ok();
                tauri_plugin_log::log::warn!(
                    target: "external_launch.bridge",
                    "bridge server stopped; retrying: {error}"
                );
                sleep(retry_delay).await;
                retry_delay = (retry_delay * 2).min(EXTERNAL_LAUNCH_BRIDGE_RESTART_MAX_DELAY);
            }
        }
    }
}

async fn send_envelope_over_stream<S>(
    mut stream: S,
    envelope: ExternalLaunchBridgeEnvelope,
) -> AppResult<ExternalLaunchBridgeResponse>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let frame = serde_json::to_vec(&envelope)?;
    if frame.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES {
        return Err(AppError::InvalidInput(
            "external launch bridge envelope is too large".to_owned(),
        ));
    }
    write_bridge_frame(&mut stream, &frame).await?;
    let response = read_bridge_frame(&mut stream)
        .await
        .map_err(|_| bridge_unavailable_error())?;
    serde_json::from_slice(&response).map_err(AppError::from)
}

async fn handle_bridge_stream<S>(
    mut stream: S,
    intake: ExternalLaunchIntake,
    event_sink: ExternalLaunchBridgeEventSink,
    endpoint: ExternalLaunchBridgeEndpoint,
) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let response = match read_bridge_frame(&mut stream).await {
        Ok(frame) => match serde_json::from_slice::<ExternalLaunchBridgeEnvelope>(&frame) {
            Ok(envelope) => match validate_bridge_envelope(&envelope, &endpoint) {
                Err(message) => ExternalLaunchBridgeResponse::rejected_message(message),
                Ok(()) => match intake.accept_bridge_envelope_bounded(envelope).await {
                    Ok(outcome) => {
                        let response = ExternalLaunchBridgeResponse::from_outcome(&outcome);
                        tauri_plugin_log::log::info!(
                            target: "external_launch.bridge",
                            "accepted shim envelope ok={} request_hash_present={} pending_count={} message_present={}",
                            response.ok,
                            response.request_hash.is_some(),
                            response.pending_count,
                            response.message.is_some()
                        );
                        if let Some(payload) = outcome.event_payload() {
                            event_sink(payload);
                        }
                        response
                    }
                    Err(error) => {
                        tauri_plugin_log::log::warn!(
                            target: "external_launch.bridge",
                            "failed to accept shim envelope: {error}"
                        );
                        ExternalLaunchBridgeResponse::rejected_message(
                            "external launch bridge failed to accept envelope",
                        )
                    }
                },
            },
            Err(_) => ExternalLaunchBridgeResponse::rejected_message(
                "external launch bridge received an invalid envelope",
            ),
        },
        Err(error) => ExternalLaunchBridgeResponse::rejected_message(error.public_message()),
    };

    let response_frame = serde_json::to_vec(&response)?;
    write_bridge_frame(&mut stream, &response_frame).await
}

async fn handle_tracked_bridge_stream<S>(
    stream: S,
    intake: ExternalLaunchIntake,
    event_sink: ExternalLaunchBridgeEventSink,
    endpoint: ExternalLaunchBridgeEndpoint,
) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    intake.bridge_client_started()?;
    let result = handle_bridge_stream(stream, intake.clone(), event_sink, endpoint).await;
    intake.bridge_client_finished().ok();
    result
}

fn validate_bridge_envelope(
    envelope: &ExternalLaunchBridgeEnvelope,
    endpoint: &ExternalLaunchBridgeEndpoint,
) -> Result<(), &'static str> {
    if envelope.schema_version != EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION {
        return Err("external launch bridge upgrade_required");
    }
    let request_id = envelope.request_id.trim();
    let parsed_request_id = Uuid::parse_str(request_id)
        .map_err(|_| "external launch bridge request id must be a canonical UUID v4")?;
    if parsed_request_id.get_version_num() != 4
        || parsed_request_id.hyphenated().to_string() != request_id
    {
        return Err("external launch bridge request id must be a canonical UUID v4");
    }
    if envelope.app_generation != endpoint.app_generation
        || !capability_matches(&envelope.nonce, &endpoint.nonce)
    {
        return Err("external launch bridge authentication failed");
    }
    let now = unix_timestamp_ms();
    let maximum_age = EXTERNAL_LAUNCH_BRIDGE_MAX_ENVELOPE_AGE.as_millis() as u64;
    let maximum_future_skew = EXTERNAL_LAUNCH_BRIDGE_MAX_FUTURE_SKEW.as_millis() as u64;
    if envelope.timestamp_ms == 0
        || now.saturating_sub(envelope.timestamp_ms) > maximum_age
        || envelope.timestamp_ms.saturating_sub(now) > maximum_future_skew
    {
        return Err("external launch bridge envelope is stale");
    }
    Ok(())
}

fn capability_matches(candidate: &str, expected: &str) -> bool {
    !candidate.is_empty()
        && !expected.is_empty()
        && Sha256::digest(candidate.as_bytes()) == Sha256::digest(expected.as_bytes())
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

impl ExternalLaunchBridgeResponse {
    fn from_outcome(outcome: &ExternalLaunchAcceptOutcome) -> Self {
        match outcome {
            ExternalLaunchAcceptOutcome::Noop(noop) => Self {
                ok: true,
                request_hash: None,
                pending_count: 0,
                message: Some(noop.reason.clone()),
                event: None,
            },
            ExternalLaunchAcceptOutcome::Queued(ExternalLaunchQueued {
                launch_id,
                pending_count,
                ..
            }) => Self {
                ok: true,
                request_hash: Some(super::redaction::opaque_id_hash(launch_id)),
                pending_count: *pending_count,
                message: None,
                event: None,
            },
            ExternalLaunchAcceptOutcome::Rejected(ExternalLaunchRejected { message, .. }) => Self {
                ok: false,
                request_hash: None,
                pending_count: 0,
                message: Some(message.clone()),
                event: None,
            },
        }
    }

    fn rejected_message(message: &str) -> Self {
        Self {
            ok: false,
            request_hash: None,
            pending_count: 0,
            message: Some(message.to_owned()),
            event: None,
        }
    }
}

fn bridge_unavailable_error() -> AppError {
    AppError::InvalidInput("external launch bridge unavailable or timed out".to_owned())
}

fn remaining_timeout(deadline: Instant) -> Duration {
    deadline
        .checked_duration_since(Instant::now())
        .unwrap_or_else(|| Duration::from_millis(1))
}

#[cfg(windows)]
async fn connect_bridge_stream(
    endpoint: &ExternalLaunchBridgeEndpoint,
) -> AppResult<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new()
        .open(&endpoint.windows_pipe_name)
        .map_err(|_| bridge_unavailable_error())
}

#[cfg(unix)]
async fn connect_bridge_stream(
    endpoint: &ExternalLaunchBridgeEndpoint,
) -> AppResult<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(&endpoint.unix_socket_path)
        .await
        .map_err(|_| bridge_unavailable_error())
}

#[cfg(not(any(unix, windows)))]
async fn connect_bridge_stream(_endpoint: &ExternalLaunchBridgeEndpoint) -> AppResult<()> {
    Err(bridge_unavailable_error())
}

#[cfg(windows)]
async fn run_bridge_server(
    endpoint: ExternalLaunchBridgeEndpoint,
    intake: ExternalLaunchIntake,
    event_sink: ExternalLaunchBridgeEventSink,
) -> AppResult<()> {
    let permits = Arc::new(Semaphore::new(EXTERNAL_LAUNCH_BRIDGE_MAX_CONNECTIONS));
    loop {
        // 先取得 permit 再接受连接，保证慢客户端最多占用固定数量的 handler task。
        let permit = permits.clone().acquire_owned().await.map_err(|_| {
            AppError::InvalidInput("external launch bridge server is shutting down".to_owned())
        })?;
        let server = match create_windows_pipe_server(&endpoint.windows_pipe_name) {
            Ok(server) => server,
            Err(error) => {
                drop(permit);
                tauri_plugin_log::log::warn!(
                    target: "external_launch.bridge",
                    "failed to create bridge pipe listener: {error}"
                );
                sleep(EXTERNAL_LAUNCH_BRIDGE_CONNECT_RETRY_DELAY).await;
                continue;
            }
        };
        if let Err(error) = server.connect().await {
            drop(permit);
            tauri_plugin_log::log::warn!(
                target: "external_launch.bridge",
                "failed to accept bridge pipe client: {error}"
            );
            continue;
        }
        let intake = intake.clone();
        let event_sink = event_sink.clone();
        let endpoint = endpoint.clone();
        tokio::spawn(async move {
            let _permit = permit;
            if let Err(error) =
                handle_tracked_bridge_stream(server, intake, event_sink, endpoint).await
            {
                tauri_plugin_log::log::warn!(
                    target: "external_launch.bridge",
                    "bridge client handling failed: {error}"
                );
            }
        });
    }
}

/// 使用受保护 DACL 创建 named pipe：SYSTEM 与对象 owner（当前用户）拥有完全访问权。
///
/// `OW` 是 Windows Owner Rights SID；对象 owner 由当前进程 token 设置，因此同机其它用户
/// 即使猜到 pipe 名也无法打开。nonce 仍用于抵御同用户进程误调用和 stale generation。
#[cfg(windows)]
fn create_windows_pipe_server(
    pipe_name: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use std::{ffi::c_void, ptr};

    use tokio::net::windows::named_pipe::ServerOptions;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            },
            PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
        },
    };

    let sddl = "D:P(A;;GA;;;SY)(A;;GA;;;OW)\0"
        .encode_utf16()
        .collect::<Vec<_>>();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let result = unsafe {
        ServerOptions::new()
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(
                pipe_name,
                &mut attributes as *mut SECURITY_ATTRIBUTES as *mut c_void,
            )
    };
    unsafe {
        let _ = LocalFree(descriptor);
    }
    result
}

#[cfg(unix)]
async fn run_bridge_server(
    endpoint: ExternalLaunchBridgeEndpoint,
    intake: ExternalLaunchIntake,
    event_sink: ExternalLaunchBridgeEventSink,
) -> AppResult<()> {
    let socket_path = std::path::PathBuf::from(&endpoint.unix_socket_path);
    if let Some(parent) = socket_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if tokio::fs::try_exists(&socket_path).await? {
        tokio::fs::remove_file(&socket_path).await?;
    }
    let listener = tokio::net::UnixListener::bind(&socket_path)?;
    restrict_unix_socket_permissions(&socket_path).await?;
    let socket_owner_uid = unix_socket_owner_uid(&socket_path).await?;
    let permits = Arc::new(Semaphore::new(EXTERNAL_LAUNCH_BRIDGE_MAX_CONNECTIONS));
    loop {
        let permit = permits.clone().acquire_owned().await.map_err(|_| {
            AppError::InvalidInput("external launch bridge server is shutting down".to_owned())
        })?;
        let (stream, _) = match listener.accept().await {
            Ok(connection) => connection,
            Err(error) => {
                drop(permit);
                tauri_plugin_log::log::warn!(
                    target: "external_launch.bridge",
                    "failed to accept bridge unix client: {error}"
                );
                continue;
            }
        };
        if stream.peer_cred()?.uid() != socket_owner_uid {
            drop(permit);
            tauri_plugin_log::log::warn!(
                target: "external_launch.bridge",
                "rejected bridge unix client with mismatched peer uid"
            );
            continue;
        }
        let intake = intake.clone();
        let event_sink = event_sink.clone();
        let endpoint = endpoint.clone();
        tokio::spawn(async move {
            let _permit = permit;
            if let Err(error) =
                handle_tracked_bridge_stream(stream, intake, event_sink, endpoint).await
            {
                tauri_plugin_log::log::warn!(
                    target: "external_launch.bridge",
                    "bridge client handling failed: {error}"
                );
            }
        });
    }
}

#[cfg(unix)]
async fn restrict_unix_socket_permissions(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    Ok(())
}

#[cfg(unix)]
async fn unix_socket_owner_uid(path: &Path) -> AppResult<u32> {
    use std::os::unix::fs::MetadataExt;

    Ok(tokio::fs::metadata(path).await?.uid())
}

#[cfg(not(any(unix, windows)))]
async fn run_bridge_server(
    _endpoint: ExternalLaunchBridgeEndpoint,
    _intake: ExternalLaunchIntake,
    _event_sink: ExternalLaunchBridgeEventSink,
) -> AppResult<()> {
    Err(AppError::InvalidInput(
        "external launch bridge is unsupported on this platform".to_owned(),
    ))
}
