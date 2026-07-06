//! SSH 远程终端服务集成测试。
//!
//! @author kongweiguang

use async_trait::async_trait;
use kerminal_lib::{
    error::{AppError, AppResult},
    models::{
        remote_host::{
            RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroupCreateRequest,
            SshJumpHostOptions, SshOptions,
        },
        terminal::{SshTerminalCreateRequest, TerminalOutputKind},
    },
    paths::KerminalPaths,
    services::{
        external_launch::{
            ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
            ExternalSessionMaterializer,
        },
        ssh_runtime::{
            auth_broker::SshAuthBroker, ManagedSshSessionManager, SshAuthIdentity, SshChannelKind,
            SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
            SshRuntimeShellEvent, SshRuntimeShellRequest, SshRuntimeShellSession, SshSessionKey,
        },
        ssh_terminal_service::{
            rules::{
                cleanup_temporary_identity_files, resolve_terminal_launch,
                temporary_identity_directory, try_open_managed_shell,
            },
            SshTerminalService,
        },
        terminal_manager::TerminalManager,
    },
    state::AppState,
};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tempfile::{tempdir, TempDir};

const TEST_PRIVATE_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\nkerminal-test-private-key\n-----END OPENSSH PRIVATE KEY-----\n";
const TEST_PASSWORD: &str = "s3cr3t-ssh-password";
const EXTERNAL_PASSWORD: &str = "external-terminal-password-secret";
const JUMP_PASSWORD: &str = "jump-password-secret";
const TARGET_PASSWORD: &str = "target-password-secret";

#[test]
fn resolve_terminal_request_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: "missing-host".to_owned(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn resolve_terminal_request_uses_app_known_hosts_file() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    let expected_known_hosts = format!(
        "UserKnownHostsFile={}",
        state.paths().root.join("known_hosts").to_string_lossy()
    );
    assert!(request.args.contains(&expected_known_hosts));
    assert!(request
        .args
        .contains(&"GlobalKnownHostsFile=none".to_owned()));
    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn resolve_terminal_request_sets_default_term_env() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(request.env.get("TERM"), Some(&"xterm-256color".to_owned()));
}

#[test]
fn create_session_prefers_managed_shell_runtime_for_default_ssh_terminal() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed terminal ready".to_vec(),
    ));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::clone(&backend)),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal");

    assert_eq!(summary.pid, None);
    assert!(summary.shell.starts_with("ssh:"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed terminal ready"));

    terminals
        .write(&summary.id, "whoami\r")
        .expect("write shell");
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    terminals.close(&summary.id).expect("close shell");
    wait_until(Duration::from_secs(2), || backend.close_count() == 1);
}

#[test]
fn managed_shell_uses_configured_keepalive_and_default_directory() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.keepalive_seconds = 17;
    ssh_options.terminal.startup_command = "/srv/app".to_owned();
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
        ssh_options,
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed terminal ready".to_vec(),
    ));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::clone(&backend)),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            |_| true,
        )
        .expect("create managed ssh terminal with configured keepalive and cwd");

    assert_eq!(summary.cwd.as_deref(), Some("/srv/app"));
    assert_eq!(backend.last_keepalive_seconds(), Some(17));
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(
        backend.written_inputs(),
        vec![b"cd -- '/srv/app' && exec \"${SHELL:-/bin/sh}\" -l\r".to_vec()]
    );
    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn managed_shell_prompt_required_returns_recoverable_prompt_plan() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    remove_host_secret_ref_for_prompt_only_fixture(state.paths(), &host_id);
    let backend = Arc::new(FakeShellRuntime::default());
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let request = SshTerminalCreateRequest {
        host_id: host_id.clone(),
        cwd: None,
        remote_command: None,
        cols: 80,
        rows: 24,
    };

    let error = try_open_managed_shell(
        &service,
        state.remote_hosts(),
        state.paths(),
        request.clone(),
    )
    .expect_err("prompt-only terminal should return a recoverable prompt plan");

    assert_eq!(backend.connect_count(), 0);
    let snapshot = managed_runtime.snapshot().expect("runtime snapshot");
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
    let AppError::SshAuthPromptRequired {
        message,
        prompt_plan,
    } = error
    else {
        panic!("expected SshAuthPromptRequired");
    };
    assert!(message.contains("deploy@dev.internal:22"));
    let prompts = prompt_plan
        .get("prompts")
        .and_then(|value| value.as_array())
        .expect("prompt plan prompts");
    assert_eq!(prompts.len(), 1);
    let prompt = prompts.first().expect("target prompt");
    assert_eq!(
        prompt.get("promptId").and_then(|value| value.as_str()),
        Some("ssh-auth:target:deploy@dev.internal:22:password")
    );
    assert_eq!(
        prompt.get("role").and_then(|value| value.as_str()),
        Some("target")
    );
    assert_eq!(
        prompt.get("secretKind").and_then(|value| value.as_str()),
        Some("password")
    );
    assert_eq!(
        prompt.get("username").and_then(|value| value.as_str()),
        Some("deploy")
    );
    assert_eq!(
        prompt.get("host").and_then(|value| value.as_str()),
        Some("dev.internal")
    );
    assert_eq!(
        prompt.get("port").and_then(|value| value.as_u64()),
        Some(22)
    );
}

#[test]
fn create_session_uses_managed_shell_for_remote_cwd_without_legacy_fallback() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed cwd terminal ready".to_vec(),
    ));
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/srv/app's data".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal with cwd");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd.as_deref(), Some("/srv/app's data"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(
        backend.written_inputs(),
        vec![b"cd -- '/srv/app'\\''s data' && exec \"${SHELL:-/bin/sh}\" -l\r".to_vec()]
    );
    assert!(managed_runtime
        .snapshot()
        .expect("runtime snapshot")
        .recent_legacy_fallbacks
        .is_empty());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed cwd terminal ready"));

    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn create_session_uses_managed_shell_for_remote_command_without_legacy_fallback() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed command terminal ready".to_vec(),
    ));
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: Some("uptime".to_owned()),
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal with remote command");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd, None);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(backend.written_inputs(), vec![b"exec uptime\r".to_vec()]);
    assert!(managed_runtime
        .snapshot()
        .expect("runtime snapshot")
        .recent_legacy_fallbacks
        .is_empty());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed command terminal ready"));

    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn create_session_uses_managed_shell_for_jump_host_remote_cwd_without_legacy_fallback() {
    let (_home, state) = test_state();
    let ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "password-jump".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2022,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            key_passphrase_secret: None,
            credential_secret: Some(JUMP_PASSWORD.to_owned()),
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TARGET_PASSWORD.to_owned()),
        ssh_options,
    );
    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"managed jump cwd terminal ready".to_vec(),
    ));
    let managed_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let auth_broker = SshAuthBroker::new();
    let service = SshTerminalService::with_ssh_runtime(
        managed_runtime.clone(),
        auth_broker.clone(),
        ExternalSessionMaterializer::new(ExternalLaunchIntake::new(), auth_broker),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/dev".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed ssh terminal through jump host with cwd");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd.as_deref(), Some("/dev"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    let key = backend.last_key().expect("managed runtime key");
    assert_eq!(key.target.host, "dev.internal");
    assert_eq!(key.target.username, "deploy");
    assert_eq!(key.jumps.len(), 1);
    assert_eq!(key.jumps[0].host, "bastion.internal");
    assert_eq!(key.jumps[0].port, 2022);
    assert_eq!(key.jumps[0].username, "jump");
    assert!(!format!("{key:?}").contains(JUMP_PASSWORD));
    assert!(!format!("{key:?}").contains(TARGET_PASSWORD));
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    assert_eq!(
        backend.written_inputs(),
        vec![b"cd -- '/dev' && exec \"${SHELL:-/bin/sh}\" -l\r".to_vec()]
    );
    assert!(managed_runtime
        .snapshot()
        .expect("runtime snapshot")
        .recent_legacy_fallbacks
        .is_empty());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed jump cwd terminal ready"));

    terminals.close(&summary.id).expect("close shell");
}

#[test]
fn create_session_prefers_managed_shell_for_materialized_external_password_target() {
    let (_home, state) = test_state();
    let launch_id = queue_putty_password_launch(state.external_launch_intake(), Some("deploy"));
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("drain pending launch");
    assert_eq!(pending.len(), 1);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external launch secret");

    let backend = Arc::new(FakeShellRuntime::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"external managed terminal ready".to_vec(),
    ));
    let service = SshTerminalService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::clone(&backend)),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let terminals = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = service
        .create_session(
            state.remote_hosts(),
            state.paths(),
            &terminals,
            SshTerminalCreateRequest {
                host_id: target.host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create managed external ssh terminal");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.target_ref.as_deref(), Some(target.host_id.as_str()));
    assert!(summary.shell.contains("example.internal"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.shell_open_count(), 1);
    let key = backend.last_key().expect("managed runtime key");
    assert_eq!(key.target.host_id.as_deref(), Some(target.host_id.as_str()));
    assert_eq!(key.target.host, "example.internal");
    assert_eq!(key.target.username, "deploy");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id == "ssh-auth:target:deploy@example.internal:2202:password"
    ));
    assert!(!format!("{key:?}").contains(EXTERNAL_PASSWORD));

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed external terminal output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("external managed terminal ready"));
    assert!(!output.data.contains(EXTERNAL_PASSWORD));

    terminals
        .write(&summary.id, "whoami\r")
        .expect("write external shell");
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    terminals.close(&summary.id).expect("close external shell");
    wait_until(Duration::from_secs(2), || backend.close_count() == 1);
}

#[test]
fn resolve_terminal_request_enters_requested_remote_cwd() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/dev".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/dev' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_uses_configured_default_remote_directory() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.startup_command = "/srv/app".to_owned();
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Agent,
        None,
        None,
        ssh_options,
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/srv/app' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_cwd_overrides_configured_default_remote_directory() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.startup_command = "/srv/app".to_owned();
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Agent,
        None,
        None,
        ssh_options,
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/opt/release".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/opt/release' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_uses_configured_server_alive_interval() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.keepalive_seconds = 23;
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Agent,
        None,
        None,
        ssh_options,
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(request
        .args
        .windows(2)
        .any(|args| args[0] == "-o" && args[1] == "ServerAliveInterval=23"));
}

#[test]
fn resolve_terminal_request_quotes_requested_remote_cwd() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/srv/app's data".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/srv/app'\\''s data' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_rejects_zero_size() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let error = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 0,
            },
        )
        .expect_err("reject zero rows");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn resolve_terminal_request_uses_configured_terminal_type() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.terminal_type = "xterm".to_owned();
    let host_id =
        create_test_remote_host_with_options(&state, RemoteHostAuthType::Agent, None, ssh_options);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(request.env.get("TERM"), Some(&"xterm".to_owned()));
}

#[test]
fn resolve_terminal_request_uses_key_path_identity_file() {
    let (_home, state) = test_state();
    let key_path = state
        .paths()
        .root
        .join("keys")
        .join("dev ed25519")
        .to_string_lossy()
        .into_owned();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Key, Some(key_path.clone()));

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(request
        .args
        .windows(2)
        .any(|pair| pair[0] == "-i" && pair[1] == key_path));
    assert!(request.args.contains(&"IdentitiesOnly=yes".to_owned()));
    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn resolve_terminal_request_expands_home_relative_identity_file() {
    let (_home, state) = test_state();
    let expected_identity = dirs::home_dir()
        .expect("current user home")
        .join(".ssh")
        .join("id_ed25519")
        .to_string_lossy()
        .into_owned();
    let host_id = create_test_remote_host(
        &state,
        RemoteHostAuthType::Key,
        Some("~/.ssh/id_ed25519".to_owned()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(request
        .args
        .windows(2)
        .any(|pair| pair[0] == "-i" && pair[1] == expected_identity));
}

#[test]
fn resolve_terminal_request_materializes_inline_private_key_for_openssh() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Key,
        None,
        Some(TEST_PRIVATE_KEY.to_owned()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh")));
    let identity_path = request
        .args
        .windows(2)
        .find(|pair| pair[0] == "-i")
        .map(|pair| PathBuf::from(&pair[1]))
        .expect("identity path arg");
    assert!(identity_path.starts_with(state.paths().temp.join("ssh-terminal-keys")));
    assert_eq!(request.cleanup_paths, vec![identity_path.clone()]);
    assert_eq!(
        fs::read_to_string(&identity_path).unwrap(),
        TEST_PRIVATE_KEY
    );

    for path in request.cleanup_paths {
        let _ = fs::remove_file(path);
    }
}

#[test]
fn resolve_terminal_request_uses_saved_vault_password_without_exposing_args() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh") || arg.contains(TEST_PASSWORD)));
    assert!(request
        .args
        .contains(&"PreferredAuthentications=publickey,password,keyboard-interactive".to_owned(),));
    let host = state
        .remote_hosts()
        .require_host(&host_id)
        .expect("stored host");
    assert!(
        host.secret_ref.is_some(),
        "stored host should keep encrypted vault ref"
    );
    assert_eq!(host.credential_secret, None);
}

#[test]
fn resolve_terminal_launch_uses_saved_vault_password_secret_plan() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );

    let launch = resolve_terminal_launch(
        state.ssh_terminals(),
        state.remote_hosts(),
        state.paths(),
        SshTerminalCreateRequest {
            host_id: host_id.clone(),
            cwd: None,
            remote_command: None,
            cols: 80,
            rows: 24,
        },
    )
    .expect("resolve ssh terminal launch");

    assert!(!launch
        .request
        .args
        .iter()
        .any(|arg| arg.contains(TEST_PASSWORD)));
    let secret_plan = launch.secret_input_plan.expect("password prompt plan");
    assert_eq!(secret_plan.entries.len(), 1);
    let entry = &secret_plan.entries[0];
    assert_eq!(entry.id, "target:password");
    assert_eq!(entry.response, TEST_PASSWORD);
    assert_eq!(entry.redact_values, vec![TEST_PASSWORD.to_owned()]);
    assert_eq!(entry.max_responses, 1);
    assert!(entry
        .prompt_markers
        .iter()
        .any(|marker| marker == "deploy@dev.internal's password:"));

    let host = state
        .remote_hosts()
        .require_host(&host_id)
        .expect("stored host");
    assert!(host.secret_ref.is_some());
    assert_eq!(host.credential_secret, None);
}

#[test]
fn resolve_terminal_launch_uses_materialized_external_target_without_host_toml() {
    let (_home, state) = test_state();
    let launch_id = queued_launch_id(
        state
            .external_launch_intake()
            .accept_args(
                vec![
                    "putty.exe".to_owned(),
                    "-ssh".to_owned(),
                    "deploy@example.internal".to_owned(),
                    "-P".to_owned(),
                    "2202".to_owned(),
                    "-pw".to_owned(),
                    TEST_PASSWORD.to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue external launch"),
    );
    let _ = state
        .external_launch_intake()
        .take_pending()
        .expect("activate pending launch");
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");

    let launch = resolve_terminal_launch(
        state.ssh_terminals(),
        state.remote_hosts(),
        state.paths(),
        SshTerminalCreateRequest {
            host_id: target.host_id,
            cwd: None,
            remote_command: Some("uptime".to_owned()),
            cols: 80,
            rows: 24,
        },
    )
    .expect("resolve external terminal launch");

    assert!(launch.request.args.contains(&"2202".to_owned()));
    assert!(launch
        .request
        .args
        .contains(&"deploy@example.internal".to_owned()));
    assert!(!launch
        .request
        .args
        .iter()
        .any(|arg| arg.contains(TEST_PASSWORD)));
    assert_eq!(
        launch.request.args.last().map(String::as_str),
        Some("exec uptime")
    );

    let secret_plan = launch
        .secret_input_plan
        .expect("external password secret input plan");
    assert_eq!(secret_plan.entries.len(), 1);
    assert_eq!(secret_plan.entries[0].response, TEST_PASSWORD);
    assert_eq!(secret_plan.redact_values(), vec![TEST_PASSWORD.to_owned()]);
}

#[test]
fn resolve_terminal_request_uses_openssh_config_alias_for_jump_route() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "bastion".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2200,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            key_passphrase_secret: None,
            credential_secret: None,
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    ssh_options.terminal.keepalive_seconds = 19;
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Agent,
        None,
        None,
        ssh_options,
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal jump request");

    let config_path = request
        .args
        .windows(2)
        .find(|pair| pair[0] == "-F")
        .map(|pair| PathBuf::from(&pair[1]))
        .expect("temp config path");
    assert_eq!(
        request.args.last().map(String::as_str),
        Some("kerminal-target")
    );
    assert!(!request
        .args
        .iter()
        .any(|arg| arg == "-J" || arg.contains("ProxyJump")));
    assert!(request.cleanup_paths.contains(&config_path));

    let config = fs::read_to_string(&config_path).expect("read temp config");
    assert!(config.contains("Host kerminal-hop-0"));
    assert!(config.contains("HostName bastion.internal"));
    assert!(config.contains("Port 2200"));
    assert!(config.contains("User jump"));
    assert!(config.contains("Host kerminal-target"));
    assert!(config.contains("HostName dev.internal"));
    assert!(config.contains("ProxyCommand ssh -F "));
    assert!(config.contains(" kerminal-hop-0"));
    assert!(config.contains("UserKnownHostsFile "));
    assert!(config.contains("GlobalKnownHostsFile none"));
    assert!(config.contains("ServerAliveInterval 19"));

    cleanup_paths(&request.cleanup_paths);
}

#[test]
fn app_state_startup_cleans_stale_interactive_ssh_identity_files() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let key_dir = paths.temp.join("ssh-terminal-keys");
    fs::create_dir_all(&key_dir).unwrap();
    let stale_key = key_dir.join("identity-stale.key");
    let unrelated_key = key_dir.join("manual.key");
    fs::write(&stale_key, "leftover private key").unwrap();
    fs::write(&unrelated_key, "not managed by kerminal").unwrap();

    let _state = AppState::initialize_with_paths(paths).expect("initialize app state");

    assert!(!stale_key.exists());
    assert!(unrelated_key.exists());
}

#[test]
fn cleanup_temporary_identity_files_removes_only_managed_keys() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let key_dir = temporary_identity_directory(&paths);
    fs::create_dir_all(&key_dir).unwrap();
    let managed = key_dir.join("identity-managed.key");
    let unrelated = key_dir.join("manual.key");
    let wrong_suffix = key_dir.join("identity-managed.txt");
    fs::write(&managed, "private key").unwrap();
    fs::write(&unrelated, "manual").unwrap();
    fs::write(&wrong_suffix, "not a managed key").unwrap();

    let removed = cleanup_temporary_identity_files(&paths, None).unwrap();

    assert_eq!(removed, 1);
    assert!(!managed.exists());
    assert!(unrelated.exists());
    assert!(wrong_suffix.exists());
}

#[test]
fn cleanup_stale_temporary_identity_files_honors_age_gate() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let key_dir = temporary_identity_directory(&paths);
    fs::create_dir_all(&key_dir).unwrap();
    let fresh = key_dir.join("identity-fresh.key");
    fs::write(&fresh, "private key").unwrap();

    let removed =
        cleanup_temporary_identity_files(&paths, Some(Duration::from_secs(60 * 60))).unwrap();
    assert_eq!(removed, 0);
    assert!(fresh.exists());

    let removed = cleanup_temporary_identity_files(&paths, Some(Duration::ZERO)).unwrap();
    assert_eq!(removed, 1);
    assert!(!fresh.exists());
}

#[test]
fn jump_terminal_launch_uses_multi_secret_plan_without_leaking_args() {
    let (_home, state) = test_state();
    let ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "password-jump".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2022,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            key_passphrase_secret: None,
            credential_secret: Some(JUMP_PASSWORD.to_owned()),
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TARGET_PASSWORD.to_owned()),
        ssh_options,
    );

    let launch = resolve_terminal_launch(
        state.ssh_terminals(),
        state.remote_hosts(),
        state.paths(),
        SshTerminalCreateRequest {
            host_id,
            cwd: Some("/dev".to_owned()),
            remote_command: None,
            cols: 80,
            rows: 24,
        },
    )
    .expect("build jump terminal launch");

    assert!(launch
        .request
        .shell
        .as_deref()
        .is_some_and(|shell| shell.ends_with("ssh") || shell.ends_with("ssh.exe")));
    assert!(launch
        .request
        .args
        .windows(2)
        .any(|pair| pair[0] == "-F" && PathBuf::from(&pair[1]).exists()));
    assert_eq!(
        launch.request.args.last().map(String::as_str),
        Some("cd -- '/dev' && exec \"${SHELL:-/bin/sh}\" -l")
    );
    assert_eq!(
        launch
            .request
            .args
            .get(launch.request.args.len() - 2)
            .map(String::as_str),
        Some("kerminal-target")
    );
    assert!(!launch
        .request
        .args
        .iter()
        .any(|arg| arg.contains(JUMP_PASSWORD) || arg.contains(TARGET_PASSWORD)));

    let secret_plan = launch.secret_input_plan.expect("multi secret plan");
    assert_eq!(secret_plan.entries.len(), 2);
    assert_eq!(
        secret_plan
            .entries
            .iter()
            .map(|entry| (entry.id.as_str(), entry.response.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("jump-0:password", JUMP_PASSWORD),
            ("target:password", TARGET_PASSWORD),
        ]
    );
    assert_eq!(
        secret_plan.redact_values(),
        vec![JUMP_PASSWORD.to_owned(), TARGET_PASSWORD.to_owned()]
    );

    cleanup_paths(&launch.request.cleanup_paths);
}

fn create_test_remote_host(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
) -> String {
    create_test_remote_host_with_options(state, auth_type, credential_ref, SshOptions::default())
}

fn create_test_remote_host_with_options(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    ssh_options: SshOptions,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type,
            credential_ref,
            credential_secret: None,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            production: false,
            ssh_options,
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
        })
        .expect("create test host")
        .id
}

fn create_test_remote_host_with_secret(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> String {
    create_test_remote_host_with_secret_and_options(
        state,
        auth_type,
        credential_ref,
        credential_secret,
        SshOptions::default(),
    )
}

fn remove_host_secret_ref_for_prompt_only_fixture(paths: &KerminalPaths, host_id: &str) {
    let path = paths.root.join("hosts").join(format!("{host_id}.toml"));
    let content = fs::read_to_string(&path).expect("read host fixture toml");
    let without_secret_ref = content
        .lines()
        .filter(|line| !line.trim_start().starts_with("secret_ref"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{without_secret_ref}\n")).expect("write prompt-only host fixture");
}

fn create_test_remote_host_with_secret_and_options(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
    ssh_options: SshOptions,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type,
            credential_ref,
            credential_secret,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            production: false,
            ssh_options,
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
        })
        .expect("create test host")
        .id
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
    let started_at = Instant::now();
    while started_at.elapsed() < timeout {
        if predicate() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        predicate(),
        "condition was not satisfied within {timeout:?}"
    );
}

#[derive(Default)]
struct FakeShellRuntime {
    state: Arc<FakeShellRuntimeState>,
}

#[derive(Default)]
struct FakeShellRuntimeState {
    closes: AtomicUsize,
    connects: AtomicUsize,
    events: Mutex<VecDeque<SshRuntimeShellEvent>>,
    last_keepalive_seconds: Mutex<Option<u64>>,
    last_key: Mutex<Option<SshSessionKey>>,
    opens: AtomicUsize,
    writes: Mutex<Vec<Vec<u8>>>,
}

impl FakeShellRuntime {
    fn push_event(&self, event: SshRuntimeShellEvent) {
        self.state
            .events
            .lock()
            .expect("events lock")
            .push_back(event);
    }

    fn close_count(&self) -> usize {
        self.state.closes.load(Ordering::SeqCst)
    }

    fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    fn last_key(&self) -> Option<SshSessionKey> {
        self.state.last_key.lock().expect("last key").clone()
    }

    fn last_keepalive_seconds(&self) -> Option<u64> {
        *self
            .state
            .last_keepalive_seconds
            .lock()
            .expect("last keepalive seconds")
    }

    fn shell_open_count(&self) -> usize {
        self.state.opens.load(Ordering::SeqCst)
    }

    fn write_count(&self) -> usize {
        self.state.writes.lock().expect("writes lock").len()
    }

    fn written_inputs(&self) -> Vec<Vec<u8>> {
        self.state.writes.lock().expect("writes lock").clone()
    }
}

impl SshRuntimeBackend for FakeShellRuntime {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        *self.state.last_key.lock().expect("last key") = Some(request.key().clone());
        *self
            .state
            .last_keepalive_seconds
            .lock()
            .expect("last keepalive seconds") = request.native_keepalive_seconds();
        Ok(Arc::new(FakeShellConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeShellConnection {
    state: Arc<FakeShellRuntimeState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeShellConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        Ok(format!("fake-{kind:?}-channel"))
    }

    fn supports_shell(&self) -> bool {
        true
    }

    async fn open_shell(
        &self,
        _request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        self.state.opens.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeShellSession {
            state: Arc::clone(&self.state),
        }))
    }

    fn disconnect(&self, _reason: &str) {}
}

struct FakeShellSession {
    state: Arc<FakeShellRuntimeState>,
}

impl std::fmt::Debug for FakeShellSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FakeShellSession")
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl SshRuntimeShellSession for FakeShellSession {
    async fn read_event(&self) -> AppResult<SshRuntimeShellEvent> {
        loop {
            if let Some(event) = self.state.events.lock().expect("events lock").pop_front() {
                return Ok(event);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        self.state.writes.lock().expect("writes lock").push(data);
        Ok(())
    }

    async fn resize(&self, _cols: u16, _rows: u16) -> AppResult<()> {
        Ok(())
    }

    async fn close(&self) -> AppResult<()> {
        self.state.closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn queued_launch_id(outcome: ExternalLaunchAcceptOutcome) -> String {
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
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
                    EXTERNAL_PASSWORD.to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue putty launch"),
    )
}
