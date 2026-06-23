//! AI 工具调用审计 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, Row};

use crate::{
    error::AppResult,
    models::{
        ai_tool_invocation::{AiToolAuditContext, AiToolAuditRecord, AiToolInvocationStatus},
        tool_registry::{ToolConfirmationPolicy, ToolRiskLevel},
    },
    storage::SqliteStore,
};

impl SqliteStore {
    /// 写入一条 AI 工具调用审计记录。
    pub fn insert_ai_tool_audit(&self, audit: &AiToolAuditRecord) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO ai_tool_audits (
                    id, invocation_id, tool_id, tool_title, risk, confirmation,
                    arguments_summary, risk_summary, status, result_summary,
                    error, created_at, completed_at, audit_context_json, observation_json
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                ",
                params![
                    audit.id.as_str(),
                    audit.invocation_id.as_str(),
                    audit.tool_id.as_str(),
                    audit.tool_title.as_str(),
                    risk_to_db(audit.risk),
                    confirmation_to_db(audit.confirmation),
                    audit.arguments_summary.as_str(),
                    audit.risk_summary.as_deref(),
                    status_to_db(audit.status),
                    audit.result_summary.as_deref(),
                    audit.error.as_deref(),
                    audit.created_at.as_str(),
                    audit.completed_at.as_str(),
                    audit_context_to_json(audit)?,
                    observation_to_json(audit)?,
                ],
            )?;
            Ok(())
        })
    }

    /// 返回最近的 AI 工具调用审计记录，按完成时间倒序。
    pub fn list_ai_tool_audits(&self, limit: usize) -> AppResult<Vec<AiToolAuditRecord>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        self.with_connection(|conn| list_audits(conn, limit))
    }

    /// 清空 AI 工具调用审计记录。
    pub fn clear_ai_tool_audits(&self) -> AppResult<usize> {
        self.with_connection_mut(|conn| {
            let deleted = conn.execute("DELETE FROM ai_tool_audits", [])?;
            Ok(deleted)
        })
    }
}

fn list_audits(conn: &Connection, limit: i64) -> AppResult<Vec<AiToolAuditRecord>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, invocation_id, tool_id, tool_title, risk, confirmation,
               arguments_summary, risk_summary, status, result_summary,
               error, created_at, completed_at, audit_context_json, observation_json
        FROM ai_tool_audits
        ORDER BY CAST(completed_at AS INTEGER) DESC, rowid DESC
        LIMIT ?1
        ",
    )?;

    let audits = stmt
        .query_map([limit], audit_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(audits)
}

fn audit_from_row(row: &Row<'_>) -> rusqlite::Result<AiToolAuditRecord> {
    let risk_text: String = row.get(4)?;
    let confirmation_text: String = row.get(5)?;
    let status_text: String = row.get(8)?;

    Ok(AiToolAuditRecord {
        id: row.get(0)?,
        invocation_id: row.get(1)?,
        tool_id: row.get(2)?,
        tool_title: row.get(3)?,
        risk: risk_from_db(&risk_text).map_err(text_to_sqlite_error)?,
        confirmation: confirmation_from_db(&confirmation_text).map_err(text_to_sqlite_error)?,
        arguments_summary: row.get(6)?,
        risk_summary: row.get(7)?,
        status: status_from_db(&status_text).map_err(text_to_sqlite_error)?,
        result_summary: row.get(9)?,
        error: row.get(10)?,
        created_at: row.get(11)?,
        completed_at: row.get(12)?,
        audit_context: audit_context_from_json(row.get::<_, Option<String>>(13)?.as_deref())?,
        observation_json: observation_from_json(row.get::<_, Option<String>>(14)?.as_deref())?,
    })
}

fn audit_context_to_json(audit: &AiToolAuditRecord) -> rusqlite::Result<Option<String>> {
    audit
        .audit_context
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| text_to_sqlite_error(error.to_string()))
}

fn audit_context_from_json(value: Option<&str>) -> rusqlite::Result<Option<AiToolAuditContext>> {
    value
        .filter(|text| !text.trim().is_empty())
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| text_to_sqlite_error(error.to_string()))
}

fn observation_to_json(audit: &AiToolAuditRecord) -> rusqlite::Result<Option<String>> {
    audit
        .observation_json
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| text_to_sqlite_error(error.to_string()))
}

fn observation_from_json(value: Option<&str>) -> rusqlite::Result<Option<serde_json::Value>> {
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

fn status_to_db(status: AiToolInvocationStatus) -> &'static str {
    match status {
        AiToolInvocationStatus::Pending => "pending",
        AiToolInvocationStatus::Rejected => "rejected",
        AiToolInvocationStatus::Succeeded => "succeeded",
        AiToolInvocationStatus::Failed => "failed",
    }
}

fn status_from_db(value: &str) -> Result<AiToolInvocationStatus, String> {
    match value {
        "pending" => Ok(AiToolInvocationStatus::Pending),
        "rejected" => Ok(AiToolInvocationStatus::Rejected),
        "succeeded" => Ok(AiToolInvocationStatus::Succeeded),
        "failed" => Ok(AiToolInvocationStatus::Failed),
        _ => Err(format!("未知工具调用状态: {value}")),
    }
}

fn text_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
    )
}
