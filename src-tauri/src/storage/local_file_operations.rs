//! 本机文件写操作审计 JSONL 访问层。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    storage::{
        audit_log_store::{AuditLogStore, AuditLogStoreError},
        RuntimeFileStore,
    },
};

const LOCAL_FILE_AUDIT_DIR: &str = "logs/local-file-operations";

/// 本机文件写操作审计记录。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

impl RuntimeFileStore {
    /// 写入一条本机文件写操作审计。
    pub fn insert_local_file_operation_audit(
        &self,
        entry: &LocalFileOperationAuditWrite,
    ) -> AppResult<LocalFileOperationAuditRecord> {
        let record = LocalFileOperationAuditRecord {
            id: format!("local-file-audit-{}", Uuid::new_v4()),
            operation: entry.operation.clone(),
            path: entry.path.clone(),
            kind: entry.kind.clone(),
            root_path: entry.root_path.clone(),
            parent_path: entry.parent_path.clone(),
            recursive: entry.recursive,
            confirmation_matched: entry.confirmation_matched,
            status: entry.status.clone(),
            error: entry.error.clone(),
            created_at_unix_ms: current_unix_ms(),
        };

        self.with_file_io(|root| {
            let store = AuditLogStore::new(root);
            let relative_path = local_file_audit_relative_path(record.created_at_unix_ms);
            store
                .append_jsonl(relative_path, &record)
                .map_err(audit_log_error)?;
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

        self.with_file_io(|root| {
            let store = AuditLogStore::new(root);
            let mut records = Vec::new();
            for relative_path in local_file_audit_log_paths(root)? {
                let read = store
                    .read_jsonl::<LocalFileOperationAuditRecord>(&relative_path)
                    .map_err(audit_log_error)?;
                records.extend(read.records);
            }
            records.sort_by(|left, right| {
                right
                    .created_at_unix_ms
                    .cmp(&left.created_at_unix_ms)
                    .then_with(|| right.id.cmp(&left.id))
            });
            records.truncate(limit);
            Ok(records)
        })
    }
}

fn current_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn local_file_audit_relative_path(created_at_unix_ms: u128) -> PathBuf {
    Path::new(LOCAL_FILE_AUDIT_DIR)
        .join(format!("{}.jsonl", unix_ms_to_utc_date(created_at_unix_ms)))
}

fn local_file_audit_log_paths(root: &Path) -> AppResult<Vec<PathBuf>> {
    let directory = root.join(LOCAL_FILE_AUDIT_DIR);
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut paths = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".jsonl") {
            paths.push(Path::new(LOCAL_FILE_AUDIT_DIR).join(name.as_ref()));
        }
    }
    paths.sort();
    Ok(paths)
}

fn unix_ms_to_utc_date(unix_ms: u128) -> String {
    let days = (unix_ms / 86_400_000) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era as i32 + (era as i32) * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = (month_prime + if month_prime < 10 { 3 } else { -9 }) as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

fn audit_log_error(error: AuditLogStoreError) -> AppError {
    match error {
        AuditLogStoreError::Io(error) => AppError::Io(error),
        AuditLogStoreError::Json(error) => AppError::Json(error),
        AuditLogStoreError::InvalidPath(path) => AppError::InvalidInput(path),
    }
}
