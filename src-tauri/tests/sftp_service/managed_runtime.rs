use std::{
    sync::{atomic::Ordering, mpsc, Arc},
    time::Duration,
};

#[path = "../support/managed_ssh_runtime.rs"]
mod managed_ssh_runtime_support;

use super::support::{
    create_password_remote_host_without_credentials,
    loopback::{start_loopback_sftp_server, LOOPBACK_SFTP_SHELL_READY_MARKER},
    test_state,
};
use kerminal_lib::{
    models::{
        sftp::{
            SftpDeleteRequest, SftpEntryKind, SftpListDirectoryRequest, SftpTransferConflictPolicy,
            SftpTransferRequest, SftpTrustHostKeyRequest,
        },
        terminal::{SshTerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    services::{
        external_launch::{
            external_target_id, ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint,
        },
        sftp_service::SftpService,
        ssh_runtime::{
            auth_broker::SshSessionSecretInput, native_backend::NativeSshRuntimeBackend,
            ManagedSshSessionManager, SshAuthSecretKind, SshChannelKind,
            MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG,
        },
    },
    state::AppState,
};
use managed_ssh_runtime_support::FakeManagedSshRuntime;
use tempfile::tempdir;
use tokio::{fs, runtime::Runtime};

#[test]
fn ssh_terminal_and_sftp_share_one_session_only_managed_transport() {
    let runtime = Runtime::new().expect("create test runtime");
    let server_root = tempdir().expect("server root");
    runtime.block_on(async {
        fs::write(server_root.path().join("shared-session.txt"), b"runtime")
            .await
            .expect("seed remote file");
    });
    let server = runtime.block_on(start_loopback_sftp_server(server_root.path().to_path_buf()));
    let (_home, state) = test_state();
    let host_id =
        create_password_remote_host_without_credentials(&state, "loopback", server.addr.port());
    runtime
        .block_on(state.sftp().trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.clone(),
            },
        ))
        .expect("trust loopback host key");
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: format!(
                "ssh-auth:target:deploy@127.0.0.1:{}:password",
                server.addr.port()
            ),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");

    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("open managed SSH terminal with session-only secret");

    let output = collect_terminal_output_until(&receiver, LOOPBACK_SFTP_SHELL_READY_MARKER);
    assert!(output.contains(LOOPBACK_SFTP_SHELL_READY_MARKER));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "terminal shell should authenticate exactly once"
    );

    let listing = runtime
        .block_on(state.sftp().list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id,
                path: "/".to_owned(),
            },
        ))
        .expect("list through the same managed SSH session after terminal login");
    assert!(listing
        .entries
        .iter()
        .any(|entry| { entry.name == "shared-session.txt" && entry.kind == SftpEntryKind::File }));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "SFTP must reuse the terminal-authenticated managed SSH transport"
    );

    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.sessions.len(), 1);
    assert_eq!(snapshot.active_channels, 1);
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
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
    let debug = format!("{snapshot:?}");
    assert!(!debug.contains("secret"));

    state
        .terminals()
        .close(&summary.id)
        .expect("close terminal shell");
}

#[test]
fn external_launch_terminal_and_sftp_use_isolated_capability_transport() {
    let runtime = Runtime::new().expect("create test runtime");
    let server_root = tempdir().expect("server root");
    runtime.block_on(async {
        fs::write(server_root.path().join("external-session.txt"), b"runtime")
            .await
            .expect("seed remote file");
        fs::create_dir_all(server_root.path().join("external-dir/nested"))
            .await
            .expect("seed external directory");
        fs::write(
            server_root.path().join("external-dir/nested/app.log"),
            b"delete through external capability exec",
        )
        .await
        .expect("seed external nested file");
    });
    let server = runtime.block_on(start_loopback_sftp_server(server_root.path().to_path_buf()));
    let (_home, state) = test_state();
    let trust_host_id = create_password_remote_host_without_credentials(
        &state,
        "loopback-trust",
        server.addr.port(),
    );
    runtime
        .block_on(state.sftp().trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: trust_host_id,
            },
        ))
        .expect("trust loopback host key");

    let launch_id = queue_putty_loopback_password_launch(&state, server.addr.port());
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending external launch");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, launch_id);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external launch secret");
    assert_eq!(target.host_id, external_target_id(&launch_id));

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
        .expect("open managed SSH terminal for materialized external target");

    let output = collect_terminal_output_until(&receiver, LOOPBACK_SFTP_SHELL_READY_MARKER);
    assert!(output.contains(LOOPBACK_SFTP_SHELL_READY_MARKER));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "external launch terminal should authenticate exactly once"
    );

    let listing = runtime
        .block_on(state.sftp().list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: target.host_id.clone(),
                path: "/".to_owned(),
            },
        ))
        .expect("list external target through an isolated managed SSH capability session");
    assert!(listing.entries.iter().any(|entry| {
        entry.name == "external-session.txt" && entry.kind == SftpEntryKind::File
    }));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        2,
        "external SFTP should open a separate capability transport instead of sharing the terminal shell"
    );
    runtime
        .block_on(state.sftp().delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: target.host_id.clone(),
                path: "/external-dir".to_owned(),
                directory: true,
            },
        ))
        .expect("delete external directory through the isolated capability transport");
    assert!(
        !server_root.path().join("external-dir").exists(),
        "external managed exec helper should remove the remote directory"
    );
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        2,
        "external SFTP directory helper should reuse the capability transport instead of logging in again or using the terminal shell"
    );

    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.sessions.len(), 2);
    assert_eq!(snapshot.active_channels, 1);
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("external terminal interactive lane");
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
        .expect("external SFTP capability lane");
    assert_eq!(interactive.key.target, capability.key.target);
    assert_eq!(interactive.key.jumps, capability.key.jumps);
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Shell),
        Some(&1)
    );
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Exec),
        None,
        "external SFTP helper exec must not run on the interactive shell lane"
    );
    assert_eq!(
        capability.channel_counts.get(&SshChannelKind::Sftp),
        Some(&1)
    );
    assert_eq!(
        capability.channel_counts.get(&SshChannelKind::Exec),
        Some(&1),
        "external SFTP helper exec should share the isolated capability lane"
    );
    let debug = format!("{snapshot:?}");
    assert!(!debug.contains("secret"));
    assert!(!format!("{target:?}").contains("external-secret:"));

    state
        .terminals()
        .close(&summary.id)
        .expect("close external terminal shell");
}

#[tokio::test]
async fn sftp_operations_use_real_managed_sftp_channel_without_second_ssh_connection() {
    let server_root = tempdir().expect("server root");
    fs::write(server_root.path().join("managed-runtime.txt"), b"runtime")
        .await
        .expect("seed remote file");
    fs::create_dir_all(server_root.path().join("managed-dir/nested"))
        .await
        .expect("seed remote directory");
    fs::write(
        server_root.path().join("managed-dir/nested/app.log"),
        b"delete through managed exec",
    )
    .await
    .expect("seed nested remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id =
        create_password_remote_host_without_credentials(&state, "loopback", server.addr.port());
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.clone(),
            },
        )
        .await
        .expect("trust loopback host key");
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: format!(
                "ssh-auth:target:deploy@127.0.0.1:{}:password",
                server.addr.port()
            ),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");

    let manager = ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
    let service = SftpService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let listing = service
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect("list through managed SFTP channel");
    let second_listing = service
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect("reuse managed SFTP channel for second listing");

    for listing in [&listing, &second_listing] {
        assert!(listing.entries.iter().any(|entry| {
            entry.name == "managed-runtime.txt" && entry.kind == SftpEntryKind::File
        }));
    }
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "two SFTP operations should reuse the authenticated managed SSH transport"
    );
    service
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: host_id.clone(),
                path: "/managed-dir".to_owned(),
                directory: true,
            },
        )
        .await
        .expect("delete directory through managed exec channel");
    assert!(!server_root.path().join("managed-dir").exists());
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "managed exec delete should reuse the already authenticated SSH transport"
    );

    let local_download = tempdir().expect("local download");
    let local_download_path = local_download.path().join("managed-runtime-download.txt");
    service
        .download(
            state.paths(),
            SftpTransferRequest {
                host_id,
                local_path: local_download_path.to_string_lossy().into_owned(),
                remote_path: "/managed-runtime.txt".to_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("download through bulk transfer lane");
    assert_eq!(
        fs::read(&local_download_path)
            .await
            .expect("downloaded file"),
        b"runtime"
    );
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        2,
        "bulk transfer should use a second managed SSH transport while reusing session-only auth"
    );
    assert_eq!(manager.active_session_count().expect("active sessions"), 2);
    let snapshot = manager.snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.active_channels, 0);
    assert!(snapshot.recent_legacy_fallbacks.is_empty());
    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive SFTP lane");
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
        .expect("bulk transfer SFTP lane");
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Sftp),
        Some(&2)
    );
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Exec),
        Some(&1)
    );
    assert_eq!(bulk.channel_counts.get(&SshChannelKind::Sftp), Some(&1));
    let debug = format!("{snapshot:?}");
    assert!(!debug.contains("secret"));
    assert!(!debug.contains("PRIVATE KEY"));
    assert_eq!(manager.close_idle_sessions().expect("close idle"), 2);
}

fn collect_terminal_output_until(
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
) -> String {
    let mut output = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let event = receiver
            .recv_timeout(remaining)
            .expect("wait for terminal output");
        if event.kind != TerminalOutputKind::Data {
            continue;
        }
        output.push_str(&event.data);
        if output.contains(expected) {
            return output;
        }
    }
    panic!("timed out waiting for {expected:?}, got {output:?}");
}

fn queue_putty_loopback_password_launch(state: &AppState, port: u16) -> String {
    match state
        .external_launch_intake()
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                port.to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue putty loopback launch")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    }
}

#[tokio::test]
async fn unsupported_managed_sftp_fallback_does_not_record_lease_only_channel() {
    let server_root = tempdir().expect("server root");
    fs::write(server_root.path().join("legacy-fallback.txt"), b"fallback")
        .await
        .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id =
        create_password_remote_host_without_credentials(&state, "loopback", server.addr.port());
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.clone(),
            },
        )
        .await
        .expect("trust loopback host key");
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: format!(
                "ssh-auth:target:deploy@127.0.0.1:{}:password",
                server.addr.port()
            ),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");

    let fake_runtime = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(fake_runtime.clone());
    let service = SftpService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let listing = service
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id,
                path: "/".to_owned(),
            },
        )
        .await
        .expect("fall back to legacy SFTP when managed backend lacks SFTP");

    assert!(listing
        .entries
        .iter()
        .any(|entry| { entry.name == "legacy-fallback.txt" && entry.kind == SftpEntryKind::File }));
    assert_eq!(
        server.auth_successes.load(Ordering::SeqCst),
        1,
        "legacy fallback performs the actual SSH/SFTP authentication once"
    );
    assert_eq!(fake_runtime.connect_count(), 1);
    assert_eq!(
        fake_runtime.channel_count(),
        0,
        "unsupported managed SFTP must not leave a diagnostics-only SFTP channel lease"
    );
    assert_eq!(fake_runtime.last_channel_kind(), None);

    let snapshot = manager.snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.active_channels, 0);
    assert_eq!(snapshot.recent_legacy_fallbacks.len(), 1);
    assert_eq!(snapshot.recent_legacy_fallbacks[0].capability, "sftp");
    assert_eq!(
        snapshot.recent_legacy_fallbacks[0].reason,
        "managed-sftp-unsupported"
    );
    assert_eq!(snapshot.recent_legacy_fallbacks[0].count, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Sftp),
        None,
        "fallback diagnostics must not claim that a managed SFTP channel opened"
    );
    assert_eq!(manager.close_idle_sessions().expect("close idle"), 1);
}
