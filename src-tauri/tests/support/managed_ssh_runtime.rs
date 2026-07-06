//! Managed SSH runtime test backend helpers.
//!
//! @author kongweiguang

#![allow(dead_code)]

use async_trait::async_trait;
use kerminal_lib::{
    error::AppResult,
    services::{
        ssh_command_service::SshCommandService,
        ssh_runtime::{
            ManagedSshSessionManager, SshChannelKind, SshRuntimeBackend, SshRuntimeConnectRequest,
            SshRuntimeConnection, SshRuntimeDynamicForwardRequest, SshRuntimeExecRawOutput,
            SshRuntimeExecRequest, SshRuntimeForwardTask, SshRuntimeLocalForwardRequest,
            SshRuntimeRemoteDynamicForwardRequest, SshRuntimeRemoteForwardRequest,
            SshRuntimeStreamingExecExit, SshRuntimeStreamingExecReader,
            SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
            SshRuntimeStreamingExecWriter, SshSessionKey,
        },
    },
    state::AppState,
};
use std::{
    io::{Cursor, Write},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

#[derive(Debug, Clone)]
pub struct FakeManagedExecOutput {
    pub exit_code: Option<i32>,
    pub stderr: String,
    pub stdout: String,
}

impl FakeManagedExecOutput {
    pub fn success(stdout: impl Into<String>) -> Self {
        Self {
            exit_code: Some(0),
            stderr: String::new(),
            stdout: stdout.into(),
        }
    }
}

impl Default for FakeManagedExecOutput {
    fn default() -> Self {
        Self::success("")
    }
}

#[derive(Default)]
pub struct FakeManagedSshRuntime {
    state: Arc<FakeManagedSshRuntimeState>,
}

#[derive(Default)]
struct FakeManagedSshRuntimeState {
    channels: AtomicUsize,
    connects: AtomicUsize,
    disconnects: AtomicUsize,
    dynamic_forwards: AtomicUsize,
    execs: AtomicUsize,
    local_forwards: AtomicUsize,
    remote_dynamic_forwards: AtomicUsize,
    remote_forwards: AtomicUsize,
    streaming_execs: AtomicUsize,
    last_channel_kind: Mutex<Option<SshChannelKind>>,
    last_dynamic_forward_request: Mutex<Option<SshRuntimeDynamicForwardRequest>>,
    last_exec_script: Mutex<Option<String>>,
    last_local_forward_request: Mutex<Option<SshRuntimeLocalForwardRequest>>,
    last_remote_forward_request: Mutex<Option<SshRuntimeRemoteForwardRequest>>,
    last_remote_dynamic_forward_request: Mutex<Option<SshRuntimeRemoteDynamicForwardRequest>>,
    last_streaming_exec_command: Mutex<Option<String>>,
    last_key: Mutex<Option<SshSessionKey>>,
    output: Mutex<FakeManagedExecOutput>,
    streaming_exit_code: Mutex<Option<i32>>,
    streaming_stderr: Mutex<Vec<u8>>,
    streaming_stdin: Mutex<Vec<u8>>,
    streaming_stdout: Mutex<Vec<u8>>,
}

impl FakeManagedSshRuntime {
    pub fn with_stdout(stdout: impl Into<String>) -> Self {
        let backend = Self::default();
        backend.set_output(FakeManagedExecOutput::success(stdout));
        backend
    }

    pub fn set_output(&self, output: FakeManagedExecOutput) {
        *self.state.output.lock().expect("fake managed output") = output;
    }

    pub fn set_streaming_output(&self, stdout: Vec<u8>, stderr: Vec<u8>, exit_code: Option<i32>) {
        *self
            .state
            .streaming_stdout
            .lock()
            .expect("streaming stdout") = stdout;
        *self
            .state
            .streaming_stderr
            .lock()
            .expect("streaming stderr") = stderr;
        *self
            .state
            .streaming_exit_code
            .lock()
            .expect("streaming exit") = exit_code;
    }

    pub fn channel_count(&self) -> usize {
        self.state.channels.load(Ordering::SeqCst)
    }

    pub fn connect_count(&self) -> usize {
        self.state.connects.load(Ordering::SeqCst)
    }

    pub fn exec_count(&self) -> usize {
        self.state.execs.load(Ordering::SeqCst)
    }

    pub fn dynamic_forward_count(&self) -> usize {
        self.state.dynamic_forwards.load(Ordering::SeqCst)
    }

    pub fn local_forward_count(&self) -> usize {
        self.state.local_forwards.load(Ordering::SeqCst)
    }

    pub fn remote_forward_count(&self) -> usize {
        self.state.remote_forwards.load(Ordering::SeqCst)
    }

    pub fn remote_dynamic_forward_count(&self) -> usize {
        self.state.remote_dynamic_forwards.load(Ordering::SeqCst)
    }

    pub fn streaming_exec_count(&self) -> usize {
        self.state.streaming_execs.load(Ordering::SeqCst)
    }

    pub fn last_channel_kind(&self) -> Option<SshChannelKind> {
        *self
            .state
            .last_channel_kind
            .lock()
            .expect("last channel kind")
    }

    pub fn last_exec_script(&self) -> Option<String> {
        self.state
            .last_exec_script
            .lock()
            .expect("last exec script")
            .clone()
    }

    pub fn last_streaming_exec_command(&self) -> Option<String> {
        self.state
            .last_streaming_exec_command
            .lock()
            .expect("last streaming exec command")
            .clone()
    }

    pub fn last_streaming_stdin(&self) -> Vec<u8> {
        self.state
            .streaming_stdin
            .lock()
            .expect("streaming stdin")
            .clone()
    }

    pub fn last_dynamic_forward_request(&self) -> Option<SshRuntimeDynamicForwardRequest> {
        self.state
            .last_dynamic_forward_request
            .lock()
            .expect("last dynamic forward request")
            .clone()
    }

    pub fn last_local_forward_request(&self) -> Option<SshRuntimeLocalForwardRequest> {
        self.state
            .last_local_forward_request
            .lock()
            .expect("last local forward request")
            .clone()
    }

    pub fn last_remote_forward_request(&self) -> Option<SshRuntimeRemoteForwardRequest> {
        self.state
            .last_remote_forward_request
            .lock()
            .expect("last remote forward request")
            .clone()
    }

    pub fn last_remote_dynamic_forward_request(
        &self,
    ) -> Option<SshRuntimeRemoteDynamicForwardRequest> {
        self.state
            .last_remote_dynamic_forward_request
            .lock()
            .expect("last remote dynamic forward request")
            .clone()
    }

    pub fn last_key(&self) -> Option<SshSessionKey> {
        self.state.last_key.lock().expect("last key").clone()
    }
}

pub fn ssh_command_service_with_fake_runtime(
    state: &AppState,
    backend: Arc<FakeManagedSshRuntime>,
) -> SshCommandService {
    SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(backend),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    )
}

impl SshRuntimeBackend for FakeManagedSshRuntime {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        self.state.connects.fetch_add(1, Ordering::SeqCst);
        *self.state.last_key.lock().expect("last key") = Some(request.key().clone());
        Ok(Arc::new(FakeManagedSshConnection {
            state: Arc::clone(&self.state),
        }))
    }
}

struct FakeManagedSshConnection {
    state: Arc<FakeManagedSshRuntimeState>,
}

#[async_trait]
impl SshRuntimeConnection for FakeManagedSshConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        self.state.channels.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_channel_kind
            .lock()
            .expect("last channel kind") = Some(kind);
        Ok(format!("fake-managed-{}", kind.as_str()))
    }

    fn supports_exec(&self) -> bool {
        true
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
        let output = self
            .state
            .output
            .lock()
            .expect("fake managed output")
            .clone();
        Ok(SshRuntimeExecRawOutput {
            exit_code: output.exit_code,
            stderr: output.stderr.into_bytes(),
            stdout: output.stdout.into_bytes(),
        })
    }

    fn supports_streaming_exec(&self) -> bool {
        true
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
        Ok(Box::new(FakeStreamingExecSession {
            exit_code: *self
                .state
                .streaming_exit_code
                .lock()
                .expect("streaming exit"),
            state: Arc::clone(&self.state),
            stderr: Some(Cursor::new(
                self.state
                    .streaming_stderr
                    .lock()
                    .expect("streaming stderr")
                    .clone(),
            )),
            stdin_taken: false,
            stdout: Some(Cursor::new(
                self.state
                    .streaming_stdout
                    .lock()
                    .expect("streaming stdout")
                    .clone(),
            )),
        }))
    }

    fn supports_local_forward(&self) -> bool {
        true
    }

    fn start_local_forward(
        &self,
        request: SshRuntimeLocalForwardRequest,
    ) -> kerminal_lib::error::AppResult<Box<dyn SshRuntimeForwardTask>> {
        self.state.local_forwards.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_local_forward_request
            .lock()
            .expect("last local forward request") = Some(request);
        Ok(Box::new(FakeManagedForwardTask::default()))
    }

    fn supports_dynamic_forward(&self) -> bool {
        true
    }

    fn start_dynamic_forward(
        &self,
        request: SshRuntimeDynamicForwardRequest,
    ) -> kerminal_lib::error::AppResult<Box<dyn SshRuntimeForwardTask>> {
        self.state.dynamic_forwards.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_dynamic_forward_request
            .lock()
            .expect("last dynamic forward request") = Some(request);
        Ok(Box::new(FakeManagedForwardTask::default()))
    }

    fn supports_remote_forward(&self) -> bool {
        true
    }

    fn start_remote_forward(
        &self,
        request: SshRuntimeRemoteForwardRequest,
    ) -> kerminal_lib::error::AppResult<Box<dyn SshRuntimeForwardTask>> {
        self.state.remote_forwards.fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_remote_forward_request
            .lock()
            .expect("last remote forward request") = Some(request);
        Ok(Box::new(FakeManagedForwardTask::default()))
    }

    fn supports_remote_dynamic_forward(&self) -> bool {
        true
    }

    fn start_remote_dynamic_forward(
        &self,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> kerminal_lib::error::AppResult<Box<dyn SshRuntimeForwardTask>> {
        self.state
            .remote_dynamic_forwards
            .fetch_add(1, Ordering::SeqCst);
        *self
            .state
            .last_remote_dynamic_forward_request
            .lock()
            .expect("last remote dynamic forward request") = Some(request);
        Ok(Box::new(FakeManagedForwardTask::default()))
    }

    fn disconnect(&self, _reason: &str) {
        self.state.disconnects.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeStreamingExecSession {
    exit_code: Option<i32>,
    state: Arc<FakeManagedSshRuntimeState>,
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
            return Err(kerminal_lib::error::AppError::SshCommand(
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
            .ok_or_else(|| {
                kerminal_lib::error::AppError::SshCommand(
                    "fake streaming stdout already taken".to_owned(),
                )
            })
    }

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stderr
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| {
                kerminal_lib::error::AppError::SshCommand(
                    "fake streaming stderr already taken".to_owned(),
                )
            })
    }

    fn close_stdin(&mut self) -> AppResult<()> {
        self.stdin_taken = true;
        Ok(())
    }

    fn wait(&mut self, _timeout: std::time::Duration) -> AppResult<SshRuntimeStreamingExecExit> {
        Ok(SshRuntimeStreamingExecExit {
            exit_code: self.exit_code.or(Some(0)),
        })
    }

    fn kill(&mut self) -> AppResult<()> {
        Ok(())
    }
}

struct FakeStreamingExecWriter {
    state: Arc<FakeManagedSshRuntimeState>,
}

impl Write for FakeStreamingExecWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        self.state
            .streaming_stdin
            .lock()
            .expect("streaming stdin")
            .extend_from_slice(input);
        Ok(input.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Debug, Default)]
struct FakeManagedForwardTask {
    stopped: bool,
}

impl SshRuntimeForwardTask for FakeManagedForwardTask {
    fn id(&self) -> Option<String> {
        Some("fake-managed-forward".to_owned())
    }

    fn try_wait(&mut self) -> kerminal_lib::error::AppResult<Option<String>> {
        Ok(self
            .stopped
            .then(|| "fake managed forward stopped".to_owned()))
    }

    fn kill(&mut self) -> kerminal_lib::error::AppResult<()> {
        self.stopped = true;
        Ok(())
    }

    fn wait(&mut self) {}
}
