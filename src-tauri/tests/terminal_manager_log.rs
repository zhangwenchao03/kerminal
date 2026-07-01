//! TerminalManager session log integration tests.

mod support;

use kerminal_lib::services::terminal_manager::TerminalManager;
use std::{fs, sync::mpsc};
use support::terminal_manager::{
    interactive_shell_request, log_secret_command, log_smoke_command, wait_for_output,
};
use tempfile::tempdir;

#[test]
fn session_log_writes_new_output_until_stopped() {
    let manager = TerminalManager::new();
    let logs_root = tempdir().unwrap();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(interactive_shell_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let started = manager.start_log(&summary.id, logs_root.path()).unwrap();
    assert!(started.active);
    assert!(started
        .path
        .as_deref()
        .is_some_and(|path| path.contains("session-")));

    manager.write(&summary.id, log_smoke_command()).unwrap();
    wait_for_output(&manager, &summary.id, &receiver, "kerminal-log-smoke");

    let stopped = manager.stop_log(&summary.id).unwrap();
    manager.close(&summary.id).unwrap();

    assert!(!stopped.active);
    assert!(stopped.bytes_written >= started.bytes_written);
    let log_path = stopped.path.expect("stopped log path");
    let log = fs::read_to_string(log_path).unwrap();
    assert!(log.contains("Kerminal session log"));
    assert!(log.contains("kerminal-log-smoke"));
}

#[test]
fn session_log_redacts_common_secret_shapes() {
    let manager = TerminalManager::new();
    let logs_root = tempdir().unwrap();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(interactive_shell_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    manager.start_log(&summary.id, logs_root.path()).unwrap();
    manager.write(&summary.id, log_secret_command()).unwrap();
    wait_for_output(
        &manager,
        &summary.id,
        &receiver,
        "kerminal-secret-log-smoke",
    );

    let stopped = manager.stop_log(&summary.id).unwrap();
    manager.close(&summary.id).unwrap();

    let log_path = stopped.path.expect("stopped log path");
    let log = fs::read_to_string(log_path).unwrap();
    assert!(log.contains("kerminal-secret-log-smoke"));
    assert!(log.contains("TOKEN=[已脱敏]"));
    assert!(log.contains("Bearer [已脱敏]"));
    assert!(!log.contains("super-secret-token-12345"));
    assert!(!log.contains("abcdefghijklmnopqrstuvwxyz"));
    assert!(!log.contains("sk-terminal-secret-12345"));
}
