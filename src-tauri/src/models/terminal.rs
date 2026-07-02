//! 终端会话 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::ErrorKind, path::PathBuf};

use crate::error::AppError;

/// 创建本地终端会话的请求参数。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateRequest {
    /// 需要启动的 shell 或命令；为空时使用当前平台默认 shell。
    pub shell: Option<String>,
    /// 传给 shell 的参数，后续 profile 会从这里扩展启动命令能力。
    #[serde(default)]
    pub args: Vec<String>,
    /// 进程工作目录；为空时继承应用进程工作目录。
    #[serde(default)]
    pub cwd: Option<String>,
    /// 初始列数。
    pub cols: u16,
    /// 初始行数。
    pub rows: u16,
    /// 会话级环境变量覆盖。
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 后端为会话创建的临时文件，关闭或读线程退出时清理；不参与 IPC。
    #[serde(skip)]
    pub cleanup_paths: Vec<PathBuf>,
}

/// 后端内部的多敏感输入自动响应计划。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TerminalSecretInputPlan {
    /// 按预期出现顺序排列的敏感输入条目。
    pub entries: Vec<TerminalSecretInputEntry>,
}

impl TerminalSecretInputPlan {
    /// 返回终端输出、快照和日志都需要脱敏的敏感值。
    pub fn redact_values(&self) -> Vec<String> {
        let mut values = Vec::new();
        for entry in &self.entries {
            push_unique_redact_value(&mut values, &entry.response);
            for value in &entry.redact_values {
                push_unique_redact_value(&mut values, value);
            }
        }
        values
    }
}

/// 后端内部的单个敏感输入自动响应条目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSecretInputEntry {
    /// 条目的稳定 id，用于 route plan 和测试断言区分来源。
    pub id: String,
    /// 条目的用户或日志可读标签；不得包含 secret。
    pub label: String,
    /// 输出中触发自动响应的提示文本片段，大小写不敏感。
    pub prompt_markers: Vec<String>,
    /// 要写入 PTY 的敏感内容，不包含回车。
    pub response: String,
    /// 如果远端异常回显敏感内容，输出事件、快照和日志中要精确替换的值。
    pub redact_values: Vec<String>,
    /// 最多自动响应次数。
    pub max_responses: usize,
}

fn push_unique_redact_value(values: &mut Vec<String>, value: &str) {
    if value.is_empty() || values.iter().any(|existing| existing == value) {
        return;
    }
    values.push(value.to_owned());
}

/// 创建 SSH 远程终端会话的请求参数。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTerminalCreateRequest {
    /// 远程主机配置 id。
    pub host_id: String,
    /// 可选远程初始工作目录；为空时使用远程登录 shell 默认目录。
    #[serde(default)]
    pub cwd: Option<String>,
    /// 可选远端启动命令；为空时进入远端登录 shell。
    #[serde(default)]
    pub remote_command: Option<String>,
    /// 初始列数。
    pub cols: u16,
    /// 初始行数。
    pub rows: u16,
}

/// 创建 Telnet 远程终端会话的请求参数。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelnetTerminalCreateRequest {
    /// 远程主机配置 id。
    pub host_id: String,
    /// 初始列数。
    pub cols: u16,
    /// 初始行数。
    pub rows: u16,
}

/// 创建 Serial 串口终端会话的请求参数。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SerialTerminalCreateRequest {
    /// 远程主机配置 id，串口配置从对应主机 tags 中解析。
    pub host_id: String,
    /// 初始列数。
    pub cols: u16,
    /// 初始行数。
    pub rows: u16,
}

impl Default for TerminalCreateRequest {
    fn default() -> Self {
        Self {
            shell: None,
            args: Vec::new(),
            cwd: None,
            cols: 80,
            rows: 24,
            env: HashMap::new(),
            cleanup_paths: Vec::new(),
        }
    }
}

/// 调整终端尺寸的请求参数。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    /// 目标列数。
    pub cols: u16,
    /// 目标行数。
    pub rows: u16,
}

/// 终端输出事件类型。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalOutputKind {
    /// PTY 输出的数据块。
    Data,
    /// PTY 内 Agent CLI 发出的状态信号，不属于可写入终端的数据流。
    AgentSignal,
    /// PTY 输出流已经关闭。
    Closed,
    /// 读取 PTY 输出时发生错误。
    Error,
}

/// Kerminal 识别的外部 Agent 类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalAgentKind {
    /// OpenAI Codex CLI。
    Codex,
    /// Anthropic Claude Code CLI。
    Claude,
    /// Google Gemini CLI。
    Gemini,
}

impl TerminalAgentKind {
    /// 返回稳定的协议 id。
    pub fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }

    /// 从协议 id 解析 Agent 类型。
    pub fn from_id(id: &str) -> Option<Self> {
        match id.trim().to_ascii_lowercase().as_str() {
            "codex" => Some(Self::Codex),
            "claude" => Some(Self::Claude),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }
}

/// Kerminal 识别的 Agent CLI 运行态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalAgentStatus {
    /// Agent 正在处理任务。
    Working,
    /// Agent 需要用户注意或输入。
    Attention,
    /// Agent 已完成当前任务。
    Finished,
    /// Agent 所在 PTY 已退出。
    Exited,
}

impl TerminalAgentStatus {
    /// 从 Kerminal OSC marker event 解析状态。
    pub fn from_marker_event(event: &str) -> Option<Self> {
        match event.trim().to_ascii_lowercase().as_str() {
            "working" => Some(Self::Working),
            "attention" => Some(Self::Attention),
            "finished" => Some(Self::Finished),
            _ => None,
        }
    }
}

/// 从 PTY OSC 序列解析出的 Agent 状态信号。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalAgentSignal {
    /// Agent 类型。
    pub agent: TerminalAgentKind,
    /// Agent 状态。
    pub status: TerminalAgentStatus,
}

/// 前端、MCP 和 session summary 可消费的 typed Agent 状态事件。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgentSignalSummary {
    /// Agent terminal 所属的 Kerminal Agent session id。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
    /// 产生信号的终端 session id。
    pub terminal_session_id: String,
    /// Agent 类型。
    pub agent: TerminalAgentKind,
    /// Agent 状态。
    pub status: TerminalAgentStatus,
}

impl TerminalAgentSignalSummary {
    /// 将 detector 信号补充为带 session 归属的 IPC summary。
    pub fn new(
        terminal_session_id: &str,
        agent_session_id: Option<&str>,
        signal: TerminalAgentSignal,
    ) -> Self {
        Self {
            agent_session_id: agent_session_id.map(str::to_owned),
            terminal_session_id: terminal_session_id.to_owned(),
            agent: signal.agent,
            status: signal.status,
        }
    }
}

/// Rust 通过 Tauri Channel 推送给前端的终端输出事件。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    /// 产生事件的 session id。
    pub session_id: String,
    /// 事件类型。
    pub kind: TerminalOutputKind,
    /// 输出数据或错误摘要。
    pub data: String,
    /// Agent 状态事件；只有 `kind == AgentSignal` 时有值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_signal: Option<TerminalAgentSignalSummary>,
    /// 错误事件的可分类摘要；只有 `kind == Error` 时有值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<TerminalCommandError>,
}

impl TerminalOutputEvent {
    /// 创建普通输出事件。
    pub fn data(session_id: &str, data: String) -> Self {
        Self {
            session_id: session_id.to_owned(),
            kind: TerminalOutputKind::Data,
            data,
            agent_signal: None,
            error: None,
        }
    }

    /// 创建 Agent typed signal 事件。
    pub fn agent_signal(summary: TerminalAgentSignalSummary) -> Self {
        Self {
            session_id: summary.terminal_session_id.clone(),
            kind: TerminalOutputKind::AgentSignal,
            data: String::new(),
            agent_signal: Some(summary),
            error: None,
        }
    }

    /// 创建关闭事件。
    pub fn closed(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_owned(),
            kind: TerminalOutputKind::Closed,
            data: String::new(),
            agent_signal: None,
            error: None,
        }
    }

    /// 创建错误事件。
    pub fn error(session_id: &str, message: String) -> Self {
        let terminal_error = TerminalCommandError::from_app_error(
            TerminalErrorOperation::ReadOutput,
            &AppError::Terminal(message.clone()),
        );
        Self {
            session_id: session_id.to_owned(),
            kind: TerminalOutputKind::Error,
            data: message,
            agent_signal: None,
            error: Some(terminal_error),
        }
    }
}

/// 终端会话运行状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionStatus {
    /// 子进程仍在运行。
    Running,
    /// 子进程已经退出。
    Exited,
}

/// 前端可展示和追踪的终端会话摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSummary {
    /// 稳定 session id。
    pub id: String,
    /// 启动的 shell 或命令。
    pub shell: String,
    /// 进程工作目录。
    pub cwd: Option<String>,
    /// 当前列数。
    pub cols: u16,
    /// 当前行数。
    pub rows: u16,
    /// 子进程 id。
    pub pid: Option<u32>,
    /// 会话运行状态。
    pub status: TerminalSessionStatus,
    /// 后端按会话创建来源生成的目标引用，用于和前端 pane binding 交叉校验。
    pub target_ref: Option<String>,
    /// 后端签发的目标绑定 capability token；前端只能原样透传，不能生成。
    pub target_token: Option<String>,
    /// 本地 shell integration 启用状态；远程、容器和裸 shell 会保持 disabled。
    pub shell_integration: TerminalShellIntegrationSummary,
    /// 如果这是右栏 Agent terminal，则为对应 Kerminal Agent session id。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
    /// 该终端最近一次 Agent typed signal。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_signal: Option<TerminalAgentSignalSummary>,
}

/// 终端 shell integration 状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalShellIntegrationStatus {
    /// 后端已用 Kerminal shell integration wrapper 启动本地 shell。
    Enabled,
    /// 本会话未启用 shell integration，继续使用裸 shell 行为。
    Disabled,
}

/// 终端 shell integration 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShellIntegrationSummary {
    /// 是否启用 shell integration。
    pub status: TerminalShellIntegrationStatus,
    /// 启用时识别到的 shell kind。
    pub shell: Option<String>,
    /// 启用时注入的脚本路径。
    pub script_path: Option<String>,
    /// 禁用或降级原因。
    pub reason: Option<String>,
}

impl TerminalShellIntegrationSummary {
    /// 返回禁用状态摘要。
    pub fn disabled(reason: impl Into<String>) -> Self {
        Self {
            status: TerminalShellIntegrationStatus::Disabled,
            shell: None,
            script_path: None,
            reason: Some(reason.into()),
        }
    }
}

/// 本地终端 orphan 会话收割诊断。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionReapDiagnostics {
    /// 本次从本地 PTY 管理器中移除的会话数量。
    pub reaped_count: usize,
    /// 被移除的本地 PTY session id。
    pub session_ids: Vec<String>,
    /// 同步移除、清理临时路径并调度后台 kill 所花费的毫秒数。
    pub elapsed_ms: u64,
}

/// PTY output pump 最近一次 flush 的原因。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalPtyOutputPumpFlushReason {
    /// 累积输出达到字节阈值后刷新。
    Threshold,
    /// coalescing 空闲窗口到期后刷新。
    Idle,
    /// 会话关闭前刷新最后输出尾部。
    Closed,
    /// 会话错误前刷新最后输出尾部。
    Error,
    /// pump 输入通道断开前刷新剩余输出。
    Disconnected,
}

/// 本地 PTY output pump 的非敏感运行态指标。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPtyOutputPumpStats {
    /// 产生指标的本地终端 session id。
    pub session_id: String,
    /// 当前尚未发送给前端的 pending 输出字节数。
    pub pending_bytes: usize,
    /// 当前 pending 输出中合并的输入 chunk 数。
    pub buffered_chunks: u64,
    /// 已接收的输入 chunk 数。
    pub input_chunks: u64,
    /// 已接收的输入字节数。
    pub input_bytes: u64,
    /// 已发送给前端的 data 事件数量。
    pub data_events: u64,
    /// 已发送的 closed 事件数量。
    pub closed_events: u64,
    /// 已发送的 error 事件数量。
    pub error_events: u64,
    /// 已发送给前端的 data 字节数。
    pub output_bytes: u64,
    /// 已执行的非空 data flush 次数。
    pub flush_count: u64,
    /// 已通过 flush 发出的输入 chunk 累计数。
    pub coalesced_chunks: u64,
    /// 本会话历史最高 pending 字节数。
    pub max_pending_bytes: usize,
    /// pending 达到或超过上限的次数。
    pub max_pending_hit_count: u64,
    /// 被 backpressure 丢弃的字节数。
    pub dropped_bytes: u64,
    /// output backlog overflow 发生次数。
    pub overflow_count: u64,
    /// close/error 前刷新最终输出尾部的次数。
    pub final_tail_flush_count: u64,
    /// 最近一次非空 flush 距离首个 pending chunk 的毫秒数。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_flush_interval_ms: Option<u64>,
    /// 最近一次非空 flush 的触发原因。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_flush_reason: Option<TerminalPtyOutputPumpFlushReason>,
    /// pump 所在 flusher 是否已经结束。
    pub finished: bool,
}

/// 终端操作失败的可分类错误类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalErrorClass {
    /// 子进程或终端客户端启动失败。
    SpawnFailed,
    /// PTY 输出读取失败。
    PtyReadFailed,
    /// PTY 输入写入失败。
    PtyWriteFailed,
    /// 终端尺寸调整失败。
    ResizeFailed,
    /// 会话已关闭或底层管道断开。
    SessionClosed,
    /// 会话 id 不存在。
    SessionNotFound,
    /// 权限不足。
    PermissionDenied,
    /// 用户输入或配置不合法。
    InvalidInput,
    /// 输出编码或解码失败。
    EncodingFailure,
    /// 会话日志读写失败。
    LoggingFailure,
    /// 运行态共享状态不可用。
    StateUnavailable,
    /// 终端依赖或客户端缺失。
    DependencyMissing,
    /// 暂未归类的终端错误。
    Unknown,
}

/// 终端错误恢复建议。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalErrorRecovery {
    /// 可以自动或手动重试。
    Retryable,
    /// 需要用户修正配置、安装依赖或检查权限。
    UserActionRequired,
    /// 当前操作不应直接重试。
    NotRetryable,
    /// 内部状态异常，需要重启或提交诊断。
    Internal,
}

/// 发生错误的终端操作。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalErrorOperation {
    CreateSession,
    ReadOutput,
    Write,
    Resize,
    Close,
    ListSessions,
    SessionSummary,
    OutputSnapshot,
    StartLog,
    StopLog,
    LogState,
    ReapOrphanSessions,
    Diagnostics,
}

/// Tauri command 可序列化返回的终端错误摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandError {
    pub class: TerminalErrorClass,
    pub recovery: TerminalErrorRecovery,
    pub operation: TerminalErrorOperation,
    pub message: String,
    pub retryable: bool,
}

impl TerminalCommandError {
    pub fn from_app_error(operation: TerminalErrorOperation, error: &AppError) -> Self {
        let message = error.to_string();
        let class = classify_terminal_app_error(operation, error, &message);
        let recovery = recovery_for_terminal_error_class(class);
        Self {
            class,
            recovery,
            operation,
            message,
            retryable: recovery == TerminalErrorRecovery::Retryable,
        }
    }
}

fn classify_terminal_app_error(
    operation: TerminalErrorOperation,
    error: &AppError,
    message: &str,
) -> TerminalErrorClass {
    let lower_message = message.to_ascii_lowercase();
    match error {
        AppError::InvalidInput(_) => TerminalErrorClass::InvalidInput,
        AppError::NotFound(_) => TerminalErrorClass::SessionNotFound,
        AppError::StateLockPoisoned(_) => TerminalErrorClass::StateUnavailable,
        AppError::Io(error) => classify_terminal_io_error(operation, error.kind()),
        AppError::Terminal(_) => classify_terminal_message(operation, &lower_message),
        AppError::Credential(_) => TerminalErrorClass::PermissionDenied,
        _ => TerminalErrorClass::Unknown,
    }
}

fn classify_terminal_io_error(
    operation: TerminalErrorOperation,
    kind: ErrorKind,
) -> TerminalErrorClass {
    match kind {
        ErrorKind::PermissionDenied => TerminalErrorClass::PermissionDenied,
        ErrorKind::BrokenPipe | ErrorKind::ConnectionAborted | ErrorKind::NotConnected => {
            TerminalErrorClass::SessionClosed
        }
        ErrorKind::NotFound if operation == TerminalErrorOperation::CreateSession => {
            TerminalErrorClass::SpawnFailed
        }
        _ if matches!(
            operation,
            TerminalErrorOperation::StartLog
                | TerminalErrorOperation::StopLog
                | TerminalErrorOperation::LogState
        ) =>
        {
            TerminalErrorClass::LoggingFailure
        }
        _ if operation == TerminalErrorOperation::ReadOutput => TerminalErrorClass::PtyReadFailed,
        _ if operation == TerminalErrorOperation::Write => TerminalErrorClass::PtyWriteFailed,
        _ if operation == TerminalErrorOperation::Resize => TerminalErrorClass::ResizeFailed,
        _ if operation == TerminalErrorOperation::CreateSession => TerminalErrorClass::SpawnFailed,
        _ => TerminalErrorClass::Unknown,
    }
}

fn classify_terminal_message(
    operation: TerminalErrorOperation,
    lower_message: &str,
) -> TerminalErrorClass {
    if lower_message.contains("终端会话不存在") {
        return TerminalErrorClass::SessionNotFound;
    }
    if lower_message.contains("permission") || lower_message.contains("denied") {
        return TerminalErrorClass::PermissionDenied;
    }
    if lower_message.contains("未找到")
        || lower_message.contains("not found")
        || lower_message.contains("cannot find")
    {
        return TerminalErrorClass::DependencyMissing;
    }
    if lower_message.contains("encoding") || lower_message.contains("utf") {
        return TerminalErrorClass::EncodingFailure;
    }
    match operation {
        TerminalErrorOperation::CreateSession => TerminalErrorClass::SpawnFailed,
        TerminalErrorOperation::ReadOutput => TerminalErrorClass::PtyReadFailed,
        TerminalErrorOperation::Write => TerminalErrorClass::PtyWriteFailed,
        TerminalErrorOperation::Resize => TerminalErrorClass::ResizeFailed,
        TerminalErrorOperation::StartLog
        | TerminalErrorOperation::StopLog
        | TerminalErrorOperation::LogState => TerminalErrorClass::LoggingFailure,
        _ => TerminalErrorClass::Unknown,
    }
}

fn recovery_for_terminal_error_class(class: TerminalErrorClass) -> TerminalErrorRecovery {
    match class {
        TerminalErrorClass::PtyReadFailed
        | TerminalErrorClass::PtyWriteFailed
        | TerminalErrorClass::ResizeFailed => TerminalErrorRecovery::Retryable,
        TerminalErrorClass::InvalidInput
        | TerminalErrorClass::PermissionDenied
        | TerminalErrorClass::DependencyMissing
        | TerminalErrorClass::SpawnFailed
        | TerminalErrorClass::EncodingFailure
        | TerminalErrorClass::LoggingFailure => TerminalErrorRecovery::UserActionRequired,
        TerminalErrorClass::StateUnavailable => TerminalErrorRecovery::Internal,
        TerminalErrorClass::SessionClosed | TerminalErrorClass::SessionNotFound => {
            TerminalErrorRecovery::NotRetryable
        }
        TerminalErrorClass::Unknown => TerminalErrorRecovery::Internal,
    }
}

impl TerminalPtyOutputPumpStats {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            pending_bytes: 0,
            buffered_chunks: 0,
            input_chunks: 0,
            input_bytes: 0,
            data_events: 0,
            closed_events: 0,
            error_events: 0,
            output_bytes: 0,
            flush_count: 0,
            coalesced_chunks: 0,
            max_pending_bytes: 0,
            max_pending_hit_count: 0,
            dropped_bytes: 0,
            overflow_count: 0,
            final_tail_flush_count: 0,
            last_flush_interval_ms: None,
            last_flush_reason: None,
            finished: false,
        }
    }
}

/// 当前终端会话日志记录状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionLogState {
    /// 是否正在把新输出写入日志文件。
    pub active: bool,
    /// 当前或刚停止的日志文件路径。
    pub path: Option<String>,
    /// 日志开始时间，使用 Unix 秒字符串，避免引入额外时间依赖。
    pub started_at: Option<String>,
    /// 已写入日志文件的字节数。
    pub bytes_written: u64,
}

impl TerminalSessionLogState {
    /// 返回未启用日志记录的状态。
    pub fn inactive() -> Self {
        Self {
            active: false,
            path: None,
            started_at: None,
            bytes_written: 0,
        }
    }
}

/// 本地终端会话的后端目标引用。
pub fn local_terminal_target_ref() -> String {
    "local".to_owned()
}

/// 远程主机类终端会话的后端目标引用。
pub fn host_terminal_target_ref(kind: &str, host_id: &str) -> String {
    format!("{}:{}", kind.trim(), host_id.trim())
}

/// 容器终端会话的后端目标引用。
pub fn docker_container_terminal_target_ref(host_id: &str, container_id: &str) -> String {
    format!("dockerContainer:{}:{}", host_id.trim(), container_id.trim())
}

/// 终端最近输出快照，用于外部 Agent / MCP 上下文预览。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputSnapshot {
    /// 最近输出内容，已经按请求上限截断。
    pub data: String,
    /// 当前返回内容的字节数。
    pub captured_bytes: usize,
    /// 本次请求允许返回的最大字节数。
    pub max_bytes: usize,
    /// 输出是否因为内存 buffer 或请求上限被截断。
    pub truncated: bool,
}
