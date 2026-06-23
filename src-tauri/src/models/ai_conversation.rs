//! AI 会话持久化模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// AI 会话详情，包含消息和附件 metadata。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub id: String,
    pub title: String,
    pub scope_kind: String,
    pub scope_ref_json: String,
    pub target_key: Option<String>,
    pub host_id: Option<String>,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_message_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub messages: Vec<AiConversationMessage>,
    pub attachments: Vec<AiAttachment>,
}

/// AI 会话列表行，不携带完整消息体。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationSummary {
    pub id: String,
    pub title: String,
    pub scope_kind: String,
    pub scope_ref_json: String,
    pub target_key: Option<String>,
    pub host_id: Option<String>,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_message_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub message_count: i64,
    pub attachment_count: i64,
}

/// AI 会话消息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub status: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub token_estimate: Option<i64>,
    pub context_snapshot_id: Option<String>,
    pub metadata_json: String,
    pub created_at: i64,
}

/// AI 消息发送时的上下文证据快照。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSnapshot {
    pub id: String,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub generated_at: i64,
    pub scope_kind: String,
    pub scope_ref_json: String,
    pub route_mode: Option<String>,
    pub target_ref_json: Option<String>,
    pub terminal_context_json: Option<String>,
    pub application_context_json: Option<String>,
    pub attachment_refs_json: String,
    pub policy_json: String,
    pub created_at: i64,
}

/// AI 消息附件 metadata。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachment {
    pub id: String,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub kind: String,
    pub storage_mode: String,
    pub source_kind: String,
    pub mime_type: String,
    pub original_name: String,
    pub original_path: Option<String>,
    pub asset_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub sha256: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size_bytes: i64,
    pub ocr_text: Option<String>,
    pub status: String,
    pub missing_reason: Option<String>,
    pub vision_usage: Option<String>,
    pub redaction_summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// AI 会话槽位，描述某个 tab/pane/host 默认展示的会话。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationSlot {
    pub slot_key: String,
    pub route_mode: String,
    pub target_ref_json: String,
    pub active_conversation_id: Option<String>,
    pub draft_text: Option<String>,
    pub last_active_at: i64,
    pub updated_at: i64,
}

/// 创建 AI 会话请求。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationCreateRequest {
    pub title: Option<String>,
    pub scope_kind: String,
    pub scope_ref_json: Option<String>,
    pub target_key: Option<String>,
    pub host_id: Option<String>,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
}

/// AI 会话列表请求。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationListRequest {
    pub query: Option<String>,
    pub target_key: Option<String>,
    pub host_id: Option<String>,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub include_archived: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// 追加 AI 会话消息请求。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationMessageAppendRequest {
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub status: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub token_estimate: Option<i64>,
    pub context_snapshot_id: Option<String>,
    pub metadata_json: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AiAttachmentInput>,
}

/// 创建 AI 上下文快照请求。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSnapshotCreateRequest {
    pub conversation_id: String,
    pub scope_kind: String,
    pub scope_ref_json: Option<String>,
    pub route_mode: Option<String>,
    pub target_ref_json: Option<String>,
    pub terminal_context_json: Option<String>,
    pub application_context_json: Option<String>,
    pub attachment_refs_json: Option<String>,
    pub policy_json: Option<String>,
}

/// 新增独立附件 metadata 请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationAttachmentAddRequest {
    pub conversation_id: String,
    pub attachment: AiAttachmentInput,
}

/// 从本地图片导入 AI 会话受管附件请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationAttachmentImportRequest {
    pub conversation_id: String,
    pub source_path: String,
    pub source_kind: Option<String>,
    pub vision_usage: Option<String>,
}

/// 从剪贴板图片字节导入 AI 会话受管附件请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationAttachmentImportBytesRequest {
    pub conversation_id: String,
    pub original_name: Option<String>,
    pub bytes: Vec<u8>,
    pub source_kind: Option<String>,
    pub vision_usage: Option<String>,
}

/// 将发送前导入的附件绑定到消息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationAttachmentBindMessageRequest {
    pub attachment_id: String,
    pub message_id: String,
}

/// AI 附件文件解析结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachmentAssetInfo {
    pub attachment: AiAttachment,
    pub exists: bool,
    pub resolved_path: Option<String>,
    pub preview_path: Option<String>,
}

/// 新增附件 metadata 输入。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAttachmentInput {
    pub kind: String,
    pub storage_mode: String,
    pub source_kind: Option<String>,
    pub mime_type: String,
    pub original_name: String,
    pub original_path: Option<String>,
    pub asset_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub sha256: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size_bytes: i64,
    pub ocr_text: Option<String>,
    pub status: Option<String>,
    pub missing_reason: Option<String>,
    pub vision_usage: Option<String>,
    pub redaction_summary: Option<String>,
}

/// 更新 AI 会话槽位活跃会话请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationSlotSetActiveRequest {
    pub slot_key: String,
    pub route_mode: String,
    pub target_ref_json: String,
    pub active_conversation_id: Option<String>,
}

/// 保存 AI 会话槽位草稿请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationSlotSaveDraftRequest {
    pub slot_key: String,
    pub route_mode: String,
    pub target_ref_json: String,
    pub active_conversation_id: Option<String>,
    pub draft_text: Option<String>,
}
