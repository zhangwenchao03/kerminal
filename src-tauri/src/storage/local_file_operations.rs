//! 本机文件写操作审计 SQLite 访问层。
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Row};
use uuid::Uuid;

use crate::{error::AppResult, storage::SqliteStore};

/// 本机文件写操作审计记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFileOperationAuditRecord {
    pub id: String,
    pub operation: String,
    pub path: String,
    pub kind: String,
    pub root_path: Option<String>,
    pub parent_path: Option<String>,
    pub recursive: bool,
    pub confirmation_matched: bool,
    pub status: String,
    pub error: Option<String>,
    pub created_at_unix_ms: u128,
}

/// 待写入的本机文件写操作审计记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFileOperationAuditWrite {
    pub operation: String,
    pub path: String,
    pub kind: String,
    pub root_path: Option<String>,
    pub parent_path: Option<String>,
    pub recursive: bool,
    pub confirmation_matched: bool,
    pub status: String,
    pub error: Option<String>,
}

impl SqliteStore {
    /// 写入一条本机文件写操作审计。
    pub fn insert_local_file_operation_audit(
        &self,
        audit: &LocalFileOperationAuditWrite,
    ) -> AppResult<LocalFileOperationAuditRecord> {
        let record = LocalFileOperationAuditRecord {
            id: format!("local-file-audit-{}", Uuid::new_v4()),
            operation: audit.operation.clone(),
            path: audit.path.clone(),
            kind: audit.kind.clone(),
            root_path: audit.root_path.clone(),
            parent_path: audit.parent_path.clone(),
            recursive: audit.recursive,
            confirmation_matched: audit.confirmation_matched,
            status: audit.status.clone(),
            error: audit.error.clone(),
            created_at_unix_ms: current_unix_ms(),
        };

        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO local_file_operation_audits (
                    id, operation, path, kind, root_path, parent_path, recursive,
                    confirmation_matched, status, error, created_at_unix_ms
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                params![
                    record.id.as_str(),
                    record.operation.as_str(),
                    record.path.as_str(),
                    record.kind.as_str(),
                    record.root_path.as_deref(),
                    record.parent_path.as_deref(),
                    bool_to_db(record.recursive),
                    bool_to_db(record.confirmation_matched),
                    record.status.as_str(),
                    record.error.as_deref(),
                    i64::try_from(record.created_at_unix_ms).unwrap_or(i64::MAX),
                ],
            )?;
            Ok(())
        })?;

        Ok(record)
    }

    /// 返回最近的本机文件写操作审计记录。
    pub fn list_local_file_operation_audits(
        &self,
        limit: usize,
    ) -> AppResult<Vec<LocalFileOperationAuditRecord>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT id, operation, path, kind, root_path, parent_path, recursive,
                       confirmation_matched, status, error, created_at_unix_ms
                FROM local_file_operation_audits
                ORDER BY created_at_unix_ms DESC, rowid DESC
                LIMIT ?1
                ",
            )?;
            let records = stmt
                .query_map([limit], local_file_audit_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(records)
        })
    }
}

fn local_file_audit_from_row(row: &Row<'_>) -> rusqlite::Result<LocalFileOperationAuditRecord> {
    let created_at_unix_ms: i64 = row.get(10)?;
    Ok(LocalFileOperationAuditRecord {
        id: row.get(0)?,
        operation: row.get(1)?,
        path: row.get(2)?,
        kind: row.get(3)?,
        root_path: row.get(4)?,
        parent_path: row.get(5)?,
        recursive: db_to_bool(row.get(6)?),
        confirmation_matched: db_to_bool(row.get(7)?),
        status: row.get(8)?,
        error: row.get(9)?,
        created_at_unix_ms: created_at_unix_ms.max(0) as u128,
    })
}

fn current_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn bool_to_db(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn db_to_bool(value: i64) -> bool {
    value != 0
}
