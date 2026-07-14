//! 本地 PTY 终端会话管理服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalAgentSignalSummary, TerminalCreateRequest, TerminalOutputEvent,
        TerminalOutputSnapshot, TerminalPtyOutputPumpStats, TerminalResizeRequest,
        TerminalSecretInputPlan, TerminalSessionLogState, TerminalSessionReapDiagnostics,
        TerminalSessionStatus, TerminalSessionSummary, TerminalShellIntegrationSummary,
    },
    services::{
        pty_process_guard::{with_conpty_lifecycle_lock, PtyMasterGuard, PtyProcessGuard},
        ssh_runtime::ManagedSshShellSession,
        terminal_agent_signal_detector::TerminalAgentSignalDetector,
        terminal_shell_integration::build_terminal_shell_launch,
    },
};
mod io_runtime;
mod managed_shell_channel;
mod output_flusher;
mod output_state;
mod pump_metrics;
mod secret_input;
mod session_handle;
#[path = "terminal_target_token.rs"]
mod terminal_target_token;
mod text;
mod transport;
mod utf8_decoder;

use io_runtime::{
    cleanup_session_paths, pty_output_channel, spawn_child_exit_waiter_thread, spawn_reader_thread,
    CleanupPathGuard,
};
use managed_shell_channel::TERMINAL_WRITE_MAX_BYTES;
use output_flusher::{spawn_output_flusher_thread, OutputFlusherState};
use output_state::{ActiveTerminalLog, TerminalOutputBuffer};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use pump_metrics::SharedPtyOutputPumpStats;
pub use secret_input::rules;
use session_handle::TerminalSessionHandle;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
pub use terminal_target_token::TerminalTargetTokenClaims;
use terminal_target_token::{TerminalTargetCapability, TerminalTargetTokenSigner};
use transport::{
    create_pty_transport, spawn_managed_shell_io, SharedTerminalTransportHandle, SharedWriterHandle,
};
use uuid::Uuid;

const PTY_OUTPUT_FLUSH_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const PTY_OUTPUT_COALESCE: Duration = Duration::from_millis(4);
const PTY_OUTPUT_MAX_IDLE: Duration = Duration::from_millis(50);
const TERMINAL_TARGET_TOKEN_TTL_MS: u64 = 5 * 60 * 1000;
const KERMINAL_AGENT_SESSION_ID_ENV: &str = "KERMINAL_AGENT_SESSION_ID";

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
        let (pump_sender, pump_receiver) = pty_output_channel(&session_id);
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
            terminal_target_ref_log_label(summary.target_ref.as_deref()),
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
        let (writer, transport) = create_pty_transport(process_guard, master, writer);

        let session_id = Uuid::new_v4().to_string();
        let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
        let log_sink = Arc::new(Mutex::new(None));
        let latest_agent_signal = Arc::new(Mutex::new(None));
        let agent_detector = Arc::new(Mutex::new(TerminalAgentSignalDetector::new()));
        let (pump_sender, pump_receiver) = pty_output_channel(&session_id);
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
        if data.len() > TERMINAL_WRITE_MAX_BYTES {
            return Err(AppError::InvalidInput(format!(
                "terminal input exceeds per-write limit: {} bytes > {} bytes",
                data.len(),
                TERMINAL_WRITE_MAX_BYTES
            )));
        }
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

fn terminal_target_ref_log_label(target_ref: Option<&str>) -> String {
    let Some(target_ref) = target_ref else {
        return "<none>".to_owned();
    };
    let Some(launch_id) = target_ref.strip_prefix("ssh:external:") else {
        return target_ref.to_owned();
    };
    format!(
        "ssh:external:request_hash={}",
        crate::services::external_launch::redaction::opaque_id_hash(launch_id)
    )
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
            if value.len() > TERMINAL_WRITE_MAX_BYTES {
                return Err(AppError::InvalidInput(format!(
                    "managed SSH shell startup input exceeds per-write limit: {} bytes > {} bytes",
                    value.len(),
                    TERMINAL_WRITE_MAX_BYTES
                )));
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
