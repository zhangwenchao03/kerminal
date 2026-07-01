//! 本地 PTY 终端会话管理服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalAgentSignal, TerminalAgentSignalSummary, TerminalCreateRequest,
        TerminalOutputEvent, TerminalOutputKind, TerminalOutputSnapshot, TerminalResizeRequest,
        TerminalSecretInputPlan, TerminalSessionLogState, TerminalSessionReapDiagnostics,
        TerminalSessionStatus, TerminalSessionSummary,
    },
    services::{
        pty_process_guard::{
            with_conpty_lifecycle_lock, PtyMasterGuard, PtyProcessGuard, SharedPtyChildHandle,
        },
        terminal_agent_signal_detector::TerminalAgentSignalDetector,
        terminal_escape_responder::TerminalEscapeResponder,
        terminal_output_pump::{PtyOutputPump, PtyOutputPumpConfig, PtyOutputSink},
        terminal_shell_integration::build_terminal_shell_launch,
    },
};
mod output_state;
mod secret_input;
#[path = "terminal_target_token.rs"]
mod terminal_target_token;
mod text;

use output_state::{ActiveTerminalLog, TerminalOutputBuffer};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
pub use secret_input::rules;
use secret_input::TerminalSecretInputResponder;
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex, MutexGuard},
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
type OutputEmitter = Box<dyn Fn(TerminalOutputEvent) -> bool + Send + 'static>;

/// 管理进程内所有本地终端会话。
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    shell_integration_cache: PathBuf,
    target_token_signer: TerminalTargetTokenSigner,
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
        let master = PtyMasterGuard::new(pair.master);
        let reader = master.try_clone_reader().map_err(AppError::Terminal)?;
        let writer = master.take_writer().map_err(AppError::Terminal)?;
        let writer = Arc::new(Mutex::new(writer));

        let session_id = Uuid::new_v4().to_string();
        let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
        let log_sink = Arc::new(Mutex::new(None));
        let latest_agent_signal = Arc::new(Mutex::new(None));
        let agent_detector = Arc::new(Mutex::new(TerminalAgentSignalDetector::new()));
        let (pump_sender, pump_receiver) = mpsc::channel();
        spawn_output_flusher_thread(
            session_id.clone(),
            agent_session_id.clone(),
            pump_receiver,
            output_buffer.clone(),
            log_sink.clone(),
            latest_agent_signal.clone(),
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
            process_guard.shared_child(),
            pump_sender,
            reader_done,
            cleanup_paths.clone(),
            agent_detector,
        );

        let summary = TerminalSessionSummary {
            id: session_id.clone(),
            shell,
            cwd: cwd.as_ref().map(|path| path.to_string_lossy().into_owned()),
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
            process_guard,
            cols: size.cols,
            cwd,
            id: session_id.clone(),
            master,
            pid,
            rows: size.rows,
            shell: summary.shell.clone(),
            shell_integration: summary.shell_integration.clone(),
            target_ref: None,
            target_token: None,
            output_buffer,
            log_sink,
            latest_agent_signal,
            agent_session_id,
            cleanup_paths,
            writer,
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

        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_writer"))?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    /// 调整指定终端会话大小。
    pub fn resize(&self, session_id: &str, request: TerminalResizeRequest) -> AppResult<()> {
        let size = normalize_size(request.rows, request.cols)?;
        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;

        session
            .master
            .resize(size)
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        session.rows = size.rows;
        session.cols = size.cols;
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
        let sessions = self.lock_sessions()?;
        sessions
            .values()
            .map(TerminalSession::summary)
            .collect::<AppResult<Vec<_>>>()
    }

    pub fn session_summary(&self, session_id: &str) -> AppResult<TerminalSessionSummary> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;
        session.summary()
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
        session.summary()
    }

    pub fn verify_target_token(
        &self,
        session_id: &str,
        target_token: &str,
    ) -> AppResult<Option<TerminalTargetTokenClaims>> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;
        let Some(target_ref) = session.target_ref.as_deref() else {
            return Ok(None);
        };
        let Some(expected_token) = session.target_token.as_ref() else {
            return Ok(None);
        };
        if !TerminalTargetTokenSigner::matches(&expected_token.token, target_token) {
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
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;

        Ok((session.summary()?, session.output_snapshot(max_bytes)?))
    }

    /// 开始把指定会话的新输出写入日志文件。
    pub fn start_log(
        &self,
        session_id: &str,
        logs_root: impl AsRef<Path>,
    ) -> AppResult<TerminalSessionLogState> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;

        session.start_log(logs_root.as_ref())
    }

    /// 停止指定会话的日志记录。
    pub fn stop_log(&self, session_id: &str) -> AppResult<TerminalSessionLogState> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;

        session.stop_log()
    }

    /// 查询指定会话的日志记录状态。
    pub fn log_state(&self, session_id: &str) -> AppResult<TerminalSessionLogState> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Terminal(format!("终端会话不存在: {session_id}")))?;

        session.log_state()
    }

    fn lock_sessions(&self) -> AppResult<MutexGuard<'_, HashMap<String, TerminalSession>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_sessions"))
    }
}

struct TerminalSession {
    process_guard: PtyProcessGuard,
    cols: u16,
    cwd: Option<PathBuf>,
    id: String,
    master: PtyMasterGuard,
    pid: Option<u32>,
    rows: u16,
    shell: String,
    shell_integration: crate::models::terminal::TerminalShellIntegrationSummary,
    target_ref: Option<String>,
    target_token: Option<TerminalTargetCapability>,
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>>,
    agent_session_id: Option<String>,
    cleanup_paths: Vec<PathBuf>,
    writer: SharedWriterHandle,
}

impl TerminalSession {
    fn summary(&self) -> AppResult<TerminalSessionSummary> {
        let status = if self.process_guard.try_wait_status()?.is_some() {
            TerminalSessionStatus::Exited
        } else {
            TerminalSessionStatus::Running
        };

        Ok(TerminalSessionSummary {
            id: self.id.clone(),
            shell: self.shell.clone(),
            cwd: self
                .cwd
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            cols: self.cols,
            rows: self.rows,
            pid: self.pid,
            status,
            target_ref: self.target_ref.clone(),
            target_token: self
                .target_token
                .as_ref()
                .map(TerminalTargetCapability::token),
            shell_integration: self.shell_integration.clone(),
            agent_session_id: self.agent_session_id.clone(),
            agent_signal: self
                .latest_agent_signal
                .lock()
                .ok()
                .and_then(|signal| signal.clone()),
        })
    }

    fn close_detached(mut self) {
        cleanup_session_paths(&self.cleanup_paths);
        self.cleanup_paths.clear();
        thread::spawn(move || {
            let _ = self.process_guard.best_effort_kill();
        });
    }

    fn output_snapshot(&self, max_bytes: usize) -> AppResult<TerminalOutputSnapshot> {
        let output_buffer = self
            .output_buffer
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_output_buffer"))?;
        Ok(output_buffer.snapshot(max_bytes))
    }

    fn start_log(&self, logs_root: &Path) -> AppResult<TerminalSessionLogState> {
        let mut log_sink = self
            .log_sink
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_log_sink"))?;
        if let Some(active_log) = log_sink.as_ref() {
            return Ok(active_log.state(true));
        }

        let started_at = unix_timestamp_string();
        let session_log_dir = logs_root.join("sessions");
        fs::create_dir_all(&session_log_dir)?;
        let path = session_log_dir.join(format!(
            "session-{}-{}.log",
            started_at,
            safe_session_suffix(&self.id)
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;

        let header = format!(
            "Kerminal session log\nsession_id: {}\nshell: {}\ncwd: {}\nstarted_at: {}\n\n",
            self.id,
            self.shell,
            self.cwd
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|| "-".to_owned()),
            started_at
        );
        file.write_all(header.as_bytes())?;
        file.flush()?;

        let active_log = ActiveTerminalLog {
            bytes_written: header.len() as u64,
            file,
            pending_text: String::new(),
            path,
            started_at,
        };
        let state = active_log.state(true);
        *log_sink = Some(active_log);
        Ok(state)
    }

    fn stop_log(&self) -> AppResult<TerminalSessionLogState> {
        let mut log_sink = self
            .log_sink
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_log_sink"))?;
        let Some(mut active_log) = log_sink.take() else {
            return Ok(TerminalSessionLogState::inactive());
        };
        active_log.flush_pending()?;
        Ok(active_log.state(false))
    }

    fn log_state(&self) -> AppResult<TerminalSessionLogState> {
        let log_sink = self
            .log_sink
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_log_sink"))?;
        Ok(log_sink
            .as_ref()
            .map(|active_log| active_log.state(true))
            .unwrap_or_else(TerminalSessionLogState::inactive))
    }
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

fn spawn_output_flusher_thread(
    session_id: String,
    agent_session_id: Option<String>,
    receiver: mpsc::Receiver<PtyOutputPumpMessage>,
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>>,
    output: OutputEmitter,
) {
    thread::spawn(move || {
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
                    if !pump.push_data(&data, &mut sink) {
                        break;
                    }
                    if pump.pending_bytes() == 0 {
                        first_pending_at = None;
                        last_input_at = None;
                    } else {
                        first_pending_at.get_or_insert(now);
                        last_input_at = Some(now);
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
                    let _ = pump.finish_closed(&mut sink);
                    break;
                }
                PumpReceiveResult::Message(PtyOutputPumpMessage::Error(message)) => {
                    let _ = pump.finish_error(message, &mut sink);
                    break;
                }
                PumpReceiveResult::Timeout => {
                    if !pump.flush(&mut sink) {
                        break;
                    }
                    first_pending_at = None;
                    last_input_at = None;
                }
                PumpReceiveResult::Disconnected => {
                    let _ = pump.flush(&mut sink);
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
