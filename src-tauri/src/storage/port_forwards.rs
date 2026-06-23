//! SSH 端口转发 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, OptionalExtension, Row};

use crate::{error::AppResult, models::port_forward::PortForwardSummary, storage::SqliteStore};

impl SqliteStore {
    /// 保存或更新一条脱敏端口转发摘要。
    pub fn upsert_port_forward_summary(&self, summary: &PortForwardSummary) -> AppResult<()> {
        let summary_json = serde_json::to_string(summary)?;
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO port_forward_sessions (
                    id, host_id, status, summary_json, created_at_unix, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    host_id = excluded.host_id,
                    status = excluded.status,
                    summary_json = excluded.summary_json,
                    created_at_unix = excluded.created_at_unix,
                    updated_at = excluded.updated_at
                ",
                params![
                    summary.id.as_str(),
                    summary.host_id.as_str(),
                    port_forward_status(summary),
                    summary_json,
                    summary.created_at.as_str(),
                ],
            )?;
            Ok(())
        })
    }

    /// 返回全部已保存端口转发摘要。
    pub fn list_port_forward_summaries(&self) -> AppResult<Vec<PortForwardSummary>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT summary_json
                FROM port_forward_sessions
                ORDER BY CAST(created_at_unix AS INTEGER), rowid
                ",
            )?;
            let summaries = stmt
                .query_map([], port_forward_summary_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(summaries)
        })
    }

    /// 根据 id 返回已保存端口转发摘要。
    pub fn port_forward_summary_by_id(
        &self,
        forward_id: &str,
    ) -> AppResult<Option<PortForwardSummary>> {
        self.with_connection(|conn| {
            Ok(conn
                .query_row(
                    "
                    SELECT summary_json
                    FROM port_forward_sessions
                    WHERE id = ?1
                    ",
                    [forward_id],
                    port_forward_summary_from_row,
                )
                .optional()?)
        })
    }

    /// 删除一条已保存端口转发摘要。
    pub fn delete_port_forward_summary(&self, forward_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected = conn.execute(
                "DELETE FROM port_forward_sessions WHERE id = ?1",
                [forward_id],
            )?;
            Ok(affected > 0)
        })
    }
}

fn port_forward_summary_from_row(row: &Row<'_>) -> rusqlite::Result<PortForwardSummary> {
    let summary_json: String = row.get(0)?;
    serde_json::from_str(&summary_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn port_forward_status(summary: &PortForwardSummary) -> &'static str {
    match summary.status {
        crate::models::port_forward::PortForwardStatus::Running => "running",
        crate::models::port_forward::PortForwardStatus::Exited => "exited",
    }
}
