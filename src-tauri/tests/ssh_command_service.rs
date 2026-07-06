//! SSH 非交互命令服务集成测试。
//!
//! @author kongweiguang

use async_trait::async_trait;
use kerminal_lib::{
    error::{AppError, AppResult},
    models::{
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, SshJumpHostOptions,
        },
        ssh_command::SshCommandRequest,
    },
    paths::KerminalPaths,
    services::external_launch::{
        ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
        ExternalSessionMaterializer,
    },
    services::ssh_command_service::{
        build_ssh_command_plan_with_executable,
        rules::{self, LimitedOutputSummary, NativeAuthMaterialSummary},
        SshCommandService,
    },
    services::ssh_runtime::{
        auth_broker::{SshAuthBroker, SshSessionSecretInput},
        native_backend::NativeSshRuntimeBackend,
        ManagedSshSessionManager, SshAuthIdentity, SshAuthSecretKind, SshChannelKind,
        SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection, SshRuntimeExecRawOutput,
        SshRuntimeExecRequest, SshRuntimeStreamingExecExit, SshRuntimeStreamingExecReader,
        SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
        SshRuntimeStreamingExecWriter, SshSessionKey, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG,
    },
    state::AppState,
    storage::config_file_store::ConfigFileStore,
};
use russh::{
    keys::{self, PrivateKey, PublicKey},
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId,
};
use std::{
    io::Cursor,
    net::SocketAddr,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tempfile::{tempdir, TempDir};
use tokio::{io, net::TcpListener};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[test]
fn external_runtime_host_metadata_without_materialized_target_does_not_read_host_toml_path() {
    let (_home, state) = test_state();

    let error = state
        .ssh_commands()
        .resolve_native_runtime_host_metadata(state.paths(), "external:missing-launch")
        .expect_err("missing external target should fail before file store");

    let message = error.to_string();
    assert!(matches!(error, AppError::NotFound(_)));
    assert!(message.contains("外部 SSH 临时目标不存在或已关闭"));
    assert!(!message.contains("invalid remote host id"));
    assert!(!message.contains("invalid file store path"));
}

#[derive(Debug)]
struct LoopbackCommandServer {
    addr: SocketAddr,
    host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for LoopbackCommandServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Debug)]
struct LoopbackJumpServer {
    addr: SocketAddr,
    direct_tcpip_requests: Arc<AtomicUsize>,
    host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for LoopbackJumpServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Clone)]
struct LoopbackSshCommandServer;

#[derive(Default)]
struct LoopbackSshCommandSession {
    exec_command: Option<String>,
    script: Vec<u8>,
}

#[derive(Clone)]
struct LoopbackSshJumpServer {
    direct_tcpip_requests: Arc<AtomicUsize>,
    target_addr: SocketAddr,
}

struct LoopbackSshJumpSession {
    direct_tcpip_requests: Arc<AtomicUsize>,
    target_addr: SocketAddr,
}

impl russh::server::Server for LoopbackSshCommandServer {
    type Handler = LoopbackSshCommandSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackSshCommandSession::default()
    }
}

impl russh::server::Handler for LoopbackSshCommandSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "deploy" && password == "secret" {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if data == b"sh -s" {
            self.exec_command = Some(String::from_utf8_lossy(data).into_owned());
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.script.extend_from_slice(data);
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let script = String::from_utf8_lossy(&self.script);
        let stdout = format!(
            "exec={}\nscript={script}",
            self.exec_command.as_deref().unwrap_or("<none>")
        );
        session.data(channel, stdout.into_bytes())?;
        session.extended_data(channel, 1, b"loopback stderr\n".to_vec())?;
        session.exit_status_request(channel, 0)?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }
}

impl russh::server::Server for LoopbackSshJumpServer {
    type Handler = LoopbackSshJumpSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackSshJumpSession {
            direct_tcpip_requests: Arc::clone(&self.direct_tcpip_requests),
            target_addr: self.target_addr,
        }
    }
}

impl russh::server::Handler for LoopbackSshJumpSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "jump" && password == "jump-secret" {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        if host_to_connect != self.target_addr.ip().to_string()
            || port_to_connect != u32::from(self.target_addr.port())
        {
            return Ok(false);
        }

        self.direct_tcpip_requests.fetch_add(1, Ordering::SeqCst);
        let target_addr = self.target_addr;
        tokio::spawn(async move {
            if let Ok(mut target_stream) = tokio::net::TcpStream::connect(target_addr).await {
                let mut channel_stream = channel.into_stream();
                let _ = io::copy_bidirectional(&mut channel_stream, &mut target_stream).await;
            }
        });

        Ok(true)
    }
}

async fn start_loopback_command_server() -> LoopbackCommandServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind loopback command server");
    let addr = listener.local_addr().expect("loopback command address");
    let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate loopback command host key");
    let host_key = private_key.public_key().clone();
    let config = russh::server::Config {
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![private_key],
        maximum_packet_size: 65_535,
        ..Default::default()
    };
    let task = tokio::spawn(async move {
        let mut server = LoopbackSshCommandServer;
        let _ = server.run_on_socket(Arc::new(config), &listener).await;
    });

    LoopbackCommandServer {
        addr,
        host_key,
        task,
    }
}

async fn start_loopback_jump_server(target_addr: SocketAddr) -> LoopbackJumpServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind loopback jump server");
    let addr = listener.local_addr().expect("loopback jump address");
    let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate loopback jump host key");
    let host_key = private_key.public_key().clone();
    let config = russh::server::Config {
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![private_key],
        maximum_packet_size: 65_535,
        ..Default::default()
    };
    let direct_tcpip_requests = Arc::new(AtomicUsize::new(0));
    let counters = Arc::clone(&direct_tcpip_requests);
    let task = tokio::spawn(async move {
        let mut server = LoopbackSshJumpServer {
            direct_tcpip_requests: counters,
            target_addr,
        };
        let _ = server.run_on_socket(Arc::new(config), &listener).await;
    });

    LoopbackJumpServer {
        addr,
        direct_tcpip_requests,
        host_key,
        task,
    }
}

#[tokio::test]
async fn execute_native_rejects_unknown_remote_host_before_opening_managed_exec() {
    let (_home, state) = test_state();

    let error = state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: "missing-host".to_owned(),
                command: "uname -a".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(4096),
            },
        )
        .await
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn build_plan_uses_parameterized_openssh_args_without_credentials() {
    let plan = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "whoami".to_owned(),
            timeout_seconds: Some(10),
            max_output_bytes: Some(2048),
        },
    )
    .expect("build plan");

    assert_eq!(plan.executable, "ssh");
    assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2222"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(plan.args.windows(2).any(|pair| pair == ["sh", "-s"]));
    assert!(plan
        .args
        .contains(&"PreferredAuthentications=publickey".to_owned()));
    assert_eq!(plan.script, "whoami\n");
    assert_eq!(plan.timeout_seconds, 10);
    assert_eq!(plan.max_output_bytes, 2048);
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn build_plan_uses_identity_file_for_key_path_hosts() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("id_ed25519".to_owned());

    let plan = build_ssh_command_plan_with_executable(
        &host,
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "command -v git".to_owned(),
            timeout_seconds: None,
            max_output_bytes: None,
        },
    )
    .expect("build ssh command plan with identity file");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-i", "id_ed25519"]));
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn build_plan_expands_home_relative_identity_file() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("~/.ssh/id_ed25519".to_owned());
    let expected_identity = dirs::home_dir()
        .expect("current user home")
        .join(".ssh")
        .join("id_ed25519")
        .to_string_lossy()
        .into_owned();

    let plan = build_ssh_command_plan_with_executable(
        &host,
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "whoami".to_owned(),
            timeout_seconds: Some(10),
            max_output_bytes: Some(2048),
        },
    )
    .expect("build plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair[0] == "-i" && pair[1] == expected_identity));
}

#[test]
fn build_plan_rejects_empty_command() {
    let error = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "  ".to_owned(),
            timeout_seconds: None,
            max_output_bytes: None,
        },
    )
    .expect_err("reject empty command");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn build_plan_rejects_control_characters_in_identity_file_path() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("/tmp/id_ed25519\nProxyCommand=bad".to_owned());

    assert!(matches!(
        build_ssh_command_plan_with_executable(
            &host,
            "ssh".to_owned(),
            SshCommandRequest {
                host_id: "host-1".to_owned(),
                command: "whoami".to_owned(),
                timeout_seconds: None,
                max_output_bytes: None,
            },
        ),
        Err(AppError::InvalidInput(_))
    ));
}

#[test]
fn native_auth_material_uses_plaintext_password_from_host() {
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.credential_secret = Some("s3cret".to_owned());

    assert_eq!(
        rules::resolve_native_auth_material_summary(&host).expect("resolve password auth"),
        NativeAuthMaterialSummary::Password("s3cret".to_owned())
    );
}

#[test]
fn native_auth_material_uses_plaintext_inline_private_key_from_host() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = None;
    host.credential_secret = Some(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----".to_owned(),
    );

    match rules::resolve_native_auth_material_summary(&host).expect("resolve private key auth") {
        NativeAuthMaterialSummary::PrivateKeyPem {
            content,
            passphrase,
        } => {
            assert!(content.contains("OPENSSH PRIVATE KEY"));
            assert_eq!(passphrase, None);
        }
        other => panic!("expected inline private key auth material, got {other:?}"),
    }
}

#[test]
fn native_auth_material_uses_key_path_from_host() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("id_ed25519".to_owned());

    assert_eq!(
        rules::resolve_native_auth_material_summary(&host).expect("resolve key path auth"),
        NativeAuthMaterialSummary::PrivateKeyPath {
            path: Path::new("id_ed25519").to_path_buf(),
            passphrase: None,
        }
    );
}

#[test]
fn native_auth_material_preserves_key_passphrase_for_path_and_inline_keys() {
    let mut path_host = remote_host(RemoteHostAuthType::Key);
    path_host.credential_ref = Some("id_ed25519".to_owned());
    path_host.key_passphrase_secret = Some("path-passphrase".to_owned());

    assert_eq!(
        rules::resolve_native_auth_material_summary(&path_host).expect("resolve key path auth"),
        NativeAuthMaterialSummary::PrivateKeyPath {
            path: Path::new("id_ed25519").to_path_buf(),
            passphrase: Some("path-passphrase".to_owned()),
        }
    );

    let mut pem_host = remote_host(RemoteHostAuthType::Key);
    pem_host.credential_ref = None;
    pem_host.credential_secret = Some(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----".to_owned(),
    );
    pem_host.key_passphrase_secret = Some("pem-passphrase".to_owned());

    match rules::resolve_native_auth_material_summary(&pem_host).expect("resolve private key auth")
    {
        NativeAuthMaterialSummary::PrivateKeyPem {
            content,
            passphrase,
        } => {
            assert!(content.contains("OPENSSH PRIVATE KEY"));
            assert_eq!(passphrase.as_deref(), Some("pem-passphrase"));
        }
        other => panic!("expected inline private key auth material, got {other:?}"),
    }
}

#[test]
fn native_auth_material_rejects_missing_password_before_connect() {
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.credential_secret = None;

    assert!(matches!(
        rules::resolve_native_auth_material_summary(&host),
        Err(AppError::InvalidInput(_))
    ));
}

#[tokio::test]
async fn native_command_executes_against_loopback_ssh_server() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_secret = Some("secret".to_owned());
    let host = create_saved_password_remote_host(&state, host);

    let output = SshCommandService::new()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf ready".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf ready\n");
    assert_eq!(output.stderr, "loopback stderr\n");
    assert!(!output.stdout_truncated);
    assert!(!output.stderr_truncated);
}

#[tokio::test]
async fn native_command_uses_session_only_password_from_auth_broker() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let host = create_password_remote_host_without_credentials(&state, server.addr.port());
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

    let output = state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf session-only".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command with session-only password");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf session-only\n");

    let first_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("first runtime snapshot");
    assert_eq!(first_snapshot.active_sessions, 1);
    assert_eq!(first_snapshot.sessions[0].ref_count, 0);
    assert_eq!(first_snapshot.sessions[0].opened_channels, 1);

    let second_output = state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf session-only-again".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute second native command on managed session");

    assert!(second_output.success);
    assert!(second_output.stdout.contains("printf session-only-again\n"));
    let second_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("second runtime snapshot");
    assert_eq!(second_snapshot.active_sessions, 1);
    assert!(second_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        second_snapshot.sessions[0].session_id,
        first_snapshot.sessions[0].session_id
    );
    assert_eq!(second_snapshot.sessions[0].opened_channels, 2);
    assert_eq!(
        second_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&2)
    );
    assert_eq!(
        state
            .ssh_runtime()
            .close_idle_sessions()
            .expect("close idle"),
        1
    );
}

#[tokio::test]
async fn native_command_fallback_honors_pre_cancelled_token() {
    let (_home, state) = test_state();
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = 9;
    host.credential_secret = Some("secret".to_owned());
    let host = create_saved_password_remote_host(&state, host);
    let cancel_token = CancellationToken::new();
    cancel_token.cancel();

    let error = SshCommandService::new()
        .execute_native_with_cancel_token(
            state.paths(),
            SshCommandRequest {
                host_id: host.id,
                command: "printf should-not-run".to_owned(),
                timeout_seconds: Some(30),
                max_output_bytes: Some(1024),
            },
            cancel_token,
        )
        .await
        .expect_err("pre-cancelled native fallback should not connect");

    assert!(matches!(error, AppError::SshCommand(_)));
    assert_eq!(error.to_string(), "SSH 远程命令执行失败: 远程命令已取消");
}

#[tokio::test]
async fn native_command_opens_managed_exec_channel_with_redacted_session_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let host = create_password_remote_host_without_credentials(&state, server.addr.port());
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
    let backend = Arc::new(FakeRuntimeBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );

    let output = service
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf managed-exec".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command with managed exec lease");

    assert!(output.success);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(backend.disconnect_count(), 0);
    assert_eq!(manager.active_session_count().expect("active sessions"), 1);
    assert_eq!(backend.last_channel_kind(), None);
    let key = backend.last_key().expect("runtime key");
    assert_eq!(key.target.host, "127.0.0.1");
    assert!(key.runtime_flags.is_empty());
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id.starts_with("ssh-auth:target:deploy@127.0.0.1:")
    ));
    let debug = format!("{key:?}");
    assert!(!debug.contains("secret"));
    assert!(!debug.contains("PRIVATE KEY"));
    assert_eq!(manager.close_idle_sessions().expect("closed idle"), 1);
    assert_eq!(backend.disconnect_count(), 1);
}

#[tokio::test]
async fn native_command_uses_managed_exec_stream_when_backend_supports_exec() {
    let (_home, state) = test_state();
    let host = create_password_remote_host_without_credentials(&state, 2222);
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@127.0.0.1:2222:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");
    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let cancel_token = CancellationToken::new();

    let output = service
        .execute_native_with_cancel_token(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf managed-stream".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(8),
            },
            cancel_token,
        )
        .await
        .expect("execute through managed exec stream");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout_bytes, 256);
    assert!(output.stdout.starts_with("managed-stream-output"));
    assert!(output.stdout_truncated);
    assert_eq!(output.stderr, "stderr");
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_exec_script(),
        Some("printf managed-stream\n".to_owned())
    );
    assert_eq!(backend.last_exec_timeout_seconds(), Some(5));
    assert_eq!(backend.last_exec_max_output_bytes(), Some(256));
    assert_eq!(backend.last_exec_cancelled(), Some(false));
    assert!(manager
        .snapshot()
        .expect("managed exec stream snapshot")
        .recent_legacy_fallbacks
        .is_empty());
}

#[tokio::test]
async fn native_command_managed_exec_honors_pre_cancelled_token() {
    let (_home, state) = test_state();
    let host = create_password_remote_host_without_credentials(&state, 2222);
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@127.0.0.1:2222:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");
    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager,
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let cancel_token = CancellationToken::new();
    cancel_token.cancel();

    let error = service
        .execute_native_with_cancel_token(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf managed-cancel".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
            cancel_token,
        )
        .await
        .expect_err("pre-cancelled managed exec should stop before backend exec");

    assert!(matches!(error, AppError::SshCommand(_)));
    assert_eq!(error.to_string(), "SSH 远程命令执行失败: 远程命令已取消");
    assert_eq!(backend.connect_count(), 0);
    assert_eq!(backend.exec_count(), 0);
}

#[tokio::test]
async fn open_managed_streaming_exec_passes_timeout_and_cancel_token_to_runtime() {
    let (_home, state) = test_state();
    let host = create_password_remote_host_without_credentials(&state, 2222);
    state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@127.0.0.1:2222:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "secret".to_owned(),
        })
        .expect("remember session-only password");
    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_streaming_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let cancel_token = CancellationToken::new();
    cancel_token.cancel();

    let session = service
        .open_managed_streaming_exec(
            state.paths(),
            &host.id,
            "tail -f /var/log/app.log".to_owned(),
            42,
            cancel_token,
        )
        .await
        .expect("open managed streaming exec")
        .expect("managed streaming exec supported");

    assert!(!session.session_id().is_empty());
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.streaming_exec_count(), 1);
    assert_eq!(
        backend.last_streaming_exec_command(),
        Some("tail -f /var/log/app.log".to_owned())
    );
    assert_eq!(backend.last_streaming_exec_timeout_seconds(), Some(42));
    assert_eq!(backend.last_streaming_exec_cancelled(), Some(true));
    let snapshot = manager.snapshot().expect("runtime snapshot");
    assert_eq!(snapshot.sessions[0].active_channels, 1);
    assert_eq!(
        snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::Exec),
        Some(&1)
    );
    drop(session);
    assert_eq!(manager.active_session_count().expect("active sessions"), 1);
}

#[tokio::test]
async fn external_native_command_exec_uses_capability_runtime_lane() {
    let (_home, state) = test_state();
    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                "2222".to_owned(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    };
    let _ = intake.take_pending().expect("take pending launch");
    let target = materializer
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external target");
    intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let backend = Arc::new(FakeRuntimeBackend::default());
    backend.enable_exec();
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(manager, auth_broker, materializer);

    let output = service
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: target.host_id,
                command: "printf external-managed".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute external managed command");

    assert!(output.success);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    let key = backend.last_key().expect("runtime key");
    assert!(key
        .runtime_flags
        .iter()
        .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG));
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id.starts_with("ssh-auth:target:deploy@127.0.0.1:2222:")
    ));
}

#[tokio::test]
async fn native_command_executes_through_loopback_jump_host() {
    let target = start_loopback_command_server().await;
    let jump = start_loopback_jump_server(target.addr).await;
    let (_home, state) = test_state();
    let known_hosts_path = state.paths().root.join("known_hosts");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        jump.addr.port(),
        &jump.host_key,
        &known_hosts_path,
    )
    .expect("trust jump host key");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        target.addr.port(),
        &target.host_key,
        &known_hosts_path,
    )
    .expect("trust target host key");

    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = target.addr.port();
    host.credential_secret = Some("secret".to_owned());
    host.ssh_options.jump_hosts = vec![SshJumpHostOptions {
        name: "loopback jump".to_owned(),
        host: "127.0.0.1".to_owned(),
        port: jump.addr.port(),
        username: "jump".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some("jump-secret".to_owned()),
        credential_status: Default::default(),
    }];
    let host = create_saved_password_remote_host(&state, host);

    let output = SshCommandService::new()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf through-jump".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command through jump");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf through-jump\n");
    assert_eq!(output.stderr, "loopback stderr\n");
    assert_eq!(jump.direct_tcpip_requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn native_command_rejects_untrusted_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_secret = Some("secret".to_owned());
    let host = create_saved_password_remote_host(&state, host);

    assert!(matches!(
        SshCommandService::new()
            .execute_native(
                state.paths(),
                SshCommandRequest {
                    host_id: host.id.clone(),
                    command: "printf ready".to_owned(),
                    timeout_seconds: Some(5),
                    max_output_bytes: Some(1024),
                },
            )
            .await,
        Err(AppError::SshCommand(_))
    ));
}

#[tokio::test]
async fn external_native_command_trusts_unknown_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    let known_hosts_path = state.paths().root.join("known_hosts");
    assert!(!known_hosts_path.exists());

    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                server.addr.port().to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    };
    let _ = intake.take_pending().expect("take pending launch");
    let target = materializer
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external loopback target");
    intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let ssh_commands = SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new())),
        auth_broker,
        materializer,
    );
    let output = ssh_commands
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: target.host_id,
                command: "printf external-ready".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("unknown external host key should be trusted on first use");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf external-ready\n");
    assert!(keys::known_hosts::check_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        &known_hosts_path,
    )
    .expect("check learned external known host"));
}

#[tokio::test]
async fn external_native_command_rejects_changed_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    let known_hosts_path = state.paths().root.join("known_hosts");
    let wrong_private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate wrong host key");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        wrong_private_key.public_key(),
        &known_hosts_path,
    )
    .expect("write changed known host key");

    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                server.addr.port().to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    };
    let _ = intake.take_pending().expect("take pending launch");
    let target = materializer
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external loopback target");
    intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let ssh_commands = SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new())),
        auth_broker,
        materializer,
    );
    let error = ssh_commands
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: target.host_id,
                command: "printf should-not-run".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect_err("changed host key should block external target");
    let error = error.to_string();

    assert!(!error.contains("secret"));
    assert!(error.contains("key") || error.contains("host") || error.contains("验证"));
}

#[tokio::test]
async fn native_connection_test_trusts_unknown_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let known_hosts_path = paths.root.join("known_hosts");
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_secret = Some("secret".to_owned());

    assert!(!known_hosts_path.exists());
    SshCommandService::new()
        .test_connection(&paths, &host)
        .await
        .expect("test connection trusts unknown loopback key");

    assert!(keys::known_hosts::check_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        &known_hosts_path,
    )
    .expect("check learned known host"));
}

#[test]
fn normalize_command_rejects_empty_and_nul() {
    assert!(matches!(
        rules::normalize_command_script(" \n\t "),
        Err(AppError::InvalidInput(_))
    ));
    assert!(matches!(
        rules::normalize_command_script("echo ok\0"),
        Err(AppError::InvalidInput(_))
    ));
    assert_eq!(
        rules::normalize_command_script("echo one\r\necho two").expect("normalize command"),
        "echo one\necho two\n"
    );
}

#[test]
fn timeout_and_output_bounds_are_clamped() {
    let plan = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "whoami".to_owned(),
            timeout_seconds: Some(400),
            max_output_bytes: Some(1),
        },
    )
    .expect("build clamped plan");

    assert_eq!(plan.timeout_seconds, 300);
    assert_eq!(plan.max_output_bytes, 256);
}

#[test]
fn read_limited_output_captures_prefix_and_truncation_flag() {
    let output = rules::read_limited_output_summary(Cursor::new("abcdef中文".as_bytes()), 6)
        .expect("read output");

    assert_eq!(
        output,
        LimitedOutputSummary {
            text: "abcdef".to_owned(),
            captured_bytes: 6,
            truncated: true,
        }
    );
}

#[test]
fn limited_output_buffer_captures_prefix_and_tracks_truncation() {
    let output =
        rules::limited_output_summary_from_chunks(5, &[b"abc".as_ref(), "def中文".as_bytes()]);

    assert_eq!(
        output,
        LimitedOutputSummary {
            text: "abcde".to_owned(),
            captured_bytes: 5,
            truncated: true,
        }
    );
}

#[derive(Default)]
struct FakeRuntimeBackend {
    state: Arc<FakeRuntimeState>,
}

#[derive(Default)]
struct FakeRuntimeState {
    channels: AtomicUsize,
    connects: AtomicUsize,
    disconnects: AtomicUsize,
    exec_enabled: AtomicUsize,
    execs: AtomicUsize,
    last_exec_cancelled: Mutex<Option<bool>>,
    last_exec_max_output_bytes: Mutex<Option<usize>>,
    last_exec_script: Mutex<Option<String>>,
    last_exec_timeout_seconds: Mutex<Option<u64>>,
    last_channel_kind: Mutex<Option<SshChannelKind>>,
    last_key: Mutex<Option<SshSessionKey>>,
    last_streaming_exec_cancelled: Mutex<Option<bool>>,
    last_streaming_exec_command: Mutex<Option<String>>,
    last_streaming_exec_timeout_seconds: Mutex<Option<u64>>,
    streaming_exec_enabled: AtomicUsize,
    streaming_execs: AtomicUsize,
}

impl FakeRuntimeBackend {
    fn channel_count(&self) -> usize {
        self.state.channels.load(Ordering::SeqCst)
    }

    fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    fn disconnect_count(&self) -> usize {
        self.state.disconnects.load(Ordering::SeqCst)
    }

    fn last_channel_kind(&self) -> Option<SshChannelKind> {
        *self
            .state
            .last_channel_kind
            .lock()
            .expect("last channel kind")
    }

    fn last_key(&self) -> Option<SshSessionKey> {
        self.state.last_key.lock().expect("last key").clone()
    }

    fn enable_exec(&self) {
        self.state.exec_enabled.store(1, Ordering::SeqCst);
    }

    fn enable_streaming_exec(&self) {
        self.state.streaming_exec_enabled.store(1, Ordering::SeqCst);
    }

    fn exec_count(&self) -> usize {
        self.state.execs.load(Ordering::SeqCst)
    }

    fn last_exec_script(&self) -> Option<String> {
        self.state
            .last_exec_script
            .lock()
            .expect("last exec script")
            .clone()
    }

    fn last_exec_timeout_seconds(&self) -> Option<u64> {
        *self
            .state
            .last_exec_timeout_seconds
            .lock()
            .expect("last exec timeout seconds")
    }

    fn last_exec_max_output_bytes(&self) -> Option<usize> {
        *self
            .state
            .last_exec_max_output_bytes
            .lock()
            .expect("last exec max output bytes")
    }

    fn last_exec_cancelled(&self) -> Option<bool> {
        *self
            .state
            .last_exec_cancelled
            .lock()
            .expect("last exec cancelled")
    }

    fn streaming_exec_count(&self) -> usize {
        self.state.streaming_execs.load(Ordering::SeqCst)
    }

    fn last_streaming_exec_command(&self) -> Option<String> {
        self.state
            .last_streaming_exec_command
            .lock()
            .expect("last streaming exec command")
            .clone()
    }

    fn last_streaming_exec_timeout_seconds(&self) -> Option<u64> {
        *self
            .state
            .last_streaming_exec_timeout_seconds
            .lock()
            .expect("last streaming exec timeout seconds")
    }

    fn last_streaming_exec_cancelled(&self) -> Option<bool> {
        *self
            .state
            .last_streaming_exec_cancelled
            .lock()
            .expect("last streaming exec cancelled")
    }
}

impl SshRuntimeBackend for FakeRuntimeBackend {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        *self.state.last_key.lock().expect("last key") = Some(request.key().clone());
        Ok(Arc::new(FakeRuntimeConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeRuntimeConnection {
    state: Arc<FakeRuntimeState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeRuntimeConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        self.state.channels.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_channel_kind
            .lock()
            .expect("last channel kind") = Some(kind);
        Ok(format!("fake-runtime-{}", kind.as_str()))
    }

    fn supports_exec(&self) -> bool {
        self.state.exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        self.state.execs.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_exec_script
            .lock()
            .expect("last exec script") = Some(request.script);
        *self
            .state
            .last_exec_timeout_seconds
            .lock()
            .expect("last exec timeout seconds") = Some(request.timeout_seconds);
        *self
            .state
            .last_exec_max_output_bytes
            .lock()
            .expect("last exec max output bytes") = Some(request.max_output_bytes);
        *self
            .state
            .last_exec_cancelled
            .lock()
            .expect("last exec cancelled") = Some(request.cancel_token.is_cancelled());
        Ok(SshRuntimeExecRawOutput {
            exit_code: Some(0),
            stdout: "managed-stream-output".repeat(20).into_bytes(),
            stderr: b"stderr".to_vec(),
        })
    }

    fn supports_streaming_exec(&self) -> bool {
        self.state.streaming_exec_enabled.load(Ordering::SeqCst) > 0
    }

    async fn open_streaming_exec(
        &self,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        self.state.streaming_execs.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_streaming_exec_command
            .lock()
            .expect("last streaming exec command") = Some(request.command);
        *self
            .state
            .last_streaming_exec_timeout_seconds
            .lock()
            .expect("last streaming exec timeout seconds") = Some(request.timeout_seconds);
        *self
            .state
            .last_streaming_exec_cancelled
            .lock()
            .expect("last streaming exec cancelled") = Some(request.cancel_token.is_cancelled());
        Ok(Box::new(FakeStreamingExecSession))
    }

    fn disconnect(&self, _reason: &str) {
        self.state.disconnects.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Debug)]
struct FakeStreamingExecSession;

impl SshRuntimeStreamingExecSession for FakeStreamingExecSession {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        Ok(Box::new(Cursor::new(Vec::<u8>::new())))
    }

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        Ok(Box::new(Cursor::new(Vec::<u8>::new())))
    }

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        Ok(Box::new(Cursor::new(Vec::<u8>::new())))
    }

    fn close_stdin(&mut self) -> AppResult<()> {
        Ok(())
    }

    fn wait(&mut self, _timeout: Duration) -> AppResult<SshRuntimeStreamingExecExit> {
        Ok(SshRuntimeStreamingExecExit { exit_code: Some(0) })
    }

    fn kill(&mut self) -> AppResult<()> {
        Ok(())
    }
}

fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        auth_type,
        credential_ref: (auth_type == RemoteHostAuthType::Key)
            .then(|| "/home/deploy/.ssh/id_ed25519".to_owned()),
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags: vec!["dev".to_owned()],
        production: false,
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn create_saved_password_remote_host(state: &AppState, mut host: RemoteHost) -> RemoteHost {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: host.auth_type,
            credential_ref: host.credential_ref.take(),
            credential_secret: host.credential_secret.take(),
            group_id: None,
            host: host.host,
            name: host.name,
            port: host.port,
            production: host.production,
            ssh_options: host.ssh_options,
            tags: host.tags,
            username: host.username,
        })
        .expect("create saved password host")
}

fn create_password_remote_host_without_credentials(state: &AppState, port: u16) -> RemoteHost {
    let host = RemoteHost {
        id: Uuid::new_v4().to_string(),
        group_id: None,
        name: "loopback".to_owned(),
        host: "127.0.0.1".to_owned(),
        port,
        username: "deploy".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: Default::default(),
        tags: vec!["loopback".to_owned()],
        production: false,
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "0".to_owned(),
        updated_at: "0".to_owned(),
    };
    ConfigFileStore::new(state.paths().root.clone())
        .apply_remote_host_change_set(None, std::slice::from_ref(&host), &[])
        .expect("write loopback remote host without credentials");
    host
}
