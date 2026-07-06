//! 真实 OpenSSH password 交互终端 smoke 测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{
        SshTerminalCreateRequest, TerminalAgentKind, TerminalAgentStatus, TerminalOutputEvent,
        TerminalSessionStatus, TerminalSessionSummary,
    },
    paths::KerminalPaths,
    services::external_launch::{
        ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
    },
    state::AppState,
};
use std::{
    sync::{atomic::Ordering, mpsc},
    time::Duration,
};
use tempfile::{tempdir, TempDir};

mod support;

use support::ssh_terminal_smoke::*;

fn open_loopback_managed_terminal() -> (
    LoopbackTerminalServer,
    TempDir,
    AppState,
    PasswordSmokeConfig,
    TerminalSessionSummary,
    mpsc::Receiver<TerminalOutputEvent>,
) {
    let server = LoopbackTerminalServer::start();
    let config = PasswordSmokeConfig {
        host: "127.0.0.1".to_owned(),
        port: server.addr.port(),
        username: LOOPBACK_USER.to_owned(),
        password: LOOPBACK_PASSWORD.to_owned(),
        known_host_line: None,
        ready_marker: Some(LOOPBACK_READY_MARKER.to_owned()),
        expect_auth_failure: false,
    };
    let (home, state) = create_loopback_terminal_harness(&server);
    let host_id = create_remote_host(&state, &config);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create loopback managed SSH terminal session");
    assert_eq!(
        summary.pid, None,
        "loopback SSH terminal should use managed native shell, not system ssh"
    );
    (server, home, state, config, summary, receiver)
}

#[test]
fn local_russh_loopback_password_terminal_auto_login_smoke() {
    if !open_ssh_client_available() {
        eprintln!("skipping local loopback SSH terminal smoke: OpenSSH client is not available");
        return;
    }

    let server = LoopbackTerminalServer::start();
    let config = PasswordSmokeConfig {
        host: "127.0.0.1".to_owned(),
        port: server.addr.port(),
        username: LOOPBACK_USER.to_owned(),
        password: LOOPBACK_PASSWORD.to_owned(),
        known_host_line: None,
        ready_marker: Some(LOOPBACK_READY_MARKER.to_owned()),
        expect_auth_failure: false,
    };
    let (_home, state) = create_loopback_terminal_harness(&server);
    let host_id = create_remote_host(&state, &config);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create local loopback SSH password terminal session");

    let result = run_smoke_terminal_flow(state.terminals(), &summary.id, &receiver, &config);
    let _ = state.terminals().close(&summary.id);
    let output = result.expect("run local loopback SSH password terminal flow");

    assert!(output.contains(COMMAND_MARKER), "{output:?}");
    assert!(output.contains(UNICODE_COMMAND_MARKER), "{output:?}");
    assert!(
        !output.contains(&config.password),
        "terminal output must not echo saved password: {output:?}",
    );
}

#[test]
fn local_russh_loopback_external_password_terminal_no_save_smoke() {
    let server = LoopbackTerminalServer::start();
    let config = PasswordSmokeConfig {
        host: "127.0.0.1".to_owned(),
        port: server.addr.port(),
        username: LOOPBACK_USER.to_owned(),
        password: LOOPBACK_PASSWORD.to_owned(),
        known_host_line: None,
        ready_marker: Some(LOOPBACK_READY_MARKER.to_owned()),
        expect_auth_failure: false,
    };
    let (_home, state) = create_loopback_terminal_harness(&server);
    let launch_id = queue_external_putty_password_launch(state.external_launch_intake(), &config);
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("drain external launch");
    assert_eq!(pending.len(), 1);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external no-save target");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: target.host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create external no-save SSH terminal session");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.target_ref.as_deref(), Some(target.host_id.as_str()));
    let result = run_smoke_terminal_flow(state.terminals(), &summary.id, &receiver, &config);
    let _ = state.terminals().close(&summary.id);
    let output = result.expect("run external no-save SSH terminal flow");

    assert!(output.contains(COMMAND_MARKER), "{output:?}");
    assert!(output.contains(UNICODE_COMMAND_MARKER), "{output:?}");
    assert!(
        !output.contains(&config.password),
        "terminal output must not echo external no-save password: {output:?}",
    );
}

#[test]
fn local_russh_loopback_managed_terminal_handles_ctrl_c_and_continues() {
    let (_server, _home, state, _config, summary, receiver) = open_loopback_managed_terminal();
    let mut output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_READY_MARKER,
        String::new(),
        Duration::from_secs(10),
    )
    .expect("wait for loopback ready marker");

    state
        .terminals()
        .write(
            &summary.id,
            &format!("{LOOPBACK_INTERRUPT_COMMAND}\r\u{0003}"),
        )
        .expect("send interrupt command and Ctrl+C");
    output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_INTERRUPT_MARKER,
        output,
        Duration::from_secs(10),
    )
    .expect("wait for interrupt marker");
    assert!(output.contains("^C"), "{output:?}");

    state
        .terminals()
        .write(&summary.id, &format!("echo {COMMAND_MARKER}\r"))
        .expect("send post-interrupt command");
    let output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        COMMAND_MARKER,
        output,
        Duration::from_secs(10),
    )
    .expect("managed shell should keep working after Ctrl+C");
    let _ = state.terminals().close(&summary.id);
    assert!(output.contains(COMMAND_MARKER), "{output:?}");
}

#[test]
fn local_russh_loopback_managed_terminal_handles_eof_close() {
    let (_server, _home, state, _config, summary, receiver) = open_loopback_managed_terminal();
    let output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_READY_MARKER,
        String::new(),
        Duration::from_secs(10),
    )
    .expect("wait for loopback ready marker");

    state
        .terminals()
        .write(&summary.id, "\u{0004}")
        .expect("send Ctrl+D EOF");
    let output = collect_until_closed(
        state.terminals(),
        &summary.id,
        &receiver,
        output,
        Duration::from_secs(10),
    )
    .expect("managed shell should emit closed after Ctrl+D EOF");
    let summary = state
        .terminals()
        .session_summary(&summary.id)
        .expect("read terminal summary after EOF");
    assert_eq!(summary.status, TerminalSessionStatus::Exited);
    assert!(
        !output.contains(LOOPBACK_PASSWORD),
        "terminal output must not echo password: {output:?}",
    );
}

#[test]
fn local_russh_loopback_managed_terminal_accepts_raw_chinese_input() {
    let (_server, _home, state, _config, summary, receiver) = open_loopback_managed_terminal();
    let output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_READY_MARKER,
        String::new(),
        Duration::from_secs(10),
    )
    .expect("wait for loopback ready marker");

    state
        .terminals()
        .write(&summary.id, &format!("echo {UNICODE_COMMAND_MARKER}\r"))
        .expect("send raw unicode command");
    let output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        UNICODE_COMMAND_MARKER,
        output,
        Duration::from_secs(10),
    )
    .expect("wait for raw unicode marker");
    let _ = state.terminals().close(&summary.id);
    assert!(output.contains(UNICODE_COMMAND_MARKER), "{output:?}");
    assert!(
        !output.contains('\u{FFFD}'),
        "managed shell output contains replacement characters: {output:?}"
    );
}

#[test]
fn local_russh_loopback_managed_terminal_handles_high_output_and_recovers() {
    let (_server, _home, state, _config, summary, receiver) = open_loopback_managed_terminal();
    let mut output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_READY_MARKER,
        String::new(),
        Duration::from_secs(10),
    )
    .expect("wait for loopback ready marker");

    state
        .terminals()
        .write(&summary.id, &format!("{LOOPBACK_HIGH_OUTPUT_COMMAND}\r"))
        .expect("send high output command");
    output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_HIGH_OUTPUT_END,
        output,
        Duration::from_secs(20),
    )
    .expect("wait for high output end marker");
    assert!(output.contains(LOOPBACK_HIGH_OUTPUT_START), "{output:?}");
    assert!(output.contains(LOOPBACK_HIGH_OUTPUT_END), "{output:?}");
    assert!(
        output.matches(LOOPBACK_HIGH_OUTPUT_LINE).count() >= LOOPBACK_HIGH_OUTPUT_LINES,
        "high output did not contain every expected line"
    );
    assert!(
        output.len() > 100_000,
        "high output should exercise the managed shell reader buffer, got {} bytes",
        output.len()
    );

    state
        .terminals()
        .write(&summary.id, &format!("echo {COMMAND_MARKER}\r"))
        .expect("send command after high output");
    let output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        COMMAND_MARKER,
        output,
        Duration::from_secs(10),
    )
    .expect("managed shell should keep working after high output");
    let _ = state.terminals().close(&summary.id);
    assert!(output.contains(COMMAND_MARKER), "{output:?}");
}

#[test]
fn local_russh_loopback_managed_terminal_passes_tui_and_agent_signals() {
    let (_server, _home, state, _config, summary, receiver) = open_loopback_managed_terminal();
    let mut output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_READY_MARKER,
        String::new(),
        Duration::from_secs(10),
    )
    .expect("wait for loopback ready marker");

    state
        .terminals()
        .write(&summary.id, &format!("{LOOPBACK_TUI_COMMAND}\r"))
        .expect("send TUI command");
    output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_TUI_MARKER,
        output,
        Duration::from_secs(10),
    )
    .expect("wait for TUI marker");
    assert!(output.contains("\u{1b}[?1049h"), "{output:?}");
    assert!(output.contains("\u{1b}[?1049l"), "{output:?}");

    state
        .terminals()
        .write(&summary.id, &format!("{LOOPBACK_AGENT_SIGNAL_COMMAND}\r"))
        .expect("send agent signal command");
    let (output_after_signal, signal) = collect_until_agent_signal(
        state.terminals(),
        &summary.id,
        &receiver,
        output,
        Duration::from_secs(10),
    )
    .expect("wait for agent signal");
    assert_eq!(signal.terminal_session_id, summary.id);
    assert_eq!(signal.agent, TerminalAgentKind::Codex);
    assert_eq!(signal.status, TerminalAgentStatus::Working);
    let output = collect_until_output(
        state.terminals(),
        &summary.id,
        &receiver,
        LOOPBACK_AGENT_SIGNAL_VISIBLE_MARKER,
        output_after_signal,
        Duration::from_secs(10),
    )
    .expect("wait for agent visible marker");
    let _ = state.terminals().close(&summary.id);
    assert!(
        !output.contains(LOOPBACK_AGENT_OSC_MARKER),
        "agent OSC marker must be filtered from terminal data: {output:?}"
    );
}

#[test]
fn local_russh_loopback_password_terminal_auto_login_smoke_reconnects_with_same_saved_secret() {
    if !open_ssh_client_available() {
        eprintln!(
            "skipping local loopback SSH terminal reconnect smoke: OpenSSH client is not available"
        );
        return;
    }

    let server = LoopbackTerminalServer::start();
    let config = PasswordSmokeConfig {
        host: "127.0.0.1".to_owned(),
        port: server.addr.port(),
        username: LOOPBACK_USER.to_owned(),
        password: LOOPBACK_PASSWORD.to_owned(),
        known_host_line: None,
        ready_marker: Some(LOOPBACK_READY_MARKER.to_owned()),
        expect_auth_failure: false,
    };
    let (_home, state) = create_loopback_terminal_harness(&server);
    let host_id = create_remote_host(&state, &config);

    let first_output = connect_and_capture_loopback_output(&state, &host_id, &config)
        .expect("first reconnect smoke terminal flow");
    assert!(first_output.contains(COMMAND_MARKER), "{first_output:?}");
    assert!(
        first_output.contains(UNICODE_COMMAND_MARKER),
        "{first_output:?}"
    );
    assert!(
        !first_output.contains(&config.password),
        "terminal output must not echo saved password on first connect: {first_output:?}",
    );

    let second_output = connect_and_capture_loopback_output(&state, &host_id, &config)
        .expect("second reconnect smoke terminal flow");
    assert!(second_output.contains(COMMAND_MARKER), "{second_output:?}");
    assert!(
        second_output.contains(UNICODE_COMMAND_MARKER),
        "{second_output:?}"
    );
    assert!(
        !second_output.contains(&config.password),
        "terminal output must not echo saved password on second connect: {second_output:?}",
    );
}

fn queue_external_putty_password_launch(
    intake: &ExternalLaunchIntake,
    config: &PasswordSmokeConfig,
) -> String {
    queued_launch_id(
        intake
            .accept_args(
                vec![
                    "putty.exe".to_owned(),
                    "-ssh".to_owned(),
                    format!("{}@{}", config.username, config.host),
                    "-P".to_owned(),
                    config.port.to_string(),
                    "-pw".to_owned(),
                    config.password.clone(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue external putty password launch"),
    )
}

fn queued_launch_id(outcome: ExternalLaunchAcceptOutcome) -> String {
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    }
}

#[test]
fn local_russh_loopback_password_jump_terminal_auto_login_smoke() {
    if !open_ssh_client_available() {
        eprintln!(
            "skipping local loopback SSH jump terminal smoke: OpenSSH client is not available"
        );
        return;
    }

    let target = LoopbackTerminalServer::start();
    let jump = LoopbackTerminalJumpServer::start(target.addr);
    let config = PasswordSmokeConfig {
        host: "127.0.0.1".to_owned(),
        port: target.addr.port(),
        username: LOOPBACK_USER.to_owned(),
        password: LOOPBACK_PASSWORD.to_owned(),
        known_host_line: None,
        ready_marker: Some(LOOPBACK_READY_MARKER.to_owned()),
        expect_auth_failure: false,
    };
    let (_home, state) = create_loopback_terminal_harness(&target);
    trust_loopback_host_key(state.paths(), "127.0.0.1", jump.addr.port(), &jump.host_key)
        .expect("trust loopback jump host key");
    let host_id = create_remote_host_with_password_jump(&state, &config, &jump);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create local loopback SSH password jump terminal session");

    let result = run_smoke_terminal_flow(state.terminals(), &summary.id, &receiver, &config);
    let _ = state.terminals().close(&summary.id);
    let output = result.expect("run local loopback SSH password jump terminal flow");

    assert!(output.contains(COMMAND_MARKER), "{output:?}");
    assert!(output.contains(UNICODE_COMMAND_MARKER), "{output:?}");
    assert!(
        !output.contains(&config.password),
        "terminal output must not echo target password: {output:?}",
    );
    assert!(
        !output.contains(LOOPBACK_JUMP_PASSWORD),
        "terminal output must not echo jump password: {output:?}",
    );
    assert!(
        jump.direct_tcpip_requests.load(Ordering::SeqCst) >= 1,
        "OpenSSH ProxyCommand must open direct-tcpip through the jump host",
    );
}

#[test]
fn local_russh_loopback_wrong_password_stays_unauthenticated() {
    if !open_ssh_client_available() {
        eprintln!("skipping local loopback SSH terminal wrong-password smoke: OpenSSH client is not available");
        return;
    }

    let server = LoopbackTerminalServer::start();
    let config = PasswordSmokeConfig {
        host: "127.0.0.1".to_owned(),
        port: server.addr.port(),
        username: LOOPBACK_USER.to_owned(),
        password: "wrong-secret".to_owned(),
        known_host_line: None,
        ready_marker: Some(LOOPBACK_READY_MARKER.to_owned()),
        expect_auth_failure: true,
    };
    let (_home, state) = create_loopback_terminal_harness(&server);
    let host_id = create_remote_host(&state, &config);
    let error = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |_event| true,
        )
        .expect_err("wrong saved password should fail before opening managed shell");
    let error = error.to_string();

    assert!(
        auth_failure_feedback_seen(&error),
        "expected saved wrong password to produce authentication feedback, got: {error:?}",
    );
    assert!(
        !error.contains(COMMAND_MARKER) && !error.contains(UNICODE_COMMAND_MARKER),
        "wrong password smoke must not reach the authenticated shell: {error:?}",
    );
    assert!(
        !error.contains(&config.password),
        "terminal error must not echo saved password: {error:?}",
    );
}

#[test]
#[ignore = "requires RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE=1 and a real OpenSSH password host"]
fn real_openssh_password_terminal_auto_login_smoke() {
    let Some(config) =
        PasswordSmokeConfig::from_env().expect("read SSH terminal password smoke env")
    else {
        eprintln!(
            "skipping real OpenSSH password terminal smoke: set {RUN_FLAG}=1, {HOST_ENV}, \
             {USER_ENV} and {PASSWORD_ENV}"
        );
        return;
    };

    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    trust_smoke_host_key(state.paths(), &config).expect("trust smoke host key");

    let host_id = create_remote_host(&state, &config);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create SSH password terminal session");

    let result = if config.expect_auth_failure {
        run_expected_auth_failure_flow(state.terminals(), &summary.id, &receiver, &config)
    } else {
        run_smoke_terminal_flow(state.terminals(), &summary.id, &receiver, &config)
    };
    let _ = state.terminals().close(&summary.id);
    let output = result.expect("run SSH password terminal flow");

    if config.expect_auth_failure {
        assert!(
            auth_failure_feedback_seen(&output),
            "expected saved wrong password to produce authentication feedback, got: {output:?}",
        );
        assert!(
            !output.contains(COMMAND_MARKER) && !output.contains(UNICODE_COMMAND_MARKER),
            "wrong password smoke must not reach the authenticated shell: {output:?}",
        );
    } else {
        assert!(output.contains(COMMAND_MARKER));
        assert!(output.contains(UNICODE_COMMAND_MARKER));
    }
    assert!(
        !output.contains(&config.password),
        "terminal output must not echo saved password: {output:?}",
    );
}
