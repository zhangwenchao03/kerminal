//! AI Agent IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::{
    ai_context::AiTerminalContextRequest, ai_tool_invocation::AiToolPendingInvocation,
};

/// AI 对话请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    /// 用户输入的中文或命令相关问题。
    pub message: String,
    /// 本次消息附带的图片、文件或诊断片段摘要；真实文件仍留在受管附件目录。
    #[serde(default)]
    pub attachments: Vec<AiChatAttachmentContext>,
    /// 当前会话前序消息摘要；后端在调用 Provider 前结构化组装到 prompt。
    #[serde(default)]
    pub history: Vec<AiChatHistoryMessage>,
    /// 可选会话 id，当前切片只回传该 id，不持久化长对话历史。
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// 当前 AI 面板路由 slot 描述 JSON，用于待确认工具调用归属恢复。
    #[serde(default)]
    pub conversation_slot_json: Option<String>,
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

/// AI 对话前序消息摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatHistoryMessage {
    /// user 或 assistant。
    pub role: String,
    /// 已经脱敏/裁剪后的历史消息内容。
    pub content: String,
}

/// AI 对话可感知的消息附件上下文。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatAttachmentContext {
    pub id: String,
    pub kind: String,
    pub mime_type: String,
    pub original_name: String,
    pub size_bytes: u64,
    pub status: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub missing_reason: Option<String>,
    #[serde(default)]
    pub ocr_text: Option<String>,
    #[serde(default)]
    pub redaction_summary: Option<String>,
    #[serde(default)]
    pub vision_usage: Option<String>,
}

/// 单个附件在本次 AI 请求中的视觉/文本输入状态。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatAttachmentVisionStatus {
    /// 附件 id。
    pub id: String,
    /// 前端或持久化记录请求的视觉使用方式。
    pub requested_usage: String,
    /// 后端结合 Provider 能力和当前 adapter 后实际采用的方式。
    pub effective_usage: String,
    /// 附件实际进入模型的形态：visionInput、textContext 或 notSent。
    pub model_input: String,
    /// 安全降级或能力不匹配提示。
    #[serde(default)]
    pub warning: Option<String>,
}

/// 本次 AI 请求的视觉能力闭环报告。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatVisionUsageReport {
    /// 当前 Provider/model 是否被 Kerminal 标记为支持视觉。
    pub provider_supports_vision: bool,
    /// 当前 Kerminal provider adapter 是否真的发送图片像素。
    pub vision_adapter_enabled: bool,
    /// 每个附件的请求状态、后端 effective 状态和实际模型输入形态。
    #[serde(default)]
    pub attachments: Vec<AiChatAttachmentVisionStatus>,
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
    /// 本次附件视觉使用和 provider capability 的后端决议。
    pub vision_usage: AiChatVisionUsageReport,
}
