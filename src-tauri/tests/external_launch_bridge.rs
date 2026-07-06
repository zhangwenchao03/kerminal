//! External SSH launch bridge tests.
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    external_launch_bridge_endpoint, run_external_launch_bridge_server,
    send_external_launch_bridge_envelope, ExternalLaunchBridgeEnvelope, ExternalLaunchEntrypoint,
    ExternalLaunchEventKind, ExternalLaunchEventPayload, ExternalLaunchIntake,
    ExternalLaunchParserRegistry, ExternalLaunchSourceTool,
};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tempfile::tempdir;

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
fn bridge_envelope_debug_and_diagnostics_redact_secret_argv() {
    let envelope = putty_bridge_envelope();

    let debug = format!("{envelope:?}");
    let diagnostics = envelope.diagnostics();
    let diagnostics_json = serde_json::to_string(&diagnostics).expect("serialize diagnostics");

    assert!(!debug.contains(BRIDGE_PASSWORD));
    assert!(!diagnostics_json.contains(BRIDGE_PASSWORD));
    assert!(diagnostics
        .argv_redacted
        .iter()
        .any(|arg| arg == "<redacted>"));
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
    assert_eq!(
        response.event.as_ref().map(|event| event.kind),
        Some(ExternalLaunchEventKind::Queued)
    );
    assert!(!serde_json::to_string(&response)
        .expect("serialize response")
        .contains(BRIDGE_PASSWORD));

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
    assert_eq!(
        response.event.as_ref().map(|event| event.kind),
        Some(ExternalLaunchEventKind::Rejected)
    );
    let response_json = serde_json::to_string(&response).expect("serialize response");
    assert!(!response_json.contains(BRIDGE_PASSWORD));
    assert!(!format!("{intake:?}").contains(BRIDGE_PASSWORD));
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);

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

    for index in 0..10 {
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
        assert_eq!(
            response.event.as_ref().map(|event| event.kind),
            Some(ExternalLaunchEventKind::Queued)
        );
    }

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 10);
    let actual_hosts = pending
        .iter()
        .map(|request| request.target.host.clone())
        .collect::<BTreeSet<_>>();
    assert_eq!(actual_hosts, expected_hosts);
    let debug = format!("{pending:?}");
    assert!(!debug.contains("KERM_BRIDGE_CONCURRENT_SECRET_"));
    assert_eq!(events.lock().expect("events").len(), 10);

    server.abort();
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
