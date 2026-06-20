//! 真实 OpenSSH password 交互终端 smoke 测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::{
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
        terminal::{SshTerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    paths::KerminalPaths,
    services::{
        credential_service::{CredentialService, MemoryCredentialVault},
        terminal_manager::TerminalManager,
    },
    state::AppState,
};
use russh::{
    keys::{self, PrivateKey, PublicKey},
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId, Pty,
};
use std::{
    collections::HashMap,
    env, fs,
    net::SocketAddr,
    process::Command,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};
use tempfile::{tempdir, TempDir};
use tokio::{net::TcpListener, runtime::Runtime};

const RUN_FLAG: &str = "RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE";
const HOST_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_HOST";
const PORT_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_PORT";
const USER_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_USER";
const PASSWORD_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_PASSWORD";
const KNOWN_HOST_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_KNOWN_HOST_LINE";
const READY_MARKER_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_READY_MARKER";
const EXPECT_AUTH_FAILURE_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_EXPECT_AUTH_FAILURE";
const COMMAND_MARKER: &str = "kerminal-password-command-ok";
const UNICODE_COMMAND_MARKER: &str = "kerminal-unicode-部署-完成";
const LOOPBACK_READY_MARKER: &str = "kerminal-loopback-login-ready";
const LOOPBACK_USER: &str = "deploy";
const LOOPBACK_PASSWORD: &str = "secret";

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
    let (_home, state, credentials, credential_ref) =
        create_loopback_terminal_harness(&server, &config.password);
    let host_id = create_remote_host(&state, &config, credential_ref);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.storage(),
            &credentials,
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
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
        "terminal output must not leak password credential: {output:?}",
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
    let (_home, state, credentials, credential_ref) =
        create_loopback_terminal_harness(&server, &config.password);
    let host_id = create_remote_host(&state, &config, credential_ref);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.storage(),
            &credentials,
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
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
        "terminal output must not leak password credential: {output:?}",
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

    let credentials = CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()));
    let credential_ref = "credential:ssh/smoke/terminal-password";
    credentials
        .set_secret(credential_ref, &config.password)
        .expect("store password smoke credential");
    let host_id = create_remote_host(&state, &config, credential_ref);
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.storage(),
            &credentials,
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id,
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
        "terminal output must not leak password credential: {output:?}",
    );
}

fn open_ssh_client_available() -> bool {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .is_ok()
}

fn create_loopback_terminal_harness(
    server: &LoopbackTerminalServer,
    password: &str,
) -> (TempDir, AppState, CredentialService, &'static str) {
    let home = tempdir().expect("create temp loopback terminal home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize loopback app state");
    fs::create_dir_all(&state.paths().root).expect("create loopback app root");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        state.paths().root.join("known_hosts"),
    )
    .expect("trust loopback SSH host key");

    let credentials = CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()));
    let credential_ref = "credential:ssh/smoke/loopback-terminal-password";
    credentials
        .set_secret(credential_ref, password)
        .expect("store loopback terminal password credential");
    (home, state, credentials, credential_ref)
}

#[derive(Debug)]
struct LoopbackTerminalServer {
    addr: SocketAddr,
    host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
    _runtime: Runtime,
}

impl LoopbackTerminalServer {
    fn start() -> Self {
        let runtime = Runtime::new().expect("create loopback SSH runtime");
        let (addr, host_key, task) = runtime.block_on(async {
            let listener = TcpListener::bind(("127.0.0.1", 0))
                .await
                .expect("bind loopback SSH terminal server");
            let addr = listener
                .local_addr()
                .expect("read loopback SSH terminal address");
            let private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
                .expect("generate loopback SSH host key");
            let host_key = private_key.public_key().clone();
            let config = russh::server::Config {
                auth_rejection_time: Duration::from_millis(0),
                auth_rejection_time_initial: Some(Duration::from_millis(0)),
                keys: vec![private_key],
                maximum_packet_size: 65_535,
                ..Default::default()
            };
            let task = tokio::spawn(async move {
                let mut server = LoopbackInteractiveSshServer;
                let _ = server.run_on_socket(Arc::new(config), &listener).await;
            });
            (addr, host_key, task)
        });

        Self {
            addr,
            host_key,
            task,
            _runtime: runtime,
        }
    }
}

impl Drop for LoopbackTerminalServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Clone)]
struct LoopbackInteractiveSshServer;

struct LoopbackInteractiveSshSession {
    channels: HashMap<ChannelId, Channel<Msg>>,
    line_buffers: HashMap<ChannelId, String>,
}

impl russh::server::Server for LoopbackInteractiveSshServer {
    type Handler = LoopbackInteractiveSshSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackInteractiveSshSession {
            channels: HashMap::new(),
            line_buffers: HashMap::new(),
        }
    }
}

impl russh::server::Handler for LoopbackInteractiveSshSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == LOOPBACK_USER && password == LOOPBACK_PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.channels.insert(channel.id(), channel);
        Ok(true)
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(
            channel,
            format!("{LOOPBACK_READY_MARKER}\r\n$ ").into_bytes(),
        )?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let text = String::from_utf8_lossy(data);
        for character in text.chars() {
            match character {
                '\r' | '\n' => {
                    let line = self.line_buffers.entry(channel).or_default();
                    if line.is_empty() {
                        continue;
                    }
                    let command = std::mem::take(line);
                    self.handle_command(channel, &command, session)?;
                }
                '\u{0008}' | '\u{007f}' => {
                    self.line_buffers.entry(channel).or_default().pop();
                }
                _ if !character.is_control() => {
                    self.line_buffers
                        .entry(channel)
                        .or_default()
                        .push(character);
                }
                _ => {}
            }
        }
        Ok(())
    }
}

impl LoopbackInteractiveSshSession {
    fn handle_command(
        &mut self,
        channel: ChannelId,
        command: &str,
        session: &mut Session,
    ) -> Result<(), russh::Error> {
        let command = command.trim();
        if command == "exit" {
            session.exit_status_request(channel, 0)?;
            session.eof(channel)?;
            session.close(channel)?;
            return Ok(());
        }

        let output = if command.contains(UNICODE_COMMAND_MARKER) {
            UNICODE_COMMAND_MARKER
        } else if command.contains(COMMAND_MARKER) {
            COMMAND_MARKER
        } else {
            "ok"
        };
        session.data(channel, format!("{output}\r\n$ ").into_bytes())?;
        Ok(())
    }
}

#[derive(Debug)]
struct PasswordSmokeConfig {
    host: String,
    port: u16,
    username: String,
    password: String,
    known_host_line: Option<String>,
    ready_marker: Option<String>,
    expect_auth_failure: bool,
}

impl PasswordSmokeConfig {
    fn from_env() -> Result<Option<Self>, String> {
        if env::var(RUN_FLAG).ok().as_deref() != Some("1") {
            return Ok(None);
        }

        let host = required_env(HOST_ENV)?;
        let username = required_env(USER_ENV)?;
        let password = required_env(PASSWORD_ENV)?;
        let port = optional_env(PORT_ENV)
            .map(|value| {
                value
                    .parse::<u16>()
                    .map_err(|error| format!("{PORT_ENV} must be a valid TCP port: {error}"))
            })
            .transpose()?
            .unwrap_or(22);

        Ok(Some(Self {
            host,
            port,
            username,
            password,
            known_host_line: optional_env(KNOWN_HOST_ENV),
            ready_marker: optional_env(READY_MARKER_ENV),
            expect_auth_failure: env::var(EXPECT_AUTH_FAILURE_ENV).ok().as_deref() == Some("1"),
        }))
    }
}

fn required_env(name: &str) -> Result<String, String> {
    optional_env(name).ok_or_else(|| format!("{name} is required"))
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn trust_smoke_host_key(paths: &KerminalPaths, config: &PasswordSmokeConfig) -> Result<(), String> {
    let known_host_line = match config.known_host_line.as_deref() {
        Some(line) => line.to_owned(),
        None => scan_host_key(config)?,
    };
    fs::create_dir_all(&paths.root).map_err(|error| error.to_string())?;
    fs::write(
        paths.root.join("known_hosts"),
        format!("{}\n", known_host_line.trim()),
    )
    .map_err(|error| error.to_string())
}

fn scan_host_key(config: &PasswordSmokeConfig) -> Result<String, String> {
    let output = Command::new("ssh-keyscan")
        .args(["-p", &config.port.to_string(), &config.host])
        .output()
        .map_err(|error| {
            format!(
                "failed to run ssh-keyscan; set {KNOWN_HOST_ENV} with a trusted known_hosts line: {error}"
            )
        })?;
    if !output.status.success() {
        return Err(format!(
            "ssh-keyscan failed; set {KNOWN_HOST_ENV} with a trusted known_hosts line:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let known_host_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .ok_or_else(|| "ssh-keyscan returned no host key lines".to_owned())?;
    Ok(known_host_line)
}

fn create_remote_host(
    state: &AppState,
    config: &PasswordSmokeConfig,
    credential_ref: &str,
) -> String {
    state
        .remote_hosts()
        .create_host(
            state.storage(),
            RemoteHostCreateRequest {
                auth_type: RemoteHostAuthType::Password,
                credential_ref: Some(credential_ref.to_owned()),
                credential_secret: None,
                group_id: None,
                host: config.host.clone(),
                name: "OpenSSH password smoke".to_owned(),
                port: config.port,
                production: false,
                ssh_options: Default::default(),
                tags: vec!["smoke".to_owned()],
                username: config.username.clone(),
            },
        )
        .expect("create password smoke remote host")
        .id
}

fn run_smoke_terminal_flow(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    config: &PasswordSmokeConfig,
) -> Result<String, String> {
    let mut received = String::new();
    if let Some(ready_marker) = config.ready_marker.as_deref() {
        received = collect_until_output(
            terminals,
            session_id,
            receiver,
            ready_marker,
            received,
            Duration::from_secs(20),
        )?;
    } else {
        received = collect_any_data(
            terminals,
            session_id,
            receiver,
            received,
            Duration::from_secs(5),
        )?;
        std::thread::sleep(Duration::from_millis(1000));
    }

    terminals
        .write(session_id, &format!("echo {COMMAND_MARKER}\r"))
        .map_err(|error| error.to_string())?;
    let received = collect_until_output(
        terminals,
        session_id,
        receiver,
        COMMAND_MARKER,
        received,
        Duration::from_secs(10),
    )?;

    terminals
        .write(
            session_id,
            &format!("printf '{UNICODE_COMMAND_MARKER}\\n'\r"),
        )
        .map_err(|error| error.to_string())?;
    collect_until_output(
        terminals,
        session_id,
        receiver,
        UNICODE_COMMAND_MARKER,
        received,
        Duration::from_secs(10),
    )
}

fn run_expected_auth_failure_flow(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    config: &PasswordSmokeConfig,
) -> Result<String, String> {
    let mut received = collect_until_auth_failure_feedback(
        terminals,
        session_id,
        receiver,
        String::new(),
        Duration::from_secs(15),
    )?;
    received.push_str(&collect_additional_output_for(
        terminals,
        session_id,
        receiver,
        Duration::from_millis(1200),
    )?);
    if let Some(ready_marker) = config.ready_marker.as_deref() {
        if received.contains(ready_marker) {
            return Err(format!(
                "wrong password unexpectedly reached ready marker {ready_marker:?}: {received:?}"
            ));
        }
    }
    Ok(received)
}

fn collect_any_data(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            if !received.is_empty() {
                return Ok(received);
            }
        }
    }
    Err("timed out waiting for any SSH terminal output".to_owned())
}

fn collect_until_auth_failure_feedback(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
        }
        if auth_failure_feedback_seen(&received) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected SSH terminal output to contain authentication failure feedback, got: {received:?}"
    ))
}

fn collect_additional_output_for(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    duration: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + duration;
    let mut received = String::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
        }
    }
    Ok(received)
}

fn auth_failure_feedback_seen(output: &str) -> bool {
    let output = output.to_ascii_lowercase();
    output.contains("permission denied")
        || output.contains("authentication failed")
        || output.contains("try again")
        || output.contains("access denied")
}

fn collect_until_output(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
        }
        if received.contains(expected) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected SSH terminal output to contain {expected:?}, got: {received:?}"
    ))
}

fn handle_terminal_data(
    terminals: &TerminalManager,
    session_id: &str,
    data: &str,
    received: &mut String,
) -> Result<(), String> {
    received.push_str(data);
    if data.contains("\u{1b}[6n") {
        terminals
            .write(session_id, "\u{1b}[1;1R")
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
