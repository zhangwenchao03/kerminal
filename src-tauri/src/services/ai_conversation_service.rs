//! AI 会话持久化业务服务。
//!
//! @author kongweiguang

#[path = "ai_conversation_service/attachments.rs"]
mod attachments;

use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::ai_conversation::{
        AiAttachment, AiAttachmentAssetInfo, AiAttachmentInput, AiContextSnapshot,
        AiContextSnapshotCreateRequest, AiConversation, AiConversationAttachmentAddRequest,
        AiConversationAttachmentBindMessageRequest, AiConversationAttachmentImportBytesRequest,
        AiConversationAttachmentImportRequest, AiConversationCreateRequest,
        AiConversationListRequest, AiConversationMessage, AiConversationMessageAppendRequest,
        AiConversationSlot, AiConversationSlotSaveDraftRequest, AiConversationSlotSetActiveRequest,
        AiConversationSummary,
    },
    paths::KerminalPaths,
    storage::{
        ai_context_snapshots::AiContextSnapshotWrite,
        ai_conversations::{
            AiAttachmentWrite, AiConversationListFilter, AiConversationSlotWrite,
            AiConversationWrite, AiMessageWrite,
        },
        SqliteStore,
    },
};

const MAX_TITLE_CHARS: usize = 120;
const MAX_JSON_CHARS: usize = 16_000;
const MAX_CONTEXT_JSON_CHARS: usize = 300_000;
const MAX_MESSAGE_CHARS: usize = 200_000;
const MAX_OPTIONAL_CHARS: usize = 2_000;
const MAX_ATTACHMENTS_PER_MESSAGE: usize = 20;
const DEFAULT_LIST_LIMIT: i64 = 50;
const MAX_LIST_LIMIT: i64 = 200;
/// AI 会话持久化服务。
#[derive(Debug, Default)]
pub struct AiConversationService;

impl AiConversationService {
    /// 创建 AI 会话服务。
    pub fn new() -> Self {
        Self
    }

    /// 创建 AI 会话。
    pub fn create_conversation(
        &self,
        storage: &SqliteStore,
        request: AiConversationCreateRequest,
    ) -> AppResult<AiConversation> {
        let now = unix_time_millis()?;
        let scope_kind = normalize_enum("会话 scope", request.scope_kind, allowed_scope_kinds())?;
        let scope_ref_json = normalize_json(
            "scope 引用",
            request.scope_ref_json.unwrap_or_else(|| "{}".into()),
        )?;
        let title = normalize_optional_text("会话标题", request.title, MAX_TITLE_CHARS)?
            .unwrap_or_else(|| default_title_for_scope(&scope_kind));
        let conversation = AiConversationWrite {
            id: Uuid::new_v4().to_string(),
            title,
            scope_kind,
            scope_ref_json,
            target_key: normalize_optional_text("目标 key", request.target_key, 240)?,
            host_id: normalize_optional_text("主机 ID", request.host_id, 120)?,
            tab_id: normalize_optional_text("Tab ID", request.tab_id, 120)?,
            pane_id: normalize_optional_text("Pane ID", request.pane_id, 120)?,
            provider_id: normalize_optional_text("Provider ID", request.provider_id, 120)?,
            model: normalize_optional_text("模型", request.model, 160)?,
            status: "idle".to_owned(),
            created_at: now,
            updated_at: now,
        };
        storage.insert_ai_conversation(&conversation)
    }

    /// 搜索 AI 会话列表。
    pub fn list_conversations(
        &self,
        storage: &SqliteStore,
        request: AiConversationListRequest,
    ) -> AppResult<Vec<AiConversationSummary>> {
        let limit = request
            .limit
            .map(i64::from)
            .unwrap_or(DEFAULT_LIST_LIMIT)
            .clamp(1, MAX_LIST_LIMIT);
        let filter = AiConversationListFilter {
            query_like: normalize_optional_text("搜索关键词", request.query, 200)?
                .map(|query| format!("%{}%", query.to_lowercase())),
            target_key: normalize_optional_text("目标 key", request.target_key, 240)?,
            host_id: normalize_optional_text("主机 ID", request.host_id, 120)?,
            tab_id: normalize_optional_text("Tab ID", request.tab_id, 120)?,
            pane_id: normalize_optional_text("Pane ID", request.pane_id, 120)?,
            include_archived: request.include_archived.unwrap_or(false),
            limit,
            offset: request.offset.map(i64::from).unwrap_or(0).max(0),
        };
        storage.list_ai_conversations(&filter)
    }

    /// 根据 id 读取 AI 会话详情。
    pub fn get_conversation(
        &self,
        storage: &SqliteStore,
        conversation_id: &str,
    ) -> AppResult<AiConversation> {
        let conversation_id = normalize_required_text("会话 ID", conversation_id, 120)?;
        storage
            .ai_conversation_by_id(&conversation_id)?
            .ok_or_else(|| AppError::NotFound(format!("AI 会话不存在: {conversation_id}")))
    }

    /// 删除 AI 会话。
    pub fn delete_conversation(
        &self,
        storage: &SqliteStore,
        conversation_id: &str,
    ) -> AppResult<bool> {
        let conversation_id = normalize_required_text("会话 ID", conversation_id, 120)?;
        storage.delete_ai_conversation(&conversation_id)
    }

    /// 根据槽位 key 读取 AI 会话槽位。
    pub fn get_slot(
        &self,
        storage: &SqliteStore,
        slot_key: &str,
    ) -> AppResult<Option<AiConversationSlot>> {
        let slot_key = normalize_required_text("槽位 key", slot_key, 240)?;
        storage.ai_conversation_slot_by_key(&slot_key)
    }

    /// 创建消息级 AI 上下文快照。
    pub fn create_context_snapshot(
        &self,
        storage: &SqliteStore,
        request: AiContextSnapshotCreateRequest,
    ) -> AppResult<AiContextSnapshot> {
        let conversation_id = normalize_required_text("会话 ID", &request.conversation_id, 120)?;
        if storage.ai_conversation_by_id(&conversation_id)?.is_none() {
            return Err(AppError::NotFound(format!(
                "AI 会话不存在: {conversation_id}"
            )));
        }

        let now = unix_time_millis()?;
        let snapshot = AiContextSnapshotWrite {
            id: Uuid::new_v4().to_string(),
            conversation_id,
            generated_at: now,
            scope_kind: normalize_enum("会话 scope", request.scope_kind, allowed_scope_kinds())?,
            scope_ref_json: normalize_json(
                "scope 引用",
                request.scope_ref_json.unwrap_or_else(|| "{}".to_owned()),
            )?,
            route_mode: normalize_optional_enum(
                "路由模式",
                request.route_mode,
                allowed_route_modes(),
            )?,
            target_ref_json: normalize_optional_json(
                "目标引用",
                request.target_ref_json,
                MAX_JSON_CHARS,
            )?,
            terminal_context_json: normalize_optional_json(
                "终端上下文",
                request.terminal_context_json,
                MAX_CONTEXT_JSON_CHARS,
            )?,
            application_context_json: normalize_optional_json(
                "应用上下文",
                request.application_context_json,
                MAX_CONTEXT_JSON_CHARS,
            )?,
            attachment_refs_json: normalize_json(
                "附件引用",
                request
                    .attachment_refs_json
                    .unwrap_or_else(|| "[]".to_owned()),
            )?,
            policy_json: normalize_json(
                "上下文策略",
                request.policy_json.unwrap_or_else(|| "{}".to_owned()),
            )?,
            created_at: now,
        };
        storage.insert_ai_context_snapshot(&snapshot)
    }

    /// 读取 AI 上下文快照详情。
    pub fn get_context_snapshot(
        &self,
        storage: &SqliteStore,
        snapshot_id: &str,
    ) -> AppResult<AiContextSnapshot> {
        let snapshot_id = normalize_required_text("上下文快照 ID", snapshot_id, 120)?;
        storage
            .ai_context_snapshot_by_id(&snapshot_id)?
            .ok_or_else(|| AppError::NotFound(format!("AI 上下文快照不存在: {snapshot_id}")))
    }

    /// 追加 AI 会话消息和附件 metadata。
    pub fn append_message(
        &self,
        storage: &SqliteStore,
        request: AiConversationMessageAppendRequest,
    ) -> AppResult<AiConversationMessage> {
        let conversation_id = normalize_required_text("会话 ID", &request.conversation_id, 120)?;
        if storage.ai_conversation_by_id(&conversation_id)?.is_none() {
            return Err(AppError::NotFound(format!(
                "AI 会话不存在: {conversation_id}"
            )));
        }

        if request.attachments.len() > MAX_ATTACHMENTS_PER_MESSAGE {
            return Err(AppError::InvalidInput(format!(
                "单条消息最多允许 {MAX_ATTACHMENTS_PER_MESSAGE} 个附件"
            )));
        }

        let now = unix_time_millis()?;
        let message_id = Uuid::new_v4().to_string();
        ensure_non_negative("Token 估算", request.token_estimate)?;
        let attachments = request
            .attachments
            .into_iter()
            .map(|attachment| {
                self.normalize_attachment_input(
                    &conversation_id,
                    Some(&message_id),
                    attachment,
                    now,
                )
            })
            .collect::<AppResult<Vec<_>>>()?;
        let message = AiMessageWrite {
            id: message_id,
            conversation_id,
            role: normalize_enum("消息角色", request.role, allowed_message_roles())?,
            content: normalize_required_owned_text("消息内容", request.content, MAX_MESSAGE_CHARS)?,
            status: normalize_optional_enum(
                "消息状态",
                request.status,
                allowed_message_statuses(),
            )?
            .unwrap_or_else(|| "complete".to_owned()),
            provider_id: normalize_optional_text("Provider ID", request.provider_id, 120)?,
            model: normalize_optional_text("模型", request.model, 160)?,
            token_estimate: request.token_estimate,
            context_snapshot_id: normalize_optional_text(
                "上下文快照 ID",
                request.context_snapshot_id,
                120,
            )?,
            metadata_json: normalize_json(
                "消息 metadata",
                request.metadata_json.unwrap_or_else(|| "{}".to_owned()),
            )?,
            created_at: now,
            attachments,
        };
        storage.insert_ai_conversation_message(&message)
    }

    /// 新增独立附件 metadata。
    pub fn add_attachment_metadata(
        &self,
        storage: &SqliteStore,
        request: AiConversationAttachmentAddRequest,
    ) -> AppResult<AiAttachment> {
        let conversation_id = normalize_required_text("会话 ID", &request.conversation_id, 120)?;
        if storage.ai_conversation_by_id(&conversation_id)?.is_none() {
            return Err(AppError::NotFound(format!(
                "AI 会话不存在: {conversation_id}"
            )));
        }

        let now = unix_time_millis()?;
        let attachment =
            self.normalize_attachment_input(&conversation_id, None, request.attachment, now)?;
        storage.insert_ai_attachment(&attachment)
    }

    /// 从本地图片导入受管附件。
    pub fn import_image_attachment(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: AiConversationAttachmentImportRequest,
    ) -> AppResult<AiAttachment> {
        let conversation_id = normalize_required_text("会话 ID", &request.conversation_id, 120)?;
        if storage.ai_conversation_by_id(&conversation_id)?.is_none() {
            return Err(AppError::NotFound(format!(
                "AI 会话不存在: {conversation_id}"
            )));
        }

        attachments::import_image_attachment(
            storage,
            paths,
            conversation_id,
            request.source_path,
            request.source_kind,
            request.vision_usage,
        )
    }

    /// 从图片字节导入受管附件，用于剪贴板截图等无本地路径来源。
    pub fn import_image_attachment_bytes(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: AiConversationAttachmentImportBytesRequest,
    ) -> AppResult<AiAttachment> {
        let conversation_id = normalize_required_text("会话 ID", &request.conversation_id, 120)?;
        if storage.ai_conversation_by_id(&conversation_id)?.is_none() {
            return Err(AppError::NotFound(format!(
                "AI 会话不存在: {conversation_id}"
            )));
        }

        attachments::import_image_attachment_bytes(
            storage,
            paths,
            conversation_id,
            request.original_name,
            request.bytes,
            request.source_kind,
            request.vision_usage,
        )
    }

    /// 刷新附件文件状态。
    pub fn refresh_attachment_status(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        attachment_id: &str,
    ) -> AppResult<AiAttachment> {
        Ok(self
            .resolve_attachment_asset(storage, paths, attachment_id)?
            .attachment)
    }

    /// 解析附件可预览文件路径，并同步 missing 状态。
    pub fn resolve_attachment_asset(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        attachment_id: &str,
    ) -> AppResult<AiAttachmentAssetInfo> {
        let attachment_id = normalize_required_text("附件 ID", attachment_id, 120)?;
        let attachment = storage
            .ai_attachment_by_id(&attachment_id)?
            .ok_or_else(|| AppError::NotFound(format!("AI 附件不存在: {attachment_id}")))?;
        attachments::resolve_attachment_asset(storage, paths, attachment)
    }

    /// 使用系统默认程序打开附件文件。
    pub fn open_attachment(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        attachment_id: &str,
    ) -> AppResult<bool> {
        let asset = self.resolve_attachment_asset(storage, paths, attachment_id)?;
        attachments::open_resolved_attachment(attachment_id, asset.resolved_path)
    }

    /// 将发送前导入的附件绑定到消息。
    pub fn bind_attachment_to_message(
        &self,
        storage: &SqliteStore,
        request: AiConversationAttachmentBindMessageRequest,
    ) -> AppResult<AiAttachment> {
        let attachment_id = normalize_required_owned_text("附件 ID", request.attachment_id, 120)?;
        let message_id = normalize_required_owned_text("消息 ID", request.message_id, 120)?;
        storage.bind_ai_attachment_to_message(&attachment_id, &message_id, unix_time_millis()?)
    }

    /// 设置槽位当前活跃会话。
    pub fn set_slot_active(
        &self,
        storage: &SqliteStore,
        request: AiConversationSlotSetActiveRequest,
    ) -> AppResult<AiConversationSlot> {
        let now = unix_time_millis()?;
        let slot_key = normalize_required_owned_text("槽位 key", request.slot_key, 240)?;
        let draft_text = storage
            .ai_conversation_slot_by_key(&slot_key)?
            .and_then(|slot| slot.draft_text);
        let slot = self.normalize_slot(
            slot_key,
            request.route_mode,
            request.target_ref_json,
            request.active_conversation_id,
            draft_text,
            now,
        )?;
        storage.upsert_ai_conversation_slot(&slot)
    }

    /// 保存槽位输入草稿。
    pub fn save_slot_draft(
        &self,
        storage: &SqliteStore,
        request: AiConversationSlotSaveDraftRequest,
    ) -> AppResult<AiConversationSlot> {
        let now = unix_time_millis()?;
        let slot_key = normalize_required_owned_text("槽位 key", request.slot_key, 240)?;
        let active_conversation_id = match request.active_conversation_id {
            Some(value) => Some(value),
            None => storage
                .ai_conversation_slot_by_key(&slot_key)?
                .and_then(|slot| slot.active_conversation_id),
        };
        let draft_text =
            normalize_optional_text("输入草稿", request.draft_text, MAX_MESSAGE_CHARS)?;
        let slot = self.normalize_slot(
            slot_key,
            request.route_mode,
            request.target_ref_json,
            active_conversation_id,
            draft_text,
            now,
        )?;
        storage.upsert_ai_conversation_slot(&slot)
    }

    fn normalize_attachment_input(
        &self,
        conversation_id: &str,
        message_id: Option<&str>,
        input: AiAttachmentInput,
        now: i64,
    ) -> AppResult<AiAttachmentWrite> {
        if input.size_bytes < 0 {
            return Err(AppError::InvalidInput("附件大小不能为负数".to_owned()));
        }
        ensure_non_negative("图片宽度", input.width)?;
        ensure_non_negative("图片高度", input.height)?;
        let storage_mode =
            normalize_enum("附件存储模式", input.storage_mode, allowed_storage_modes())?;
        let original_path = normalize_optional_text("原始路径", input.original_path, 2_000)?;
        let asset_path = normalize_optional_text("受管路径", input.asset_path, 2_000)?;
        if storage_mode == "managedCopy" && asset_path.is_none() {
            return Err(AppError::InvalidInput(
                "managedCopy 附件必须提供受管路径".to_owned(),
            ));
        }
        if storage_mode == "linkedFile" && original_path.is_none() {
            return Err(AppError::InvalidInput(
                "linkedFile 附件必须提供原始路径".to_owned(),
            ));
        }

        Ok(AiAttachmentWrite {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_owned(),
            message_id: message_id.map(str::to_owned),
            kind: normalize_enum("附件类型", input.kind, allowed_attachment_kinds())?,
            storage_mode,
            source_kind: normalize_optional_enum(
                "附件来源",
                input.source_kind,
                allowed_source_kinds(),
            )?
            .unwrap_or_else(|| "picker".to_owned()),
            mime_type: normalize_required_owned_text("附件 MIME", input.mime_type, 160)?,
            original_name: normalize_required_owned_text("附件文件名", input.original_name, 255)?,
            original_path,
            asset_path,
            thumbnail_path: normalize_optional_text("缩略图路径", input.thumbnail_path, 2_000)?,
            sha256: normalize_optional_text("附件 hash", input.sha256, 128)?,
            width: input.width,
            height: input.height,
            size_bytes: input.size_bytes,
            ocr_text: normalize_optional_text("OCR 文本", input.ocr_text, MAX_MESSAGE_CHARS)?,
            status: normalize_optional_enum(
                "附件状态",
                input.status,
                allowed_attachment_statuses(),
            )?
            .unwrap_or_else(|| "available".to_owned()),
            missing_reason: normalize_optional_enum(
                "缺失原因",
                input.missing_reason,
                allowed_missing_reasons(),
            )?,
            vision_usage: normalize_optional_enum(
                "视觉使用状态",
                input.vision_usage,
                allowed_vision_usages(),
            )?,
            redaction_summary: normalize_optional_text(
                "脱敏摘要",
                input.redaction_summary,
                MAX_OPTIONAL_CHARS,
            )?,
            created_at: now,
            updated_at: now,
        })
    }

    fn normalize_slot(
        &self,
        slot_key: String,
        route_mode: String,
        target_ref_json: String,
        active_conversation_id: Option<String>,
        draft_text: Option<String>,
        now: i64,
    ) -> AppResult<AiConversationSlotWrite> {
        Ok(AiConversationSlotWrite {
            slot_key: normalize_required_owned_text("槽位 key", slot_key, 240)?,
            route_mode: normalize_enum("路由模式", route_mode, allowed_route_modes())?,
            target_ref_json: normalize_json("目标引用", target_ref_json)?,
            active_conversation_id: normalize_optional_text(
                "活跃会话 ID",
                active_conversation_id,
                120,
            )?,
            draft_text,
            last_active_at: now,
            updated_at: now,
        })
    }
}

fn normalize_required_text(field: &str, value: &str, max_chars: usize) -> AppResult<String> {
    normalize_required_owned_text(field, value.to_owned(), max_chars)
}

fn normalize_required_owned_text(
    field: &str,
    value: String,
    max_chars: usize,
) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(value)
}

fn normalize_optional_text(
    field: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Ok(None);
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(Some(value))
}

fn normalize_enum(field: &str, value: String, allowed: &[&str]) -> AppResult<String> {
    let value = normalize_required_owned_text(field, value, 80)?;
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::InvalidInput(format!(
            "{field} 只能是: {}",
            allowed.join(", ")
        )))
    }
}

fn normalize_optional_enum(
    field: &str,
    value: Option<String>,
    allowed: &[&str],
) -> AppResult<Option<String>> {
    value
        .map(|value| normalize_enum(field, value, allowed))
        .transpose()
}

fn normalize_json(field: &str, value: String) -> AppResult<String> {
    let value = normalize_required_owned_text(field, value, MAX_JSON_CHARS)?;
    serde_json::from_str::<serde_json::Value>(&value)
        .map_err(|error| AppError::InvalidInput(format!("{field} 不是合法 JSON: {error}")))?;
    Ok(value)
}

fn normalize_optional_json(
    field: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    let Some(value) = normalize_optional_text(field, value, max_chars)? else {
        return Ok(None);
    };
    serde_json::from_str::<serde_json::Value>(&value)
        .map_err(|error| AppError::InvalidInput(format!("{field} 不是合法 JSON: {error}")))?;
    Ok(Some(value))
}

fn ensure_max_chars(field: &str, value: &str, max_chars: usize) -> AppResult<()> {
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{field} 最多允许 {max_chars} 个字符"
        )));
    }
    Ok(())
}

fn ensure_non_negative(field: &str, value: Option<i64>) -> AppResult<()> {
    if value.is_some_and(|value| value < 0) {
        return Err(AppError::InvalidInput(format!("{field}不能为负数")));
    }
    Ok(())
}

fn unix_time_millis() -> AppResult<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::AiAgent(format!("系统时间早于 UNIX_EPOCH: {error}")))?;
    Ok(duration.as_millis().min(i64::MAX as u128) as i64)
}

fn default_title_for_scope(scope_kind: &str) -> String {
    match scope_kind {
        "noContext" => "普通 AI 会话",
        "followFocus" => "跟随当前终端",
        "lockedPane" => "终端 Pane 会话",
        "lockedHost" => "主机会话",
        "workspaceTask" => "工作区任务会话",
        _ => "AI 会话",
    }
    .to_owned()
}

fn allowed_scope_kinds() -> &'static [&'static str] {
    &[
        "noContext",
        "followFocus",
        "lockedPane",
        "lockedHost",
        "workspaceTask",
    ]
}

fn allowed_route_modes() -> &'static [&'static str] {
    &[
        "followWorkspaceTarget",
        "pinnedConversation",
        "noContextChat",
    ]
}

fn allowed_message_roles() -> &'static [&'static str] {
    &["user", "assistant", "system", "tool"]
}

fn allowed_message_statuses() -> &'static [&'static str] {
    &["draft", "streaming", "complete", "error"]
}

fn allowed_attachment_kinds() -> &'static [&'static str] {
    &["image", "file", "diagnostic"]
}

fn allowed_storage_modes() -> &'static [&'static str] {
    &["managedCopy", "linkedFile"]
}

fn allowed_source_kinds() -> &'static [&'static str] {
    &[
        "drag",
        "paste",
        "picker",
        "screenshot",
        "terminalSelection",
        "toolOutput",
    ]
}

fn allowed_attachment_statuses() -> &'static [&'static str] {
    &["available", "missing", "redacted", "unsupported"]
}

fn allowed_missing_reasons() -> &'static [&'static str] {
    &[
        "deleted",
        "moved",
        "permissionDenied",
        "outsideScope",
        "unknown",
    ]
}

fn allowed_vision_usages() -> &'static [&'static str] {
    &[
        "visionInput",
        "ocrOnly",
        "metadataOnly",
        "blocked",
        "notSent",
    ]
}
