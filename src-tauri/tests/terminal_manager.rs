//! 本地终端会话管理器集成测试。
//!
//! @author kongweiguang

mod support;

use kerminal_lib::{
    models::terminal::{TerminalCreateRequest, TerminalResizeRequest},
    services::terminal_manager::TerminalManager,
};
use std::{
    fs,
    sync::{mpsc, Arc, Barrier},
    thread,
    time::{Duration, Instant},
};
use support::terminal_manager::{interactive_shell_request, short_lived_echo_request};
use tempfile::tempdir;

#[test]
fn create_session_rejects_zero_sized_terminal() {
    let manager = TerminalManager::new();
    let request = TerminalCreateRequest {
        rows: 0,
        cols: 80,
        ..TerminalCreateRequest::default()
    };

    let result = manager.create_session(request, |_| true);

    assert!(result.is_err());
    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn missing_session_operations_return_errors() {
    let manager = TerminalManager::new();

    assert!(manager.write("missing", "echo test\r").is_err());
    assert!(manager
        .resize("missing", TerminalResizeRequest { rows: 24, cols: 80 })
        .is_err());
    assert!(manager.session_summary("missing").is_err());
    assert!(manager.output_snapshot("missing", 4096).is_err());
    assert!(manager.pty_output_pump_stats("missing").is_err());
    assert!(manager.close("missing").is_err());
    assert!(manager
        .start_log("missing", tempdir().unwrap().path())
        .is_err());
    assert!(manager.stop_log("missing").is_err());
    assert!(manager.log_state("missing").is_err());
}

#[test]
fn create_session_registers_and_close_removes_session() {
    let manager = TerminalManager::new();
    let (sender, _receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_echo_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, summary.id);
    assert_eq!(sessions[0].cols, 80);
    assert_eq!(sessions[0].rows, 24);

    manager.close(&summary.id).unwrap();

    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn close_interactive_session_returns_quickly_and_removes_session() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();

    let started_at = Instant::now();
    manager.close(&summary.id).unwrap();
    let elapsed = started_at.elapsed();

    assert!(
        elapsed < Duration::from_secs(1),
        "interactive PTY close should not synchronously wait on child teardown: {elapsed:?}",
    );
    assert!(manager.session_summary(&summary.id).is_err());
}

#[test]
fn concurrent_write_resize_list_snapshot_and_close_do_not_deadlock() {
    let manager = Arc::new(TerminalManager::new());
    let summary = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();
    let session_id = summary.id.clone();
    let barrier = Arc::new(Barrier::new(5));
    let (done_sender, done_receiver) = mpsc::channel();

    for worker_index in 0..4 {
        let manager = Arc::clone(&manager);
        let session_id = session_id.clone();
        let barrier = Arc::clone(&barrier);
        let done_sender = done_sender.clone();
        thread::spawn(move || {
            barrier.wait();
            for iteration in 0_u16..24 {
                match worker_index {
                    0 => {
                        let _ = manager.write(&session_id, "\r");
                    }
                    1 => {
                        let _ = manager.resize(
                            &session_id,
                            TerminalResizeRequest {
                                rows: 24 + iteration % 3,
                                cols: 80 + iteration % 5,
                            },
                        );
                    }
                    2 => {
                        let _ = manager.list_sessions();
                    }
                    _ => {
                        let _ = manager.output_snapshot(&session_id, 4096);
                    }
                }
            }
            let _ = done_sender.send(worker_index);
        });
    }
    drop(done_sender);

    barrier.wait();
    thread::sleep(Duration::from_millis(10));
    let _ = manager.close(&session_id);

    let deadline = Duration::from_secs(5);
    for _ in 0..4 {
        done_receiver
            .recv_timeout(deadline)
            .expect("concurrent terminal operations should not deadlock");
    }
    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn reap_orphan_sessions_removes_all_local_sessions_and_returns_diagnostics() {
    let manager = TerminalManager::new();
    let first = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();
    let second = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();

    let diagnostics = manager.reap_orphan_sessions().unwrap();

    assert_eq!(diagnostics.reaped_count, 2);
    assert_eq!(diagnostics.session_ids.len(), 2);
    assert!(diagnostics.session_ids.contains(&first.id));
    assert!(diagnostics.session_ids.contains(&second.id));
    assert!(manager.list_sessions().unwrap().is_empty());
    assert!(manager.session_summary(&first.id).is_err());
    assert!(manager.session_summary(&second.id).is_err());
}

#[test]
fn reap_orphan_sessions_on_empty_manager_is_noop() {
    let manager = TerminalManager::new();

    let diagnostics = manager.reap_orphan_sessions().unwrap();

    assert_eq!(diagnostics.reaped_count, 0);
    assert!(diagnostics.session_ids.is_empty());
    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn target_ref_token_is_preserved_and_verifiable() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(short_lived_echo_request(), |_| true)
        .unwrap();

    let updated = manager.set_target_ref(&summary.id, "ssh:host-a").unwrap();
    let target_token = updated.target_token.clone().expect("target token");
    assert_eq!(target_token.split('.').count(), 5);
    let sessions = manager.list_sessions().unwrap();
    let (snapshot_summary, _snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();

    manager.close(&summary.id).unwrap();

    assert_eq!(updated.target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(sessions[0].target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(
        sessions[0].target_token.as_deref(),
        Some(target_token.as_str())
    );
    assert_eq!(
        snapshot_summary.target_token.as_deref(),
        Some(target_token.as_str())
    );
    assert!(manager
        .verify_target_token(&summary.id, &target_token)
        .expect_err("closed session cannot verify token")
        .to_string()
        .contains("终端会话不存在"));
}

#[test]
fn target_token_rejects_forged_value() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(short_lived_echo_request(), |_| true)
        .unwrap();

    let updated = manager.set_target_ref(&summary.id, "ssh:host-a").unwrap();
    let target_token = updated.target_token.expect("target token");

    assert!(manager
        .verify_target_token(&summary.id, &target_token)
        .expect("verify valid token")
        .is_some());
    assert!(manager
        .verify_target_token(&summary.id, "v1.forged.token")
        .expect("verify forged token")
        .is_none());

    manager.close(&summary.id).unwrap();
}

#[test]
fn close_removes_session_cleanup_paths() {
    let manager = TerminalManager::new();
    let temp = tempdir().unwrap();
    let cleanup_path = temp.path().join("identity.key");
    fs::write(&cleanup_path, "temporary private key").unwrap();
    let mut request = short_lived_echo_request();
    request.cleanup_paths = vec![cleanup_path.clone()];

    let summary = manager.create_session(request, |_| true).unwrap();
    manager.close(&summary.id).unwrap();

    assert!(!cleanup_path.exists());
}
