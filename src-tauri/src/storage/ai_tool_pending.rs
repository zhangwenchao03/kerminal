//! AI 工具待确认调用 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, OptionalExtension, Row};
use serde_json::{Map, Value};

use crate::{
    error::AppResult,
    models::{
        ai_tool_invocation::{AiToolClientAction, AiToolInvocationStatus, AiToolPendingInvocation},
        tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
    },
    storage::SqliteStore,
};

impl SqliteStore {
    /// 写入或刷新一条 AI 工具待确认调用。
    pub fn upsert_ai_tool_pending(
        &self,
        pending: &AiToolPendingInvocation,
        arguments: &Map<String, Value>,
    ) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO ai_tool_pending_invocations (
                    id, tool_id, tool_title, risk, confirmation, audit,
                    arguments_summary, risk_summary, client_action_json, reason,
                    requested_by, requires_confirmation, status, created_at, arguments_json,
                    conversation_id, conversation_slot_json, run_id, step_id
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13, ?14, ?15, ?16, ?17, ?18)
                ON CONFLICT(id) DO UPDATE SET
                    tool_id = excluded.tool_id,
                    tool_title = excluded.tool_title,
                    risk = excluded.risk,
                    confirmation = excluded.confirmation,
                    audit = excluded.audit,
                    arguments_summary = excluded.arguments_summary,
                    risk_summary = excluded.risk_summary,
                    client_action_json = excluded.client_action_json,
                    reason = excluded.reason,
                    requested_by = excluded.requested_by,
                    requires_confirmation = excluded.requires_confirmation,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    arguments_json = excluded.arguments_json,
                    conversation_id = COALESCE(excluded.conversation_id, conversation_id),
                    conversation_slot_json = COALESCE(excluded.conversation_slot_json, conversation_slot_json),
                    run_id = COALESCE(excluded.run_id, run_id),
                    step_id = COALESCE(excluded.step_id, step_id)
                ",
                params![
                    pending.id.as_str(),
                    pending.tool_id.as_str(),
                    pending.tool_title.as_str(),
                    risk_to_db(pending.risk),
                    confirmation_to_db(pending.confirmation),
                    audit_to_db(pending.audit),
                    pending.arguments_summary.as_str(),
                    pending.risk_summary.as_deref(),
                    client_action_to_json(pending)?,
                    pending.reason.as_deref(),
                    pending.requested_by.as_deref(),
                    if pending.requires_confirmation {
                        1_i64
                    } else {
                        0_i64
                    },
                    pending.created_at.as_str(),
                    serde_json::to_string(arguments)?,
                    pending.conversation_id.as_deref(),
                    pending.conversation_slot_json.as_deref(),
                    pending.run_id.as_deref(),
                    pending.step_id.as_deref(),
                ],
            )?;
            Ok(())
        })
    }

    /// 返回最近的 AI 工具待确认调用。
    pub fn list_ai_tool_pending(&self, limit: usize) -> AppResult<Vec<AiToolPendingInvocation>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT id, tool_id, tool_title, risk, confirmation, audit,
                       arguments_summary, risk_summary, client_action_json, reason,
                       requested_by, requires_confirmation, status, created_at,
                       conversation_id, conversation_slot_json, run_id, step_id
                FROM ai_tool_pending_invocations
                ORDER BY CAST(created_at AS INTEGER) DESC, rowid DESC
                LIMIT ?1
                ",
            )?;
            let pending = stmt
                .query_map([limit], pending_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(pending)
        })
    }

    /// 返回一条待确认调用及其完整参数。
    pub fn ai_tool_pending_state(
        &self,
        invocation_id: &str,
    ) -> AppResult<Option<(AiToolPendingInvocation, Map<String, Value>)>> {
        self.with_connection(|conn| {
            conn.query_row(
                "
                SELECT id, tool_id, tool_title, risk, confirmation, audit,
                       arguments_summary, risk_summary, client_action_json, reason,
                       requested_by, requires_confirmation, status, created_at,
                       conversation_id, conversation_slot_json, run_id, step_id, arguments_json
                FROM ai_tool_pending_invocations
                WHERE id = ?1
                ",
                [invocation_id],
                pending_state_from_row,
            )
            .optional()
            .map_err(Into::into)
        })
    }

    /// 删除一条待确认调用。
    pub fn delete_ai_tool_pending(&self, invocation_id: &str) -> AppResult<usize> {
        self.with_connection_mut(|conn| {
            Ok(conn.execute(
                "DELETE FROM ai_tool_pending_invocations WHERE id = ?1",
                [invocation_id],
            )?)
        })
    }

    /// 更新待确认调用的 AI 会话归属信息。
    pub fn update_ai_tool_pending_context(
        &self,
        invocation_id: &str,
        conversation_id: Option<&str>,
        conversation_slot_json: Option<&str>,
    ) -> AppResult<usize> {
        self.with_connection_mut(|conn| {
            Ok(conn.execute(
                "
                UPDATE ai_tool_pending_invocations
                SET conversation_id = ?2,
                    conversation_slot_json = ?3
                WHERE id = ?1
                ",
                params![invocation_id, conversation_id, conversation_slot_json],
            )?)
        })
    }
}

fn pending_state_from_row(
    row: &Row<'_>,
) -> rusqlite::Result<(AiToolPendingInvocation, Map<String, Value>)> {
    let pending = pending_from_row(row)?;
    let arguments_json: String = row.get(18)?;
    let arguments = serde_json::from_str::<Map<String, Value>>(&arguments_json)
        .map_err(|error| text_to_sqlite_error(error.to_string()))?;
    Ok((pending, arguments))
}

fn pending_from_row(row: &Row<'_>) -> rusqlite::Result<AiToolPendingInvocation> {
    let risk_text: String = row.get(3)?;
    let confirmation_text: String = row.get(4)?;
    let audit_text: String = row.get(5)?;
    let status_text: String = row.get(12)?;
    let requires_confirmation: i64 = row.get(11)?;

    Ok(AiToolPendingInvocation {
        id: row.get(0)?,
        tool_id: row.get(1)?,
        tool_title: row.get(2)?,
        risk: risk_from_db(&risk_text).map_err(text_to_sqlite_error)?,
        confirmation: confirmation_from_db(&confirmation_text).map_err(text_to_sqlite_error)?,
        audit: audit_from_db(&audit_text).map_err(text_to_sqlite_error)?,
        arguments_summary: row.get(6)?,
        risk_summary: row.get(7)?,
        client_action: client_action_from_json(row.get::<_, Option<String>>(8)?.as_deref())?,
        reason: row.get(9)?,
        requested_by: row.get(10)?,
        requires_confirmation: requires_confirmation != 0,
        status: status_from_db(&status_text).map_err(text_to_sqlite_error)?,
        created_at: row.get(13)?,
        conversation_id: row.get(14).ok(),
        conversation_slot_json: row.get(15).ok(),
        run_id: row.get(16).ok(),
        step_id: row.get(17).ok(),
    })
}

fn client_action_to_json(pending: &AiToolPendingInvocation) -> rusqlite::Result<Option<String>> {
    pending
        .client_action
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| text_to_sqlite_error(error.to_string()))
}

fn client_action_from_json(value: Option<&str>) -> rusqlite::Result<Option<AiToolClientAction>> {
    value
        .filter(|text| !text.trim().is_empty())
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| text_to_sqlite_error(error.to_string()))
}

fn risk_to_db(risk: ToolRiskLevel) -> &'static str {
    match risk {
        ToolRiskLevel::Read => "read",
        ToolRiskLevel::Write => "write",
        ToolRiskLevel::Remote => "remote",
        ToolRiskLevel::Batch => "batch",
        ToolRiskLevel::Destructive => "destructive",
    }
}

fn risk_from_db(value: &str) -> Result<ToolRiskLevel, String> {
    match value {
        "read" => Ok(ToolRiskLevel::Read),
        "write" => Ok(ToolRiskLevel::Write),
        "remote" => Ok(ToolRiskLevel::Remote),
        "batch" => Ok(ToolRiskLevel::Batch),
        "destructive" => Ok(ToolRiskLevel::Destructive),
        _ => Err(format!("未知工具风险等级: {value}")),
    }
}

fn confirmation_to_db(confirmation: ToolConfirmationPolicy) -> &'static str {
    match confirmation {
        ToolConfirmationPolicy::Auto => "auto",
        ToolConfirmationPolicy::Contextual => "contextual",
        ToolConfirmationPolicy::Always => "always",
    }
}

fn confirmation_from_db(value: &str) -> Result<ToolConfirmationPolicy, String> {
    match value {
        "auto" => Ok(ToolConfirmationPolicy::Auto),
        "contextual" => Ok(ToolConfirmationPolicy::Contextual),
        "always" => Ok(ToolConfirmationPolicy::Always),
        _ => Err(format!("未知工具确认策略: {value}")),
    }
}

fn audit_to_db(audit: ToolAuditPolicy) -> &'static str {
    match audit {
        ToolAuditPolicy::Summary => "summary",
        ToolAuditPolicy::Full => "full",
    }
}

fn audit_from_db(value: &str) -> Result<ToolAuditPolicy, String> {
    match value {
        "summary" => Ok(ToolAuditPolicy::Summary),
        "full" => Ok(ToolAuditPolicy::Full),
        _ => Err(format!("未知工具审计策略: {value}")),
    }
}

fn status_from_db(value: &str) -> Result<AiToolInvocationStatus, String> {
    match value {
        "pending" => Ok(AiToolInvocationStatus::Pending),
        _ => Err(format!("未知待确认工具调用状态: {value}")),
    }
}

fn text_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
    )
}
