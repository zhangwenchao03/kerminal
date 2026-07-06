//! External SSH launch bridge envelope, endpoint, and local transport.
//!
//! @author kongweiguang

use std::{
    fmt,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    time::sleep,
};

use crate::error::{AppError, AppResult};

use super::{
    intake::{
        ExternalLaunchAcceptOutcome, ExternalLaunchEventPayload, ExternalLaunchIntake,
        ExternalLaunchQueued, ExternalLaunchRejected,
    },
    model::{ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchSourceTool},
    parser::ExternalLaunchParserRegistry,
};

pub const EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION: u16 = 1;
const EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES: usize = 64 * 1024;
const EXTERNAL_LAUNCH_BRIDGE_CONNECT_RETRY_DELAY: Duration = Duration::from_millis(15);

pub type ExternalLaunchBridgeEventSink =
    Arc<dyn Fn(ExternalLaunchEventPayload) + Send + Sync + 'static>;

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeEnvelope {
    pub schema_version: u16,
    pub persona: ExternalLaunchSourceTool,
    pub argv: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
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
            persona,
            argv,
            cwd: cwd
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        })
    }

    pub fn parse_input(&self) -> ExternalLaunchParseInput {
        ExternalLaunchParseInput::from_args(
            ExternalLaunchEntrypoint::ShimIpc,
            Some(self.persona),
            Some(self.persona.as_str().to_owned()),
            self.argv.clone(),
        )
    }

    pub fn redacted_argv(&self) -> Vec<String> {
        ExternalLaunchParserRegistry::new()
            .parse(&self.parse_input())
            .map(|request| request.diagnostics.argv_redacted)
            .unwrap_or_else(|_| redact_bridge_argv_fallback(&self.argv))
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
            .field("persona", &self.persona)
            .field("argv_redacted", &self.redacted_argv())
            .field("argv_count", &self.argv.len())
            .field("cwd_present", &self.cwd.is_some())
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeEndpoint {
    pub scope_id: String,
    pub windows_pipe_name: String,
    pub unix_socket_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchBridgeResponse {
    pub ok: bool,
    pub launch_id: Option<String>,
    pub pending_count: usize,
    pub message: Option<String>,
    pub event: Option<ExternalLaunchEventPayload>,
}

pub fn external_launch_bridge_endpoint(root: &Path) -> ExternalLaunchBridgeEndpoint {
    let scope_id = bridge_scope_id(root);
    ExternalLaunchBridgeEndpoint {
        windows_pipe_name: format!(r"\\.\pipe\kerminal-external-launch-{scope_id}"),
        unix_socket_path: root
            .join("runtime")
            .join(format!("external-launch-{scope_id}.sock"))
            .to_string_lossy()
            .into_owned(),
        scope_id,
    }
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

fn redact_bridge_argv_fallback(argv: &[String]) -> Vec<String> {
    let mut redacted = argv.to_vec();
    let mut redact_next = false;
    for token in &mut redacted {
        if redact_next {
            *token = "<redacted>".to_owned();
            redact_next = false;
            continue;
        }
        if is_secret_option(token) {
            redact_next = true;
            continue;
        }
        if token.starts_with("ssh://") {
            *token = redact_ssh_url_password(token);
        }
    }
    redacted
}

fn is_secret_option(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "-pw" | "-pwfile" | "/password" | "--password" | "--key-passphrase"
    )
}

fn redact_ssh_url_password(value: &str) -> String {
    let Some((scheme_user, rest)) = value.split_once('@') else {
        return value.to_owned();
    };
    let Some((scheme, _secret)) = scheme_user.rsplit_once(':') else {
        return value.to_owned();
    };
    format!("{scheme}:<redacted>@{rest}")
}

pub async fn send_external_launch_bridge_envelope(
    endpoint: &ExternalLaunchBridgeEndpoint,
    envelope: ExternalLaunchBridgeEnvelope,
    timeout: Duration,
) -> AppResult<ExternalLaunchBridgeResponse> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .unwrap_or_else(Instant::now);
    loop {
        match connect_bridge_stream(endpoint).await {
            Ok(stream) => {
                return tokio::time::timeout(
                    remaining_timeout(deadline),
                    send_envelope_over_stream(stream, envelope),
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
    run_bridge_server(endpoint, intake, event_sink).await
}

async fn send_envelope_over_stream<S>(
    mut stream: S,
    envelope: ExternalLaunchBridgeEnvelope,
) -> AppResult<ExternalLaunchBridgeResponse>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut frame = serde_json::to_vec(&envelope)?;
    if frame.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES {
        return Err(AppError::InvalidInput(
            "external launch bridge envelope is too large".to_owned(),
        ));
    }
    frame.push(b'\n');
    stream.write_all(&frame).await?;
    stream.flush().await?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let bytes_read = reader.read_line(&mut line).await?;
    if bytes_read == 0 || line.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES {
        return Err(bridge_unavailable_error());
    }
    serde_json::from_str(&line).map_err(AppError::from)
}

async fn handle_bridge_stream<S>(
    stream: S,
    intake: ExternalLaunchIntake,
    event_sink: ExternalLaunchBridgeEventSink,
) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let response = match reader.read_line(&mut line).await {
        Ok(0) => ExternalLaunchBridgeResponse::rejected_message(
            "external launch bridge received an empty envelope",
        ),
        Ok(_) if line.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES => {
            ExternalLaunchBridgeResponse::rejected_message(
                "external launch bridge envelope is too large",
            )
        }
        Ok(_) => match serde_json::from_str::<ExternalLaunchBridgeEnvelope>(&line) {
            Ok(envelope) => match intake.accept_bridge_envelope(envelope) {
                Ok(outcome) => {
                    let response = ExternalLaunchBridgeResponse::from_outcome(&outcome);
                    tauri_plugin_log::log::info!(
                        target: "external_launch.bridge",
                        "accepted shim envelope ok={} launch_id={:?} pending_count={} message={:?}",
                        response.ok,
                        response.launch_id,
                        response.pending_count,
                        response.message
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
            Err(_) => ExternalLaunchBridgeResponse::rejected_message(
                "external launch bridge received an invalid envelope",
            ),
        },
        Err(_) => ExternalLaunchBridgeResponse::rejected_message(
            "external launch bridge failed to read envelope",
        ),
    };

    let mut response_frame = serde_json::to_vec(&response)?;
    response_frame.push(b'\n');
    let stream = reader.get_mut();
    stream.write_all(&response_frame).await?;
    stream.flush().await?;
    Ok(())
}

impl ExternalLaunchBridgeResponse {
    fn from_outcome(outcome: &ExternalLaunchAcceptOutcome) -> Self {
        match outcome {
            ExternalLaunchAcceptOutcome::Noop(noop) => Self {
                ok: true,
                launch_id: None,
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
                launch_id: Some(launch_id.clone()),
                pending_count: *pending_count,
                message: None,
                event: outcome.event_payload(),
            },
            ExternalLaunchAcceptOutcome::Rejected(ExternalLaunchRejected { message, .. }) => Self {
                ok: false,
                launch_id: None,
                pending_count: 0,
                message: Some(message.clone()),
                event: outcome.event_payload(),
            },
        }
    }

    fn rejected_message(message: &str) -> Self {
        Self {
            ok: false,
            launch_id: None,
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
    use tokio::net::windows::named_pipe::ServerOptions;

    loop {
        let server = ServerOptions::new().create(&endpoint.windows_pipe_name)?;
        server.connect().await?;
        let intake = intake.clone();
        let event_sink = event_sink.clone();
        tokio::spawn(async move {
            let _ = handle_bridge_stream(server, intake, event_sink).await;
        });
    }
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
    if socket_path.exists() {
        tokio::fs::remove_file(&socket_path).await?;
    }
    let listener = tokio::net::UnixListener::bind(&socket_path)?;
    loop {
        let (stream, _) = listener.accept().await?;
        let intake = intake.clone();
        let event_sink = event_sink.clone();
        tokio::spawn(async move {
            let _ = handle_bridge_stream(stream, intake, event_sink).await;
        });
    }
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
