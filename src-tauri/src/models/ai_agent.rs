//! AI Agent IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::{
    ai_context::AiTerminalContextRequest, ai_tool_invocation::AiToolPendingInvocation,
};

/// AI 对话请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    /// 用户输入的中文或命令相关问题。
    pub message: String,
    /// 可选会话 id，当前切片只回传该 id，不持久化长对话历史。
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 可选 LLM Provider id；为空时选择启用的默认 Provider。
    #[serde(default)]
    pub provider_id: Option<String>,
    /// 当前终端上下文请求；为空时只使用用户输入和工具目录摘要。
    #[serde(default)]
    pub terminal_context: Option<AiTerminalContextRequest>,
    /// 当前应用工作台上下文；为空时仍会使用后端可读取的设置和工具目录。
    #[serde(default)]
    pub application_context: Option<AiApplicationContextRequest>,
    /// AI 命令执行可见性偏好；为空时默认要求命令显示在当前终端。
    #[serde(default)]
    pub execution_visibility: Option<AiCommandExecutionVisibility>,
}

/// AI 命令执行可见性偏好。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiCommandExecutionVisibility {
    /// 优先写入当前可见终端，让用户看到命令和输出。
    #[default]
    Terminal,
    /// 允许使用后台工具执行，结果显示在 AI 工具卡片和审计中。
    Background,
}

/// AI 可感知的当前应用工作台上下文。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiApplicationContextRequest {
    /// 当前打开的右侧工具面板。
    #[serde(default)]
    pub active_tool_id: Option<String>,
    /// 当前 active tab。
    #[serde(default)]
    pub active_tab: Option<AiApplicationTabContext>,
    /// 当前聚焦 pane。
    #[serde(default)]
    pub focused_pane: Option<AiApplicationPaneContext>,
    /// 当前选中的主机。
    #[serde(default)]
    pub selected_machine: Option<AiApplicationMachineContext>,
}

/// 当前应用 tab 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiApplicationTabContext {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub machine_id: Option<String>,
}

/// 当前应用 pane 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiApplicationPaneContext {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub machine_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// 当前应用主机摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiApplicationMachineContext {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    #[serde(default)]
    pub production: Option<bool>,
}

/// AI 对话响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResponse {
    /// 对话 id，后续可用于长会话记忆。
    pub conversation_id: String,
    /// 实际使用的 Provider id。
    pub provider_id: String,
    /// 实际使用的 Provider 名称。
    pub provider_name: String,
    /// 实际使用的模型名称。
    pub model: String,
    /// AI 回复文本，输出前会进行基础密钥脱敏。
    pub message: String,
    /// 模型通过标准 tool-call 创建的待审批工具调用。
    #[serde(default)]
    pub pending_invocations: Vec<AiToolPendingInvocation>,
    /// 回复是否被基础密钥脱敏修改过。
    pub response_redacted: bool,
    /// 是否纳入了当前终端上下文。
    pub context_used: bool,
    /// 本次暴露给 Agent 的 rmcp 工具数量。
    pub tool_count: usize,
    /// 响应生成时间，Unix 秒字符串。
    pub generated_at: String,
}
