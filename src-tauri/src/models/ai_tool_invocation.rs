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
    /// 归属 AI 会话 id，用于待确认调用持久化恢复。
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 归属会话 slot 描述 JSON，用于待确认调用持久化恢复。
    #[serde(default)]
    pub conversation_slot_json: Option<String>,
    /// 归属 agent run id，用于审批后恢复 harness loop。
    #[serde(default)]
    pub run_id: Option<String>,
    /// 归属 agent run step id，用于审批后写回 observation。
    #[serde(default)]
    pub step_id: Option<String>,
}

/// AI agent loop 请求“可执行则执行，否则返回待审批 observation”的工具调用。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolExecuteIfAllowedRequest {
    /// Tool Registry 中的稳定工具 id。
    pub tool_id: String,
    /// 工具结构化参数。
    #[serde(default)]
    pub arguments: Value,
    /// 请求来源说明，例如 kerminal-agent、ai-panel 或 browser-preview。
    pub requested_by: Option<String>,
    /// AI 给出的用户可见意图说明。
    pub reason: Option<String>,
    /// 归属 AI 会话 id，用于待确认调用持久化恢复。
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 归属会话 slot 描述 JSON，用于待确认调用持久化恢复。
    #[serde(default)]
    pub conversation_slot_json: Option<String>,
    /// 归属 agent run id，用于审批后恢复 harness loop。
    #[serde(default)]
    pub run_id: Option<String>,
    /// 归属 agent run step id，用于审批后写回 observation。
    #[serde(default)]
    pub step_id: Option<String>,
    /// 自动执行时写入审计的上下文。
    #[serde(default)]
    pub audit_context: Option<AiToolAuditContext>,
}

impl From<AiToolExecuteIfAllowedRequest> for AiToolPrepareRequest {
    fn from(request: AiToolExecuteIfAllowedRequest) -> Self {
        Self {
            tool_id: request.tool_id,
            arguments: request.arguments,
            requested_by: request.requested_by,
            reason: request.reason,
            conversation_id: request.conversation_id,
            conversation_slot_json: request.conversation_slot_json,
            run_id: request.run_id,
            step_id: request.step_id,
        }
    }
}

/// AI 工具调用确认请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolConfirmRequest {
    /// 待确认调用 id。
    pub invocation_id: String,
    /// 用户是否批准执行。
    pub approved: bool,
    /// 本次确认动作对应的会话、消息、上下文快照和附件引用。
    #[serde(default)]
    pub audit_context: Option<AiToolAuditContext>,
}

/// AI 工具审计列表请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolAuditListRequest {
    /// 最多返回多少条最近审计。后端会按安全上限截断。
    pub limit: Option<usize>,
}

/// AI 工具待确认调用上下文更新请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolPendingContextUpdateRequest {
    /// 待确认调用 id。
    pub invocation_id: String,
    /// 归属 AI 会话 id。
    pub conversation_id: Option<String>,
    /// 归属会话 slot 描述 JSON，由前端路由模型生成。
    pub conversation_slot_json: Option<String>,
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

/// Agent loop 可消费的工具 observation 状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiToolObservationStatus {
    /// 工具已执行成功。
    Succeeded,
    /// 工具执行失败。
    Failed,
    /// 工具已按策略准备好，但需要人工批准后才能执行。
    NeedsApproval,
    /// 策略或输入阻止了本次工具调用。
    Blocked,
}

/// Agent loop 可消费的结构化工具 observation。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolObservation {
    /// 稳定状态，供 agent run loop 分支判断。
    pub status: AiToolObservationStatus,
    /// 人类和模型都可读的短摘要，兼容旧 result_summary 语义。
    pub summary: Option<String>,
    /// 工具返回的结构化数据；没有结构化结果时为空 object。
    #[serde(default)]
    pub data: Value,
    /// 工具产出的实体列表，例如 host、group、session、file。
    #[serde(default)]
    pub entities: Vec<Value>,
    /// 当前错误是否可能通过补参数、重试或等待恢复。
    pub recoverable: bool,
    /// 稳定错误分类，例如 invalidInput、targetNotFound、remoteFailure。
    pub error_kind: Option<String>,
    /// 给 agent 下一步的恢复提示。
    #[serde(default)]
    pub next_hints: Vec<String>,
    /// 需要人工批准时的 pending invocation id。
    pub pending_invocation_id: Option<String>,
    /// 已执行并落审计时的 audit id。
    pub audit_id: Option<String>,
}

/// execute-if-allowed 的返回载荷。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolExecuteIfAllowedResponse {
    /// 本次工具调用 observation。
    pub observation: AiToolObservation,
    /// 需要人工批准时返回 pending，自动执行时为空。
    pub pending_invocation: Option<AiToolPendingInvocation>,
    /// 自动执行完成后的 audit，等待批准时为空。
    pub audit: Option<AiToolAuditRecord>,
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
    /// 归属 AI 会话 id，用于应用重启后恢复待确认项。
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 归属会话 slot 描述 JSON，用于无前端缓存时恢复 pending 队列位置。
    #[serde(default)]
    pub conversation_slot_json: Option<String>,
    /// 归属 agent run id，用于审批后恢复 harness loop。
    #[serde(default)]
    pub run_id: Option<String>,
    /// 归属 agent run step id，用于审批后写回 observation。
    #[serde(default)]
    pub step_id: Option<String>,
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
    /// 关联的 AI 会话、消息、上下文快照和附件引用。
    pub audit_context: Option<AiToolAuditContext>,
    /// Agent loop 可直接消费的结构化工具 observation。
    #[serde(default)]
    pub observation_json: Option<Value>,
}

/// AI 工具调用审计上下文。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolAuditContext {
    /// 会话 id。
    pub conversation_id: Option<String>,
    /// 用户消息 id。
    pub user_message_id: Option<String>,
    /// AI 消息 id。
    pub assistant_message_id: Option<String>,
    /// 消息级上下文快照 id。
    pub context_snapshot_id: Option<String>,
    /// 会话 scope。
    pub scope_kind: Option<String>,
    /// 会话 scope 引用 JSON。
    pub scope_ref_json: Option<String>,
    /// 目标 key。
    pub target_key: Option<String>,
    /// 主机 id。
    pub host_id: Option<String>,
    /// tab id。
    pub tab_id: Option<String>,
    /// pane id。
    pub pane_id: Option<String>,
    /// AI panel route mode。
    pub route_mode: Option<String>,
    /// 当前 route target 引用 JSON。
    pub target_ref_json: Option<String>,
    /// 归属 agent run id，用于审计跳转和 resume。
    pub run_id: Option<String>,
    /// 归属 agent run step id，用于审计跳转和 resume。
    pub step_id: Option<String>,
    /// 附件 id 列表。
    #[serde(default)]
    pub attachment_ids: Vec<String>,
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
