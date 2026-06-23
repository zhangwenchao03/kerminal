//! 本地 PTY 终端会话管理服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalCreateRequest, TerminalOutputEvent, TerminalOutputSnapshot, TerminalResizeRequest,
        TerminalSecretInputEntry, TerminalSecretInputPlan, TerminalSessionLogState,
        TerminalSessionStatus, TerminalSessionSummary,
    },
    security::redaction::redact_terminal_text,
};
#[path = "terminal_target_token.rs"]
mod terminal_target_token;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
pub use terminal_target_token::TerminalTargetTokenClaims;
use terminal_target_token::{TerminalTargetCapability, TerminalTargetTokenSigner};
use uuid::Uuid;

const READ_BUFFER_SIZE: usize = 8192;
const TERMINAL_CONTEXT_BUFFER_BYTES: usize = 64 * 1024;
const LOG_REDACTION_PENDING_CHARS: usize = 4096;
const TERMINAL_TARGET_TOKEN_TTL_MS: u64 = 5 * 60 * 1000;

type ChildHandle = Box<dyn Child + Send + Sync>;
type MasterHandle = Box<dyn MasterPty + Send>;
type WriterHandle = Box<dyn Write + Send>;
type SharedWriterHandle = Arc<Mutex<WriterHandle>>;
type OutputEmitter = Box<dyn Fn(TerminalOutputEvent) -> bool + Send + 'static>;

/// 管理进程内所有本地终端会话。
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
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
            target_token_signer: TerminalTargetTokenSigner::default(),
        }
    }
}

impl TerminalManager {
    /// 创建空的终端会话管理器。
    pub fn new() -> Self {
        Self::default()
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
            secret_input_response,
        } = request;
        let secret_input_plan =
            secret_input_plan.or_else(|| secret_input_response.map(TerminalSecretInputPlan::from));
        let cleanup_guard = CleanupPathGuard::new(cleanup_paths.clone());
        let size = normalize_size(rows, cols)?;
        let shell = normalize_shell(shell)?;
        let cwd = normalize_cwd(cwd)?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|error| AppError::Terminal(error.to_string()))?;

        let mut command = CommandBuilder::new(&shell);
        command.args(args.iter().map(String::as_str));
        if let Some(cwd) = &cwd {
            command.cwd(cwd.as_os_str());
        }
        for (key, value) in &env {
            command.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        let pid = child.process_id();
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        let writer = Arc::new(Mutex::new(writer));

        let session_id = Uuid::new_v4().to_string();
        let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
        let log_sink = Arc::new(Mutex::new(None));
        spawn_reader_thread(
            session_id.clone(),
            reader,
            output_buffer.clone(),
            log_sink.clone(),
            cleanup_paths.clone(),
            writer.clone(),
            secret_input_plan,
            Box::new(output),
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
        };

        let session = TerminalSession {
            child: Mutex::new(child),
            cols: size.cols,
            cwd,
            id: session_id.clone(),
            master: pair.master,
            pid,
            rows: size.rows,
            shell: summary.shell.clone(),
            target_ref: None,
            target_token: None,
            output_buffer,
            log_sink,
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
        let close_result = (|| {
            let mut child = session
                .child
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("terminal_child"))?;
            if child.try_wait()?.is_none() {
                child.kill()?;
            }
            Ok(())
        })();
        cleanup_session_paths(&session.cleanup_paths);
        close_result
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
    child: Mutex<ChildHandle>,
    cols: u16,
    cwd: Option<PathBuf>,
    id: String,
    master: MasterHandle,
    pid: Option<u32>,
    rows: u16,
    shell: String,
    target_ref: Option<String>,
    target_token: Option<TerminalTargetCapability>,
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    cleanup_paths: Vec<PathBuf>,
    writer: SharedWriterHandle,
}

impl TerminalSession {
    fn summary(&self) -> AppResult<TerminalSessionSummary> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_child"))?;
        let status = if child.try_wait()?.is_some() {
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
        })
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

struct ActiveTerminalLog {
    bytes_written: u64,
    file: File,
    pending_text: String,
    path: PathBuf,
    started_at: String,
}

impl ActiveTerminalLog {
    fn append(&mut self, data: &str) -> AppResult<()> {
        self.pending_text.push_str(data);
        let Some(flush_end) = self.redactable_prefix_end() else {
            return Ok(());
        };
        let remaining = self.pending_text.split_off(flush_end);
        let data = std::mem::replace(&mut self.pending_text, remaining);
        self.write_redacted(&data)
    }

    fn flush_pending(&mut self) -> AppResult<()> {
        if !self.pending_text.is_empty() {
            let data = std::mem::take(&mut self.pending_text);
            self.write_redacted(&data)?;
        }
        self.file.flush()?;
        Ok(())
    }

    fn redactable_prefix_end(&self) -> Option<usize> {
        if let Some(line_end) = self
            .pending_text
            .rfind('\n')
            .map(|index| index + '\n'.len_utf8())
        {
            return Some(line_end);
        }

        split_prefix_before_tail(&self.pending_text, LOG_REDACTION_PENDING_CHARS)
    }

    fn write_redacted(&mut self, data: &str) -> AppResult<()> {
        let (data, _) = redact_terminal_text(data);
        self.file.write_all(data.as_bytes())?;
        self.bytes_written += data.len() as u64;
        Ok(())
    }

    fn state(&self, active: bool) -> TerminalSessionLogState {
        TerminalSessionLogState {
            active,
            path: Some(self.path.to_string_lossy().into_owned()),
            started_at: Some(self.started_at.clone()),
            bytes_written: self.bytes_written,
        }
    }
}

fn split_prefix_before_tail(input: &str, tail_chars: usize) -> Option<usize> {
    let split_char_index = input.chars().count().checked_sub(tail_chars)?;
    if split_char_index == 0 {
        return None;
    }
    input
        .char_indices()
        .nth(split_char_index)
        .map(|(byte_index, _)| byte_index)
}

#[allow(clippy::too_many_arguments)]
fn spawn_reader_thread(
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    cleanup_paths: Vec<PathBuf>,
    writer: SharedWriterHandle,
    secret_input_plan: Option<TerminalSecretInputPlan>,
    output: OutputEmitter,
) {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; READ_BUFFER_SIZE];
        let mut secret_responder = secret_input_plan.map(TerminalSecretInputResponder::new);

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = output(TerminalOutputEvent::closed(&session_id));
                    break;
                }
                Ok(bytes_read) => {
                    let mut data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
                    if let Some(responder) = secret_responder.as_mut() {
                        responder.observe_and_maybe_respond(&data, &writer);
                        data = responder.redact_output(&data);
                    }
                    if let Ok(mut output_buffer) = output_buffer.lock() {
                        output_buffer.push(&data);
                    }
                    if let Ok(mut log_sink) = log_sink.lock() {
                        if let Some(active_log) = log_sink.as_mut() {
                            let _ = active_log.append(&data);
                        }
                    }
                    if !output(TerminalOutputEvent::data(&session_id, data)) {
                        break;
                    }
                }
                Err(error) => {
                    let _ = output(TerminalOutputEvent::error(&session_id, error.to_string()));
                    break;
                }
            }
        }
        cleanup_session_paths(&cleanup_paths);
    });
}

struct TerminalSecretInputResponder {
    entries: Vec<TerminalSecretInputResponderEntry>,
    marker_buffer: String,
    redact_values: Vec<String>,
}

struct TerminalSecretInputResponderEntry {
    max_responses: usize,
    prompt_markers: Vec<String>,
    response: String,
    responses_sent: usize,
}

impl TerminalSecretInputResponder {
    fn new(config: impl Into<TerminalSecretInputPlan>) -> Self {
        let config = config.into();
        let redact_values = config.redact_values();
        let entries = config
            .entries
            .into_iter()
            .filter_map(TerminalSecretInputResponderEntry::from_entry)
            .collect();
        Self {
            entries,
            marker_buffer: String::new(),
            redact_values,
        }
    }

    fn observe_and_maybe_respond(&mut self, data: &str, writer: &SharedWriterHandle) {
        if !self.entries.iter().any(|entry| entry.can_respond()) {
            return;
        }

        self.marker_buffer.push_str(&data.to_ascii_lowercase());
        trim_marker_buffer(&mut self.marker_buffer);

        let Some(entry_index) = self.best_matching_entry_index() else {
            return;
        };
        let entry = &mut self.entries[entry_index];

        if let Ok(mut writer) = writer.lock() {
            let _ = writer.write_all(entry.response.as_bytes());
            let _ = writer.write_all(b"\r");
            let _ = writer.flush();
        }
        entry.responses_sent = entry.responses_sent.saturating_add(1);
        self.marker_buffer.clear();
    }

    fn best_matching_entry_index(&self) -> Option<usize> {
        let mut best: Option<(usize, PromptMatchStrength)> = None;
        for (index, entry) in self.entries.iter().enumerate() {
            if !entry.can_respond() {
                continue;
            }
            let Some(strength) =
                secret_prompt_match_strength(&self.marker_buffer, &entry.prompt_markers)
            else {
                continue;
            };
            if best.is_none_or(|(_, best_strength)| strength > best_strength) {
                best = Some((index, strength));
            }
        }
        best.map(|(index, _)| index)
    }

    fn redact_output(&self, data: &str) -> String {
        if self.redact_values.is_empty() {
            return data.to_owned();
        }

        let mut redacted = data.to_owned();
        for value in &self.redact_values {
            redacted = redacted.replace(value, "[已脱敏]");
        }
        redacted
    }
}

impl TerminalSecretInputResponderEntry {
    fn from_entry(entry: TerminalSecretInputEntry) -> Option<Self> {
        let prompt_markers = entry
            .prompt_markers
            .into_iter()
            .map(|marker| marker.to_ascii_lowercase())
            .filter(|marker| !marker.trim().is_empty())
            .collect::<Vec<_>>();
        if entry.response.is_empty() || entry.max_responses == 0 || prompt_markers.is_empty() {
            return None;
        }
        Some(Self {
            max_responses: entry.max_responses,
            prompt_markers,
            response: entry.response,
            responses_sent: 0,
        })
    }

    fn can_respond(&self) -> bool {
        self.responses_sent < self.max_responses
    }
}

#[cfg(test)]
fn secret_prompt_matches(buffer: &str, prompt_markers: &[String]) -> bool {
    secret_prompt_match_strength(buffer, prompt_markers).is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum PromptMatchStrength {
    GenericFallback,
    Specific,
}

fn secret_prompt_match_strength(
    buffer: &str,
    prompt_markers: &[String],
) -> Option<PromptMatchStrength> {
    let visible_buffer = strip_terminal_controls(buffer);
    let prompt_line = visible_buffer
        .rsplit(['\r', '\n'])
        .next()
        .unwrap_or(visible_buffer.as_str())
        .trim_end();
    if prompt_line.is_empty() {
        return None;
    }

    prompt_markers
        .iter()
        .filter_map(|marker| prompt_line_match_strength(prompt_line, marker))
        .max()
}

fn prompt_line_match_strength(prompt_line: &str, marker: &str) -> Option<PromptMatchStrength> {
    let marker = marker.trim();
    if marker.is_empty() {
        return None;
    }
    if looks_like_password_history_line(prompt_line) {
        return None;
    }
    if marker == "password:" {
        return generic_password_prompt_line(prompt_line)
            .then_some(PromptMatchStrength::GenericFallback);
    }
    (prompt_line == marker).then_some(PromptMatchStrength::Specific)
}

fn looks_like_password_history_line(prompt_line: &str) -> bool {
    const FALSE_POSITIVE_FRAGMENTS: &[&str] = &[
        "accepted password",
        "bad password",
        "failed password",
        "failure password",
        "invalid password",
        "last failed",
        "password changed",
        "password expired",
    ];

    FALSE_POSITIVE_FRAGMENTS
        .iter()
        .any(|fragment| prompt_line.contains(fragment))
}

fn generic_password_prompt_line(prompt_line: &str) -> bool {
    prompt_line == "password:"
        || prompt_line.ends_with("'s password:")
        || prompt_line.starts_with("enter password")
        || prompt_line.starts_with("password for ")
}

fn strip_terminal_controls(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            consume_escape_sequence(&mut chars);
            continue;
        }
        if character == '\u{7}' {
            continue;
        }
        if character.is_control() && character != '\r' && character != '\n' && character != '\t' {
            continue;
        }
        output.push(character);
    }

    output
}

fn consume_escape_sequence<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    match chars.peek().copied() {
        Some(']') => {
            let _ = chars.next();
            consume_osc_sequence(chars);
        }
        Some('[') => {
            let _ = chars.next();
            consume_csi_sequence(chars);
        }
        Some(_) => {
            let _ = chars.next();
        }
        None => {}
    }
}

fn consume_osc_sequence<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    while let Some(character) = chars.next() {
        if character == '\u{7}' {
            break;
        }
        if character == '\u{1b}' && chars.peek().copied() == Some('\\') {
            let _ = chars.next();
            break;
        }
    }
}

fn consume_csi_sequence<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    for character in chars.by_ref() {
        if ('@'..='~').contains(&character) {
            break;
        }
    }
}

fn trim_marker_buffer(buffer: &mut String) {
    const MAX_MARKER_BUFFER_BYTES: usize = 1024;
    if buffer.len() <= MAX_MARKER_BUFFER_BYTES {
        return;
    }

    let drain_end = next_char_boundary(buffer, buffer.len() - MAX_MARKER_BUFFER_BYTES);
    buffer.drain(..drain_end);
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

#[derive(Default)]
struct TerminalOutputBuffer {
    data: String,
    truncated: bool,
}

impl TerminalOutputBuffer {
    fn push(&mut self, data: &str) {
        self.data.push_str(data);
        if self.data.len() <= TERMINAL_CONTEXT_BUFFER_BYTES {
            return;
        }

        let overflow = self.data.len() - TERMINAL_CONTEXT_BUFFER_BYTES;
        let drain_end = next_char_boundary(&self.data, overflow);
        self.data.drain(..drain_end);
        self.truncated = true;
    }

    fn snapshot(&self, max_bytes: usize) -> TerminalOutputSnapshot {
        let max_bytes = max_bytes.clamp(1, TERMINAL_CONTEXT_BUFFER_BYTES);
        let (data, truncated_by_request) = tail_by_bytes(&self.data, max_bytes);

        TerminalOutputSnapshot {
            captured_bytes: data.len(),
            data,
            max_bytes,
            truncated: self.truncated || truncated_by_request,
        }
    }
}

fn tail_by_bytes(data: &str, max_bytes: usize) -> (String, bool) {
    if data.len() <= max_bytes {
        return (data.to_owned(), false);
    }

    let start = next_char_boundary(data, data.len() - max_bytes);
    (data[start..].to_owned(), true)
}

fn next_char_boundary(data: &str, mut index: usize) -> usize {
    while index < data.len() && !data.is_char_boundary(index) {
        index += 1;
    }
    index
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

#[cfg(test)]
mod tests;
