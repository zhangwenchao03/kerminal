//! AI 会话持久化 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::ai_conversation::{
        AiAttachment, AiAttachmentAssetInfo, AiContextSnapshot, AiContextSnapshotCreateRequest,
        AiConversation, AiConversationAttachmentAddRequest,
        AiConversationAttachmentBindMessageRequest, AiConversationAttachmentImportBytesRequest,
        AiConversationAttachmentImportRequest, AiConversationCreateRequest,
        AiConversationListRequest, AiConversationMessage, AiConversationMessageAppendRequest,
        AiConversationSlot, AiConversationSlotSaveDraftRequest, AiConversationSlotSetActiveRequest,
        AiConversationSummary,
    },
    state::AppState,
};
use tauri::State;

/// 创建 AI 会话。
#[tauri::command]
pub fn ai_conversation_create(
    state: State<'_, AppState>,
    request: AiConversationCreateRequest,
) -> Result<AiConversation, String> {
    state
        .ai_conversations()
        .create_conversation(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 搜索 AI 会话列表。
#[tauri::command]
pub fn ai_conversation_list(
    state: State<'_, AppState>,
    request: Option<AiConversationListRequest>,
) -> Result<Vec<AiConversationSummary>, String> {
    state
        .ai_conversations()
        .list_conversations(state.storage(), request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 读取 AI 会话详情。
#[tauri::command]
pub fn ai_conversation_get(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<AiConversation, String> {
    state
        .ai_conversations()
        .get_conversation(state.storage(), &conversation_id)
        .map_err(|error| error.to_string())
}

/// 删除 AI 会话。
#[tauri::command]
pub fn ai_conversation_delete(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<bool, String> {
    state
        .ai_conversations()
        .delete_conversation(state.storage(), &conversation_id)
        .map_err(|error| error.to_string())
}

/// 读取 AI 会话槽位。
#[tauri::command]
pub fn ai_conversation_slot_get(
    state: State<'_, AppState>,
    slot_key: String,
) -> Result<Option<AiConversationSlot>, String> {
    state
        .ai_conversations()
        .get_slot(state.storage(), &slot_key)
        .map_err(|error| error.to_string())
}

/// 追加 AI 会话消息。
#[tauri::command]
pub fn ai_conversation_message_append(
    state: State<'_, AppState>,
    request: AiConversationMessageAppendRequest,
) -> Result<AiConversationMessage, String> {
    state
        .ai_conversations()
        .append_message(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 创建消息级 AI 上下文快照。
#[tauri::command]
pub fn ai_context_snapshot_create(
    state: State<'_, AppState>,
    request: AiContextSnapshotCreateRequest,
) -> Result<AiContextSnapshot, String> {
    state
        .ai_conversations()
        .create_context_snapshot(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 读取消息级 AI 上下文快照。
#[tauri::command]
pub fn ai_context_snapshot_get(
    state: State<'_, AppState>,
    snapshot_id: String,
) -> Result<AiContextSnapshot, String> {
    state
        .ai_conversations()
        .get_context_snapshot(state.storage(), &snapshot_id)
        .map_err(|error| error.to_string())
}

/// 新增 AI 会话附件 metadata。
#[tauri::command]
pub fn ai_conversation_attachment_add(
    state: State<'_, AppState>,
    request: AiConversationAttachmentAddRequest,
) -> Result<AiAttachment, String> {
    state
        .ai_conversations()
        .add_attachment_metadata(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 从本地图片导入 AI 会话受管附件。
#[tauri::command]
pub fn ai_conversation_attachment_import(
    state: State<'_, AppState>,
    request: AiConversationAttachmentImportRequest,
) -> Result<AiAttachment, String> {
    state
        .ai_conversations()
        .import_image_attachment(state.storage(), state.paths(), request)
        .map_err(|error| error.to_string())
}

/// 从图片字节导入 AI 会话受管附件。
#[tauri::command]
pub fn ai_conversation_attachment_import_bytes(
    state: State<'_, AppState>,
    request: AiConversationAttachmentImportBytesRequest,
) -> Result<AiAttachment, String> {
    state
        .ai_conversations()
        .import_image_attachment_bytes(state.storage(), state.paths(), request)
        .map_err(|error| error.to_string())
}

/// 刷新 AI 附件文件可访问状态。
#[tauri::command]
pub fn ai_conversation_attachment_status_refresh(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<AiAttachment, String> {
    state
        .ai_conversations()
        .refresh_attachment_status(state.storage(), state.paths(), &attachment_id)
        .map_err(|error| error.to_string())
}

/// 解析 AI 附件预览文件路径。
#[tauri::command]
pub fn ai_conversation_attachment_asset_info(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<AiAttachmentAssetInfo, String> {
    state
        .ai_conversations()
        .resolve_attachment_asset(state.storage(), state.paths(), &attachment_id)
        .map_err(|error| error.to_string())
}

/// 使用系统默认程序打开 AI 附件。
#[tauri::command]
pub fn ai_conversation_attachment_open(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<bool, String> {
    state
        .ai_conversations()
        .open_attachment(state.storage(), state.paths(), &attachment_id)
        .map_err(|error| error.to_string())
}

/// 将发送前导入的附件绑定到消息。
#[tauri::command]
pub fn ai_conversation_attachment_bind_message(
    state: State<'_, AppState>,
    request: AiConversationAttachmentBindMessageRequest,
) -> Result<AiAttachment, String> {
    state
        .ai_conversations()
        .bind_attachment_to_message(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 设置槽位活跃会话。
#[tauri::command]
pub fn ai_conversation_slot_set_active(
    state: State<'_, AppState>,
    request: AiConversationSlotSetActiveRequest,
) -> Result<AiConversationSlot, String> {
    state
        .ai_conversations()
        .set_slot_active(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 保存槽位草稿。
#[tauri::command]
pub fn ai_conversation_slot_save_draft(
    state: State<'_, AppState>,
    request: AiConversationSlotSaveDraftRequest,
) -> Result<AiConversationSlot, String> {
    state
        .ai_conversations()
        .save_slot_draft(state.storage(), request)
        .map_err(|error| error.to_string())
}
