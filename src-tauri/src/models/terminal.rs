//! 终端会话 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};

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
    /// 后端内部的一次性敏感输入自动响应；不参与 IPC，避免前端注入 secret。
    #[serde(skip)]
    pub secret_input_response: Option<TerminalSecretInputResponse>,
}

/// 后端内部的敏感输入自动响应配置。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSecretInputResponse {
    /// 输出中触发自动响应的提示文本片段，大小写不敏感。
    pub prompt_markers: Vec<String>,
    /// 要写入 PTY 的敏感内容，不包含回车。
    pub response: String,
    /// 如果远端异常回显敏感内容，输出事件、快照和日志中要精确替换的值。
    pub redact_values: Vec<String>,
    /// 最多自动响应次数，SSH 密码默认 1 次。
    pub max_responses: u8,
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

impl From<TerminalSecretInputResponse> for TerminalSecretInputPlan {
    fn from(response: TerminalSecretInputResponse) -> Self {
        Self {
            entries: vec![TerminalSecretInputEntry::from(response)],
        }
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

impl From<TerminalSecretInputResponse> for TerminalSecretInputEntry {
    fn from(response: TerminalSecretInputResponse) -> Self {
        Self {
            id: "legacy-secret".to_owned(),
            label: "secret".to_owned(),
            prompt_markers: response.prompt_markers,
            response: response.response,
            redact_values: response.redact_values,
            max_responses: usize::from(response.max_responses),
        }
    }
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
            secret_input_response: None,
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
    /// PTY 输出流已经关闭。
    Closed,
    /// 读取 PTY 输出时发生错误。
    Error,
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
}

impl TerminalOutputEvent {
    /// 创建普通输出事件。
    pub fn data(session_id: &str, data: String) -> Self {
        Self {
            session_id: session_id.to_owned(),
            kind: TerminalOutputKind::Data,
            data,
        }
    }

    /// 创建关闭事件。
    pub fn closed(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_owned(),
            kind: TerminalOutputKind::Closed,
            data: String::new(),
        }
    }

    /// 创建错误事件。
    pub fn error(session_id: &str, message: String) -> Self {
        Self {
            session_id: session_id.to_owned(),
            kind: TerminalOutputKind::Error,
            data: message,
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

/// 终端最近输出快照，用于 AI 上下文预览和 Kerminal Agent 输入。
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
