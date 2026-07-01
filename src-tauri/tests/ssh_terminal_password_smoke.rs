//! 真实 OpenSSH password 交互终端 smoke 测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::SshTerminalCreateRequest, paths::KerminalPaths, state::AppState,
};
use std::sync::{atomic::Ordering, mpsc};
use tempfile::tempdir;

mod support;

use support::ssh_terminal_smoke::*;

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
        .expect("create local loopback SSH wrong-password terminal session");

    let result = run_expected_auth_failure_flow(state.terminals(), &summary.id, &receiver, &config);
    let _ = state.terminals().close(&summary.id);
    let output = result.expect("run local loopback SSH wrong-password terminal flow");

    assert!(
        auth_failure_feedback_seen(&output),
        "expected saved wrong password to produce authentication feedback, got: {output:?}",
    );
    assert!(
        !output.contains(COMMAND_MARKER) && !output.contains(UNICODE_COMMAND_MARKER),
        "wrong password smoke must not reach the authenticated shell: {output:?}",
    );
    assert!(
        !output.contains(&config.password),
        "terminal output must not echo saved password: {output:?}",
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
