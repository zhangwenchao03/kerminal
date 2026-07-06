//! Managed SSH runtime tests.
//!
//! @author kongweiguang

use std::{
    collections::VecDeque,
    fs,
    io::{Cursor, Read, Write},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use async_trait::async_trait;
use kerminal_lib::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHost, RemoteHostAuthType},
    paths::KerminalPaths,
    services::ssh_runtime::{
        error_classification::{
            classify_ssh_runtime_app_error, classify_ssh_runtime_failure, SshRuntimeFailureClass,
        },
        native_backend::{
            should_clear_native_connection_after_channel_error, NativeSshRuntimeBackend,
        },
        ManagedSshSessionManager, ManagedSshShellSession, SshAuthIdentity, SshAuthSecretKind,
        SshChannelKind, SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
        SshRuntimeExecRawOutput, SshRuntimeExecRequest, SshRuntimeSftpStream, SshRuntimeShellEvent,
        SshRuntimeShellRequest, SshRuntimeShellSession, SshRuntimeStreamingExecExit,
        SshRuntimeStreamingExecReader, SshRuntimeStreamingExecRequest,
        SshRuntimeStreamingExecSession, SshRuntimeStreamingExecWriter, SshSessionKey,
        SshSessionPeer, MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG,
        MANAGED_SSH_CAPABILITY_RUNTIME_FLAG,
    },
};
use tempfile::tempdir;
use tokio::{sync::Notify, time::Duration};
use tokio_util::sync::CancellationToken;

mod support;

use support::ssh_terminal_smoke::{
    trust_loopback_host_key, LoopbackTerminalServer, COMMAND_MARKER, LOOPBACK_PASSWORD,
    LOOPBACK_READY_MARKER, LOOPBACK_USER,
};

#[test]
fn session_key_summary_does_not_include_secret_material() {
    let key = sample_key()
        .with_jump(SshSessionPeer::jump(
            "jump.internal",
            2222,
            "bastion",
            SshAuthIdentity::SessionOnly {
                prompt_id: "jump-password-prompt".to_owned(),
            },
        ))
        .with_runtime_flag("native-shell")
        .with_runtime_flag("native-shell");

    let debug = format!("{key:?}");
    assert!(!debug.contains("super-secret-password"));
    assert!(!debug.contains("PRIVATE KEY"));
    assert_eq!(key.runtime_flags, vec!["native-shell"]);

    let summary = key.summary();
    assert_eq!(summary.target, "deploy@example.com:22");
    assert_eq!(summary.jumps, vec!["bastion@jump.internal:2222"]);
}

#[test]
fn connect_request_debug_redacts_runtime_host_material() {
    let request = SshRuntimeConnectRequest::native(
        sample_key(),
        sample_runtime_host(),
        "C:/Users/example/.kerminal/known_hosts".into(),
        30,
    )
    .with_keepalive_seconds(20);

    let debug = format!("{request:?}");

    assert!(debug.contains("example.com"));
    assert_eq!(request.native_keepalive_seconds(), Some(20));
    assert!(!debug.contains("super-secret-password"));
    assert!(!debug.contains("C:/Users/example"));
    assert!(!debug.contains(".kerminal"));
}

#[test]
fn native_channel_error_classification_preserves_shared_shell_for_channel_scoped_failures() {
    for message in [
        "无法打开 direct-tcpip 到 127.0.0.1:80: connection refused by remote host",
        "direct-tcpip 数据转发失败 127.0.0.1:80: early eof",
        "managed SSH SFTP channel failed: channel closed",
        "远端拒绝执行非交互命令请求",
    ] {
        let error = AppError::SshCommand(message.to_owned());

        assert!(
            !should_clear_native_connection_after_channel_error(&error),
            "{message}"
        );
    }
}

#[test]
fn native_channel_error_classification_clears_on_transport_breakage() {
    for message in [
        "write failed: broken pipe",
        "connection reset by peer",
        "connection lost while opening channel",
        "connection aborted by local socket",
    ] {
        let error = AppError::SshCommand(message.to_owned());

        assert!(
            should_clear_native_connection_after_channel_error(&error),
            "{message}"
        );
    }
}

#[test]
fn runtime_failure_classification_covers_user_actionable_classes() {
    for (message, expected_class) in [
        (
            "user canceled authentication prompt",
            SshRuntimeFailureClass::AuthCanceled,
        ),
        (
            "Permission denied (publickey,password).",
            SshRuntimeFailureClass::BadCredential,
        ),
        (
            "encrypted private key requires passphrase",
            SshRuntimeFailureClass::KeyPassphraseMissing,
        ),
        ("Unknown server key", SshRuntimeFailureClass::UnknownHostKey),
        (
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
            SshRuntimeFailureClass::HostKeyChanged,
        ),
        (
            "stdio forwarding failed through jump host",
            SshRuntimeFailureClass::JumpFailed,
        ),
        ("connection timed out", SshRuntimeFailureClass::Timeout),
        (
            "managed SSH runtime backend does not support SFTP channels yet",
            SshRuntimeFailureClass::ChannelUnsupported,
        ),
        (
            "load key /tmp/id_rsa: Permission denied",
            SshRuntimeFailureClass::PermissionDenied,
        ),
        (
            "remote command exit code 127",
            SshRuntimeFailureClass::RemoteExit,
        ),
        ("remote command cancelled", SshRuntimeFailureClass::Canceled),
        (
            "cleanup failed while closing SSH",
            SshRuntimeFailureClass::CleanupFailed,
        ),
    ] {
        let failure = classify_ssh_runtime_failure(message);

        assert_eq!(failure.class, expected_class, "{message}");
        assert!(
            !failure.user_message.contains("连接失败"),
            "{message}: {}",
            failure.user_message
        );
        assert!(
            !failure.next_action.trim().is_empty(),
            "{message}: {:?}",
            failure
        );
    }
}

#[test]
fn runtime_failure_classification_redacts_session_only_secret_refs() {
    let failure = classify_ssh_runtime_app_error(&AppError::SshCommand(
        "Permission denied (publickey,password) external-secret:launch-secret-123 password=hunter2"
            .to_owned(),
    ));

    assert_eq!(failure.class, SshRuntimeFailureClass::BadCredential);
    assert!(!failure.sanitized_detail.contains("launch-secret-123"));
    assert!(!failure.sanitized_detail.contains("hunter2"));
    assert!(failure
        .sanitized_detail
        .contains("external-secret:<redacted>"));
    assert!(failure.sanitized_detail.contains("password=<redacted>"));
}

#[test]
fn manager_reuses_session_for_same_key_tracks_ref_counts_and_keeps_idle() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let first = manager.acquire_session(key.clone()).expect("first session");
    let first_id = first.session_id().to_owned();
    let second = manager.acquire_session(key).expect("second session");

    assert_eq!(first_id, second.session_id());
    assert_eq!(backend.connect_count(), 1);

    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].ref_count, 2);
    assert_eq!(snapshot.active_channels, 0);

    drop(first);
    let snapshot = manager.snapshot().expect("snapshot after first drop");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].ref_count, 1);

    drop(second);
    assert_eq!(manager.active_session_count().expect("count"), 1);
    assert_eq!(backend.disconnect_count(), 0);

    let third = manager
        .acquire_session(sample_key())
        .expect("third session");
    assert_eq!(first_id, third.session_id());
    assert_eq!(backend.connect_count(), 1);
    drop(third);

    assert_eq!(manager.close_idle_sessions().expect("closed idle"), 1);
    assert_eq!(manager.active_session_count().expect("count"), 0);
    assert_eq!(backend.disconnect_count(), 1);
}

#[test]
fn legacy_fallback_diagnostics_are_counted_and_capped() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));

    for index in 0..25 {
        manager.record_legacy_fallback("sftp", format!("unsupported-{index}"), None);
    }
    manager.record_legacy_fallback(
        "exec",
        "managed-exec-unsupported",
        Some("deploy@example.com:22".to_owned()),
    );
    manager.record_legacy_fallback(
        "exec",
        "managed-exec-unsupported",
        Some("deploy@example.com:22".to_owned()),
    );

    let snapshot = manager.snapshot().expect("snapshot");

    assert_eq!(snapshot.recent_legacy_fallbacks.len(), 20);
    assert!(!snapshot
        .recent_legacy_fallbacks
        .iter()
        .any(|event| event.reason == "unsupported-0"));
    let counted = snapshot
        .recent_legacy_fallbacks
        .iter()
        .find(|event| event.capability == "exec")
        .expect("exec fallback");
    assert_eq!(counted.count, 2);
    assert_eq!(counted.reason, "managed-exec-unsupported");
    assert_eq!(counted.target.as_deref(), Some("deploy@example.com:22"));
}

#[test]
fn channel_factory_counts_and_releases_channels() {
    let backend = Arc::new(FakeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let sftp = session.open_channel(SshChannelKind::Sftp).expect("sftp");
    let exec = session.open_channel(SshChannelKind::Exec).expect("exec");

    assert!(sftp.channel_id().starts_with("fake-channel-"));
    assert_eq!(exec.kind(), SshChannelKind::Exec);

    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_channels, 2);
    assert_eq!(snapshot.sessions[0].active_channels, 2);
    assert_eq!(snapshot.sessions[0].opened_channels, 2);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        Some(&1)
    );
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&1)
    );

    drop(sftp);
    let snapshot = manager.snapshot().expect("snapshot after sftp drop");
    assert_eq!(snapshot.active_channels, 1);

    drop(exec);
    drop(session);
    assert_eq!(manager.active_session_count().expect("count"), 1);
    assert_eq!(manager.close_idle_sessions().expect("closed idle"), 1);
    assert_eq!(manager.active_session_count().expect("count"), 0);
    assert_eq!(backend.disconnect_count(), 1);
}

#[tokio::test]
async fn sftp_channel_opens_and_releases_diagnostics() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let channel = session.open_sftp().await.expect("open sftp");

    assert_eq!(backend.sftp_open_count(), 1);
    let snapshot = manager.snapshot().expect("snapshot with sftp");
    assert_eq!(snapshot.active_channels, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        Some(&1)
    );

    drop(channel);
    let snapshot = manager.snapshot().expect("snapshot after sftp drop");
    assert_eq!(snapshot.active_channels, 0);
}

#[test]
fn backend_failure_is_not_cached_as_session() {
    let backend = Arc::new(FakeBackend::default());
    backend.fail_connect("network unavailable");
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));

    let error = manager.acquire_session(sample_key()).expect_err("failure");

    assert!(error.to_string().contains("network unavailable"));
    assert_eq!(manager.active_session_count().expect("count"), 0);
    assert_eq!(backend.connect_count(), 1);
}

#[test]
fn channel_failure_marks_session_failed_but_releases_active_count() {
    let backend = Arc::new(FakeBackend::default());
    backend.fail_channel("sftp subsystem rejected");
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let error = session
        .open_channel(SshChannelKind::Sftp)
        .expect_err("channel failure");

    assert!(error.to_string().contains("sftp subsystem rejected"));
    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.sessions[0].active_channels, 0);
    assert_eq!(snapshot.sessions[0].opened_channels, 1);
    assert_eq!(
        snapshot.sessions[0].last_error.as_deref(),
        Some("SSH 远程命令执行失败: sftp subsystem rejected")
    );
}

#[tokio::test]
async fn exec_queue_limits_concurrency_and_reports_pending_depth() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let first = manager
        .acquire_session(sample_key())
        .expect("first session");
    let second = manager
        .acquire_session(sample_key())
        .expect("second session");

    let first_task = tokio::spawn(async move {
        first
            .execute_exec(SshRuntimeExecRequest::new("echo one\n".to_owned(), 5, 1024))
            .await
    });
    backend.wait_for_exec_start().await;

    let second_task = tokio::spawn(async move {
        second
            .execute_exec(SshRuntimeExecRequest::new("echo two\n".to_owned(), 5, 1024))
            .await
    });
    wait_for_pending_exec_requests(&manager, 1).await;
    let snapshot = manager.snapshot().expect("snapshot with queued exec");
    assert_eq!(snapshot.sessions[0].active_channels, 1);
    assert_eq!(snapshot.sessions[0].pending_exec_requests, 1);
    assert_eq!(snapshot.sessions[0].max_concurrent_exec_channels, 1);

    backend.release_one_exec();
    let first_output = first_task.await.expect("first task").expect("first output");
    assert_eq!(first_output.stdout, "echo one\n");
    backend.wait_for_exec_start().await;
    backend.release_one_exec();
    let second_output = second_task
        .await
        .expect("second task")
        .expect("second output");
    assert_eq!(second_output.stdout, "echo two\n");
    assert_eq!(backend.max_active_exec(), 1);
}

#[tokio::test]
async fn exec_cancel_while_queued_releases_pending_depth() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let first = manager
        .acquire_session(sample_key())
        .expect("first session");
    let second = manager
        .acquire_session(sample_key())
        .expect("second session");
    let cancel_token = CancellationToken::new();

    let first_task = tokio::spawn(async move {
        first
            .execute_exec(SshRuntimeExecRequest::new("sleep\n".to_owned(), 5, 1024))
            .await
    });
    backend.wait_for_exec_start().await;

    let queued_request = SshRuntimeExecRequest::new("queued\n".to_owned(), 5, 1024)
        .with_cancel_token(cancel_token.clone());
    let queued_task = tokio::spawn(async move { second.execute_exec(queued_request).await });
    wait_for_pending_exec_requests(&manager, 1).await;

    cancel_token.cancel();
    let queued_error = queued_task
        .await
        .expect("queued task")
        .expect_err("queued command canceled");
    assert!(queued_error.to_string().contains("远程命令已取消"));
    wait_for_pending_exec_requests(&manager, 0).await;

    backend.release_one_exec();
    first_task.await.expect("first task").expect("first output");
}

#[tokio::test]
async fn streaming_exec_uses_exec_queue_and_releases_channel() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_streaming_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let session = manager.acquire_session(sample_key()).expect("session");
    let queued_session = manager
        .acquire_session(sample_key())
        .expect("queued session");

    let mut streaming = session
        .open_streaming_exec(SshRuntimeStreamingExecRequest::new("cat".to_owned(), 5))
        .await
        .expect("open streaming exec");
    let queued_task = tokio::spawn(async move {
        queued_session
            .open_streaming_exec(SshRuntimeStreamingExecRequest::new(
                "cat queued".to_owned(),
                5,
            ))
            .await
    });
    wait_for_pending_exec_requests(&manager, 1).await;

    {
        let mut stdin = streaming.take_stdin().expect("stdin");
        stdin.write_all(b"hello").expect("write stdin");
    }
    let mut stdout = String::new();
    streaming
        .take_stdout()
        .expect("stdout")
        .read_to_string(&mut stdout)
        .expect("read stdout");
    assert_eq!(stdout, "streaming-output");
    assert_eq!(streaming.wait().expect("wait").exit_code, Some(0));

    let mut queued = queued_task
        .await
        .expect("queued task")
        .expect("queued streaming exec");
    assert_eq!(queued.wait().expect("queued wait").exit_code, Some(0));

    let snapshot = manager.snapshot().expect("snapshot");
    assert_eq!(snapshot.sessions[0].active_channels, 0);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&2)
    );
    assert_eq!(backend.streaming_exec_count(), 2);
    assert_eq!(backend.streaming_stdin(), b"hello");
}

#[tokio::test]
async fn concurrent_capability_channels_share_one_managed_session() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_sftp();
    backend.enable_exec();
    backend.enable_streaming_exec();
    let manager = ManagedSshSessionManager::with_backend_and_limits(Arc::clone(&backend), 1);
    let key = sample_key();
    let shell_session = manager.acquire_session(key.clone()).expect("shell session");
    let sftp_session = manager.acquire_session(key.clone()).expect("sftp session");
    let exec_session = manager.acquire_session(key.clone()).expect("exec session");
    let streaming_session = manager.acquire_session(key).expect("streaming session");

    let mut shell = shell_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open shell");
    let sftp = sftp_session.open_sftp().await.expect("open sftp");
    let exec_task = tokio::spawn(async move {
        exec_session
            .execute_exec(SshRuntimeExecRequest::new(
                "printf managed-exec\n".to_owned(),
                5,
                1024,
            ))
            .await
    });
    backend.wait_for_exec_start().await;
    let streaming_task = tokio::spawn(async move {
        streaming_session
            .open_streaming_exec(SshRuntimeStreamingExecRequest::new(
                "cat managed-stream".to_owned(),
                5,
            ))
            .await
    });
    wait_for_pending_exec_requests(&manager, 1).await;

    let snapshot = manager
        .snapshot()
        .expect("snapshot while mixed capabilities run");
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].ref_count, 4);
    assert_eq!(snapshot.sessions[0].active_channels, 3);
    assert_eq!(snapshot.sessions[0].pending_exec_requests, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        Some(&1)
    );
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&1)
    );

    backend.release_one_exec();
    let exec_output = exec_task.await.expect("exec task").expect("exec output");
    assert_eq!(exec_output.stdout, "printf managed-exec\n");
    let mut streaming = streaming_task
        .await
        .expect("streaming task")
        .expect("streaming exec");
    {
        let mut stdin = streaming.take_stdin().expect("streaming stdin");
        stdin
            .write_all(b"streaming-input")
            .expect("write streaming stdin");
    }
    assert_eq!(streaming.wait().expect("streaming wait").exit_code, Some(0));
    shell.close().await.expect("close shell");
    drop(sftp);

    let snapshot = manager
        .snapshot()
        .expect("snapshot after mixed capabilities settle");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.sessions[0].active_channels, 0);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&2)
    );
    assert_eq!(backend.shell_open_count(), 1);
    assert_eq!(backend.sftp_open_count(), 1);
    assert_eq!(backend.streaming_exec_count(), 1);
    assert_eq!(backend.streaming_stdin(), b"streaming-input");
}

#[tokio::test]
async fn bulk_transfer_lane_uses_separate_session_without_reprompt_contract() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let interactive_session = manager
        .acquire_session(key.clone())
        .expect("interactive session");
    let bulk_session = manager
        .acquire_bulk_transfer_session(key)
        .expect("bulk transfer session");

    assert_ne!(interactive_session.session_id(), bulk_session.session_id());
    assert_eq!(backend.connect_count(), 2);

    let mut shell = interactive_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open interactive shell");
    let sftp = bulk_session.open_sftp().await.expect("open bulk sftp");

    let snapshot = manager.snapshot().expect("snapshot with isolated lanes");
    assert_eq!(snapshot.active_sessions, 2);
    assert_eq!(snapshot.active_channels, 2);

    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive runtime lane");
    let bulk = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG)
        })
        .expect("bulk transfer runtime lane");
    assert_eq!(interactive.key.target, bulk.key.target);
    assert_eq!(
        interactive.key.known_hosts_profile,
        bulk.key.known_hosts_profile
    );
    assert_eq!(interactive.key.jumps, bulk.key.jumps);
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(bulk.channel_counts.get(&SshChannelKind::Sftp), Some(&1));

    shell.close().await.expect("close shell");
    drop(sftp);
    let snapshot = manager.snapshot().expect("snapshot after drops");
    assert_eq!(snapshot.active_sessions, 2);
    assert_eq!(snapshot.active_channels, 0);
}

#[tokio::test]
async fn capability_lane_uses_separate_session_from_interactive_shell_contract() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let interactive_session = manager
        .acquire_session(key.clone())
        .expect("interactive session");
    let capability_session = manager
        .acquire_capability_session_with_request(SshRuntimeConnectRequest::key_only(key))
        .expect("capability session");

    assert_ne!(
        interactive_session.session_id(),
        capability_session.session_id()
    );
    assert_eq!(backend.connect_count(), 2);

    let mut shell = interactive_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open interactive shell");
    let exec = capability_session
        .open_channel(SshChannelKind::Exec)
        .expect("capability exec channel");

    let snapshot = manager
        .snapshot()
        .expect("snapshot with isolated capability lane");
    assert_eq!(snapshot.active_sessions, 2);
    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive runtime lane");
    let capability = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("capability runtime lane");
    assert_eq!(interactive.key.target, capability.key.target);
    assert_eq!(
        interactive.key.known_hosts_profile,
        capability.key.known_hosts_profile
    );
    assert_eq!(interactive.key.jumps, capability.key.jumps);
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(
        capability.channel_counts.get(&SshChannelKind::Exec),
        Some(&1)
    );

    shell.close().await.expect("close shell");
    drop(exec);
}

#[tokio::test]
async fn bulk_transfer_lane_does_not_block_interactive_shell_input_contract() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    backend.enable_sftp();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let key = sample_key();

    let interactive_session = manager
        .acquire_session(key.clone())
        .expect("interactive session");
    let bulk_session = manager
        .acquire_bulk_transfer_session(key)
        .expect("bulk transfer session");
    let mut shell = interactive_session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 100, 30))
        .await
        .expect("open interactive shell");
    let sftp = bulk_session.open_sftp().await.expect("open bulk sftp");

    tokio::time::timeout(
        Duration::from_millis(200),
        shell.write(b"echo still-interactive\r".to_vec()),
    )
    .await
    .expect("interactive shell write should not wait for the bulk SFTP lane")
    .expect("write interactive shell while bulk SFTP is active");
    assert_eq!(
        backend.shell_write_count(),
        1,
        "bulk SFTP transfer lane must not block interactive shell input"
    );

    let snapshot = manager
        .snapshot()
        .expect("snapshot while shell and bulk SFTP are active");
    assert_eq!(snapshot.active_sessions, 2);
    assert_eq!(snapshot.active_channels, 2);
    assert_eq!(backend.connect_count(), 2);

    shell.close().await.expect("close shell");
    drop(sftp);
}

#[tokio::test]
async fn shell_channel_opens_and_releases_diagnostics() {
    let backend = Arc::new(FakeBackend::default());
    backend.enable_shell();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let session = manager.acquire_session(sample_key()).expect("session");

    let mut shell = session
        .open_shell(SshRuntimeShellRequest::new("xterm-256color", 80, 24))
        .await
        .expect("open shell");
    shell
        .write(b"echo managed-shell\r".to_vec())
        .await
        .expect("write shell");
    shell.resize(100, 40).await.expect("resize shell");
    let event = shell.read_event().await.expect("read shell event");

    assert_eq!(
        event,
        SshRuntimeShellEvent::Data(b"fake-shell-ready".to_vec())
    );
    assert_eq!(backend.shell_open_count(), 1);
    assert_eq!(backend.shell_write_count(), 1);
    assert_eq!(backend.shell_resize_count(), 1);
    assert_eq!(
        backend
            .shell_last_request()
            .as_ref()
            .map(|request| request.term.as_str()),
        Some("xterm-256color")
    );

    let snapshot = manager.snapshot().expect("snapshot with shell");
    assert_eq!(snapshot.active_channels, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Shell),
        Some(&1)
    );

    shell.close().await.expect("close shell");
    let snapshot = manager.snapshot().expect("snapshot after shell close");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(backend.shell_close_count(), 1);
}

#[test]
fn native_shell_channel_reads_writes_resizes_and_closes_loopback_pty() {
    let server = LoopbackTerminalServer::start();
    let home = tempdir().expect("create native shell temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    fs::create_dir_all(&paths.root).expect("create kerminal root");
    trust_loopback_host_key(&paths, "127.0.0.1", server.addr.port(), &server.host_key)
        .expect("trust loopback host key");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let request = SshRuntimeConnectRequest::native(
        loopback_session_key(server.addr.port()),
        loopback_runtime_host(server.addr.port()),
        paths.root.join("known_hosts"),
        5,
    );

    let runtime = tokio::runtime::Runtime::new().expect("create native shell test runtime");
    runtime.block_on(async {
        let session = manager
            .acquire_session_with_request(request)
            .expect("acquire native session");
        let mut shell = session
            .open_shell(SshRuntimeShellRequest::new("xterm-256color", 96, 28))
            .await
            .expect("open native shell");

        let ready = read_shell_until(&shell, LOOPBACK_READY_MARKER).await;
        assert!(ready.contains(LOOPBACK_READY_MARKER), "{ready:?}");

        shell.resize(120, 36).await.expect("resize native shell");
        shell
            .write(format!("echo {COMMAND_MARKER}\r").into_bytes())
            .await
            .expect("write native shell command");
        let output = read_shell_until(&shell, COMMAND_MARKER).await;
        assert!(output.contains(COMMAND_MARKER), "{output:?}");

        shell.close().await.expect("close native shell");
        let snapshot = manager.snapshot().expect("snapshot after native shell");
        assert_eq!(snapshot.active_channels, 0);
        assert_eq!(
            snapshot.sessions[0]
                .channel_counts
                .get(&SshChannelKind::Shell),
            Some(&1)
        );
    });
}

#[test]
fn native_shell_channel_write_is_not_blocked_by_pending_read() {
    let server = LoopbackTerminalServer::start();
    let home = tempdir().expect("create native shell concurrent temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    fs::create_dir_all(&paths.root).expect("create kerminal root");
    trust_loopback_host_key(&paths, "127.0.0.1", server.addr.port(), &server.host_key)
        .expect("trust loopback host key");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let request = SshRuntimeConnectRequest::native(
        loopback_session_key(server.addr.port()),
        loopback_runtime_host(server.addr.port()),
        paths.root.join("known_hosts"),
        5,
    );

    let runtime = tokio::runtime::Runtime::new().expect("create native shell concurrent runtime");
    runtime.block_on(async {
        let session = manager
            .acquire_session_with_request(request)
            .expect("acquire native session");
        let shell = Arc::new(
            session
                .open_shell(SshRuntimeShellRequest::new("xterm-256color", 96, 28))
                .await
                .expect("open native shell"),
        );

        let ready = read_shell_until(shell.as_ref(), LOOPBACK_READY_MARKER).await;
        assert!(ready.contains(LOOPBACK_READY_MARKER), "{ready:?}");

        let reader_shell = Arc::clone(&shell);
        let reader = tokio::spawn(async move {
            tokio::time::timeout(Duration::from_secs(3), reader_shell.read_event())
                .await
                .expect("pending read should complete after write")
                .expect("read shell event")
        });
        tokio::time::sleep(Duration::from_millis(100)).await;

        tokio::time::timeout(
            Duration::from_millis(500),
            shell.write(format!("echo {COMMAND_MARKER}\r").into_bytes()),
        )
        .await
        .expect("write should not wait for pending read lock")
        .expect("write native shell command");

        let event = reader.await.expect("reader task");
        match event {
            SshRuntimeShellEvent::Data(data) | SshRuntimeShellEvent::ExtendedData { data, .. } => {
                let output = String::from_utf8_lossy(&data);
                assert!(output.contains(COMMAND_MARKER), "{output:?}");
            }
            other => panic!("expected shell data after write, got {other:?}"),
        }

        drop(shell);
        let snapshot = manager
            .snapshot()
            .expect("snapshot after native shell drop");
        assert_eq!(snapshot.active_channels, 0);
    });
}

fn sample_key() -> SshSessionKey {
    SshSessionKey::new(SshSessionPeer::target(
        "host-1",
        "example.com",
        22,
        "deploy",
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ref_id: "credential:ssh-host:host-1:target:password".to_owned(),
        },
    ))
    .with_known_hosts_profile("workspace-known-hosts")
}

fn loopback_session_key(port: u16) -> SshSessionKey {
    SshSessionKey::new(SshSessionPeer::target(
        "loopback-shell",
        "127.0.0.1",
        port,
        LOOPBACK_USER,
        SshAuthIdentity::SessionOnly {
            prompt_id: "loopback-shell-password".to_owned(),
        },
    ))
    .with_known_hosts_profile("workspace-known-hosts")
}

fn sample_runtime_host() -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: None,
        name: "Example".to_owned(),
        host: "example.com".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some("super-secret-password".to_owned()),
        credential_status: Default::default(),
        tags: Vec::new(),
        production: false,
        ssh_options: Default::default(),
        sort_order: 0,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    }
}

fn loopback_runtime_host(port: u16) -> RemoteHost {
    RemoteHost {
        id: "loopback-shell".to_owned(),
        group_id: None,
        name: "Loopback Shell".to_owned(),
        host: "127.0.0.1".to_owned(),
        port,
        username: LOOPBACK_USER.to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some(LOOPBACK_PASSWORD.to_owned()),
        credential_status: Default::default(),
        tags: Vec::new(),
        production: false,
        ssh_options: Default::default(),
        sort_order: 0,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    }
}

#[derive(Default)]
struct FakeBackend {
    state: Arc<FakeBackendState>,
}

#[derive(Default)]
struct FakeBackendState {
    channel_error: Mutex<Option<String>>,
    channels: AtomicUsize,
    connect_error: Mutex<Option<String>>,
    connects: AtomicUsize,
    disconnects: AtomicUsize,
    exec_active: AtomicUsize,
    exec_enabled: AtomicUsize,
    exec_max_active: AtomicUsize,
    exec_release: Notify,
    exec_started: Notify,
    shell_closes: AtomicUsize,
    shell_enabled: AtomicUsize,
    shell_events: Mutex<VecDeque<SshRuntimeShellEvent>>,
    shell_last_request: Mutex<Option<SshRuntimeShellRequest>>,
    shell_opens: AtomicUsize,
    shell_resizes: AtomicUsize,
    shell_writes: Mutex<Vec<Vec<u8>>>,
    sftp_enabled: AtomicUsize,
    sftp_opens: AtomicUsize,
    streaming_exec_enabled: AtomicUsize,
    streaming_execs: AtomicUsize,
    streaming_stdin: Mutex<Vec<u8>>,
}

impl FakeBackend {
    fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    fn disconnect_count(&self) -> usize {
        self.state.disconnects.load(Ordering::SeqCst)
    }

    fn fail_channel(&self, message: &str) {
        *self.state.channel_error.lock().expect("channel error lock") = Some(message.to_owned());
    }

    fn fail_connect(&self, message: &str) {
        *self.state.connect_error.lock().expect("connect error lock") = Some(message.to_owned());
    }

    fn enable_exec(&self) {
        self.state.exec_enabled.store(1, Ordering::SeqCst);
    }

    fn enable_shell(&self) {
        self.state.shell_enabled.store(1, Ordering::SeqCst);
        self.state
            .shell_events
            .lock()
            .expect("shell events lock")
            .push_back(SshRuntimeShellEvent::Data(b"fake-shell-ready".to_vec()));
    }

    fn enable_sftp(&self) {
        self.state.sftp_enabled.store(1, Ordering::SeqCst);
    }

    fn enable_streaming_exec(&self) {
        self.state.streaming_exec_enabled.store(1, Ordering::SeqCst);
    }

    async fn wait_for_exec_start(&self) {
        self.state.exec_started.notified().await;
    }

    fn release_one_exec(&self) {
        self.state.exec_release.notify_one();
    }

    fn max_active_exec(&self) -> usize {
        self.state.exec_max_active.load(Ordering::SeqCst)
    }

    fn shell_close_count(&self) -> usize {
        self.state.shell_closes.load(Ordering::SeqCst)
    }

    fn shell_last_request(&self) -> Option<SshRuntimeShellRequest> {
        self.state
            .shell_last_request
            .lock()
            .expect("shell request lock")
            .clone()
    }

    fn shell_open_count(&self) -> usize {
        self.state.shell_opens.load(Ordering::SeqCst)
    }

    fn shell_resize_count(&self) -> usize {
        self.state.shell_resizes.load(Ordering::SeqCst)
    }

    fn shell_write_count(&self) -> usize {
        self.state
            .shell_writes
            .lock()
            .expect("shell writes lock")
            .len()
    }

    fn sftp_open_count(&self) -> usize {
        self.state.sftp_opens.load(Ordering::SeqCst)
    }

    fn streaming_exec_count(&self) -> usize {
        self.state.streaming_execs.load(Ordering::SeqCst)
    }

    fn streaming_stdin(&self) -> Vec<u8> {
        self.state
            .streaming_stdin
            .lock()
            .expect("streaming stdin lock")
            .clone()
    }
}

impl SshRuntimeBackend for FakeBackend {
    fn connect(
        &self,
        _request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        if let Some(message) = self
            .state
            .connect_error
            .lock()
            .expect("connect error lock")
            .clone()
        {
            return Err(AppError::SshCommand(message));
        }
        Ok(Arc::new(FakeConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeConnection {
    state: Arc<FakeBackendState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        if let Some(message) = self
            .state
            .channel_error
            .lock()
            .expect("channel error lock")
            .clone()
        {
            return Err(AppError::SshCommand(message));
        }
        let channel_index = self.state.channels.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(format!("fake-channel-{}-{}", kind.as_str(), channel_index))
    }

    fn supports_shell(&self) -> bool {
        self.state.shell_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_shell(
        &self,
        request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        if !self.supports_shell() {
            return Err(AppError::SshCommand("fake shell disabled".to_owned()));
        }
        self.state.shell_opens.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .shell_last_request
            .lock()
            .expect("shell request lock") = Some(request);
        Ok(Box::new(FakeShellSession {
            state: Arc::clone(&self.state),
        }))
    }

    fn supports_exec(&self) -> bool {
        self.state.exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        let active = self.state.exec_active.fetch_add(1, Ordering::SeqCst) + 1;
        update_max(&self.state.exec_max_active, active);
        self.state.exec_started.notify_one();
        self.state.exec_release.notified().await;
        self.state.exec_active.fetch_sub(1, Ordering::SeqCst);
        Ok(SshRuntimeExecRawOutput {
            exit_code: Some(0),
            stdout: request.script.into_bytes(),
            stderr: Vec::new(),
        })
    }

    fn supports_streaming_exec(&self) -> bool {
        self.state.streaming_exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_streaming_exec(
        &self,
        _request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        if !self.supports_streaming_exec() {
            return Err(AppError::SshCommand(
                "fake streaming exec disabled".to_owned(),
            ));
        }
        self.state.streaming_execs.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(FakeStreamingExecSession {
            state: Arc::clone(&self.state),
            stderr: Some(Cursor::new(Vec::new())),
            stdin_taken: false,
            stdout: Some(Cursor::new(b"streaming-output".to_vec())),
        }))
    }

    fn supports_sftp(&self) -> bool {
        self.state.sftp_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_sftp(&self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        if !self.supports_sftp() {
            return Err(AppError::SshCommand("fake sftp disabled".to_owned()));
        }
        self.state.sftp_opens.fetch_add(1, Ordering::SeqCst);
        let (client, _server) = tokio::io::duplex(64);
        Ok(Box::new(client))
    }

    fn disconnect(&self, _reason: &str) {
        self.state.disconnects.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeStreamingExecSession {
    state: Arc<FakeBackendState>,
    stderr: Option<Cursor<Vec<u8>>>,
    stdin_taken: bool,
    stdout: Option<Cursor<Vec<u8>>>,
}

impl std::fmt::Debug for FakeStreamingExecSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FakeStreamingExecSession")
            .finish_non_exhaustive()
    }
}

impl SshRuntimeStreamingExecSession for FakeStreamingExecSession {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        if self.stdin_taken {
            return Err(AppError::SshCommand(
                "fake streaming stdin already taken".to_owned(),
            ));
        }
        self.stdin_taken = true;
        Ok(Box::new(FakeStreamingExecWriter {
            state: Arc::clone(&self.state),
        }))
    }

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stdout
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| AppError::SshCommand("fake stdout already taken".to_owned()))
    }

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stderr
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| AppError::SshCommand("fake stderr already taken".to_owned()))
    }

    fn close_stdin(&mut self) -> AppResult<()> {
        self.stdin_taken = true;
        Ok(())
    }

    fn wait(&mut self, _timeout: std::time::Duration) -> AppResult<SshRuntimeStreamingExecExit> {
        Ok(SshRuntimeStreamingExecExit { exit_code: Some(0) })
    }

    fn kill(&mut self) -> AppResult<()> {
        Ok(())
    }
}

struct FakeStreamingExecWriter {
    state: Arc<FakeBackendState>,
}

impl Write for FakeStreamingExecWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        self.state
            .streaming_stdin
            .lock()
            .expect("streaming stdin lock")
            .extend_from_slice(input);
        Ok(input.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct FakeShellSession {
    state: Arc<FakeBackendState>,
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
        Ok(self
            .state
            .shell_events
            .lock()
            .expect("shell events lock")
            .pop_front()
            .unwrap_or(SshRuntimeShellEvent::Closed))
    }

    async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        self.state
            .shell_writes
            .lock()
            .expect("shell writes lock")
            .push(data);
        Ok(())
    }

    async fn resize(&self, _cols: u16, _rows: u16) -> AppResult<()> {
        self.state.shell_resizes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn close(&self) -> AppResult<()> {
        self.state.shell_closes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

async fn wait_for_pending_exec_requests(manager: &ManagedSshSessionManager, expected: u64) {
    for _ in 0..50 {
        let snapshot = manager.snapshot().expect("runtime snapshot");
        if snapshot
            .sessions
            .iter()
            .any(|session| session.pending_exec_requests == expected)
        {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let snapshot = manager.snapshot().expect("runtime snapshot");
    panic!("expected pending exec requests {expected}, got {snapshot:?}");
}

async fn read_shell_until(shell: &ManagedSshShellSession, expected: &str) -> String {
    let mut output = String::new();
    for _ in 0..20 {
        let event = tokio::time::timeout(Duration::from_secs(2), shell.read_event())
            .await
            .expect("timed out waiting for shell event")
            .expect("read shell event");
        match event {
            SshRuntimeShellEvent::Data(data) | SshRuntimeShellEvent::ExtendedData { data, .. } => {
                output.push_str(&String::from_utf8_lossy(&data));
                if output.contains(expected) {
                    return output;
                }
            }
            SshRuntimeShellEvent::Eof | SshRuntimeShellEvent::Closed => {
                panic!("shell closed before {expected:?}: {output:?}");
            }
            SshRuntimeShellEvent::ExitSignal {
                error_message,
                signal_name,
            } => {
                panic!("shell exited by signal {signal_name}: {error_message}");
            }
            SshRuntimeShellEvent::ExitStatus(status) => {
                panic!("shell exited with status {status} before {expected:?}: {output:?}");
            }
        }
    }
    panic!("expected shell output to contain {expected:?}, got {output:?}");
}

fn update_max(max: &AtomicUsize, candidate: usize) {
    let mut current = max.load(Ordering::SeqCst);
    while candidate > current {
        match max.compare_exchange(current, candidate, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return,
            Err(next) => current = next,
        }
    }
}
