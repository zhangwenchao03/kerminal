//! External SSH launch materializer tests.
//!
//! @author kongweiguang

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use kerminal_lib::{
    error::AppResult,
    models::{
        docker::DockerContainerListRequest,
        port_forward::{PortForwardCreateRequest, PortForwardKind},
        remote_host::RemoteHostAuthType,
        server_info::ServerInfoRequest,
        ssh_command::SshCommandRequest,
        target::{ContainerRuntime, RemoteTargetRef},
        tmux::{TmuxProbeRequest, TmuxTargetRef},
    },
    paths::KerminalPaths,
    services::{
        docker_host_service::DockerHostService,
        external_launch::{
            external_target_id, external_target_safety_for_saved_hosts,
            ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
            ExternalSessionMaterializer, ExternalTargetSafety,
        },
        mcp_tool_executor_service::{McpToolExecutionContext, McpToolExecutionStatus},
        port_forward_service::PortForwardService,
        remote_host_service::RemoteHostService,
        server_info_service::ServerInfoService,
        ssh_command_service::SshCommandService,
        ssh_runtime::{
            auth_broker::SshAuthBroker, ManagedSshSessionManager, SshAuthIdentity, SshChannelKind,
            SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
            SshRuntimeExecRawOutput, SshRuntimeExecRequest, SshSessionKey,
        },
        tmux_service::TmuxService,
    },
    state::AppState,
    storage::config_file_store::ConfigFileStore,
};
use serde_json::json;
use tempfile::{tempdir, TempDir};

const PASSWORD_SECRET: &str = "KERM_EXTERNAL_MATERIALIZER_PASSWORD_DO_NOT_USE";
const PASSPHRASE_SECRET: &str = "KERM_EXTERNAL_MATERIALIZER_PASSPHRASE_DO_NOT_USE";

#[test]
fn materializer_preserves_drained_launches_as_active_requests() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));

    let pending = fixture.intake.take_pending().expect("take pending");

    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, launch_id);
    assert_eq!(
        fixture.intake.snapshot().expect("snapshot").pending_count,
        0
    );
    assert_eq!(
        fixture
            .intake
            .active_request(&launch_id)
            .expect("active request")
            .as_ref()
            .map(|request| request.target.host.as_str()),
        Some("example.internal")
    );
}

#[test]
fn materializer_moves_password_to_auth_broker_and_keeps_external_target_after_ack() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");

    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize external launch");

    assert_eq!(target.launch_id, launch_id);
    assert_eq!(target.host_id, external_target_id(&launch_id));
    assert_eq!(target.host.auth_type, RemoteHostAuthType::Password);
    assert_eq!(target.host.host, "example.internal");
    assert_eq!(target.host.port, 2202);
    assert_eq!(target.host.username, "deploy");
    assert!(target.host.production);
    assert_eq!(target.safety, ExternalTargetSafety::RestrictedUnknown);
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker snapshot")
            .session_only_secret_count,
        1
    );

    let debug = format!("{target:?}");
    assert!(!debug.contains(PASSWORD_SECRET));
    assert!(!debug.contains("external-secret:"));
    assert!(!debug.contains(&launch_id));
    assert!(debug.contains("request_hash"));

    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("ack external secret"),
        1
    );
    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .snapshot()
            .expect("external secret snapshot")
            .active_secret_count,
        0
    );
    assert!(fixture
        .materializer
        .resolve_target(&target.host_id)
        .expect("resolve materialized target")
        .is_some());

    assert!(fixture
        .materializer
        .forget_launch(&launch_id)
        .expect("forget launch"));
    assert!(fixture
        .materializer
        .resolve_target(&target.host_id)
        .expect("resolve after forget")
        .is_none());
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker after forget")
            .session_only_secret_count,
        0
    );
}

#[test]
fn external_target_safety_only_downgrades_for_exact_saved_non_production_match() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let request = fixture
        .intake
        .active_request(&launch_id)
        .expect("active request")
        .expect("queued request");
    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize restricted target");

    let mut saved = target.host.clone();
    saved.id = "saved-non-production".to_owned();
    saved.host = "EXAMPLE.INTERNAL.".to_owned();
    saved.production = false;
    assert_eq!(
        external_target_safety_for_saved_hosts(&request, "deploy", &[saved.clone()]),
        ExternalTargetSafety::KnownNonProduction
    );

    saved.production = true;
    assert_eq!(
        external_target_safety_for_saved_hosts(&request, "deploy", &[saved.clone()]),
        ExternalTargetSafety::Production
    );

    saved.port += 1;
    assert_eq!(
        external_target_safety_for_saved_hosts(&request, "deploy", &[saved]),
        ExternalTargetSafety::RestrictedUnknown
    );
}

#[test]
fn materializer_requires_username_or_trusted_override() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, None);
    let _ = fixture.intake.take_pending().expect("take pending");

    let error = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect_err("missing username should fail");
    assert!(error.to_string().contains("username is required"));

    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, Some("ops".to_owned()))
        .expect("materialize with username override");
    assert_eq!(target.host.username, "ops");
}

#[test]
fn materializer_reports_expired_password_secret_without_leaking_refs() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");

    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("expire external password"),
        1
    );

    let error = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect_err("expired password should fail");
    let message = error.to_string();

    assert!(message.contains("外部 SSH 启动凭据已过期或不可用"));
    assert_hashed_launch_id(&message, &launch_id);
    assert!(message.contains("secret_kind=password"));
    assert!(!message.contains(PASSWORD_SECRET));
    assert!(!message.contains("external-secret:"));
}

#[test]
fn materializer_reports_expired_key_passphrase_without_leaking_refs() {
    let fixture = materializer_fixture();
    let launch_id = queue_kerminal_native_key_passphrase_launch(&fixture.intake);
    let _ = fixture.intake.take_pending().expect("take pending");

    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("expire external key passphrase"),
        1
    );

    let error = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect_err("expired key passphrase should fail");
    let message = error.to_string();

    assert!(message.contains("外部 SSH 启动凭据已过期或不可用"));
    assert_hashed_launch_id(&message, &launch_id);
    assert!(message.contains("secret_kind=key-passphrase"));
    assert!(!message.contains(PASSPHRASE_SECRET));
    assert!(!message.contains("external-secret:"));
}

#[test]
fn materializer_reports_stale_launch_id_as_not_found() {
    let fixture = materializer_fixture();
    let error = fixture
        .materializer
        .materialize(&fixture.paths, "stale-launch-id", None)
        .expect_err("stale launch id should fail");

    let message = error.to_string();
    assert_hashed_launch_id(&message, "stale-launch-id");
}

#[test]
fn materializer_moves_external_key_passphrase_to_runtime_host_and_auth_broker() {
    let fixture = materializer_fixture();
    let launch_id = queue_kerminal_native_key_passphrase_launch(&fixture.intake);
    let _ = fixture.intake.take_pending().expect("take pending");
    let request = fixture
        .intake
        .active_request(&launch_id)
        .expect("active request")
        .expect("launch remains active");
    let request_debug = format!("{request:?}");
    assert!(!request_debug.contains(PASSPHRASE_SECRET));
    assert!(!request_debug.contains("id_ed25519"));
    assert!(!request_debug.contains(&launch_id));
    assert!(request_debug.contains("request_hash"));

    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize key passphrase launch");

    assert_eq!(target.host.auth_type, RemoteHostAuthType::Key);
    assert_eq!(
        target.host.key_passphrase_secret.as_deref(),
        Some(PASSPHRASE_SECRET)
    );
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker snapshot")
            .session_only_secret_count,
        1
    );
    let debug = format!("{target:?}");
    assert!(!debug.contains(PASSPHRASE_SECRET));
    assert!(!debug.contains("id_ed25519"));
    assert!(!debug.contains(&launch_id));

    fixture
        .intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");
    assert!(fixture
        .materializer
        .forget_launch(&launch_id)
        .expect("forget launch"));
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker after forget")
            .session_only_secret_count,
        0
    );
}

#[tokio::test]
async fn ssh_command_service_executes_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize external launch");
    fixture
        .intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let backend = Arc::new(RecordingExecBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager,
        fixture.auth_broker.clone(),
        fixture.materializer.clone(),
    );

    let output = service
        .execute_native(
            &fixture.paths,
            SshCommandRequest {
                host_id: target.host_id.clone(),
                command: "whoami".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute managed external command");

    assert!(output.success);
    assert_eq!(output.host_id, target.host_id);
    assert_eq!(output.stdout, "external-exec: whoami\n");

    let key = backend.last_key().expect("runtime key");
    assert_eq!(key.target.host_id.as_deref(), Some(target.host_id.as_str()));
    assert_eq!(key.target.host, "example.internal");
    assert_eq!(key.target.username, "deploy");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id == "ssh-auth:target:deploy@example.internal:2202:password"
    ));
    assert!(!format!("{key:?}").contains(PASSWORD_SECRET));
}

#[tokio::test]
async fn server_info_snapshot_native_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));
    let remote_hosts = empty_remote_hosts(&fixture.paths);

    let snapshot = ServerInfoService::new()
        .snapshot_native(
            &remote_hosts,
            &fixture.paths,
            &ssh_commands,
            ServerInfoRequest {
                host_id: target.host_id.clone(),
                target: RemoteTargetRef::Ssh {
                    host_id: target.host_id.clone(),
                },
            },
        )
        .await
        .expect("snapshot external target");

    assert_eq!(snapshot.host_id, target.host_id);
    assert_eq!(snapshot.host, "example.internal");
    assert_eq!(snapshot.port, 2202);
    assert_eq!(snapshot.username, "deploy");
    assert!(backend
        .scripts()
        .iter()
        .any(|script| script.contains("/proc/meminfo")));
}

#[tokio::test]
async fn tmux_probe_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));

    let status = TmuxService::new()
        .probe(
            &fixture.paths,
            &ssh_commands,
            TmuxProbeRequest {
                target: TmuxTargetRef {
                    target: RemoteTargetRef::Ssh {
                        host_id: target.host_id.clone(),
                    },
                    socket_name: None,
                    socket_path: None,
                    tmux_path: None,
                },
            },
        )
        .await
        .expect("probe tmux on external target");

    assert!(status.available);
    assert_eq!(status.version.as_deref(), Some("tmux 3.4"));
    assert!(backend
        .scripts()
        .iter()
        .any(|script| script.contains("'tmux' '-V'")));
}

#[tokio::test]
async fn docker_list_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));

    let containers = DockerHostService::new()
        .list_containers(
            &fixture.paths,
            &ssh_commands,
            DockerContainerListRequest {
                host_id: target.host_id.clone(),
                runtime: ContainerRuntime::Docker,
                include_stopped: false,
            },
        )
        .await
        .expect("list containers through external target");

    assert_eq!(containers.len(), 1);
    assert_eq!(containers[0].host_id, target.host_id);
    assert_eq!(containers[0].name, "api");
    assert!(backend
        .scripts()
        .iter()
        .any(|script| script.contains("docker") && script.contains(" ps")));
}

#[test]
fn port_forward_plan_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let remote_hosts = empty_remote_hosts(&fixture.paths);
    let service = PortForwardService::with_external_targets(fixture.materializer.clone());

    let plan = service
        .build_plan_with_context(
            &remote_hosts,
            &fixture.paths,
            "ssh".to_owned(),
            &PortForwardCreateRequest {
                host_id: target.host_id.clone(),
                name: Some("external tunnel".to_owned()),
                kind: PortForwardKind::Local,
                bind_host: Some("127.0.0.1".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect("build forward plan for external target");

    assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2202"]));
    assert_eq!(
        plan.args.last().map(String::as_str),
        Some("deploy@example.internal")
    );
    assert!(plan.command_preview.contains("-L"));
    assert!(!format!("{plan:?}").contains(PASSWORD_SECRET));
}

#[tokio::test]
async fn mcp_tools_use_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let state =
        AppState::initialize_with_paths(fixture.paths.clone()).expect("initialize app state");
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();
    let context = mcp_context(&state, &ssh_commands);

    let ssh_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "ssh.command",
            json!({
                "hostId": target.host_id,
                "command": "whoami"
            }),
        )
        .await
        .expect("execute MCP ssh.command");
    assert_eq!(ssh_output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        ssh_output.data["output"]["stdout"].as_str(),
        Some("external-exec: whoami\n")
    );

    let server_info_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "server_info.snapshot",
            json!({ "hostId": target.host_id }),
        )
        .await
        .expect("execute MCP server_info.snapshot");
    assert_eq!(server_info_output.status, McpToolExecutionStatus::Succeeded);

    let tmux_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "tmux.probe",
            json!({
                "targetKind": "ssh",
                "hostId": target.host_id
            }),
        )
        .await
        .expect("execute MCP tmux.probe");
    assert_eq!(tmux_output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        tmux_output.data["status"]["version"].as_str(),
        Some("tmux 3.4")
    );

    let container_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "container.list",
            json!({
                "hostId": target.host_id,
                "runtime": "docker",
                "includeStopped": false
            }),
        )
        .await
        .expect("execute MCP container.list");
    assert_eq!(container_output.status, McpToolExecutionStatus::Succeeded);

    let scripts = backend.scripts();
    assert!(scripts.iter().any(|script| script == "whoami\n"));
    assert!(scripts
        .iter()
        .any(|script| script.contains("/proc/meminfo")));
    assert!(scripts.iter().any(|script| script.contains("'tmux' '-V'")));
    assert!(scripts
        .iter()
        .any(|script| script.contains("docker") && script.contains(" ps")));
    assert!(
        !format!("{ssh_output:?}{server_info_output:?}{tmux_output:?}{container_output:?}")
            .contains(PASSWORD_SECRET)
    );
}

fn assert_hashed_launch_id(message: &str, raw_launch_id: &str) {
    assert!(!message.contains(raw_launch_id));
    let hash = message
        .split_once("request_hash=")
        .map(|(_, suffix)| suffix.split_whitespace().next().unwrap_or(suffix))
        .expect("error should contain request_hash");
    assert_eq!(hash.len(), 12, "request hash must stay bounded and opaque");
    assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
}

struct MaterializerFixture {
    _home: TempDir,
    paths: KerminalPaths,
    intake: ExternalLaunchIntake,
    auth_broker: SshAuthBroker,
    materializer: ExternalSessionMaterializer,
}

fn materialize_and_ack(
    fixture: &MaterializerFixture,
    launch_id: &str,
) -> kerminal_lib::services::external_launch::ExternalMaterializedTarget {
    let target = fixture
        .materializer
        .materialize(&fixture.paths, launch_id, None)
        .expect("materialize external launch");
    fixture
        .intake
        .secret_broker()
        .ack_launch(launch_id)
        .expect("ack external secret");
    target
}

fn ssh_command_service_with_backend(
    fixture: &MaterializerFixture,
    backend: Arc<RecordingExecBackend>,
) -> SshCommandService {
    SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(backend),
        fixture.auth_broker.clone(),
        fixture.materializer.clone(),
    )
}

fn empty_remote_hosts(paths: &KerminalPaths) -> RemoteHostService {
    RemoteHostService::new(ConfigFileStore::new(paths.root.clone()))
}

fn mcp_context<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
) -> McpToolExecutionContext<'a> {
    McpToolExecutionContext {
        agent_sessions: state.agent_sessions(),
        command_history: state.command_history(),
        command_store: state.command_store(),
        diagnostics: state.diagnostics(),
        docker_hosts: state.docker_hosts(),
        external_launch_intake: state.external_launch_intake(),
        external_launch_tasks: state.external_launch_tasks(),
        paths: state.paths(),
        port_forwards: state.port_forwards(),
        remote_hosts: state.remote_hosts(),
        server_info: state.server_info(),
        settings: state.settings(),
        sftp: state.sftp(),
        ssh_commands,
        ssh_runtime: state.ssh_runtime(),
        storage: state.storage(),
        terminal_session_bindings: state.terminal_session_bindings(),
        terminals: state.terminals(),
        tmux: state.tmux(),
    }
}

fn materializer_fixture() -> MaterializerFixture {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("ensure kerminal dirs");
    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    MaterializerFixture {
        _home: home,
        paths,
        intake,
        auth_broker,
        materializer,
    }
}

fn queue_putty_password_launch(intake: &ExternalLaunchIntake, username: Option<&str>) -> String {
    let destination = match username {
        Some(username) => format!("{username}@example.internal"),
        None => "example.internal".to_owned(),
    };
    queued_launch_id(
        intake
            .accept_args(
                vec![
                    "putty.exe".to_owned(),
                    "-ssh".to_owned(),
                    destination,
                    "-P".to_owned(),
                    "2202".to_owned(),
                    "-pw".to_owned(),
                    PASSWORD_SECRET.to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue putty launch"),
    )
}

fn queue_kerminal_native_key_passphrase_launch(intake: &ExternalLaunchIntake) -> String {
    let envelope = json!({
        "host": "key.example.internal",
        "port": 2203,
        "username": "deploy",
        "identityFile": "C:\\Users\\alice\\.ssh\\id_ed25519",
        "keyPassphrase": PASSPHRASE_SECRET,
    })
    .to_string();
    queued_launch_id(
        intake
            .accept_args(
                vec![
                    "kerminal.exe".to_owned(),
                    "--external-ssh-json".to_owned(),
                    envelope,
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue native key passphrase launch"),
    )
}

fn queued_launch_id(outcome: ExternalLaunchAcceptOutcome) -> String {
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued launch, got {other:?}"),
    }
}

#[derive(Default)]
struct RecordingExecBackend {
    last_key: Mutex<Option<SshSessionKey>>,
    scripts: Arc<Mutex<Vec<String>>>,
}

impl RecordingExecBackend {
    fn last_key(&self) -> Option<SshSessionKey> {
        self.last_key.lock().expect("last key").clone()
    }

    fn scripts(&self) -> Vec<String> {
        self.scripts.lock().expect("scripts").clone()
    }
}

impl SshRuntimeBackend for RecordingExecBackend {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        *self.last_key.lock().expect("last key") = Some(request.key().clone());
        Ok(Arc::new(RecordingExecConnection {
            scripts: Arc::clone(&self.scripts),
        }))
    }
}

struct RecordingExecConnection {
    scripts: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl SshRuntimeConnection for RecordingExecConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        Ok(format!("recording-{}", kind.as_str()))
    }

    fn supports_exec(&self) -> bool {
        true
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        self.scripts
            .lock()
            .expect("scripts")
            .push(request.script.clone());
        let stdout = if request.script.contains("/proc/meminfo") {
            b"hostname=external-host\nos=Linux\n".to_vec()
        } else if request.script.contains("'tmux' '-V'") {
            b"tmux 3.4\n".to_vec()
        } else if request.script.contains(" ps") && request.script.contains("--format") {
            br#"{"ID":"abcdef1234567890","Image":"repo/api:latest","Names":"api","Status":"Up 2 minutes","State":"running","Ports":""}
"#
            .to_vec()
        } else if request.script.contains(" inspect --format") {
            Vec::new()
        } else {
            format!("external-exec: {}", request.script).into_bytes()
        };
        Ok(SshRuntimeExecRawOutput {
            exit_code: Some(0),
            stderr: Vec::new(),
            stdout,
        })
    }

    fn disconnect(&self, _reason: &str) {}
}
