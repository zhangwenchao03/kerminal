//! AI 会话 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::ai_conversation::{
        AiAttachment, AiConversation, AiConversationMessage, AiConversationSlot,
        AiConversationSummary,
    },
    storage::SqliteStore,
};

use super::ai_context_snapshots::link_context_snapshot_to_message;

/// AI 会话写入模型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiConversationWrite {
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
    pub created_at: i64,
    pub updated_at: i64,
}

/// AI 消息写入模型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiMessageWrite {
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
    pub attachments: Vec<AiAttachmentWrite>,
}

/// AI 附件 metadata 写入模型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiAttachmentWrite {
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

/// AI 会话列表过滤条件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiConversationListFilter {
    pub query_like: Option<String>,
    pub target_key: Option<String>,
    pub host_id: Option<String>,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub include_archived: bool,
    pub limit: i64,
    pub offset: i64,
}

/// AI 会话槽位写入模型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiConversationSlotWrite {
    pub slot_key: String,
    pub route_mode: String,
    pub target_ref_json: String,
    pub active_conversation_id: Option<String>,
    pub draft_text: Option<String>,
    pub last_active_at: i64,
    pub updated_at: i64,
}

impl SqliteStore {
    /// 插入 AI 会话并返回完整会话。
    pub(crate) fn insert_ai_conversation(
        &self,
        conversation: &AiConversationWrite,
    ) -> AppResult<AiConversation> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO ai_conversations (
                    id, title, scope_kind, scope_ref_json, target_key, host_id,
                    tab_id, pane_id, provider_id, model, status, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ",
                params![
                    conversation.id,
                    conversation.title,
                    conversation.scope_kind,
                    conversation.scope_ref_json,
                    conversation.target_key,
                    conversation.host_id,
                    conversation.tab_id,
                    conversation.pane_id,
                    conversation.provider_id,
                    conversation.model,
                    conversation.status,
                    conversation.created_at,
                    conversation.updated_at,
                ],
            )?;
            query_conversation_by_id(conn, &conversation.id)
        })
    }

    /// 根据 id 读取 AI 会话。
    pub fn ai_conversation_by_id(&self, id: &str) -> AppResult<Option<AiConversation>> {
        self.with_connection(|conn| query_conversation_by_id_optional(conn, id))
    }

    /// 搜索 AI 会话列表。
    pub(crate) fn list_ai_conversations(
        &self,
        filter: &AiConversationListFilter,
    ) -> AppResult<Vec<AiConversationSummary>> {
        self.with_connection(|conn| list_conversation_summaries(conn, filter))
    }

    /// 删除 AI 会话。消息、附件会由外键级联清理。
    pub fn delete_ai_conversation(&self, id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected = conn.execute("DELETE FROM ai_conversations WHERE id = ?1", [id])?;
            Ok(affected > 0)
        })
    }

    /// 追加消息和关联附件 metadata。
    pub(crate) fn insert_ai_conversation_message(
        &self,
        message: &AiMessageWrite,
    ) -> AppResult<AiConversationMessage> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "
                INSERT INTO ai_messages (
                    id, conversation_id, role, content, status, provider_id, model,
                    token_estimate, context_snapshot_id, metadata_json, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                params![
                    message.id,
                    message.conversation_id,
                    message.role,
                    message.content,
                    message.status,
                    message.provider_id,
                    message.model,
                    message.token_estimate,
                    message.context_snapshot_id,
                    message.metadata_json,
                    message.created_at,
                ],
            )?;
            if let Some(snapshot_id) = message.context_snapshot_id.as_deref() {
                link_context_snapshot_to_message(
                    &tx,
                    snapshot_id,
                    &message.conversation_id,
                    &message.id,
                )?;
            }
            for attachment in &message.attachments {
                insert_attachment(&tx, attachment)?;
            }
            tx.execute(
                "
                UPDATE ai_conversations
                SET updated_at = ?2, last_message_at = ?2
                WHERE id = ?1
                ",
                params![message.conversation_id, message.created_at],
            )?;
            tx.commit()?;
            query_message_by_id(conn, &message.id)
        })
    }

    /// 新增独立附件 metadata，主要用于发送前已导入但尚未绑定消息的附件。
    pub(crate) fn insert_ai_attachment(
        &self,
        attachment: &AiAttachmentWrite,
    ) -> AppResult<AiAttachment> {
        self.with_connection_mut(|conn| {
            insert_attachment(conn, attachment)?;
            query_attachment_by_id(conn, &attachment.id)
        })
    }

    /// 根据 id 读取 AI 附件 metadata。
    pub fn ai_attachment_by_id(&self, id: &str) -> AppResult<Option<AiAttachment>> {
        self.with_connection(|conn| query_attachment_by_id_optional(conn, id))
    }

    /// 更新 AI 附件可访问状态。
    pub(crate) fn update_ai_attachment_status(
        &self,
        attachment_id: &str,
        status: &str,
        missing_reason: Option<&str>,
        updated_at: i64,
    ) -> AppResult<AiAttachment> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                UPDATE ai_attachments
                SET status = ?2, missing_reason = ?3, updated_at = ?4
                WHERE id = ?1
                ",
                params![attachment_id, status, missing_reason, updated_at],
            )?;
            query_attachment_by_id(conn, attachment_id)
        })
    }

    /// 将发送前导入的附件 metadata 绑定到消息。
    pub(crate) fn bind_ai_attachment_to_message(
        &self,
        attachment_id: &str,
        message_id: &str,
        updated_at: i64,
    ) -> AppResult<AiAttachment> {
        self.with_connection_mut(|conn| {
            let attachment_conversation_id = attachment_conversation_id(conn, attachment_id)?;
            let message_conversation_id = message_conversation_id(conn, message_id)?;
            if attachment_conversation_id != message_conversation_id {
                return Err(AppError::InvalidInput(
                    "附件和消息不属于同一个 AI 会话".to_owned(),
                ));
            }
            conn.execute(
                "
                UPDATE ai_attachments
                SET message_id = ?2, updated_at = ?3
                WHERE id = ?1
                ",
                params![attachment_id, message_id, updated_at],
            )?;
            query_attachment_by_id(conn, attachment_id)
        })
    }

    /// 新增或更新 AI 会话槽位。
    pub(crate) fn upsert_ai_conversation_slot(
        &self,
        slot: &AiConversationSlotWrite,
    ) -> AppResult<AiConversationSlot> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO ai_conversation_slots (
                    slot_key, route_mode, target_ref_json, active_conversation_id,
                    draft_text, last_active_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(slot_key) DO UPDATE SET
                    route_mode = excluded.route_mode,
                    target_ref_json = excluded.target_ref_json,
                    active_conversation_id = excluded.active_conversation_id,
                    draft_text = excluded.draft_text,
                    last_active_at = excluded.last_active_at,
                    updated_at = excluded.updated_at
                ",
                params![
                    slot.slot_key,
                    slot.route_mode,
                    slot.target_ref_json,
                    slot.active_conversation_id,
                    slot.draft_text,
                    slot.last_active_at,
                    slot.updated_at,
                ],
            )?;
            query_slot_by_key(conn, &slot.slot_key)
        })
    }

    /// 根据 key 读取 AI 会话槽位。
    pub fn ai_conversation_slot_by_key(
        &self,
        slot_key: &str,
    ) -> AppResult<Option<AiConversationSlot>> {
        self.with_connection(|conn| {
            conn.query_row(
                "
                SELECT slot_key, route_mode, target_ref_json, active_conversation_id,
                       draft_text, last_active_at, updated_at
                FROM ai_conversation_slots
                WHERE slot_key = ?1
                ",
                [slot_key],
                slot_from_row,
            )
            .optional()
            .map_err(Into::into)
        })
    }
}

fn list_conversation_summaries(
    conn: &Connection,
    filter: &AiConversationListFilter,
) -> AppResult<Vec<AiConversationSummary>> {
    let mut stmt = conn.prepare(
        "
        SELECT c.id, c.title, c.scope_kind, c.scope_ref_json, c.target_key,
               c.host_id, c.tab_id, c.pane_id, c.provider_id, c.model,
               c.status, c.summary, c.created_at, c.updated_at,
               c.last_message_at, c.archived_at,
               COUNT(DISTINCT m.id) AS message_count,
               COUNT(DISTINCT a.id) AS attachment_count
        FROM ai_conversations c
        LEFT JOIN ai_messages m ON m.conversation_id = c.id
        LEFT JOIN ai_attachments a ON a.conversation_id = c.id
        WHERE (?1 IS NULL OR c.target_key = ?1)
          AND (?2 IS NULL OR c.host_id = ?2)
          AND (?3 IS NULL OR c.tab_id = ?3)
          AND (?4 IS NULL OR c.pane_id = ?4)
          AND (?5 = 1 OR c.archived_at IS NULL)
          AND (
            ?6 IS NULL
            OR lower(c.title) LIKE ?6
            OR lower(COALESCE(c.provider_id, '')) LIKE ?6
            OR lower(COALESCE(c.model, '')) LIKE ?6
            OR lower(c.status) LIKE ?6
            OR lower(c.scope_ref_json) LIKE ?6
            OR lower(COALESCE(c.summary, '')) LIKE ?6
            OR EXISTS (
                SELECT 1
                FROM ai_messages mq
                WHERE mq.conversation_id = c.id
                  AND (
                    lower(mq.content) LIKE ?6
                    OR lower(COALESCE(mq.provider_id, '')) LIKE ?6
                    OR lower(COALESCE(mq.model, '')) LIKE ?6
                    OR lower(mq.status) LIKE ?6
                    OR lower(mq.metadata_json) LIKE ?6
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM ai_attachments aq
                WHERE aq.conversation_id = c.id
                  AND (
                    lower(aq.original_name) LIKE ?6
                    OR lower(aq.mime_type) LIKE ?6
                    OR lower(aq.kind) LIKE ?6
                    OR lower(aq.status) LIKE ?6
                    OR lower(COALESCE(aq.ocr_text, '')) LIKE ?6
                  )
            )
          )
        GROUP BY c.id
        HAVING COUNT(DISTINCT m.id) > 0
            OR COUNT(DISTINCT a.id) > 0
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT ?7 OFFSET ?8
        ",
    )?;
    let rows = stmt
        .query_map(
            params![
                filter.target_key.as_deref(),
                filter.host_id.as_deref(),
                filter.tab_id.as_deref(),
                filter.pane_id.as_deref(),
                if filter.include_archived {
                    1_i64
                } else {
                    0_i64
                },
                filter.query_like.as_deref(),
                filter.limit,
                filter.offset,
            ],
            summary_from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn query_conversation_by_id(conn: &Connection, id: &str) -> AppResult<AiConversation> {
    query_conversation_by_id_optional(conn, id)?
        .ok_or_else(|| AppError::NotFound(format!("AI 会话不存在: {id}")))
}

fn query_conversation_by_id_optional(
    conn: &Connection,
    id: &str,
) -> AppResult<Option<AiConversation>> {
    let header = conn
        .query_row(
            "
            SELECT id, title, scope_kind, scope_ref_json, target_key, host_id,
                   tab_id, pane_id, provider_id, model, status, summary,
                   created_at, updated_at, last_message_at, archived_at
            FROM ai_conversations
            WHERE id = ?1
            ",
            [id],
            conversation_from_row,
        )
        .optional()?;
    header
        .map(|conversation| attach_conversation_children(conn, conversation))
        .transpose()
}

fn attach_conversation_children(
    conn: &Connection,
    mut conversation: AiConversation,
) -> AppResult<AiConversation> {
    conversation.messages = list_messages_for_conversation(conn, &conversation.id)?;
    conversation.attachments = list_attachments_for_conversation(conn, &conversation.id)?;
    Ok(conversation)
}

fn list_messages_for_conversation(
    conn: &Connection,
    conversation_id: &str,
) -> AppResult<Vec<AiConversationMessage>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, conversation_id, role, content, status, provider_id, model,
               token_estimate, context_snapshot_id, metadata_json, created_at
        FROM ai_messages
        WHERE conversation_id = ?1
        ORDER BY created_at ASC, rowid ASC
        ",
    )?;
    let rows = stmt
        .query_map([conversation_id], message_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn list_attachments_for_conversation(
    conn: &Connection,
    conversation_id: &str,
) -> AppResult<Vec<AiAttachment>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, conversation_id, message_id, kind, storage_mode, source_kind,
               mime_type, original_name, original_path, asset_path, thumbnail_path,
               sha256, width, height, size_bytes, ocr_text, status, missing_reason,
               vision_usage, redaction_summary, created_at, updated_at
        FROM ai_attachments
        WHERE conversation_id = ?1
        ORDER BY created_at ASC, rowid ASC
        ",
    )?;
    let rows = stmt
        .query_map([conversation_id], attachment_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn query_message_by_id(conn: &Connection, id: &str) -> AppResult<AiConversationMessage> {
    conn.query_row(
        "
        SELECT id, conversation_id, role, content, status, provider_id, model,
               token_estimate, context_snapshot_id, metadata_json, created_at
        FROM ai_messages
        WHERE id = ?1
        ",
        [id],
        message_from_row,
    )
    .map_err(Into::into)
}

fn attachment_conversation_id(conn: &Connection, id: &str) -> AppResult<String> {
    conn.query_row(
        "SELECT conversation_id FROM ai_attachments WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("AI 附件不存在: {id}")))
}

fn message_conversation_id(conn: &Connection, id: &str) -> AppResult<String> {
    conn.query_row(
        "SELECT conversation_id FROM ai_messages WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("AI 消息不存在: {id}")))
}

fn insert_attachment(conn: &Connection, attachment: &AiAttachmentWrite) -> AppResult<()> {
    conn.execute(
        "
        INSERT INTO ai_attachments (
            id, conversation_id, message_id, kind, storage_mode, source_kind,
            mime_type, original_name, original_path, asset_path, thumbnail_path,
            sha256, width, height, size_bytes, ocr_text, status, missing_reason,
            vision_usage, redaction_summary, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
        ",
        params![
            attachment.id,
            attachment.conversation_id,
            attachment.message_id,
            attachment.kind,
            attachment.storage_mode,
            attachment.source_kind,
            attachment.mime_type,
            attachment.original_name,
            attachment.original_path,
            attachment.asset_path,
            attachment.thumbnail_path,
            attachment.sha256,
            attachment.width,
            attachment.height,
            attachment.size_bytes,
            attachment.ocr_text,
            attachment.status,
            attachment.missing_reason,
            attachment.vision_usage,
            attachment.redaction_summary,
            attachment.created_at,
            attachment.updated_at,
        ],
    )?;
    Ok(())
}

fn query_attachment_by_id(conn: &Connection, id: &str) -> AppResult<AiAttachment> {
    query_attachment_by_id_optional(conn, id)?
        .ok_or_else(|| AppError::NotFound(format!("AI 附件不存在: {id}")))
}

fn query_attachment_by_id_optional(conn: &Connection, id: &str) -> AppResult<Option<AiAttachment>> {
    conn.query_row(
        "
        SELECT id, conversation_id, message_id, kind, storage_mode, source_kind,
               mime_type, original_name, original_path, asset_path, thumbnail_path,
               sha256, width, height, size_bytes, ocr_text, status, missing_reason,
               vision_usage, redaction_summary, created_at, updated_at
        FROM ai_attachments
        WHERE id = ?1
        ",
        [id],
        attachment_from_row,
    )
    .optional()
    .map_err(Into::into)
}

fn query_slot_by_key(conn: &Connection, slot_key: &str) -> AppResult<AiConversationSlot> {
    conn.query_row(
        "
        SELECT slot_key, route_mode, target_ref_json, active_conversation_id,
               draft_text, last_active_at, updated_at
        FROM ai_conversation_slots
        WHERE slot_key = ?1
        ",
        [slot_key],
        slot_from_row,
    )
    .map_err(Into::into)
}

fn conversation_from_row(row: &Row<'_>) -> rusqlite::Result<AiConversation> {
    Ok(AiConversation {
        id: row.get(0)?,
        title: row.get(1)?,
        scope_kind: row.get(2)?,
        scope_ref_json: row.get(3)?,
        target_key: row.get(4)?,
        host_id: row.get(5)?,
        tab_id: row.get(6)?,
        pane_id: row.get(7)?,
        provider_id: row.get(8)?,
        model: row.get(9)?,
        status: row.get(10)?,
        summary: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        last_message_at: row.get(14)?,
        archived_at: row.get(15)?,
        messages: Vec::new(),
        attachments: Vec::new(),
    })
}

fn summary_from_row(row: &Row<'_>) -> rusqlite::Result<AiConversationSummary> {
    Ok(AiConversationSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        scope_kind: row.get(2)?,
        scope_ref_json: row.get(3)?,
        target_key: row.get(4)?,
        host_id: row.get(5)?,
        tab_id: row.get(6)?,
        pane_id: row.get(7)?,
        provider_id: row.get(8)?,
        model: row.get(9)?,
        status: row.get(10)?,
        summary: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        last_message_at: row.get(14)?,
        archived_at: row.get(15)?,
        message_count: row.get(16)?,
        attachment_count: row.get(17)?,
    })
}

fn message_from_row(row: &Row<'_>) -> rusqlite::Result<AiConversationMessage> {
    Ok(AiConversationMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        status: row.get(4)?,
        provider_id: row.get(5)?,
        model: row.get(6)?,
        token_estimate: row.get(7)?,
        context_snapshot_id: row.get(8)?,
        metadata_json: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn attachment_from_row(row: &Row<'_>) -> rusqlite::Result<AiAttachment> {
    Ok(AiAttachment {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        kind: row.get(3)?,
        storage_mode: row.get(4)?,
        source_kind: row.get(5)?,
        mime_type: row.get(6)?,
        original_name: row.get(7)?,
        original_path: row.get(8)?,
        asset_path: row.get(9)?,
        thumbnail_path: row.get(10)?,
        sha256: row.get(11)?,
        width: row.get(12)?,
        height: row.get(13)?,
        size_bytes: row.get(14)?,
        ocr_text: row.get(15)?,
        status: row.get(16)?,
        missing_reason: row.get(17)?,
        vision_usage: row.get(18)?,
        redaction_summary: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
    })
}

fn slot_from_row(row: &Row<'_>) -> rusqlite::Result<AiConversationSlot> {
    Ok(AiConversationSlot {
        slot_key: row.get(0)?,
        route_mode: row.get(1)?,
        target_ref_json: row.get(2)?,
        active_conversation_id: row.get(3)?,
        draft_text: row.get(4)?,
        last_active_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
