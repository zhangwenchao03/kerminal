//! External SSH launch production smoke matrix tests.
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};

use kerminal_lib::{
    commands::external_launch::external_launch_snapshot_to_dto,
    error::AppResult,
    paths::{KerminalPaths, KERMINAL_CONFIG_ROOT_ENV},
    services::{
        external_launch::{
            external_launch_bridge_endpoint, run_external_launch_bridge_server,
            send_external_launch_bridge_envelope, ExternalLaunchAcceptOutcome,
            ExternalLaunchBridgeEndpoint, ExternalLaunchBridgeEnvelope, ExternalLaunchEntrypoint,
            ExternalLaunchEventPayload, ExternalLaunchIntake, ExternalLaunchPolicy,
            ExternalLaunchSourceTool, ExternalLaunchTaskSnapshot, KERMINAL_MAIN_EXE_ENV,
            KERMINAL_SHIM_PERSONA_ALIAS_ARG,
        },
        mcp_tool_executor_service::{McpToolExecutionContext, McpToolExecutionStatus},
        ssh_command_service::SshCommandService,
        ssh_runtime::ManagedSshSessionManager,
    },
    state::AppState,
};
use serde_json::json;
use tempfile::tempdir;

const SMOKE_SECRET_PREFIX: &str = "KERM_EXTERNAL_SMOKE_SECRET_";
const DIRECT_SECRET: &str = "KERM_EXTERNAL_SMOKE_SECRET_DIRECT_DO_NOT_USE";
const RUNNING_SHIM_SECRET: &str = "KERM_EXTERNAL_SMOKE_SECRET_RUNNING_SHIM_DO_NOT_USE";
const COLD_START_SECRET: &str = "KERM_EXTERNAL_SMOKE_SECRET_COLD_START_DO_NOT_USE";
const POLICY_SECRET: &str = "KERM_EXTERNAL_SMOKE_SECRET_POLICY_DO_NOT_USE";
const UNAVAILABLE_SECRET: &str = "KERM_EXTERNAL_SMOKE_SECRET_UNAVAILABLE_DO_NOT_USE";
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(2);

#[tokio::test]
async fn direct_kerminal_args_materialize_password_no_save_and_public_surfaces_are_redacted() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");

    let outcome = state
        .external_launch_intake()
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@direct-smoke.example.internal".to_owned(),
                "-P".to_owned(),
                "2207".to_owned(),
                "-pw".to_owned(),
                DIRECT_SECRET.to_owned(),
            ],
            Some("C:\\Program Files\\Jump Host".to_owned()),
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue direct kerminal.exe vendor-style launch");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued direct launch, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(queued.entrypoint, ExternalLaunchEntrypoint::DirectArgv);
    assert_eq!(queued.target.host, "direct-smoke.example.internal");
    assert_no_public_secret("queued event", &format!("{queued:?}"));

    let snapshot_dto = external_launch_snapshot_to_dto(
        state
            .external_launch_intake()
            .snapshot()
            .expect("intake snapshot"),
        state
            .external_launch_intake()
            .secret_broker()
            .snapshot()
            .expect("secret snapshot"),
        ExternalLaunchTaskSnapshot::default(),
    );
    assert_no_public_secret(
        "external launch DTO snapshot",
        &serde_json::to_string(&snapshot_dto).expect("serialize snapshot dto"),
    );

    let tools = state.mcp_tool_catalog().list_tools();
    let mcp_output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot");
    assert_eq!(mcp_output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(mcp_output.data["runtime"]["externalLaunchPendingCount"], 1);
    assert_eq!(
        mcp_output.data["runtime"]["externalLaunchActiveSecretCount"],
        1
    );
    assert_no_public_secret("mcp runtime snapshot", &mcp_output.data.to_string());

    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending direct launch");
    assert_eq!(pending.len(), 1);
    let launch_id = pending[0].id.clone();
    assert_eq!(launch_id, queued.launch_id);
    assert_no_public_secret("pending request debug", &format!("{pending:?}"));

    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize direct external launch");
    assert_eq!(target.host.host, "direct-smoke.example.internal");
    assert_eq!(target.host.username, "ops");
    assert_no_public_secret("materialized target debug", &format!("{target:?}"));

    assert_eq!(
        state
            .external_launch_intake()
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("ack external launch secret"),
        1
    );
    assert_eq!(
        state
            .external_launch_intake()
            .secret_broker()
            .snapshot()
            .expect("secret snapshot after ack")
            .active_secret_count,
        0
    );

    let root = state.paths().root.clone();
    drop(state);
    assert_tree_does_not_contain_public_secret(&root);
}

#[tokio::test]
async fn shim_smoke_matrix_covers_running_alias_path_with_spaces_and_cold_start() {
    let root = tempdir().expect("temp kerminal root");
    let paths = KerminalPaths::from_root(root.path());
    let endpoint = external_launch_bridge_endpoint(&paths.root);
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake.clone(), events.clone());
    tokio::time::sleep(Duration::from_millis(50)).await;

    let shim_path = copy_shim_to_path_with_spaces(root.path(), "putty.exe");
    let running_output = run_shim_process(
        shim_path,
        &paths.root,
        None,
        &[
            "-ssh",
            "ops@running-shim.example.internal",
            "-P",
            "2208",
            "-pw",
            RUNNING_SHIM_SECRET,
        ],
    )
    .await;
    assert!(
        running_output.status.success(),
        "running shim failed: {}",
        String::from_utf8_lossy(&running_output.stderr)
    );
    assert_process_output_redacted("running shim output", &running_output);

    let pending = intake.take_pending().expect("take running shim pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].source.entrypoint,
        ExternalLaunchEntrypoint::ShimIpc
    );
    assert_eq!(pending[0].source.tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(pending[0].target.host, "running-shim.example.internal");
    assert_no_public_secret("running shim pending debug", &format!("{pending:?}"));
    assert_no_public_secret(
        "running shim events",
        &format!("{:?}", events.lock().expect("events")),
    );
    server.abort();

    let cold_root = tempdir().expect("cold start temp root");
    let cold_paths = KerminalPaths::from_root(cold_root.path());
    let cold_endpoint = external_launch_bridge_endpoint(&cold_paths.root);
    let cold_intake = ExternalLaunchIntake::new();
    let cold_events = Arc::new(Mutex::new(Vec::new()));
    let main_exe = cold_start_placeholder_main_executable();
    let cold_root_path = cold_paths.root.clone();

    let shim = tokio::task::spawn_blocking(move || {
        Command::new(shim_binary())
            .env(KERMINAL_CONFIG_ROOT_ENV, cold_root_path)
            .env(KERMINAL_MAIN_EXE_ENV, main_exe)
            .arg(KERMINAL_SHIM_PERSONA_ALIAS_ARG)
            .arg("xshell")
            .arg("-url")
            .arg(format!(
                "ssh://cold:{COLD_START_SECRET}@cold-start.example.internal:2209"
            ))
            .output()
    });
    tokio::time::sleep(Duration::from_millis(600)).await;
    let cold_server = spawn_bridge_server(cold_endpoint, cold_intake.clone(), cold_events.clone());
    let cold_output = shim
        .await
        .expect("join cold start shim")
        .expect("run cold start shim");
    assert!(
        cold_output.status.success(),
        "cold start shim failed: {}",
        String::from_utf8_lossy(&cold_output.stderr)
    );
    assert_process_output_redacted("cold start shim output", &cold_output);

    let pending = cold_intake.take_pending().expect("take cold start pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].source.entrypoint,
        ExternalLaunchEntrypoint::ShimIpc
    );
    assert_eq!(pending[0].source.tool, ExternalLaunchSourceTool::Xshell);
    assert_eq!(pending[0].target.host, "cold-start.example.internal");
    assert_no_public_secret("cold start pending debug", &format!("{pending:?}"));
    assert_no_public_secret(
        "cold start events",
        &format!("{:?}", cold_events.lock().expect("cold events")),
    );
    cold_server.abort();
}

#[tokio::test]
async fn bridge_policy_and_concurrent_click_smoke_matrix_is_redacted() {
    let unavailable_home = tempdir().expect("unavailable bridge home");
    let unavailable_endpoint = external_launch_bridge_endpoint(unavailable_home.path());
    let unavailable_error = send_external_launch_bridge_envelope(
        &unavailable_endpoint,
        putty_bridge_envelope_for(
            "unavailable-smoke.example.internal",
            2210,
            UNAVAILABLE_SECRET,
        ),
        Duration::from_millis(50),
    )
    .await
    .expect_err("bridge should be unavailable");
    let unavailable_message = unavailable_error.to_string();
    assert!(unavailable_message.contains("external launch bridge unavailable or timed out"));
    assert_no_public_secret("unavailable bridge error", &unavailable_message);

    let disabled_intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        enabled: false,
        ..ExternalLaunchPolicy::default()
    });
    let disabled_outcome = disabled_intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@disabled-policy.example.internal".to_owned(),
                "-pw".to_owned(),
                POLICY_SECRET.to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("policy disabled outcome");
    let rejected = match disabled_outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected policy rejection, got {other:?}"),
    };
    assert_eq!(rejected.message, "external SSH launch disabled by policy");
    assert_eq!(
        disabled_intake
            .take_pending()
            .expect("take disabled pending")
            .len(),
        0
    );
    let disabled_snapshot = external_launch_snapshot_to_dto(
        disabled_intake.snapshot().expect("disabled snapshot"),
        disabled_intake
            .secret_broker()
            .snapshot()
            .expect("disabled secret snapshot"),
        ExternalLaunchTaskSnapshot::default(),
    );
    assert_no_public_secret(
        "policy disabled snapshot",
        &serde_json::to_string(&disabled_snapshot).expect("serialize disabled snapshot"),
    );

    let home = tempdir().expect("concurrent bridge home");
    let endpoint = external_launch_bridge_endpoint(home.path());
    let intake = ExternalLaunchIntake::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let server = spawn_bridge_server(endpoint.clone(), intake.clone(), events.clone());
    let mut tasks = Vec::new();
    for index in 0..8 {
        let endpoint = endpoint.clone();
        tasks.push(tokio::spawn(async move {
            let secret = format!("{SMOKE_SECRET_PREFIX}CONCURRENT_{index}_DO_NOT_USE");
            send_external_launch_bridge_envelope(
                &endpoint,
                putty_bridge_envelope_for(
                    &format!("concurrent-{index}.example.internal"),
                    2300 + index,
                    &secret,
                ),
                BRIDGE_TIMEOUT,
            )
            .await
        }));
    }

    let mut serialized_responses = String::new();
    for task in tasks {
        let response = task
            .await
            .expect("concurrent bridge task")
            .expect("concurrent bridge response");
        assert!(response.ok);
        assert!(response.event.is_none());
        assert_eq!(response.request_hash.as_deref().map(str::len), Some(12));
        serialized_responses
            .push_str(&serde_json::to_string(&response).expect("serialize bridge response"));
    }
    assert_no_public_secret("concurrent bridge responses", &serialized_responses);

    let pending = intake.take_pending().expect("take concurrent pending");
    assert_eq!(pending.len(), 8);
    assert!(pending
        .iter()
        .all(|request| request.source.entrypoint == ExternalLaunchEntrypoint::ShimIpc));
    assert_no_public_secret("concurrent pending debug", &format!("{pending:?}"));
    assert_no_public_secret(
        "concurrent bridge events",
        &format!("{:?}", events.lock().expect("events")),
    );
    server.abort();
}

fn mcp_context<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
) -> McpToolExecutionContext<'a> {
    mcp_context_with_ssh_runtime(state, ssh_commands, state.ssh_runtime())
}

fn mcp_context_with_ssh_runtime<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
    ssh_runtime: &'a ManagedSshSessionManager,
) -> McpToolExecutionContext<'a> {
    McpToolExecutionContext {
        agent_sessions: state.agent_sessions(),
        command_history: state.command_history(),
        command_store: state.command_store(),
        diagnostics: state.diagnostics(),
        docker_hosts: state.docker_hosts(),
        external_launch_intake: state.external_launch_intake(),
        external_launch_tasks: state.external_launch_tasks(),
        local_network_proxy: state.local_network_proxy(),
        paths: state.paths(),
        port_forwards: state.port_forwards(),
        remote_hosts: state.remote_hosts(),
        server_info: state.server_info(),
        settings: state.settings(),
        sftp: state.sftp(),
        ssh_commands,
        ssh_runtime,
        storage: state.storage(),
        terminal_session_bindings: state.terminal_session_bindings(),
        terminals: state.terminals(),
        tmux: state.tmux(),
    }
}

fn spawn_bridge_server(
    endpoint: ExternalLaunchBridgeEndpoint,
    intake: ExternalLaunchIntake,
    events: Arc<Mutex<Vec<ExternalLaunchEventPayload>>>,
) -> tokio::task::JoinHandle<AppResult<()>> {
    tokio::spawn(run_external_launch_bridge_server(
        endpoint,
        intake,
        Arc::new(move |payload| {
            events.lock().expect("events").push(payload);
        }),
    ))
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
        Some("C:/jump platform".to_owned()),
    )
    .expect("create bridge envelope")
}

async fn run_shim_process(
    shim_path: PathBuf,
    root: &Path,
    main_exe: Option<PathBuf>,
    args: &[&str],
) -> std::process::Output {
    let root = root.to_path_buf();
    let args = args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>();
    tokio::task::spawn_blocking(move || {
        let mut command = Command::new(shim_path);
        command.env(KERMINAL_CONFIG_ROOT_ENV, root);
        if let Some(main_exe) = main_exe {
            command.env(KERMINAL_MAIN_EXE_ENV, main_exe);
        }
        command.args(args).output()
    })
    .await
    .expect("join shim process")
    .expect("run shim process")
}

fn shim_binary() -> &'static str {
    env!("CARGO_BIN_EXE_kerminal-launch-shim")
}

fn copy_shim_to_path_with_spaces(root: &Path, filename: &str) -> PathBuf {
    let install_dir = root
        .join("Program Files")
        .join("Kerminal Compatibility Shim");
    fs::create_dir_all(&install_dir).expect("create shim directory with spaces");
    let shim_path = install_dir.join(filename);
    fs::copy(shim_binary(), &shim_path).expect("copy shim binary");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(&shim_path)
            .expect("shim metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&shim_path, permissions).expect("set executable permissions");
    }
    shim_path
}

fn cold_start_placeholder_main_executable() -> PathBuf {
    if cfg!(windows) {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        return system_root.join("System32").join("where.exe");
    }
    PathBuf::from("/bin/true")
}

fn assert_process_output_redacted(label: &str, output: &std::process::Output) {
    assert_no_public_secret(label, &String::from_utf8_lossy(&output.stdout));
    assert_no_public_secret(label, &String::from_utf8_lossy(&output.stderr));
}

fn assert_no_public_secret(label: &str, text: &str) {
    assert!(
        !text.contains(SMOKE_SECRET_PREFIX),
        "{label} leaked smoke secret: {text}"
    );
    assert!(
        !text.contains("external-secret:"),
        "{label} leaked external secret ref: {text}"
    );
}

fn assert_tree_does_not_contain_public_secret(root: &Path) {
    if !root.exists() {
        return;
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = fs::metadata(&path).expect("scan metadata");
        if metadata.is_dir() {
            for entry in fs::read_dir(&path).expect("scan directory") {
                stack.push(entry.expect("scan directory entry").path());
            }
            continue;
        }
        let bytes = fs::read(&path).expect("scan file bytes");
        assert!(
            !contains_bytes(&bytes, SMOKE_SECRET_PREFIX.as_bytes()),
            "workspace/config/log file leaked smoke secret: {}",
            path.display()
        );
        assert!(
            !contains_bytes(&bytes, b"external-secret:"),
            "workspace/config/log file leaked external secret ref: {}",
            path.display()
        );
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}
