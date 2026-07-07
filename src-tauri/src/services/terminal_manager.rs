//! 本地 PTY 终端会话管理服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalAgentSignal, TerminalAgentSignalSummary, TerminalCreateRequest,
        TerminalOutputEvent, TerminalOutputKind, TerminalOutputSnapshot,
        TerminalPtyOutputPumpFlushReason, TerminalPtyOutputPumpStats, TerminalResizeRequest,
        TerminalSecretInputPlan, TerminalSessionLogState, TerminalSessionReapDiagnostics,
        TerminalSessionStatus, TerminalSessionSummary, TerminalShellIntegrationSummary,
    },
    services::{
        pty_process_guard::{
            with_conpty_lifecycle_lock, PtyMasterGuard, PtyProcessGuard, SharedPtyChildHandle,
        },
        ssh_runtime::{ManagedSshShellSession, SshRuntimeShellEvent},
        terminal_agent_signal_detector::TerminalAgentSignalDetector,
        terminal_escape_responder::TerminalEscapeResponder,
        terminal_output_pump::{PtyOutputPump, PtyOutputPumpConfig, PtyOutputSink},
        terminal_shell_integration::build_terminal_shell_launch,
    },
};
mod output_state;
mod pump_metrics;
mod secret_input;
mod session_handle;
#[path = "terminal_target_token.rs"]
mod terminal_target_token;
mod text;

use output_state::{ActiveTerminalLog, TerminalOutputBuffer};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use pump_metrics::{flush_metadata_since, publish_pump_stats, SharedPtyOutputPumpStats};
pub use secret_input::rules;
use secret_input::TerminalSecretInputResponder;
use session_handle::TerminalSessionHandle;
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
pub use terminal_target_token::TerminalTargetTokenClaims;
use terminal_target_token::{TerminalTargetCapability, TerminalTargetTokenSigner};
use uuid::Uuid;

const READ_BUFFER_SIZE: usize = 16 * 1024;
const PTY_OUTPUT_FLUSH_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const PTY_OUTPUT_COALESCE: Duration = Duration::from_millis(4);
const PTY_OUTPUT_MAX_IDLE: Duration = Duration::from_millis(50);
const PTY_CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(20);
const PTY_READER_EOF_GRACE: Duration = Duration::from_millis(500);
const TERMINAL_TARGET_TOKEN_TTL_MS: u64 = 5 * 60 * 1000;
const KERMINAL_AGENT_SESSION_ID_ENV: &str = "KERMINAL_AGENT_SESSION_ID";

type WriterHandle = Box<dyn Write + Send>;
type SharedWriterHandle = Arc<Mutex<WriterHandle>>;
type SharedPtyMasterHandle = Arc<Mutex<PtyMasterGuard>>;
type SharedTerminalTransportHandle = Arc<Mutex<Box<dyn TerminalSessionTransport>>>;
type OutputEmitter = Box<dyn Fn(TerminalOutputEvent) -> bool + Send + 'static>;

/// 管理进程内所有本地终端会话。
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    shell_integration_cache: PathBuf,
    target_token_signer: TerminalTargetTokenSigner,
}

#[derive(Debug)]
pub struct TerminalManagedShellCreateRequest {
    pub shell: String,
    pub cwd: Option<String>,
    pub startup_input: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub target_ref: Option<String>,
}

pub struct TerminalManagedShellRuntime {
    pub shell: ManagedSshShellSession,
    pub runtime: tokio::runtime::Runtime,
}

impl std::fmt::Debug for TerminalManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TerminalManager")
            .finish_non_exhaustive()
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            shell_integration_cache: default_shell_integration_cache_dir(),
            target_token_signer: TerminalTargetTokenSigner::default(),
        }
    }
}

impl TerminalManager {
    /// 创建空的终端会话管理器。
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建使用指定 cache 目录写入 shell integration 脚本的终端会话管理器。
    pub fn with_shell_integration_cache_dir(cache_dir: impl Into<PathBuf>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            shell_integration_cache: cache_dir.into(),
            target_token_signer: TerminalTargetTokenSigner::default(),
        }
    }

    /// 创建本地 PTY 会话，并把输出推给调用方提供的回调。
    pub fn create_session<F>(
        &self,
        request: TerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        self.create_session_with_secret_input_plan(request, None, output)
    }

    pub fn create_managed_shell_session<F>(
        &self,
        request: TerminalManagedShellCreateRequest,
        shell: TerminalManagedShellRuntime,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let size = normalize_size(request.rows, request.cols)?;
        let shell_name = normalize_shell(Some(request.shell))?;
        let cwd = normalize_display_cwd(request.cwd)?;
        let target_ref = normalize_target_ref(request.target_ref);

        let session_id = Uuid::new_v4().to_string();
        let target_token = target_ref.as_deref().map(|target_ref| {
            self.target_token_signer.sign_binding_register_now(
                &session_id,
                target_ref,
                TERMINAL_TARGET_TOKEN_TTL_MS,
            )
        });
        let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
        let log_sink = Arc::new(Mutex::new(None));
        let latest_agent_signal = Arc::new(Mutex::new(None));
        let agent_detector = Arc::new(Mutex::new(TerminalAgentSignalDetector::new()));
        let (pump_sender, pump_receiver) = mpsc::channel();
        let pump_stats = Arc::new(Mutex::new(TerminalPtyOutputPumpStats::new(
            session_id.clone(),
        )));
        let flusher_state = OutputFlusherState {
            output_buffer: output_buffer.clone(),
            log_sink: log_sink.clone(),
            latest_agent_signal: latest_agent_signal.clone(),
            pump_stats: pump_stats.clone(),
        };
        spawn_output_flusher_thread(
            session_id.clone(),
            None,
            pump_receiver,
            flusher_state,
            Box::new(output),
        );

        let startup_input = normalize_startup_input(request.startup_input)?;
        let (reader, writer, transport) = spawn_managed_shell_io(shell, startup_input);
        let _reader_done = spawn_reader_thread(
            reader,
            Vec::new(),
            writer,
            None,
            pump_sender,
            agent_detector,
        );
        let shell_integration =
            TerminalShellIntegrationSummary::disabled("managed SSH shell channel");
        let summary = TerminalSessionSummary {
            id: session_id.clone(),
            shell: shell_name.clone(),
            cwd: cwd.clone(),
            cols: size.cols,
            rows: size.rows,
            pid: None,
            status: TerminalSessionStatus::Running,
            target_ref: target_ref.clone(),
            target_token: target_token.as_ref().map(TerminalTargetCapability::token),
            shell_integration: shell_integration.clone(),
            agent_session_id: None,
            agent_signal: None,
        };
        let session = TerminalSession {
            cols: size.cols,
            cwd,
            id: session_id.clone(),
            pid: None,
            rows: size.rows,
            shell: shell_name,
            shell_integration,
            target_ref,
            target_token,
            output_buffer,
            log_sink,
            latest_agent_signal,
            pump_stats,
            agent_session_id: None,
            cleanup_paths: Vec::new(),
            transport,
        };

        self.lock_sessions()?.insert(session_id.clone(), session);
        tauri_plugin_log::log::info!(
            target: "terminal.managed",
            "event=open.ok session_id={} target_ref={} shell={} rows={} cols={}",
            session_id,
            summary.target_ref.as_deref().unwrap_or("<none>"),
            summary.shell,
            summary.rows,
            summary.cols
        );
        Ok(summary)
    }

    /// 创建本地 PTY 会话，并使用后端提供的多敏感输入计划自动响应 prompt。
    pub fn create_session_with_secret_input_plan<F>(
        &self,
        request: TerminalCreateRequest,
        secret_input_plan: Option<TerminalSecretInputPlan>,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let TerminalCreateRequest {
            shell,
            args,
            cwd,
            cols,
            rows,
            env,
            cleanup_paths,
        } = request;
        let cleanup_guard = CleanupPathGuard::new(cleanup_paths.clone());
        let size = normalize_size(rows, cols)?;
        let shell = normalize_shell(shell)?;
        let cwd = normalize_cwd(cwd)?;
        let cwd_summary = cwd.as_ref().map(|path| path.to_string_lossy().into_owned());
        let agent_session_id = normalize_agent_session_id(env.get(KERMINAL_AGENT_SESSION_ID_ENV));
        let launch_plan =
            build_terminal_shell_launch(&shell, &args, &env, &self.shell_integration_cache);

        let mut command = CommandBuilder::new(&launch_plan.shell);
        command.args(launch_plan.args.iter().map(String::as_str));
        if let Some(cwd) = &cwd {
            command.cwd(cwd.as_os_str());
        }
        for (key, value) in &launch_plan.env {
            command.env(key, value);
        }

        let (pair, child) = with_conpty_lifecycle_lock(|| {
            let pty_system = native_pty_system();
            let pair = pty_system
                .openpty(size)
                .map_err(|error| AppError::Terminal(error.to_string()))?;
            let child = pair
                .slave
                .spawn_command(command)
                .map_err(|error| AppError::Terminal(error.to_string()))?;
            Ok::<_, AppError>((pair, child))
        })?;
        let process_guard = PtyProcessGuard::new(child);
        let pid = process_guard.pid();
        let process_child = process_guard.shared_child();
        let master = PtyMasterGuard::new(pair.master);
        let reader = master.try_clone_reader().map_err(AppError::Terminal)?;
        let writer = master.take_writer().map_err(AppError::Terminal)?;
        let master = Arc::new(Mutex::new(master));
        let writer = Arc::new(Mutex::new(writer));
        let transport = Arc::new(Mutex::new(Box::new(PtyTerminalTransport {
            process_guard: Some(process_guard),
            master,
            writer: writer.clone(),
        }) as Box<dyn TerminalSessionTransport>));

        let session_id = Uuid::new_v4().to_string();
        let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
        let log_sink = Arc::new(Mutex::new(None));
        let latest_agent_signal = Arc::new(Mutex::new(None));
        let agent_detector = Arc::new(Mutex::new(TerminalAgentSignalDetector::new()));
        let (pump_sender, pump_receiver) = mpsc::channel();
        let pump_stats = Arc::new(Mutex::new(TerminalPtyOutputPumpStats::new(
            session_id.clone(),
        )));
        let flusher_state = OutputFlusherState {
            output_buffer: output_buffer.clone(),
            log_sink: log_sink.clone(),
            latest_agent_signal: latest_agent_signal.clone(),
            pump_stats: pump_stats.clone(),
        };
        spawn_output_flusher_thread(
            session_id.clone(),
            agent_session_id.clone(),
            pump_receiver,
            flusher_state,
            Box::new(output),
        );
        let reader_done = spawn_reader_thread(
            reader,
            cleanup_paths.clone(),
            writer.clone(),
            secret_input_plan,
            pump_sender.clone(),
            agent_detector.clone(),
        );
        spawn_child_exit_waiter_thread(
            session_id.clone(),
            process_child,
            pump_sender,
            reader_done,
            cleanup_paths.clone(),
            agent_detector,
        );

        let summary = TerminalSessionSummary {
            id: session_id.clone(),
            shell,
            cwd: cwd_summary.clone(),
            cols: size.cols,
            rows: size.rows,
            pid,
            status: TerminalSessionStatus::Running,
            target_ref: None,
            target_token: None,
            shell_integration: launch_plan.integration.clone(),
            agent_session_id: agent_session_id.clone(),
            agent_signal: None,
        };

        let session = TerminalSession {
            cols: size.cols,
            cwd: cwd_summary,
            id: session_id.clone(),
            pid,
            rows: size.rows,
            shell: summary.shell.clone(),
            shell_integration: summary.shell_integration.clone(),
            target_ref: None,
            target_token: None,
            output_buffer,
            log_sink,
            latest_agent_signal,
            pump_stats,
            agent_session_id,
            cleanup_paths,
            transport,
        };

        self.lock_sessions()?.insert(session_id, session);
        cleanup_guard.disarm();
        Ok(summary)
    }

    /// 向指定终端会话写入原始输入。
    pub fn write(&self, session_id: &str, data: &str) -> AppResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        let handle = self.session_handle(session_id)?;
        let result = handle
            .transport
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_transport"))?
            .write(data.as_bytes());
        result
    }

    /// 调整指定终端会话大小。
    pub fn resize(&self, session_id: &str, request: TerminalResizeRequest) -> AppResult<()> {
        let size = normalize_size(request.rows, request.cols)?;
        let handle = self.session_handle(session_id)?;
        handle
            .transport
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_transport"))?
            .resize(size)?;
        if let Some(session) = self.lock_sessions()?.get_mut(session_id) {
            session.rows = size.rows;
            session.cols = size.cols;
        }
        Ok(())
    }

    /// 关闭并移除指定终端会话。
    pub fn close(&self, session_id: &str) -> AppResult<()> {
        let session = self
            .lock_sessions()?
            .remove(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;
        session.close_detached();
        Ok(())
    }

    /// 收割当前进程内仍挂在本地 PTY 管理器中的 orphan 会话。
    pub fn reap_orphan_sessions(&self) -> AppResult<TerminalSessionReapDiagnostics> {
        let started_at = Instant::now();
        let sessions = {
            let mut sessions = self.lock_sessions()?;
            sessions.drain().collect::<Vec<_>>()
        };
        let mut session_ids = Vec::with_capacity(sessions.len());

        for (session_id, session) in sessions {
            session_ids.push(session_id);
            session.close_detached();
        }

        let elapsed_ms = u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX);
        Ok(TerminalSessionReapDiagnostics {
            reaped_count: session_ids.len(),
            session_ids,
            elapsed_ms,
        })
    }

    /// 返回当前管理器中的终端会话摘要。
    pub fn list_sessions(&self) -> AppResult<Vec<TerminalSessionSummary>> {
        self.session_handles()?
            .into_iter()
            .map(|session| session.summary())
            .collect()
    }

    pub fn session_summary(&self, session_id: &str) -> AppResult<TerminalSessionSummary> {
        self.session_handle(session_id)?.summary()
    }

    pub fn set_target_ref(
        &self,
        session_id: &str,
        target_ref: impl Into<String>,
    ) -> AppResult<TerminalSessionSummary> {
        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;
        let target_ref = normalize_target_ref(Some(target_ref.into()));
        session.target_token = target_ref.as_deref().map(|target_ref| {
            self.target_token_signer.sign_binding_register_now(
                session_id,
                target_ref,
                TERMINAL_TARGET_TOKEN_TTL_MS,
            )
        });
        session.target_ref = target_ref;
        let handle = session.handle();
        drop(sessions);
        handle.summary()
    }

    pub fn verify_target_token(
        &self,
        session_id: &str,
        target_token: &str,
    ) -> AppResult<Option<TerminalTargetTokenClaims>> {
        let handle = self.session_handle(session_id)?;
        let Some(target_ref) = handle.target_ref.as_deref() else {
            return Ok(None);
        };
        let Some(expected_token) = handle.target_token.as_ref() else {
            return Ok(None);
        };
        if !TerminalTargetTokenSigner::matches(expected_token, target_token) {
            return Ok(None);
        }
        Ok(self.target_token_signer.verify_binding_register_now(
            session_id,
            target_ref,
            target_token,
        ))
    }

    /// 返回指定终端会话的摘要和最近输出快照。
    pub fn output_snapshot(
        &self,
        session_id: &str,
        max_bytes: usize,
    ) -> AppResult<(TerminalSessionSummary, TerminalOutputSnapshot)> {
        let handle = self.session_handle(session_id)?;
        Ok((handle.summary()?, handle.output_snapshot(max_bytes)?))
    }

    /// 开始把指定会话的新输出写入日志文件。
    pub fn start_log(
        &self,
        session_id: &str,
        logs_root: impl AsRef<Path>,
    ) -> AppResult<TerminalSessionLogState> {
        self.session_handle(session_id)?
            .start_log(logs_root.as_ref())
    }

    /// 停止指定会话的日志记录。
    pub fn stop_log(&self, session_id: &str) -> AppResult<TerminalSessionLogState> {
        self.session_handle(session_id)?.stop_log()
    }

    /// 查询指定会话的日志记录状态。
    pub fn log_state(&self, session_id: &str) -> AppResult<TerminalSessionLogState> {
        self.session_handle(session_id)?.log_state()
    }

    /// 返回指定本地 PTY 会话的 output pump 非敏感指标。
    pub fn pty_output_pump_stats(&self, session_id: &str) -> AppResult<TerminalPtyOutputPumpStats> {
        self.session_handle(session_id)?.pty_output_pump_stats()
    }

    fn lock_sessions(&self) -> AppResult<MutexGuard<'_, HashMap<String, TerminalSession>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_sessions"))
    }

    fn session_handle(&self, session_id: &str) -> AppResult<TerminalSessionHandle> {
        self.lock_sessions()?
            .get(session_id)
            .map(TerminalSession::handle)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))
    }

    fn session_handles(&self) -> AppResult<Vec<TerminalSessionHandle>> {
        Ok(self
            .lock_sessions()?
            .values()
            .map(TerminalSession::handle)
            .collect())
    }
}

struct TerminalSession {
    cols: u16,
    cwd: Option<String>,
    id: String,
    pid: Option<u32>,
    rows: u16,
    shell: String,
    shell_integration: crate::models::terminal::TerminalShellIntegrationSummary,
    target_ref: Option<String>,
    target_token: Option<TerminalTargetCapability>,
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>>,
    pump_stats: SharedPtyOutputPumpStats,
    agent_session_id: Option<String>,
    cleanup_paths: Vec<PathBuf>,
    transport: SharedTerminalTransportHandle,
}

impl TerminalSession {
    fn handle(&self) -> TerminalSessionHandle {
        TerminalSessionHandle {
            cols: self.cols,
            cwd: self.cwd.clone(),
            id: self.id.clone(),
            pid: self.pid,
            rows: self.rows,
            shell: self.shell.clone(),
            shell_integration: self.shell_integration.clone(),
            target_ref: self.target_ref.clone(),
            target_token: self
                .target_token
                .as_ref()
                .map(TerminalTargetCapability::token),
            output_buffer: self.output_buffer.clone(),
            log_sink: self.log_sink.clone(),
            latest_agent_signal: self.latest_agent_signal.clone(),
            pump_stats: self.pump_stats.clone(),
            agent_session_id: self.agent_session_id.clone(),
            transport: self.transport.clone(),
        }
    }

    fn close_detached(mut self) {
        cleanup_session_paths(&self.cleanup_paths);
        self.cleanup_paths.clear();
        if let Ok(mut transport) = self.transport.lock() {
            transport.close_detached();
        }
    }
}

trait TerminalSessionTransport: Send {
    fn status(&mut self) -> AppResult<TerminalSessionStatus>;

    fn write(&mut self, data: &[u8]) -> AppResult<()>;

    fn resize(&mut self, size: PtySize) -> AppResult<()>;

    fn close_detached(&mut self);
}

struct PtyTerminalTransport {
    process_guard: Option<PtyProcessGuard>,
    master: SharedPtyMasterHandle,
    writer: SharedWriterHandle,
}

impl TerminalSessionTransport for PtyTerminalTransport {
    fn status(&mut self) -> AppResult<TerminalSessionStatus> {
        let Some(process_guard) = self.process_guard.as_ref() else {
            return Ok(TerminalSessionStatus::Exited);
        };
        let status = if process_guard.try_wait_status()?.is_some() {
            TerminalSessionStatus::Exited
        } else {
            TerminalSessionStatus::Running
        };
        Ok(status)
    }

    fn write(&mut self, data: &[u8]) -> AppResult<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_writer"))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    fn resize(&mut self, size: PtySize) -> AppResult<()> {
        let master = self
            .master
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_master"))?;
        master
            .resize(size)
            .map_err(|error| AppError::Terminal(error.to_string()))
    }

    fn close_detached(&mut self) {
        let Some(process_guard) = self.process_guard.take() else {
            return;
        };
        thread::spawn(move || {
            let _ = process_guard.best_effort_kill();
        });
    }
}

enum ManagedSshShellCommand {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

enum ManagedSshShellReaderMessage {
    Data(Vec<u8>),
    Error(String),
    Closed,
}

struct ManagedSshShellTransport {
    closed: Arc<AtomicBool>,
    commands: tokio::sync::mpsc::UnboundedSender<ManagedSshShellCommand>,
}

impl TerminalSessionTransport for ManagedSshShellTransport {
    fn status(&mut self) -> AppResult<TerminalSessionStatus> {
        if self.closed.load(Ordering::SeqCst) {
            Ok(TerminalSessionStatus::Exited)
        } else {
            Ok(TerminalSessionStatus::Running)
        }
    }

    fn write(&mut self, data: &[u8]) -> AppResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::Terminal(
                "managed SSH shell channel is closed".to_owned(),
            ));
        }
        self.commands
            .send(ManagedSshShellCommand::Write(data.to_vec()))
            .map_err(|_| AppError::Terminal("managed SSH shell channel is closed".to_owned()))
    }

    fn resize(&mut self, size: PtySize) -> AppResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::Terminal(
                "managed SSH shell channel is closed".to_owned(),
            ));
        }
        self.commands
            .send(ManagedSshShellCommand::Resize {
                cols: size.cols,
                rows: size.rows,
            })
            .map_err(|_| AppError::Terminal("managed SSH shell channel is closed".to_owned()))
    }

    fn close_detached(&mut self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = self.commands.send(ManagedSshShellCommand::Close);
    }
}

struct ManagedSshShellWriter {
    closed: Arc<AtomicBool>,
    commands: tokio::sync::mpsc::UnboundedSender<ManagedSshShellCommand>,
}

impl Write for ManagedSshShellWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "managed SSH shell channel is closed",
            ));
        }
        self.commands
            .send(ManagedSshShellCommand::Write(buf.to_vec()))
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "managed SSH shell channel is closed",
                )
            })?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct ManagedSshShellReader {
    pending: Vec<u8>,
    pending_offset: usize,
    receiver: mpsc::Receiver<ManagedSshShellReaderMessage>,
}

impl Read for ManagedSshShellReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }

        loop {
            if self.pending_offset < self.pending.len() {
                let remaining = &self.pending[self.pending_offset..];
                let bytes_to_copy = remaining.len().min(buf.len());
                buf[..bytes_to_copy].copy_from_slice(&remaining[..bytes_to_copy]);
                self.pending_offset += bytes_to_copy;
                if self.pending_offset >= self.pending.len() {
                    self.pending.clear();
                    self.pending_offset = 0;
                }
                return Ok(bytes_to_copy);
            }

            match self.receiver.recv() {
                Ok(ManagedSshShellReaderMessage::Data(data)) if data.is_empty() => {}
                Ok(ManagedSshShellReaderMessage::Data(data)) => {
                    self.pending = data;
                    self.pending_offset = 0;
                }
                Ok(ManagedSshShellReaderMessage::Error(error)) => {
                    return Err(io::Error::other(error));
                }
                Ok(ManagedSshShellReaderMessage::Closed) | Err(_) => return Ok(0),
            }
        }
    }
}

fn spawn_managed_shell_io(
    shell: TerminalManagedShellRuntime,
    startup_input: Option<String>,
) -> (
    Box<dyn Read + Send>,
    SharedWriterHandle,
    SharedTerminalTransportHandle,
) {
    let (reader_sender, reader_receiver) = mpsc::channel();
    let (command_sender, command_receiver) = tokio::sync::mpsc::unbounded_channel();
    let closed = Arc::new(AtomicBool::new(false));

    spawn_managed_shell_bridge(
        shell,
        startup_input,
        reader_sender,
        command_receiver,
        Arc::clone(&closed),
    );

    let reader = Box::new(ManagedSshShellReader {
        pending: Vec::new(),
        pending_offset: 0,
        receiver: reader_receiver,
    });
    let writer = Arc::new(Mutex::new(Box::new(ManagedSshShellWriter {
        closed: Arc::clone(&closed),
        commands: command_sender.clone(),
    }) as WriterHandle));
    let transport = Arc::new(Mutex::new(Box::new(ManagedSshShellTransport {
        closed,
        commands: command_sender,
    }) as Box<dyn TerminalSessionTransport>));
    (reader, writer, transport)
}

fn spawn_managed_shell_bridge(
    shell: TerminalManagedShellRuntime,
    startup_input: Option<String>,
    reader_sender: mpsc::Sender<ManagedSshShellReaderMessage>,
    mut command_receiver: tokio::sync::mpsc::UnboundedReceiver<ManagedSshShellCommand>,
    closed: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let TerminalManagedShellRuntime { mut shell, runtime } = shell;

        runtime.block_on(async move {
            if let Some(startup_input) = startup_input {
                if let Err(error) = shell.write(startup_input.into_bytes()).await {
                    let _ = reader_sender.send(ManagedSshShellReaderMessage::Error(error.to_string()));
                    let _ = shell.close().await;
                    closed.store(true, Ordering::SeqCst);
                    let _ = reader_sender.send(ManagedSshShellReaderMessage::Closed);
                    return;
                }
            }

            loop {
                tokio::select! {
                    command = command_receiver.recv() => {
                        match command {
                            Some(ManagedSshShellCommand::Write(data)) => {
                                if let Err(error) = shell.write(data).await {
                                    let _ = reader_sender.send(ManagedSshShellReaderMessage::Error(error.to_string()));
                                    break;
                                }
                            }
                            Some(ManagedSshShellCommand::Resize { cols, rows }) => {
                                if let Err(error) = shell.resize(cols, rows).await {
                                    let _ = reader_sender.send(ManagedSshShellReaderMessage::Error(error.to_string()));
                                    break;
                                }
                            }
                            Some(ManagedSshShellCommand::Close) | None => break,
                        }
                    }
                    event = shell.read_event() => {
                        match event {
                            Ok(SshRuntimeShellEvent::Data(data))
                            | Ok(SshRuntimeShellEvent::ExtendedData { data, .. }) => {
                                if reader_sender.send(ManagedSshShellReaderMessage::Data(data)).is_err() {
                                    break;
                                }
                            }
                            Ok(SshRuntimeShellEvent::Eof) | Ok(SshRuntimeShellEvent::Closed) => {
                                break;
                            }
                            Ok(SshRuntimeShellEvent::ExitSignal { error_message, signal_name }) => {
                                let message = if error_message.is_empty() {
                                    format!("SSH shell exited by signal {signal_name}")
                                } else {
                                    format!("SSH shell exited by signal {signal_name}: {error_message}")
                                };
                                let _ = reader_sender.send(ManagedSshShellReaderMessage::Error(message));
                                break;
                            }
                            Ok(SshRuntimeShellEvent::ExitStatus(status)) => {
                                if status != 0 {
                                    let _ = reader_sender.send(ManagedSshShellReaderMessage::Error(
                                        format!("SSH shell exited with status {status}"),
                                    ));
                                }
                                break;
                            }
                            Err(error) => {
                                let _ = reader_sender.send(ManagedSshShellReaderMessage::Error(error.to_string()));
                                break;
                            }
                        }
                    }
                }
            }

            let _ = shell.close().await;
            closed.store(true, Ordering::SeqCst);
            let _ = reader_sender.send(ManagedSshShellReaderMessage::Closed);
        });
    });
}

fn spawn_reader_thread(
    mut reader: Box<dyn Read + Send>,
    cleanup_paths: Vec<PathBuf>,
    writer: SharedWriterHandle,
    secret_input_plan: Option<TerminalSecretInputPlan>,
    pump_sender: mpsc::Sender<PtyOutputPumpMessage>,
    agent_detector: Arc<Mutex<TerminalAgentSignalDetector>>,
) -> mpsc::Receiver<()> {
    let (reader_done_sender, reader_done_receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = vec![0_u8; READ_BUFFER_SIZE];
        let mut escape_responder = TerminalEscapeResponder::new();
        let mut secret_responder = secret_input_plan.map(TerminalSecretInputResponder::new);

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    send_finished_agent_signal(&agent_detector, &pump_sender);
                    let _ = pump_sender.send(PtyOutputPumpMessage::Closed);
                    break;
                }
                Ok(bytes_read) => {
                    let mut data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
                    let observation = escape_responder.observe(&data);
                    if let Err(error) =
                        write_terminal_escape_responses(&writer, &observation.responses)
                    {
                        let _ = pump_sender.send(PtyOutputPumpMessage::Error(error.to_string()));
                        break;
                    }
                    data = observation.data;
                    if let Some(responder) = secret_responder.as_mut() {
                        responder.observe_and_maybe_respond(&data, &writer);
                        data = responder.redact_output(&data);
                    }
                    let observed = match agent_detector.lock() {
                        Ok(mut detector) => detector.observe_and_filter(&data),
                        Err(_) => {
                            let _ = pump_sender.send(PtyOutputPumpMessage::Error(
                                "terminal agent signal detector lock poisoned".to_owned(),
                            ));
                            break;
                        }
                    };
                    let mut signal_send_failed = false;
                    for signal in observed.signals {
                        if pump_sender
                            .send(PtyOutputPumpMessage::AgentSignal(signal))
                            .is_err()
                        {
                            signal_send_failed = true;
                            break;
                        }
                    }
                    if signal_send_failed {
                        break;
                    }
                    if !observed.data.is_empty()
                        && pump_sender
                            .send(PtyOutputPumpMessage::Data(observed.data))
                            .is_err()
                    {
                        break;
                    }
                }
                Err(error) => {
                    send_finished_agent_signal(&agent_detector, &pump_sender);
                    let _ = pump_sender.send(PtyOutputPumpMessage::Error(error.to_string()));
                    break;
                }
            }
        }
        let _ = reader_done_sender.send(());
        cleanup_session_paths(&cleanup_paths);
    });
    reader_done_receiver
}

fn write_terminal_escape_responses(
    writer: &SharedWriterHandle,
    responses: &[&'static str],
) -> AppResult<()> {
    if responses.is_empty() {
        return Ok(());
    }

    let mut writer = writer
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("terminal_writer"))?;
    for response in responses {
        writer.write_all(response.as_bytes())?;
    }
    writer.flush()?;
    Ok(())
}

enum PtyOutputPumpMessage {
    Data(String),
    AgentSignal(TerminalAgentSignal),
    Closed,
    Error(String),
}

struct OutputFlusherState {
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>>,
    pump_stats: SharedPtyOutputPumpStats,
}

fn spawn_output_flusher_thread(
    session_id: String,
    agent_session_id: Option<String>,
    receiver: mpsc::Receiver<PtyOutputPumpMessage>,
    state: OutputFlusherState,
    output: OutputEmitter,
) {
    thread::spawn(move || {
        let OutputFlusherState {
            output_buffer,
            log_sink,
            latest_agent_signal,
            pump_stats,
        } = state;
        let mut pump = PtyOutputPump::new(session_id.clone(), terminal_output_pump_config());
        let mut sink = TerminalOutputDeliverySink {
            output_buffer,
            log_sink,
            output,
        };
        let mut first_pending_at: Option<Instant> = None;
        let mut last_input_at: Option<Instant> = None;

        loop {
            match receive_pump_message(&receiver, first_pending_at, last_input_at) {
                PumpReceiveResult::Message(PtyOutputPumpMessage::Data(data)) => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let accepted = pump.push_data(&data, &mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Threshold));
                    if pump.pending_bytes() == 0 {
                        first_pending_at = None;
                        last_input_at = None;
                    } else {
                        first_pending_at.get_or_insert(now);
                        last_input_at = Some(now);
                    }
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, false);
                    if !accepted {
                        break;
                    }
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::AgentSignal(signal)) => {
                    let summary = TerminalAgentSignalSummary::new(
                        &session_id,
                        agent_session_id.as_deref(),
                        signal,
                    );
                    if let Ok(mut latest_agent_signal) = latest_agent_signal.lock() {
                        *latest_agent_signal = Some(summary.clone());
                    }
                    if !sink.on_terminal_output(TerminalOutputEvent::agent_signal(summary)) {
                        break;
                    }
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::Closed) => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let _ = pump.finish_closed(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Closed));
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, true);
                    break;
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::Error(message)) => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let _ = pump.finish_error(message, &mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Error));
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, true);
                    break;
                }
                PumpReceiveResult::Timeout => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let accepted = pump.flush(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| (interval_ms, TerminalPtyOutputPumpFlushReason::Idle));
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, false);
                    if !accepted {
                        break;
                    }
                    first_pending_at = None;
                    last_input_at = None;
                }
                PumpReceiveResult::Disconnected => {
                    let now = Instant::now();
                    let first_pending_started_at = first_pending_at.unwrap_or(now);
                    let flush_count_before = pump.stats().flush_count;
                    let _ = pump.flush(&mut sink);
                    let flush_metadata = flush_metadata_since(
                        flush_count_before,
                        &pump,
                        first_pending_started_at,
                        now,
                    )
                    .map(|interval_ms| {
                        (interval_ms, TerminalPtyOutputPumpFlushReason::Disconnected)
                    });
                    publish_pump_stats(&pump_stats, &session_id, &pump, flush_metadata, true);
                    break;
                }
            }
        }
    });
}

fn spawn_child_exit_waiter_thread(
    session_id: String,
    child: SharedPtyChildHandle,
    pump_sender: mpsc::Sender<PtyOutputPumpMessage>,
    reader_done: mpsc::Receiver<()>,
    cleanup_paths: Vec<PathBuf>,
    agent_detector: Arc<Mutex<TerminalAgentSignalDetector>>,
) {
    thread::spawn(move || loop {
        match reader_done.try_recv() {
            Ok(()) | Err(mpsc::TryRecvError::Disconnected) => return,
            Err(mpsc::TryRecvError::Empty) => {}
        }

        let child_exited = {
            let mut child = match child.lock() {
                Ok(child) => child,
                Err(_) => {
                    let _ = pump_sender.send(PtyOutputPumpMessage::Error(
                        "terminal child lock poisoned".to_owned(),
                    ));
                    return;
                }
            };
            match child.try_wait() {
                Ok(Some(_status)) => true,
                Ok(None) => false,
                Err(error) => {
                    let _ = pump_sender.send(PtyOutputPumpMessage::Error(format!(
                        "failed to monitor terminal process {session_id}: {error}"
                    )));
                    return;
                }
            }
        };

        if child_exited {
            cleanup_session_paths(&cleanup_paths);
            match reader_done.recv_timeout(PTY_READER_EOF_GRACE) {
                Ok(()) => return,
                Err(mpsc::RecvTimeoutError::Timeout)
                | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    send_finished_agent_signal(&agent_detector, &pump_sender);
                    let _ = pump_sender.send(PtyOutputPumpMessage::Closed);
                    return;
                }
            }
        }

        thread::sleep(PTY_CHILD_EXIT_POLL_INTERVAL);
    });
}

enum PumpReceiveResult {
    Message(PtyOutputPumpMessage),
    Timeout,
    Disconnected,
}

fn receive_pump_message(
    receiver: &mpsc::Receiver<PtyOutputPumpMessage>,
    first_pending_at: Option<Instant>,
    last_input_at: Option<Instant>,
) -> PumpReceiveResult {
    let Some(timeout) = next_output_flush_timeout(first_pending_at, last_input_at) else {
        return receiver
            .recv()
            .map(PumpReceiveResult::Message)
            .unwrap_or(PumpReceiveResult::Disconnected);
    };

    match receiver.recv_timeout(timeout) {
        Ok(message) => PumpReceiveResult::Message(message),
        Err(mpsc::RecvTimeoutError::Timeout) => PumpReceiveResult::Timeout,
        Err(mpsc::RecvTimeoutError::Disconnected) => PumpReceiveResult::Disconnected,
    }
}

fn next_output_flush_timeout(
    first_pending_at: Option<Instant>,
    last_input_at: Option<Instant>,
) -> Option<Duration> {
    let first_pending_at = first_pending_at?;
    let last_input_at = last_input_at.unwrap_or(first_pending_at);
    let coalesce_due = last_input_at + PTY_OUTPUT_COALESCE;
    let max_idle_due = first_pending_at + PTY_OUTPUT_MAX_IDLE;
    let due = coalesce_due.min(max_idle_due);
    let now = Instant::now();
    Some(due.saturating_duration_since(now))
}

fn terminal_output_pump_config() -> PtyOutputPumpConfig {
    PtyOutputPumpConfig {
        flush_bytes: PTY_OUTPUT_FLUSH_BYTES,
        max_pending_bytes: PTY_OUTPUT_MAX_PENDING_BYTES,
        ..PtyOutputPumpConfig::default()
    }
}

struct TerminalOutputDeliverySink {
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    output: OutputEmitter,
}

impl PtyOutputSink for TerminalOutputDeliverySink {
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        if event.kind == TerminalOutputKind::Data {
            if let Ok(mut output_buffer) = self.output_buffer.lock() {
                output_buffer.push(&event.data);
            }
            if let Ok(mut log_sink) = self.log_sink.lock() {
                if let Some(active_log) = log_sink.as_mut() {
                    let _ = active_log.append(&event.data);
                }
            }
        }
        (self.output)(event)
    }
}

struct CleanupPathGuard {
    active: Mutex<bool>,
    paths: Vec<PathBuf>,
}

impl CleanupPathGuard {
    fn new(paths: Vec<PathBuf>) -> Self {
        Self {
            active: Mutex::new(true),
            paths,
        }
    }

    fn disarm(&self) {
        if let Ok(mut active) = self.active.lock() {
            *active = false;
        }
    }
}

impl Drop for CleanupPathGuard {
    fn drop(&mut self) {
        if self.active.lock().map(|active| *active).unwrap_or(true) {
            cleanup_session_paths(&self.paths);
        }
    }
}

fn cleanup_session_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn normalize_size(rows: u16, cols: u16) -> AppResult<PtySize> {
    if rows == 0 || cols == 0 {
        return Err(AppError::InvalidInput(
            "终端行数和列数必须大于 0".to_owned(),
        ));
    }

    Ok(PtySize {
        cols,
        rows,
        pixel_height: 0,
        pixel_width: 0,
    })
}

fn send_finished_agent_signal(
    agent_detector: &Arc<Mutex<TerminalAgentSignalDetector>>,
    pump_sender: &mpsc::Sender<PtyOutputPumpMessage>,
) {
    let Some(signal) = agent_detector
        .lock()
        .ok()
        .and_then(|mut detector| detector.finish_pty())
    else {
        return;
    };
    let _ = pump_sender.send(PtyOutputPumpMessage::AgentSignal(signal));
}

fn normalize_shell(shell: Option<String>) -> AppResult<String> {
    let shell = shell.unwrap_or_else(default_shell);
    let shell = shell.trim().to_owned();
    if shell.is_empty() {
        return Err(AppError::InvalidInput("shell 不能为空".to_owned()));
    }
    Ok(shell)
}

fn normalize_target_ref(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn normalize_display_cwd(cwd: Option<String>) -> AppResult<Option<String>> {
    cwd.map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("工作目录不能为空".to_owned()));
        }
        Ok(trimmed.to_owned())
    })
    .transpose()
}

fn normalize_startup_input(input: Option<String>) -> AppResult<Option<String>> {
    input
        .map(|value| {
            if value.is_empty() {
                return Err(AppError::InvalidInput(
                    "managed SSH shell startup input cannot be empty".to_owned(),
                ));
            }
            if value.contains('\0') {
                return Err(AppError::InvalidInput(
                    "managed SSH shell startup input cannot contain NUL".to_owned(),
                ));
            }
            Ok(value)
        })
        .transpose()
}

fn normalize_agent_session_id(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn normalize_cwd(cwd: Option<String>) -> AppResult<Option<PathBuf>> {
    cwd.map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("工作目录不能为空".to_owned()));
        }
        let path = PathBuf::from(trimmed);
        if !path.exists() {
            return Err(AppError::InvalidInput("工作目录不存在".to_owned()));
        }
        if !path.is_dir() {
            return Err(AppError::InvalidInput("工作目录必须是文件夹".to_owned()));
        }
        Ok(path)
    })
    .transpose()
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn safe_session_suffix(session_id: &str) -> String {
    session_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(12)
        .collect()
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_owned()
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_owned())
    }
}

fn default_shell_integration_cache_dir() -> PathBuf {
    std::env::temp_dir().join("kerminal").join("cache")
}
