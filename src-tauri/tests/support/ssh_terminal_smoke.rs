#![allow(dead_code)]

use kerminal_lib::{
    models::{
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest, SshJumpHostOptions},
        terminal::{
            SshTerminalCreateRequest, TerminalAgentSignalSummary, TerminalOutputEvent,
            TerminalOutputKind,
        },
    },
    paths::KerminalPaths,
    services::terminal_manager::TerminalManager,
    state::AppState,
};
use russh::{
    keys::{self, PrivateKey, PublicKey},
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId, Pty,
};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    net::SocketAddr,
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tempfile::{tempdir, TempDir};
use tokio::{net::TcpListener, runtime::Runtime};

pub const RUN_FLAG: &str = "RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE";
pub const HOST_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_HOST";
const PORT_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_PORT";
pub const USER_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_USER";
pub const PASSWORD_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_PASSWORD";
const KNOWN_HOST_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_KNOWN_HOST_LINE";
const READY_MARKER_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_READY_MARKER";
const EXPECT_AUTH_FAILURE_ENV: &str = "KERMINAL_SSH_TERMINAL_SMOKE_EXPECT_AUTH_FAILURE";
pub const COMMAND_MARKER: &str = "kerminal-password-command-ok";
pub const UNICODE_COMMAND_MARKER: &str = "kerminal-unicode-部署-完成";
const LOOPBACK_UNICODE_REQUEST_MARKER: &str = "kerminal-loopback-unicode-request";
pub const LOOPBACK_READY_MARKER: &str = "kerminal-loopback-login-ready";
pub const LOOPBACK_USER: &str = "deploy";
pub const LOOPBACK_PASSWORD: &str = "secret";
pub const LOOPBACK_INTERRUPT_COMMAND: &str = "kerminal-loopback-wait-for-interrupt";
pub const LOOPBACK_INTERRUPT_MARKER: &str = "kerminal-loopback-interrupt-ok";
pub const LOOPBACK_HIGH_OUTPUT_COMMAND: &str = "kerminal-loopback-high-output";
pub const LOOPBACK_HIGH_OUTPUT_START: &str = "kerminal-loopback-high-output-start";
pub const LOOPBACK_HIGH_OUTPUT_END: &str = "kerminal-loopback-high-output-end";
pub const LOOPBACK_HIGH_OUTPUT_LINE: &str = "kerminal-loopback-high-output-line";
pub const LOOPBACK_HIGH_OUTPUT_LINES: usize = 256;
pub const LOOPBACK_TUI_COMMAND: &str = "kerminal-loopback-tui";
pub const LOOPBACK_TUI_MARKER: &str = "kerminal-loopback-tui-rendered";
pub const LOOPBACK_AGENT_SIGNAL_COMMAND: &str = "kerminal-loopback-agent-signal";
pub const LOOPBACK_AGENT_SIGNAL_VISIBLE_MARKER: &str = "kerminal-loopback-agent-visible";
pub const LOOPBACK_AGENT_OSC_MARKER: &str = "\u{1b}]777;notify;Kerminal;codex;working\u{7}";
const LOOPBACK_JUMP_USER: &str = "jump";
pub const LOOPBACK_JUMP_PASSWORD: &str = "jump-secret";

pub fn connect_and_capture_loopback_output(
    state: &AppState,
    host_id: &str,
    config: &PasswordSmokeConfig,
) -> Result<String, String> {
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: host_id.to_owned(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .map_err(|error| error.to_string())?;

    let result = run_smoke_terminal_flow(state.terminals(), &summary.id, &receiver, config);
    let close_result = state
        .terminals()
        .close(&summary.id)
        .map_err(|error| error.to_string());
    let idle_result = wait_for_managed_runtime_idle(state, Duration::from_secs(5));

    match (result, close_result, idle_result) {
        (Err(error), _, _) => Err(error),
        (Ok(_), Err(error), _) => Err(error),
        (Ok(_), Ok(()), Err(error)) => Err(error),
        (Ok(output), Ok(()), Ok(())) => Ok(output),
    }
}

fn wait_for_managed_runtime_idle(state: &AppState, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshot = state
            .ssh_runtime()
            .snapshot()
            .map_err(|error| error.to_string())?;
        if snapshot.active_channels == 0 {
            state
                .ssh_runtime()
                .close_idle_sessions()
                .map_err(|error| error.to_string())?;
            thread::sleep(Duration::from_millis(150));
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "managed SSH runtime still has {} active channel(s) after close",
                snapshot.active_channels
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn open_ssh_client_available() -> bool {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .is_ok()
}

pub fn create_loopback_terminal_harness(server: &LoopbackTerminalServer) -> (TempDir, AppState) {
    let home = tempdir().expect("create temp loopback terminal home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize loopback app state");
    fs::create_dir_all(&state.paths().root).expect("create loopback app root");
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
    )
    .expect("trust loopback SSH host key");

    (home, state)
}

pub fn trust_loopback_host_key(
    paths: &KerminalPaths,
    host: &str,
    port: u16,
    host_key: &PublicKey,
) -> Result<(), keys::Error> {
    keys::known_hosts::learn_known_hosts_path(host, port, host_key, paths.root.join("known_hosts"))
}

#[derive(Debug)]
pub struct LoopbackTerminalServer {
    pub addr: SocketAddr,
    pub host_key: PublicKey,
    task: tokio::task::JoinHandle<()>,
    _runtime: Runtime,
}

impl LoopbackTerminalServer {
    pub fn start() -> Self {
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

#[derive(Debug)]
pub struct LoopbackTerminalJumpServer {
    pub addr: SocketAddr,
    pub host_key: PublicKey,
    pub auth_attempts: Arc<AtomicUsize>,
    pub direct_tcpip_requests: Arc<AtomicUsize>,
    pub forwarded_tcpip_requests: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
    _runtime: Runtime,
}

impl LoopbackTerminalJumpServer {
    pub fn start(target_addr: SocketAddr) -> Self {
        Self::start_with_private_key_on_port(target_addr, 0, Self::generate_host_key())
    }

    pub fn generate_host_key() -> PrivateKey {
        PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
            .expect("generate loopback SSH jump host key")
    }

    pub fn start_with_private_key_on_port(
        target_addr: SocketAddr,
        bind_port: u16,
        private_key: PrivateKey,
    ) -> Self {
        let runtime = Runtime::new().expect("create loopback SSH jump runtime");
        let (addr, host_key, auth_attempts, direct_tcpip_requests, forwarded_tcpip_requests, task) =
            runtime.block_on(async {
                let listener = TcpListener::bind(("127.0.0.1", bind_port))
                    .await
                    .expect("bind loopback SSH jump server");
                let addr = listener
                    .local_addr()
                    .expect("read loopback SSH jump address");
                let host_key = private_key.public_key().clone();
                let auth_attempts = Arc::new(AtomicUsize::new(0));
                let direct_tcpip_requests = Arc::new(AtomicUsize::new(0));
                let forwarded_tcpip_requests = Arc::new(AtomicUsize::new(0));
                let config = russh::server::Config {
                    auth_rejection_time: Duration::from_millis(0),
                    auth_rejection_time_initial: Some(Duration::from_millis(0)),
                    keys: vec![private_key],
                    maximum_packet_size: 65_535,
                    ..Default::default()
                };
                let auths = Arc::clone(&auth_attempts);
                let requests = Arc::clone(&direct_tcpip_requests);
                let forwarded_requests = Arc::clone(&forwarded_tcpip_requests);
                let task = tokio::spawn(async move {
                    let mut server = LoopbackTerminalJumpServerState {
                        auth_attempts: auths,
                        direct_tcpip_requests: requests,
                        forwarded_tcpip_requests: forwarded_requests,
                        target_addr,
                    };
                    let _ = server.run_on_socket(Arc::new(config), &listener).await;
                });
                (
                    addr,
                    host_key,
                    auth_attempts,
                    direct_tcpip_requests,
                    forwarded_tcpip_requests,
                    task,
                )
            });

        Self {
            addr,
            host_key,
            auth_attempts,
            direct_tcpip_requests,
            forwarded_tcpip_requests,
            task,
            _runtime: runtime,
        }
    }
}

impl Drop for LoopbackTerminalJumpServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct LoopbackTerminalJumpServerState {
    auth_attempts: Arc<AtomicUsize>,
    direct_tcpip_requests: Arc<AtomicUsize>,
    forwarded_tcpip_requests: Arc<AtomicUsize>,
    target_addr: SocketAddr,
}

struct LoopbackTerminalJumpSession {
    auth_attempts: Arc<AtomicUsize>,
    direct_tcpip_requests: Arc<AtomicUsize>,
    forwarded_tcpip_requests: Arc<AtomicUsize>,
    remote_forward_shutdowns: HashMap<(String, u32), tokio::sync::oneshot::Sender<()>>,
    target_addr: SocketAddr,
}

impl russh::server::Server for LoopbackTerminalJumpServerState {
    type Handler = LoopbackTerminalJumpSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackTerminalJumpSession {
            auth_attempts: Arc::clone(&self.auth_attempts),
            direct_tcpip_requests: Arc::clone(&self.direct_tcpip_requests),
            forwarded_tcpip_requests: Arc::clone(&self.forwarded_tcpip_requests),
            remote_forward_shutdowns: HashMap::new(),
            target_addr: self.target_addr,
        }
    }
}

impl russh::server::Handler for LoopbackTerminalJumpSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        self.auth_attempts.fetch_add(1, Ordering::SeqCst);
        if user == LOOPBACK_JUMP_USER && password == LOOPBACK_JUMP_PASSWORD {
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
                let _ =
                    tokio::io::copy_bidirectional(&mut channel_stream, &mut target_stream).await;
            }
        });

        Ok(true)
    }

    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        session: &mut Session,
    ) -> Result<bool, Self::Error> {
        let listener = match TcpListener::bind((address, *port as u16)).await {
            Ok(listener) => listener,
            Err(_) => return Ok(false),
        };
        let local_addr = match listener.local_addr() {
            Ok(addr) => addr,
            Err(_) => return Ok(false),
        };
        if *port == 0 {
            *port = u32::from(local_addr.port());
        }

        let bind_address = address.to_owned();
        let bind_port = *port;
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
        let handle = session.handle();
        let forwarded_requests = Arc::clone(&self.forwarded_tcpip_requests);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        return;
                    }
                    accepted = listener.accept() => {
                        let Ok((mut inbound, peer_addr)) = accepted else {
                            return;
                        };
                        let handle = handle.clone();
                        let bind_address = bind_address.clone();
                        let forwarded_requests = Arc::clone(&forwarded_requests);
                        tokio::spawn(async move {
                            if let Ok(channel) = handle
                                .channel_open_forwarded_tcpip(
                                    bind_address,
                                    bind_port,
                                    peer_addr.ip().to_string(),
                                    u32::from(peer_addr.port()),
                                )
                                .await
                            {
                                forwarded_requests.fetch_add(1, Ordering::SeqCst);
                                let mut channel_stream = channel.into_stream();
                                let _ = tokio::io::copy_bidirectional(
                                    &mut inbound,
                                    &mut channel_stream,
                                )
                                .await;
                            }
                        });
                    }
                }
            }
        });

        self.remote_forward_shutdowns
            .insert((address.to_owned(), *port), shutdown_tx);
        Ok(true)
    }

    async fn cancel_tcpip_forward(
        &mut self,
        address: &str,
        port: u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        if let Some(shutdown) = self
            .remote_forward_shutdowns
            .remove(&(address.to_owned(), port))
        {
            let _ = shutdown.send(());
            return Ok(true);
        }
        Ok(false)
    }
}

#[derive(Clone)]
struct LoopbackInteractiveSshServer;

struct LoopbackInteractiveSshSession {
    channels: HashMap<ChannelId, Channel<Msg>>,
    escape_sequence_channels: HashSet<ChannelId>,
    interrupt_wait_channels: HashSet<ChannelId>,
    line_buffers: HashMap<ChannelId, String>,
}

impl russh::server::Server for LoopbackInteractiveSshServer {
    type Handler = LoopbackInteractiveSshSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackInteractiveSshSession {
            channels: HashMap::new(),
            escape_sequence_channels: HashSet::new(),
            interrupt_wait_channels: HashSet::new(),
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
            if self.consume_escape_sequence_character(channel, character) {
                continue;
            }
            match character {
                '\u{0003}' => {
                    self.line_buffers.entry(channel).or_default().clear();
                    let output = if self.interrupt_wait_channels.remove(&channel) {
                        format!("^C\r\n{LOOPBACK_INTERRUPT_MARKER}\r\n$ ")
                    } else {
                        "^C\r\n$ ".to_owned()
                    };
                    session.data(channel, output.into_bytes())?;
                }
                '\u{0004}' => {
                    self.line_buffers.entry(channel).or_default().clear();
                    self.interrupt_wait_channels.remove(&channel);
                    session.exit_status_request(channel, 0)?;
                    session.eof(channel)?;
                    session.close(channel)?;
                }
                '\u{001b}' => {
                    self.escape_sequence_channels.insert(channel);
                }
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
    fn consume_escape_sequence_character(&mut self, channel: ChannelId, character: char) -> bool {
        if !self.escape_sequence_channels.contains(&channel) {
            return false;
        }
        if character.is_ascii_alphabetic() || character == '~' {
            self.escape_sequence_channels.remove(&channel);
        }
        true
    }

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
        if command.contains(LOOPBACK_INTERRUPT_COMMAND) {
            self.interrupt_wait_channels.insert(channel);
            session.data(channel, b"interrupt-armed\r\n".to_vec())?;
            return Ok(());
        }
        if command.contains(LOOPBACK_HIGH_OUTPUT_COMMAND) {
            let filler = "0123456789abcdef".repeat(32);
            session.data(
                channel,
                format!("{LOOPBACK_HIGH_OUTPUT_START}\r\n").into_bytes(),
            )?;
            for index in 0..LOOPBACK_HIGH_OUTPUT_LINES {
                session.data(
                    channel,
                    format!("{LOOPBACK_HIGH_OUTPUT_LINE}-{index:03}-{filler}\r\n").into_bytes(),
                )?;
            }
            session.data(
                channel,
                format!("{LOOPBACK_HIGH_OUTPUT_END}\r\n$ ").into_bytes(),
            )?;
            return Ok(());
        }
        if command.contains(LOOPBACK_TUI_COMMAND) {
            session.data(
                channel,
                format!("\u{1b}[?1049h\u{1b}[2J{LOOPBACK_TUI_MARKER}\r\n\u{1b}[?1049l$ ")
                    .into_bytes(),
            )?;
            return Ok(());
        }
        if command.contains(LOOPBACK_AGENT_SIGNAL_COMMAND) {
            session.data(
                channel,
                format!("{LOOPBACK_AGENT_OSC_MARKER}{LOOPBACK_AGENT_SIGNAL_VISIBLE_MARKER}\r\n$ ")
                    .into_bytes(),
            )?;
            return Ok(());
        }

        let mut output = Vec::new();
        if command.contains(COMMAND_MARKER) {
            output.push(COMMAND_MARKER);
        }
        let unicode_marker_escape = posix_printf_octal_escape(UNICODE_COMMAND_MARKER);
        if command.contains(UNICODE_COMMAND_MARKER)
            || command.contains(&unicode_marker_escape)
            || command.contains(LOOPBACK_UNICODE_REQUEST_MARKER)
        {
            output.push(UNICODE_COMMAND_MARKER);
        }
        let output = if output.is_empty() {
            "ok".to_owned()
        } else {
            output.join("\r\n")
        };
        session.data(channel, format!("{output}\r\n$ ").into_bytes())?;
        Ok(())
    }
}

#[derive(Debug)]
pub struct PasswordSmokeConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub known_host_line: Option<String>,
    pub ready_marker: Option<String>,
    pub expect_auth_failure: bool,
}

impl PasswordSmokeConfig {
    pub fn from_env() -> Result<Option<Self>, String> {
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

pub fn trust_smoke_host_key(
    paths: &KerminalPaths,
    config: &PasswordSmokeConfig,
) -> Result<(), String> {
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

pub fn create_remote_host(state: &AppState, config: &PasswordSmokeConfig) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(config.password.clone()),
            group_id: None,
            host: config.host.clone(),
            name: "OpenSSH password smoke".to_owned(),
            port: config.port,
            production: false,
            ssh_options: Default::default(),
            tags: vec!["smoke".to_owned()],
            username: config.username.clone(),
        })
        .expect("create password smoke remote host")
        .id
}

pub fn create_remote_host_with_password_jump(
    state: &AppState,
    config: &PasswordSmokeConfig,
    jump: &LoopbackTerminalJumpServer,
) -> String {
    let mut request = RemoteHostCreateRequest {
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        credential_secret: Some(config.password.clone()),
        group_id: None,
        host: config.host.clone(),
        name: "OpenSSH password jump smoke".to_owned(),
        port: config.port,
        production: false,
        ssh_options: Default::default(),
        tags: vec!["smoke".to_owned(), "jump".to_owned()],
        username: config.username.clone(),
    };
    request.ssh_options.jump_hosts.push(SshJumpHostOptions {
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
        credential_status: Default::default(),
        host: "127.0.0.1".to_owned(),
        name: "Loopback jump".to_owned(),
        port: jump.addr.port(),
        username: LOOPBACK_JUMP_USER.to_owned(),
    });

    state
        .remote_hosts()
        .create_host(request)
        .expect("create password jump smoke remote host")
        .id
}

pub fn run_smoke_terminal_flow(
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

    let smoke_command = if config.ready_marker.as_deref() == Some(LOOPBACK_READY_MARKER) {
        format!("echo {COMMAND_MARKER} {LOOPBACK_UNICODE_REQUEST_MARKER}\r")
    } else {
        let unicode_marker_escape = posix_printf_octal_escape(UNICODE_COMMAND_MARKER);
        format!("printf '%s\\n{unicode_marker_escape}\\n' '{COMMAND_MARKER}'\r")
    };
    terminals
        .write(session_id, &smoke_command)
        .map_err(|error| error.to_string())?;
    let received = collect_until_output(
        terminals,
        session_id,
        receiver,
        COMMAND_MARKER,
        received,
        Duration::from_secs(10),
    )?;

    collect_until_output(
        terminals,
        session_id,
        receiver,
        UNICODE_COMMAND_MARKER,
        received,
        Duration::from_secs(10),
    )
}

pub fn run_expected_auth_failure_flow(
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

fn posix_printf_octal_escape(text: &str) -> String {
    text.as_bytes()
        .iter()
        .map(|byte| format!("\\{byte:03o}"))
        .collect()
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

pub fn collect_additional_output_for(
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
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while collecting output: {}",
                    event.data
                ));
            }
            _ => {}
        }
    }
    Ok(received)
}

pub fn auth_failure_feedback_seen(output: &str) -> bool {
    let output = output.to_ascii_lowercase();
    output.contains("permission denied")
        || output.contains("authentication failed")
        || output.contains("认证失败")
        || output.contains("try again")
        || output.contains("access denied")
}

pub fn collect_until_output(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    if received.contains(expected) {
        return Ok(received);
    }

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for {expected:?}: {}",
                    event.data
                ));
            }
            _ => {}
        }
        if received.contains(expected) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected SSH terminal output to contain {expected:?}, got: {received:?}"
    ))
}

pub fn collect_until_closed(
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
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::Closed => return Ok(received),
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for close: {}",
                    event.data
                ));
            }
            TerminalOutputKind::AgentSignal => {}
        }
    }

    Err(format!(
        "expected SSH terminal to close, got output so far: {received:?}"
    ))
}

pub fn collect_until_agent_signal(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<(String, TerminalAgentSignalSummary), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::AgentSignal => {
                let Some(signal) = event.agent_signal else {
                    return Err("agent signal event did not include a signal summary".to_owned());
                };
                return Ok((received, signal));
            }
            TerminalOutputKind::Closed => {
                return Err(format!(
                    "terminal closed before agent signal, got output: {received:?}"
                ));
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for agent signal: {}",
                    event.data
                ));
            }
        }
    }

    Err(format!(
        "expected SSH terminal agent signal, got output so far: {received:?}"
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
