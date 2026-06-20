//! AI 上下文 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::terminal::{TerminalOutputSnapshot, TerminalSessionSummary};

/// 请求当前终端上下文的参数。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTerminalContextRequest {
    /// 当前 pane 绑定的 terminal session id。
    pub session_id: String,
    /// 前端工作台 pane id，用于审计和用户可见定位。
    pub pane_id: Option<String>,
    /// 当前 pane 标题。
    pub pane_title: Option<String>,
    /// 当前 tab id。
    pub tab_id: Option<String>,
    /// 当前 tab 标题。
    pub tab_title: Option<String>,
    /// 当前主机 id。
    pub machine_id: Option<String>,
    /// 当前主机名称。
    pub machine_name: Option<String>,
    /// 当前主机类型，例如 local 或 ssh。
    pub machine_kind: Option<String>,
    /// 最近输出最大字节数；为空时使用服务默认值。
    pub max_output_bytes: Option<usize>,
}

/// AI 上下文来源元数据。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTerminalContextSource {
    /// 前端工作台 pane id。
    pub pane_id: Option<String>,
    /// 当前 pane 标题。
    pub pane_title: Option<String>,
    /// 当前 tab id。
    pub tab_id: Option<String>,
    /// 当前 tab 标题。
    pub tab_title: Option<String>,
    /// 当前主机 id。
    pub machine_id: Option<String>,
    /// 当前主机名称。
    pub machine_name: Option<String>,
    /// 当前主机类型。
    pub machine_kind: Option<String>,
}

/// 本次上下文采集策略快照。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiContextPolicySnapshot {
    /// 当前策略模式，后续会和 LLM provider context strategy 对齐。
    pub mode: String,
    /// 是否包含最近终端输出。
    pub includes_recent_output: bool,
    /// 是否包含完整终端历史。
    pub includes_full_history: bool,
    /// 是否启用基础密钥脱敏。
    pub secret_redaction: bool,
    /// 最近输出最大字节数。
    pub max_output_bytes: usize,
}

/// AI 可读取的当前终端上下文快照。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTerminalContextSnapshot {
    /// 快照生成时间，Unix 秒字符串。
    pub generated_at: String,
    /// 当前 session 摘要。
    pub session: TerminalSessionSummary,
    /// 工作台来源信息。
    pub source: AiTerminalContextSource,
    /// 最近终端输出。
    pub output: TerminalOutputSnapshot,
    /// 输出是否经过基础脱敏。
    pub redacted: bool,
    /// 本次上下文策略。
    pub policy: AiContextPolicySnapshot,
}
