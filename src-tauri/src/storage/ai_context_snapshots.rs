//! AI context snapshot SQLite access.
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::ai_conversation::AiContextSnapshot,
    storage::SqliteStore,
};

/// AI 上下文快照写入模型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiContextSnapshotWrite {
    pub id: String,
    pub conversation_id: String,
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

impl SqliteStore {
    /// 插入 AI 上下文快照。
    pub(crate) fn insert_ai_context_snapshot(
        &self,
        snapshot: &AiContextSnapshotWrite,
    ) -> AppResult<AiContextSnapshot> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO ai_context_snapshots (
                    id, conversation_id, generated_at, scope_kind, scope_ref_json,
                    route_mode, target_ref_json, terminal_context_json,
                    application_context_json, attachment_refs_json, policy_json,
                    created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                params![
                    snapshot.id,
                    snapshot.conversation_id,
                    snapshot.generated_at,
                    snapshot.scope_kind,
                    snapshot.scope_ref_json,
                    snapshot.route_mode,
                    snapshot.target_ref_json,
                    snapshot.terminal_context_json,
                    snapshot.application_context_json,
                    snapshot.attachment_refs_json,
                    snapshot.policy_json,
                    snapshot.created_at,
                ],
            )?;
            query_context_snapshot_by_id(conn, &snapshot.id)
        })
    }

    /// 根据 id 读取 AI 上下文快照。
    pub fn ai_context_snapshot_by_id(&self, id: &str) -> AppResult<Option<AiContextSnapshot>> {
        self.with_connection(|conn| query_context_snapshot_by_id_optional(conn, id))
    }
}

pub(crate) fn link_context_snapshot_to_message(
    conn: &Connection,
    snapshot_id: &str,
    conversation_id: &str,
    message_id: &str,
) -> AppResult<()> {
    let affected = conn.execute(
        "
        UPDATE ai_context_snapshots
        SET message_id = ?3
        WHERE id = ?1 AND conversation_id = ?2
        ",
        params![snapshot_id, conversation_id, message_id],
    )?;
    if affected == 0 {
        return Err(AppError::InvalidInput(format!(
            "上下文快照不存在或不属于当前 AI 会话: {snapshot_id}"
        )));
    }
    Ok(())
}

fn query_context_snapshot_by_id(conn: &Connection, id: &str) -> AppResult<AiContextSnapshot> {
    query_context_snapshot_by_id_optional(conn, id)?
        .ok_or_else(|| AppError::NotFound(format!("AI 上下文快照不存在: {id}")))
}

fn query_context_snapshot_by_id_optional(
    conn: &Connection,
    id: &str,
) -> AppResult<Option<AiContextSnapshot>> {
    conn.query_row(
        "
        SELECT id, conversation_id, message_id, generated_at, scope_kind,
               scope_ref_json, route_mode, target_ref_json, terminal_context_json,
               application_context_json, attachment_refs_json, policy_json,
               created_at
        FROM ai_context_snapshots
        WHERE id = ?1
        ",
        [id],
        context_snapshot_from_row,
    )
    .optional()
    .map_err(Into::into)
}

fn context_snapshot_from_row(row: &Row<'_>) -> rusqlite::Result<AiContextSnapshot> {
    Ok(AiContextSnapshot {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        generated_at: row.get(3)?,
        scope_kind: row.get(4)?,
        scope_ref_json: row.get(5)?,
        route_mode: row.get(6)?,
        target_ref_json: row.get(7)?,
        terminal_context_json: row.get(8)?,
        application_context_json: row.get(9)?,
        attachment_refs_json: row.get(10)?,
        policy_json: row.get(11)?,
        created_at: row.get(12)?,
    })
}
