//! External SSH launch bridge tests.
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    external_launch_bridge_endpoint, run_external_launch_bridge_server,
    send_external_launch_bridge_envelope, ExternalLaunchBridgeEnvelope, ExternalLaunchEntrypoint,
    ExternalLaunchEventKind, ExternalLaunchEventPayload, ExternalLaunchIntake,
    ExternalLaunchParserRegistry, ExternalLaunchSourceTool,
};
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const BRIDGE_PASSWORD: &str = "KERM_BRIDGE_PASSWORD_DO_NOT_USE";
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(2);

#[test]
fn bridge_envelope_parse_input_preserves_persona_and_shim_entrypoint() {
    let envelope = putty_bridge_envelope();
    let input = envelope.parse_input();

    assert_eq!(input.entrypoint, ExternalLaunchEntrypoint::ShimIpc);
    assert_eq!(input.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(input.persona.as_deref(), Some("putty"));

    let request = ExternalLaunchParserRegistry::new()
        .parse(&input)
        .expect("parse bridge envelope as putty launch");

    assert_eq!(request.source.entrypoint, ExternalLaunchEntrypoint::ShimIpc);
    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(request.target.host, "bridge.example.internal");
    assert_eq!(request.target.port, 2202);
    assert_eq!(request.target.username.as_deref(), Some("deploy"));
}

#[test]
fn bridge_v2_envelope_has_unique_request_identity_and_fresh_timestamp() {
    let first = putty_bridge_envelope();
    let second = putty_bridge_envelope();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time after epoch")
        .as_millis() as u64;

    assert_eq!(first.schema_version, 2);
    assert!(!first.request_id.is_empty());
    assert_ne!(first.request_id, second.request_id);
    assert!(first.timestamp_ms <= now);
    assert!(now - first.timestamp_ms < 1_000);
    assert!(first.app_generation.is_empty());
    assert!(first.nonce.is_empty());

    let json = serde_json::to_value(&first).expect("serialize bridge v2 envelope");
    assert_eq!(json["protocolVersion"], 2);
    assert_eq!(json["requestId"], first.request_id);
    assert_eq!(json["timestampMs"], first.timestamp_ms);
    assert!(json.get("schemaVersion").is_none());
}

#[test]
fn bridge_envelope_debug_and_diagnostics_redact_secret_argv() {
    let envelope = putty_bridge_envelope();

    let debug = format!("{envelope:?}");
    let diagnostics = envelope.diagnostics();
    let diagnostics_json = serde_json::to_string(&diagnostics).expect("serialize diagnostics");

    assert!(!debug.contains(BRIDGE_PASSWORD));
    assert!(!debug.contains(&envelope.request_id));
    assert!(debug.contains("request_hash"));
    assert!(!diagnostics_json.contains(BRIDGE_PASSWORD));
    assert!(!diagnostics_json.contains("bridge.example.internal"));
    assert!(!diagnostics_json.contains("deploy"));
    assert!(diagnostics
        .argv_redacted
        .iter()
        .all(|arg| matches!(arg.as_str(), "<executable>" | "<option>" | "<argument>")));
    assert_eq!(diagnostics.argv_count, envelope.argv.len());
}

#[test]
fn bridge_endpoint_uses_hashed_scope_without_raw_root_in_pipe_name() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());

    assert!(endpoint
        .windows_pipe_name
        .starts_with(r"\\.\pipe\kerminal-external-launch-"));
    assert!(endpoint.unix_socket_path.ends_with(".sock"));
    assert_eq!(endpoint.scope_id.len(), 16);
    assert!(!endpoint
        .windows_pipe_name
        .contains(&home.path().to_string_lossy().to_string()));
}

#[test]
fn bridge_security_policy_requires_windows_owner_dacl() {
    let policy =
        kerminal_lib::services::external_launch::bridge::external_launch_bridge_security_policy();

    assert_eq!(policy.capability_nonce_bits, 256);
    assert_eq!(policy.maximum_connections, 16);
    assert!(policy.windows_reject_remote_clients);
    assert!(policy.windows_current_user_sid_acl);
    assert!(policy.unix_owner_only_socket);
    assert!(policy.unix_peer_uid_validation);
}

#[tokio::test]
async fn bridge_server_client_delivers_envelope_to_intake() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake.clone(), events.clone());

    let response =
        send_external_launch_bridge_envelope(&endpoint, putty_bridge_envelope(), BRIDGE_TIMEOUT)
            .await
            .expect("send bridge envelope");

    assert!(response.ok);
    assert_eq!(response.pending_count, 1);
    assert!(response.event.is_none());
    assert_eq!(response.request_hash.as_deref().map(str::len), Some(12));
    let response_json = serde_json::to_string(&response).expect("serialize response");
    assert!(!response_json.contains(BRIDGE_PASSWORD));
    assert!(!response_json.contains("bridge.example.internal"));
    assert!(!response_json.contains("deploy"));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].source.entrypoint,
        ExternalLaunchEntrypoint::ShimIpc
    );
    assert_eq!(pending[0].source.tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(pending[0].target.host, "bridge.example.internal");
    assert_eq!(pending[0].target.port, 2202);
    assert_eq!(pending[0].target.username.as_deref(), Some("deploy"));

    let events = events.lock().expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, ExternalLaunchEventKind::Queued);

    server.abort();
}

#[tokio::test]
async fn bridge_rejects_invalid_envelope_without_secret_leak() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake.clone(), events.clone());
    let mut envelope = putty_bridge_envelope();
    envelope.schema_version = 999;

    let response = send_external_launch_bridge_envelope(&endpoint, envelope, BRIDGE_TIMEOUT)
        .await
        .expect("send invalid bridge envelope");

    assert!(!response.ok);
    assert_eq!(response.pending_count, 0);
    assert!(response.event.is_none());
    assert_eq!(
        response.message.as_deref(),
        Some("external launch bridge upgrade_required")
    );
    let response_json = serde_json::to_string(&response).expect("serialize response");
    assert!(!response_json.contains(BRIDGE_PASSWORD));
    assert!(!format!("{intake:?}").contains(BRIDGE_PASSWORD));
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);

    server.abort();
}

#[tokio::test]
async fn bridge_rejects_non_canonical_or_non_v4_request_id() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake, events);
    let mut envelope = putty_bridge_envelope();
    envelope.request_id = "caller-controlled-request-id".to_owned();

    let response = send_external_launch_bridge_envelope(&endpoint, envelope, BRIDGE_TIMEOUT)
        .await
        .expect("send invalid request id");
    assert!(!response.ok);
    assert_eq!(
        response.message.as_deref(),
        Some("external launch bridge request id must be a canonical UUID v4")
    );

    server.abort();
}

#[tokio::test]
async fn bridge_unavailable_error_is_redacted() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());

    let error = send_external_launch_bridge_envelope(
        &endpoint,
        putty_bridge_envelope(),
        Duration::from_millis(50),
    )
    .await
    .expect_err("bridge should be unavailable");

    let message = error.to_string();
    assert!(message.contains("external launch bridge unavailable or timed out"));
    assert!(!message.contains(BRIDGE_PASSWORD));
}

#[tokio::test]
async fn bridge_concurrent_clicks_queue_all_launches() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake.clone(), events.clone());
    let mut tasks = Vec::new();
    let mut expected_hosts = BTreeSet::new();

    for index in 0..50 {
        let endpoint = endpoint.clone();
        let host = format!("bridge-{index}.example.internal");
        expected_hosts.insert(host.clone());
        tasks.push(tokio::spawn(async move {
            let envelope = putty_bridge_envelope_for(
                &host,
                2200 + index,
                &format!("KERM_BRIDGE_CONCURRENT_SECRET_{index}_DO_NOT_USE"),
            );
            send_external_launch_bridge_envelope(&endpoint, envelope, BRIDGE_TIMEOUT).await
        }));
    }

    for task in tasks {
        let response = task
            .await
            .expect("bridge send task")
            .expect("bridge response");
        assert!(response.ok);
        assert!(response.event.is_none());
        assert_eq!(response.request_hash.as_deref().map(str::len), Some(12));
    }

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 50);
    let actual_hosts = pending
        .iter()
        .map(|request| request.target.host.clone())
        .collect::<BTreeSet<_>>();
    assert_eq!(actual_hosts, expected_hosts);
    let debug = format!("{pending:?}");
    assert!(!debug.contains("KERM_BRIDGE_CONCURRENT_SECRET_"));
    assert_eq!(events.lock().expect("events").len(), 50);

    server.abort();
}

#[tokio::test]
async fn bridge_rejects_oversized_envelope_before_transport_allocation() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let mut envelope = putty_bridge_envelope();
    envelope.argv.push("x".repeat(65 * 1024));

    let error = send_external_launch_bridge_envelope(&endpoint, envelope, BRIDGE_TIMEOUT)
        .await
        .expect_err("oversized envelope must be rejected");

    assert!(error.to_string().contains("envelope is too large"));
}

#[tokio::test]
async fn bridge_rejects_wrong_capability_before_intake() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake.clone(), events.clone());
    let descriptor = wait_for_descriptor(&endpoint).await;
    let mut envelope = putty_bridge_envelope();
    envelope.app_generation = descriptor.app_generation.clone();
    envelope.nonce = "wrong-capability-must-fail-closed".to_owned();

    let response = send_raw_envelope(&descriptor, &envelope).await;

    assert!(!response.ok);
    assert_eq!(
        response.message.as_deref(),
        Some("external launch bridge authentication failed")
    );
    assert!(intake.take_pending().expect("take pending").is_empty());
    assert!(events.lock().expect("events").is_empty());
    server.abort();
}

#[tokio::test]
async fn bridge_v1_fails_closed_with_upgrade_required() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let server = spawn_bridge_server(
        endpoint.clone(),
        intake.clone(),
        Arc::new(Mutex::new(Vec::new())),
    );
    let descriptor = wait_for_descriptor(&endpoint).await;
    let mut envelope = putty_bridge_envelope();
    envelope.schema_version = 1;
    envelope.app_generation = descriptor.app_generation.clone();
    envelope.nonce = descriptor.nonce.clone();

    let response = send_raw_envelope(&descriptor, &envelope).await;

    assert!(!response.ok);
    assert_eq!(
        response.message.as_deref(),
        Some("external launch bridge upgrade_required")
    );
    assert!(intake.take_pending().expect("take pending").is_empty());
    server.abort();
}

#[tokio::test]
async fn bridge_rejects_oversized_length_header_and_remains_available() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let server = spawn_bridge_server(
        endpoint.clone(),
        intake.clone(),
        Arc::new(Mutex::new(Vec::new())),
    );
    let descriptor = wait_for_descriptor(&endpoint).await;

    let response = send_raw_frame(&descriptor, &(1024_u32 * 1024).to_be_bytes()).await;
    assert!(!response.ok);
    assert_eq!(
        response.message.as_deref(),
        Some("external launch bridge envelope is too large")
    );

    let healthy =
        send_external_launch_bridge_envelope(&endpoint, putty_bridge_envelope(), BRIDGE_TIMEOUT)
            .await
            .expect("bridge remains available after oversized frame");
    assert!(healthy.ok);
    server.abort();
}

#[tokio::test]
async fn bridge_times_out_partial_frame_and_remains_available() {
    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let server = spawn_bridge_server(endpoint.clone(), intake, Arc::new(Mutex::new(Vec::new())));
    let descriptor = wait_for_descriptor(&endpoint).await;

    let response = send_slow_partial_frame(&descriptor).await;
    assert!(!response.ok);
    assert_eq!(
        response.message.as_deref(),
        Some("external launch bridge envelope read timed out")
    );

    let healthy =
        send_external_launch_bridge_envelope(&endpoint, putty_bridge_envelope(), BRIDGE_TIMEOUT)
            .await
            .expect("bridge remains available after partial frame timeout");
    assert!(healthy.ok);
    server.abort();
}

#[cfg(unix)]
#[tokio::test]
async fn bridge_descriptor_and_socket_are_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempdir().expect("temp kerminal root");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let server = spawn_bridge_server(
        endpoint.clone(),
        ExternalLaunchIntake::new(),
        Arc::new(Mutex::new(Vec::new())),
    );
    let descriptor = wait_for_descriptor(&endpoint).await;

    let descriptor_mode = std::fs::metadata(&endpoint.descriptor_path)
        .expect("descriptor metadata")
        .permissions()
        .mode()
        & 0o777;
    let socket_mode = std::fs::metadata(&descriptor.unix_socket_path)
        .expect("socket metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(descriptor_mode, 0o600);
    assert_eq!(socket_mode, 0o600);
    server.abort();
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestBridgeDescriptor {
    #[allow(dead_code)]
    windows_pipe_name: String,
    #[allow(dead_code)]
    unix_socket_path: String,
    app_generation: String,
    nonce: String,
}

async fn wait_for_descriptor(
    endpoint: &kerminal_lib::services::external_launch::ExternalLaunchBridgeEndpoint,
) -> TestBridgeDescriptor {
    for _ in 0..100 {
        if let Ok(bytes) = tokio::fs::read(&endpoint.descriptor_path).await {
            if let Ok(descriptor) = serde_json::from_slice(&bytes) {
                return descriptor;
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("bridge descriptor was not created")
}

async fn send_raw_envelope(
    descriptor: &TestBridgeDescriptor,
    envelope: &ExternalLaunchBridgeEnvelope,
) -> kerminal_lib::services::external_launch::ExternalLaunchBridgeResponse {
    let payload = serde_json::to_vec(envelope).expect("serialize raw envelope");
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload);
    send_raw_frame(descriptor, &frame).await
}

#[cfg(windows)]
async fn send_raw_frame(
    descriptor: &TestBridgeDescriptor,
    frame: &[u8],
) -> kerminal_lib::services::external_launch::ExternalLaunchBridgeResponse {
    use tokio::net::windows::named_pipe::ClientOptions;

    let mut stream = loop {
        match ClientOptions::new().open(&descriptor.windows_pipe_name) {
            Ok(stream) => break stream,
            Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    };
    stream.write_all(frame).await.expect("write raw frame");
    read_raw_response(&mut stream).await
}

#[cfg(windows)]
async fn send_slow_partial_frame(
    descriptor: &TestBridgeDescriptor,
) -> kerminal_lib::services::external_launch::ExternalLaunchBridgeResponse {
    use tokio::net::windows::named_pipe::ClientOptions;

    let mut stream = loop {
        match ClientOptions::new().open(&descriptor.windows_pipe_name) {
            Ok(stream) => break stream,
            Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    };
    stream
        .write_all(&100_u32.to_be_bytes())
        .await
        .expect("write slow frame length");
    stream.write_all(b"{").await.expect("write partial frame");
    tokio::time::sleep(Duration::from_millis(2_100)).await;
    read_raw_response(&mut stream).await
}

#[cfg(unix)]
async fn send_raw_frame(
    descriptor: &TestBridgeDescriptor,
    frame: &[u8],
) -> kerminal_lib::services::external_launch::ExternalLaunchBridgeResponse {
    let mut stream = tokio::net::UnixStream::connect(&descriptor.unix_socket_path)
        .await
        .expect("connect raw unix stream");
    stream.write_all(frame).await.expect("write raw frame");
    read_raw_response(&mut stream).await
}

#[cfg(unix)]
async fn send_slow_partial_frame(
    descriptor: &TestBridgeDescriptor,
) -> kerminal_lib::services::external_launch::ExternalLaunchBridgeResponse {
    let mut stream = tokio::net::UnixStream::connect(&descriptor.unix_socket_path)
        .await
        .expect("connect slow unix stream");
    stream
        .write_all(&100_u32.to_be_bytes())
        .await
        .expect("write slow frame length");
    stream.write_all(b"{").await.expect("write partial frame");
    tokio::time::sleep(Duration::from_millis(2_100)).await;
    read_raw_response(&mut stream).await
}

async fn read_raw_response<S>(
    stream: &mut S,
) -> kerminal_lib::services::external_launch::ExternalLaunchBridgeResponse
where
    S: tokio::io::AsyncRead + Unpin,
{
    let mut length = [0_u8; 4];
    stream
        .read_exact(&mut length)
        .await
        .expect("read response length");
    let mut payload = vec![0_u8; u32::from_be_bytes(length) as usize];
    stream
        .read_exact(&mut payload)
        .await
        .expect("read response payload");
    serde_json::from_slice(&payload).expect("parse raw bridge response")
}

fn putty_bridge_envelope() -> ExternalLaunchBridgeEnvelope {
    putty_bridge_envelope_for("bridge.example.internal", 2202, BRIDGE_PASSWORD)
}

fn putty_bridge_envelope_for(
    host: &str,
    port: usize,
    password: &str,
) -> ExternalLaunchBridgeEnvelope {
    ExternalLaunchBridgeEnvelope::new(
        ExternalLaunchSourceTool::Putty,
        vec![
            "putty.exe".to_owned(),
            "-ssh".to_owned(),
            format!("deploy@{host}"),
            "-P".to_owned(),
            port.to_string(),
            "-pw".to_owned(),
            password.to_owned(),
        ],
        Some("C:/work".to_owned()),
    )
    .expect("create bridge envelope")
}

fn spawn_bridge_server(
    endpoint: kerminal_lib::services::external_launch::ExternalLaunchBridgeEndpoint,
    intake: ExternalLaunchIntake,
    events: Arc<Mutex<Vec<ExternalLaunchEventPayload>>>,
) -> tokio::task::JoinHandle<kerminal_lib::error::AppResult<()>> {
    tokio::spawn(run_external_launch_bridge_server(
        endpoint,
        intake,
        Arc::new(move |payload| {
            events.lock().expect("events").push(payload);
        }),
    ))
}
