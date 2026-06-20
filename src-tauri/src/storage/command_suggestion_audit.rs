//! 命令建议审计事件 SQLite 访问层。
//!
//! @author kongweiguang

use std::collections::BTreeMap;

use rusqlite::{params, Row};

use crate::{
    error::{AppError, AppResult},
    models::{
        command_history::CommandHistoryTarget,
        command_suggestion::{
            CommandSuggestionAuditDecision, CommandSuggestionAuditEvent,
            CommandSuggestionAuditEventKind, SuggestionProviderKind,
        },
    },
    storage::SqliteStore,
};

/// 写入 command_suggestion_audit_events 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSuggestionAuditEventWrite {
    /// 事件 id。
    pub id: String,
    /// 事件类型。
    pub event_kind: CommandSuggestionAuditEventKind,
    /// 关联 provider。
    pub provider: Option<SuggestionProviderKind>,
    /// 目标类型。
    pub target: CommandHistoryTarget,
    /// 审计决策。
    pub decision: CommandSuggestionAuditDecision,
    /// 稳定原因码。
    pub reason: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 当前工作目录。
    pub cwd: Option<String>,
    /// 远端目录。
    pub path: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 终端 session id。
    pub session_id: Option<String>,
    /// 受限元数据 JSON。
    pub metadata_json: String,
    /// 创建时间，Unix 毫秒。
    pub created_at_unix_ms: i64,
}

impl SqliteStore {
    /// 写入一条命令建议审计事件。
    pub(crate) fn insert_command_suggestion_audit_event(
        &self,
        event: &CommandSuggestionAuditEventWrite,
    ) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO command_suggestion_audit_events (
                    id, event_kind, provider, target, decision, reason,
                    remote_host_id, cwd, path, pane_id, session_id,
                    metadata_json, created_at_unix_ms, created_at
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    datetime('now')
                )
                ",
                params![
                    event.id.as_str(),
                    event.event_kind.as_str(),
                    event.provider.map(SuggestionProviderKind::as_str),
                    event.target.as_str(),
                    event.decision.as_str(),
                    event.reason.as_deref(),
                    event.remote_host_id.as_deref(),
                    event.cwd.as_deref(),
                    event.path.as_deref(),
                    event.pane_id.as_deref(),
                    event.session_id.as_deref(),
                    event.metadata_json.as_str(),
                    event.created_at_unix_ms,
                ],
            )?;

            Ok(())
        })
    }

    /// 读取最近的命令建议审计事件。
    pub(crate) fn command_suggestion_audit_events(
        &self,
        limit: usize,
    ) -> AppResult<Vec<CommandSuggestionAuditEvent>> {
        let limit = limit.clamp(1, 500);
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT id, event_kind, provider, target, decision, reason,
                       remote_host_id, cwd, path, pane_id, session_id,
                       metadata_json, created_at_unix_ms
                FROM command_suggestion_audit_events
                ORDER BY created_at_unix_ms DESC, id DESC
                LIMIT ?1
                ",
            )?;
            let rows = stmt
                .query_map([limit as i64], audit_event_from_row)?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(rows)
        })
    }
}

fn audit_event_from_row(row: &Row<'_>) -> rusqlite::Result<CommandSuggestionAuditEvent> {
    let event_kind_text: String = row.get(1)?;
    let event_kind =
        CommandSuggestionAuditEventKind::try_from(event_kind_text.as_str()).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(AppError::InvalidInput(error)),
            )
        })?;
    let provider_text: Option<String> = row.get(2)?;
    let provider = provider_text
        .as_deref()
        .map(SuggestionProviderKind::try_from)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(AppError::InvalidInput(error)),
            )
        })?;
    let target_text: String = row.get(3)?;
    let target = CommandHistoryTarget::try_from(target_text.as_str()).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(AppError::InvalidInput(error)),
        )
    })?;
    let decision_text: String = row.get(4)?;
    let decision =
        CommandSuggestionAuditDecision::try_from(decision_text.as_str()).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(AppError::InvalidInput(error)),
            )
        })?;
    let metadata_json: String = row.get(11)?;
    let metadata =
        serde_json::from_str::<BTreeMap<String, String>>(&metadata_json).unwrap_or_default();
    let created_at_unix_ms: i64 = row.get(12)?;

    Ok(CommandSuggestionAuditEvent {
        id: row.get(0)?,
        event_kind,
        provider,
        target,
        decision,
        reason: row.get(5)?,
        remote_host_id: row.get(6)?,
        cwd: row.get(7)?,
        path: row.get(8)?,
        pane_id: row.get(9)?,
        session_id: row.get(10)?,
        metadata,
        created_at_unix_ms: created_at_unix_ms.max(0) as u128,
    })
}
