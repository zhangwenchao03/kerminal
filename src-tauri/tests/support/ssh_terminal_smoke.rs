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

include!("ssh_terminal_smoke/runtime.rs");
include!("ssh_terminal_smoke/loopback_server.rs");
include!("ssh_terminal_smoke/flows.rs");
