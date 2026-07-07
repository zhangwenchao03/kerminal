//! Managed SSH exec request and output types.
//!
//! @author kongweiguang

use std::{fmt, time::Duration};

use tokio_util::sync::CancellationToken;

use crate::error::AppResult;

use super::{SshRuntimeStreamingExecReader, SshRuntimeStreamingExecWriter};

/// Request for a non-interactive exec channel on an authenticated session.
#[derive(Clone, Debug)]
pub struct SshRuntimeExecRequest {
    pub cancel_token: CancellationToken,
    pub max_output_bytes: usize,
    pub script: String,
    pub timeout_seconds: u64,
}

impl SshRuntimeExecRequest {
    pub fn new(script: String, timeout_seconds: u64, max_output_bytes: usize) -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            max_output_bytes,
            script,
            timeout_seconds,
        }
    }

    pub fn with_cancel_token(mut self, cancel_token: CancellationToken) -> Self {
        self.cancel_token = cancel_token;
        self
    }
}

/// Request for a long-running exec channel that streams stdin/stdout/stderr.
#[derive(Clone, Debug)]
pub struct SshRuntimeStreamingExecRequest {
    pub cancel_token: CancellationToken,
    pub command: String,
    pub timeout_seconds: u64,
}

impl SshRuntimeStreamingExecRequest {
    pub fn new(command: String, timeout_seconds: u64) -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            command,
            timeout_seconds,
        }
    }

    pub fn with_cancel_token(mut self, cancel_token: CancellationToken) -> Self {
        self.cancel_token = cancel_token;
        self
    }
}

/// Exit result for a streaming exec channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeStreamingExecExit {
    pub exit_code: Option<i32>,
}

/// Runtime-owned streaming exec channel.
pub trait SshRuntimeStreamingExecSession: Send + fmt::Debug {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>>;

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>>;

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>>;

    fn close_stdin(&mut self) -> AppResult<()>;

    fn wait(&mut self, timeout: Duration) -> AppResult<SshRuntimeStreamingExecExit>;

    fn kill(&mut self) -> AppResult<()>;
}

/// Raw exec output returned by a backend before the manager applies output limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeExecRawOutput {
    pub exit_code: Option<i32>,
    pub stderr: Vec<u8>,
    pub stdout: Vec<u8>,
}

/// Bounded exec output safe for diagnostics and command callers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeExecOutput {
    pub duration_ms: u128,
    pub exit_code: Option<i32>,
    pub max_output_bytes: usize,
    pub stderr: String,
    pub stderr_bytes: usize,
    pub stderr_truncated: bool,
    pub stdout: String,
    pub stdout_bytes: usize,
    pub stdout_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LimitedExecOutput {
    captured_bytes: usize,
    text: String,
    truncated: bool,
}

impl SshRuntimeExecOutput {
    pub(super) fn from_raw(
        raw: SshRuntimeExecRawOutput,
        max_output_bytes: usize,
        duration_ms: u128,
    ) -> Self {
        let stdout = limit_exec_output(raw.stdout, max_output_bytes);
        let stderr = limit_exec_output(raw.stderr, max_output_bytes);
        Self {
            duration_ms,
            exit_code: raw.exit_code,
            max_output_bytes,
            stderr: stderr.text,
            stderr_bytes: stderr.captured_bytes,
            stderr_truncated: stderr.truncated,
            stdout: stdout.text,
            stdout_bytes: stdout.captured_bytes,
            stdout_truncated: stdout.truncated,
        }
    }
}

fn limit_exec_output(bytes: Vec<u8>, max_bytes: usize) -> LimitedExecOutput {
    let visible = bytes.len().min(max_bytes);
    LimitedExecOutput {
        captured_bytes: visible,
        text: String::from_utf8_lossy(&bytes[..visible]).into_owned(),
        truncated: bytes.len() > visible,
    }
}
