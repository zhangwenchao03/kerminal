//! AI 工具调用 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::models::tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel};

/// AI 工具调用准备请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolPrepareRequest {
    /// Tool Registry 中的稳定工具 id。
    pub tool_id: String,
    /// 工具结构化参数。
    #[serde(default)]
    pub arguments: Value,
    /// 请求来源说明，例如 kerminal-agent、ai-panel 或 browser-preview。
    pub requested_by: Option<String>,
    /// AI 给出的用户可见意图说明。
    pub reason: Option<String>,
}

/// AI 工具调用确认请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolConfirmRequest {
    /// 待确认调用 id。
    pub invocation_id: String,
    /// 用户是否批准执行。
    pub approved: bool,
}

/// AI 工具审计列表请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolAuditListRequest {
    /// 最多返回多少条最近审计。后端会按安全上限截断。
    pub limit: Option<usize>,
}

/// 工具调用生命周期状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiToolInvocationStatus {
    /// 等待用户确认。
    Pending,
    /// 用户拒绝执行。
    Rejected,
    /// 已确认并执行成功。
    Succeeded,
    /// 已确认但执行失败。
    Failed,
}

/// 需要前端工作区在确认后执行的受控动作类型。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiToolClientActionKind {
    /// 创建新的本地终端 tab。
    TerminalCreate,
    /// 打开已保存 SSH 主机终端。
    SshConnect,
    /// 分割当前工作区焦点 pane。
    WorkspaceSplitPane,
    /// 切换当前工作区的活动终端 tab。
    WorkspaceFocusTab,
    /// 打开右侧工具面板。
    WorkspaceOpenTool,
}

/// Rust 白名单化后的客户端动作描述。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolClientAction {
    /// 客户端动作类型。
    pub kind: AiToolClientActionKind,
    /// 分屏方向，仅用于 `workspaceSplitPane`。
    pub direction: Option<String>,
    /// 新终端 tab 标题，仅用于 `terminalCreate`。
    pub title: Option<String>,
    /// 新终端 shell 或命令，仅用于 `terminalCreate`。
    pub shell: Option<String>,
    /// 新终端启动参数，仅用于 `terminalCreate`。
    pub args: Option<Vec<String>>,
    /// 新终端工作目录，仅用于 `terminalCreate`。
    pub cwd: Option<String>,
    /// 新终端环境变量覆盖，仅用于 `terminalCreate`。
    pub env: Option<HashMap<String, String>>,
    /// 已保存 SSH 主机 id，仅用于 `sshConnect`。
    pub host_id: Option<String>,
    /// 终端 tab id，仅用于 `workspaceFocusTab`。
    pub tab_id: Option<String>,
    /// 右侧工具面板 id，仅用于 `workspaceOpenTool`。
    pub tool_id: Option<String>,
    /// 请求的初始列数，仅用于 `terminalCreate`。
    pub cols: Option<u16>,
    /// 请求的初始行数，仅用于 `terminalCreate`。
    pub rows: Option<u16>,
}

/// 待确认 AI 工具调用。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolPendingInvocation {
    /// 待确认调用 id。
    pub id: String,
    /// 工具 id。
    pub tool_id: String,
    /// 中文工具标题。
    pub tool_title: String,
    /// 工具风险等级。
    pub risk: ToolRiskLevel,
    /// 工具确认策略。
    pub confirmation: ToolConfirmationPolicy,
    /// 工具审计策略。
    pub audit: ToolAuditPolicy,
    /// 参数摘要，已脱敏和截断。
    pub arguments_summary: String,
    /// 风险摘要，说明本次调用为什么需要更强确认。
    pub risk_summary: Option<String>,
    /// 确认成功后需要前端工作区执行的受控动作。
    pub client_action: Option<AiToolClientAction>,
    /// AI 给出的用户可见意图说明。
    pub reason: Option<String>,
    /// 请求来源说明。
    pub requested_by: Option<String>,
    /// 是否必须确认后执行。
    pub requires_confirmation: bool,
    /// 当前状态。
    pub status: AiToolInvocationStatus,
    /// 创建时间，Unix 秒字符串。
    pub created_at: String,
}

/// AI 工具调用审计记录。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolAuditRecord {
    /// 审计记录 id。
    pub id: String,
    /// 对应 pending invocation id。
    pub invocation_id: String,
    /// 工具 id。
    pub tool_id: String,
    /// 中文工具标题。
    pub tool_title: String,
    /// 工具风险等级。
    pub risk: ToolRiskLevel,
    /// 工具确认策略。
    pub confirmation: ToolConfirmationPolicy,
    /// 参数摘要。
    pub arguments_summary: String,
    /// 风险摘要，说明本次调用为什么需要更强确认。
    pub risk_summary: Option<String>,
    /// 调用状态。
    pub status: AiToolInvocationStatus,
    /// 执行结果摘要。
    pub result_summary: Option<String>,
    /// 失败原因。
    pub error: Option<String>,
    /// 创建时间，Unix 秒字符串。
    pub created_at: String,
    /// 完成时间，Unix 秒字符串。
    pub completed_at: String,
}

/// AI 工具审计导出载荷。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolAuditExport {
    /// 导出时间，Unix 秒字符串。
    pub exported_at: String,
    /// 导出记录数。
    pub count: usize,
    /// 审计记录列表，按完成时间倒序。
    pub records: Vec<AiToolAuditRecord>,
}

/// AI 工具审计清空结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolAuditClearResponse {
    /// 本次清空删除的记录数。
    pub cleared_count: usize,
}
