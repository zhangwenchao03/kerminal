//! 本地终端会话管理器集成测试。
//!
//! @author kongweiguang

mod support;

use async_trait::async_trait;
use kerminal_lib::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalCreateRequest, TerminalOutputKind, TerminalResizeRequest, TerminalSessionStatus,
    },
    services::{
        ssh_runtime::{
            ManagedSshSessionManager, SshAuthIdentity, SshChannelKind, SshRuntimeBackend,
            SshRuntimeConnectRequest, SshRuntimeConnection, SshRuntimeShellEvent,
            SshRuntimeShellRequest, SshRuntimeShellSession, SshSessionKey, SshSessionPeer,
        },
        terminal_manager::{
            TerminalManagedShellCreateRequest, TerminalManagedShellRuntime, TerminalManager,
        },
    },
};
use std::{
    collections::VecDeque,
    fs,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Barrier, Mutex,
    },
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
fn managed_shell_session_uses_existing_output_pump_and_transport_controls() {
    let backend = Arc::new(FakeShellBackend::default());
    backend.push_event(SshRuntimeShellEvent::Data(b"managed-shell-ready".to_vec()));
    let runtime_manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = runtime_manager
        .acquire_session(fake_session_key())
        .expect("managed session");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let shell = runtime
        .block_on(session.open_shell(SshRuntimeShellRequest::new("xterm-256color", 80, 24)))
        .expect("managed shell");
    let terminal_manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = terminal_manager
        .create_managed_shell_session(
            TerminalManagedShellCreateRequest {
                shell: "ssh:managed-host".to_owned(),
                cwd: Some("/home/deploy".to_owned()),
                startup_input: None,
                cols: 80,
                rows: 24,
                target_ref: Some("ssh:managed-host".to_owned()),
            },
            TerminalManagedShellRuntime { shell, runtime },
            move |event| sender.send(event).is_ok(),
        )
        .expect("terminal managed shell session");

    assert_eq!(summary.pid, None);
    assert_eq!(summary.cwd.as_deref(), Some("/home/deploy"));
    assert_eq!(summary.target_ref.as_deref(), Some("ssh:managed-host"));
    assert!(summary.target_token.is_some());

    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed shell output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("managed-shell-ready"));

    terminal_manager
        .write(&summary.id, "printf managed-input\\r")
        .expect("write managed shell input");
    wait_until(Duration::from_secs(2), || backend.write_count() == 1);

    terminal_manager
        .resize(
            &summary.id,
            TerminalResizeRequest {
                rows: 32,
                cols: 120,
            },
        )
        .expect("resize managed shell");
    wait_until(Duration::from_secs(2), || backend.resize_count() == 1);
    let resized = terminal_manager
        .session_summary(&summary.id)
        .expect("resized summary");
    assert_eq!(resized.rows, 32);
    assert_eq!(resized.cols, 120);

    terminal_manager
        .close(&summary.id)
        .expect("close managed shell");
    wait_until(Duration::from_secs(2), || backend.close_count() == 1);
    assert!(terminal_manager.session_summary(&summary.id).is_err());
}

#[test]
fn managed_shell_session_reports_nonzero_exit_status_and_marks_session_exited() {
    let backend = Arc::new(FakeShellBackend::default());
    backend.push_event(SshRuntimeShellEvent::Data(
        b"remote command output".to_vec(),
    ));
    backend.push_event(SshRuntimeShellEvent::ExitStatus(42));
    let runtime_manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = runtime_manager
        .acquire_session(fake_session_key())
        .expect("managed session");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let shell = runtime
        .block_on(session.open_shell(SshRuntimeShellRequest::new("xterm-256color", 80, 24)))
        .expect("managed shell");
    let terminal_manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = terminal_manager
        .create_managed_shell_session(
            TerminalManagedShellCreateRequest {
                shell: "ssh:managed-host".to_owned(),
                cwd: None,
                startup_input: Some("exec false\r".to_owned()),
                cols: 80,
                rows: 24,
                target_ref: Some("ssh:managed-host".to_owned()),
            },
            TerminalManagedShellRuntime { shell, runtime },
            move |event| sender.send(event).is_ok(),
        )
        .expect("terminal managed shell session");

    wait_until(Duration::from_secs(2), || backend.write_count() == 1);
    let output = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed shell command output");
    assert_eq!(output.kind, TerminalOutputKind::Data);
    assert!(output.data.contains("remote command output"));

    let error = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("managed shell exit status error");
    assert_eq!(error.kind, TerminalOutputKind::Error);
    assert!(error.data.contains("SSH shell exited with status 42"));
    wait_until(Duration::from_secs(2), || {
        terminal_manager
            .session_summary(&summary.id)
            .expect("managed shell summary")
            .status
            == TerminalSessionStatus::Exited
    });

    terminal_manager
        .close(&summary.id)
        .expect("remove exited managed shell session");
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

fn fake_session_key() -> SshSessionKey {
    SshSessionKey::new(SshSessionPeer::target(
        "managed-host",
        "127.0.0.1",
        22,
        "deploy",
        SshAuthIdentity::SessionOnly {
            prompt_id: "managed-shell-prompt".to_owned(),
        },
    ))
}

#[derive(Default)]
struct FakeShellBackend {
    state: Arc<FakeShellState>,
}

#[derive(Default)]
struct FakeShellState {
    closes: AtomicUsize,
    events: Mutex<VecDeque<SshRuntimeShellEvent>>,
    opens: AtomicUsize,
    resizes: AtomicUsize,
    writes: Mutex<Vec<Vec<u8>>>,
}

impl FakeShellBackend {
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

    fn resize_count(&self) -> usize {
        self.state.resizes.load(Ordering::SeqCst)
    }

    fn write_count(&self) -> usize {
        self.state.writes.lock().expect("writes lock").len()
    }
}

impl SshRuntimeBackend for FakeShellBackend {
    fn connect(
        &self,
        _request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        Ok(Arc::new(FakeShellConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeShellConnection {
    state: Arc<FakeShellState>,
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
    state: Arc<FakeShellState>,
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
        if data.is_empty() {
            return Err(AppError::InvalidInput("empty shell input".to_owned()));
        }
        self.state.writes.lock().expect("writes lock").push(data);
        Ok(())
    }

    async fn resize(&self, _cols: u16, _rows: u16) -> AppResult<()> {
        self.state.resizes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn close(&self) -> AppResult<()> {
        self.state.closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
