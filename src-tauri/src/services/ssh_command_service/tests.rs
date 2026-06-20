//! SSH 非交互命令服务单元测试。
//!
//! @author kongweiguang

use super::*;
use russh::{
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId,
};
use std::{io::Cursor, net::SocketAddr, path::Path, sync::Arc};
use tempfile::tempdir;
use tokio::net::TcpListener;

use crate::services::credential_service::{CredentialService, MemoryCredentialVault};

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

#[derive(Clone)]
struct LoopbackSshCommandServer;

#[derive(Default)]
struct LoopbackSshCommandSession {
    exec_command: Option<String>,
    script: Vec<u8>,
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

fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        auth_type,
        credential_ref: Some("credential:ssh/dev".to_owned()),
        tags: vec!["dev".to_owned()],
        production: false,
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

#[test]
fn build_plan_uses_parameterized_openssh_args_without_credentials() {
    let plan = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "uname -a".to_owned(),
            timeout_seconds: Some(45),
            max_output_bytes: Some(4096),
        },
    )
    .expect("build ssh command plan");

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
    assert_eq!(plan.args.last().map(String::as_str), Some("-s"));
    assert_eq!(plan.script, "uname -a\n");
    assert_eq!(plan.timeout_seconds, 45);
    assert_eq!(plan.max_output_bytes, 4096);
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn build_plan_uses_identity_file_for_key_path_hosts() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("/home/deploy/.ssh/id_ed25519".to_owned());

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
        .any(|pair| pair == ["-i", "/home/deploy/.ssh/id_ed25519"]));
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
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
fn native_auth_material_loads_password_from_vault() {
    let credentials = test_credentials(&[("credential:ssh/dev/password", "s3cret")]);
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.credential_ref = Some("credential:ssh/dev/password".to_owned());

    match resolve_native_auth_material(&host, &credentials).expect("resolve password auth") {
        NativeSshAuthMaterial::Password(password) => assert_eq!(password, "s3cret"),
        _ => panic!("expected password auth material"),
    }
}

#[test]
fn native_auth_material_decodes_inline_private_key_json() {
    let secret = serde_json::json!({
        "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
        "passphrase": "secret-passphrase"
    })
    .to_string();
    let credentials = test_credentials(&[("credential:ssh/dev/private-key", &secret)]);
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("credential:ssh/dev/private-key".to_owned());

    match resolve_native_auth_material(&host, &credentials).expect("resolve private key auth") {
        NativeSshAuthMaterial::PrivateKey(NativeSshPrivateKey::Pem {
            content,
            passphrase,
        }) => {
            assert!(content.contains("OPENSSH PRIVATE KEY"));
            assert_eq!(passphrase.as_deref(), Some("secret-passphrase"));
        }
        _ => panic!("expected inline private key auth material"),
    }
}

#[test]
fn native_auth_material_keeps_key_path_out_of_vault() {
    let credentials = test_credentials(&[]);
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("/home/deploy/.ssh/id_ed25519".to_owned());

    match resolve_native_auth_material(&host, &credentials).expect("resolve key path auth") {
        NativeSshAuthMaterial::PrivateKey(NativeSshPrivateKey::Path(path)) => {
            assert_eq!(path, Path::new("/home/deploy/.ssh/id_ed25519"));
        }
        _ => panic!("expected key path auth material"),
    }
}

#[test]
fn native_auth_material_rejects_missing_password_before_connect() {
    let credentials = test_credentials(&[]);
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.credential_ref = Some("credential:ssh/dev/password".to_owned());

    assert!(matches!(
        resolve_native_auth_material(&host, &credentials),
        Err(AppError::Credential(_))
    ));
}

#[tokio::test]
async fn native_command_executes_against_loopback_ssh_server() {
    let server = start_loopback_command_server().await;
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        paths.root.join("known_hosts"),
    )
    .expect("trust loopback host key");
    let credentials = test_credentials(&[("credential:ssh/dev/password", "secret")]);
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_ref = Some("credential:ssh/dev/password".to_owned());

    let execution = build_native_command_execution(
        &host,
        &credentials,
        &paths,
        SshCommandRequest {
            host_id: host.id.clone(),
            command: "printf ready".to_owned(),
            timeout_seconds: Some(5),
            max_output_bytes: Some(1024),
        },
    )
    .expect("build native command execution");
    let output = execute_native_ssh_command(&host, execution)
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
async fn native_command_rejects_untrusted_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let credentials = test_credentials(&[("credential:ssh/dev/password", "secret")]);
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_ref = Some("credential:ssh/dev/password".to_owned());

    let execution = build_native_command_execution(
        &host,
        &credentials,
        &paths,
        SshCommandRequest {
            host_id: host.id.clone(),
            command: "printf ready".to_owned(),
            timeout_seconds: Some(5),
            max_output_bytes: Some(1024),
        },
    )
    .expect("build native command execution");

    assert!(matches!(
        execute_native_ssh_command(&host, execution).await,
        Err(AppError::SshCommand(_))
    ));
}

#[test]
fn normalize_command_rejects_empty_and_nul() {
    assert!(matches!(
        normalize_command_script(" \n\t "),
        Err(AppError::InvalidInput(_))
    ));
    assert!(matches!(
        normalize_command_script("echo ok\0"),
        Err(AppError::InvalidInput(_))
    ));
    assert_eq!(
        normalize_command_script("echo one\r\necho two").expect("normalize command"),
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
            timeout_seconds: Some(MAX_TIMEOUT_SECONDS + 100),
            max_output_bytes: Some(1),
        },
    )
    .expect("build clamped plan");

    assert_eq!(plan.timeout_seconds, MAX_TIMEOUT_SECONDS);
    assert_eq!(plan.max_output_bytes, MIN_OUTPUT_BYTES);
}

#[test]
fn read_limited_output_captures_prefix_and_truncation_flag() {
    let output = read_limited_output(Cursor::new("abcdef中文".as_bytes()), 6).expect("read output");

    assert_eq!(output.text, "abcdef");
    assert_eq!(output.captured_bytes, 6);
    assert!(output.truncated);
}

#[test]
fn limited_output_buffer_captures_prefix_and_tracks_truncation() {
    let mut output = LimitedOutputBuffer::new(5);
    output.push(b"abc");
    output.push("def中文".as_bytes());

    let output = output.finish();
    assert_eq!(output.text, "abcde");
    assert_eq!(output.captured_bytes, 5);
    assert!(output.truncated);
}

fn test_credentials(entries: &[(&str, &str)]) -> CredentialService {
    let vault = Arc::new(MemoryCredentialVault::new());
    let credentials = CredentialService::with_vault(vault);
    for (credential_ref, secret) in entries {
        credentials
            .set_secret(credential_ref, secret)
            .expect("store test credential");
    }
    credentials
}
