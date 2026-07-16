//! Durable file transaction test fixtures.
//!
//! @author kongweiguang

use std::{fs, path::Path};

use kerminal_lib::storage::storage_manifest::StorageManifest;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// 测试使用的事务日志阶段；字段值必须与生产 journal 契约一致。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalPhaseFixture {
    Preparing,
    Prepared,
    Applying,
    Committed,
    RollingBack,
    RolledBack,
}

/// 测试使用的目标动作。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalActionFixture {
    Write,
    Delete,
}

/// 构造可独立控制原始存在状态的 journal entry。
#[derive(Debug, Clone, Serialize)]
pub struct JournalEntryFixture {
    pub relative_path: String,
    pub original_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_sha256: Option<String>,
    pub action: JournalActionFixture,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intended_sha256: Option<String>,
}

impl JournalEntryFixture {
    pub fn present_write(id: &str, relative_path: &str, old: &[u8], new: &[u8]) -> Self {
        Self {
            relative_path: relative_path.to_owned(),
            original_exists: true,
            backup_path: Some(format!("backups/{id}/{relative_path}")),
            original_sha256: Some(content_sha256(old)),
            action: JournalActionFixture::Write,
            staged_path: Some(format!(".storage-transactions/{id}/staged/{relative_path}")),
            intended_sha256: Some(content_sha256(new)),
        }
    }

    pub fn missing_write(id: &str, relative_path: &str, new: &[u8]) -> Self {
        Self {
            relative_path: relative_path.to_owned(),
            original_exists: false,
            backup_path: None,
            original_sha256: None,
            action: JournalActionFixture::Write,
            staged_path: Some(format!(".storage-transactions/{id}/staged/{relative_path}")),
            intended_sha256: Some(content_sha256(new)),
        }
    }

    pub fn present_delete(id: &str, relative_path: &str, old: &[u8]) -> Self {
        Self {
            relative_path: relative_path.to_owned(),
            original_exists: true,
            backup_path: Some(format!("backups/{id}/{relative_path}")),
            original_sha256: Some(content_sha256(old)),
            action: JournalActionFixture::Delete,
            staged_path: None,
            intended_sha256: None,
        }
    }
}

#[derive(Debug, Serialize)]
struct TransactionJournalFixture<'a> {
    schema_version: u32,
    id: &'a str,
    started_at: &'a str,
    phase: JournalPhaseFixture,
    entries: &'a [JournalEntryFixture],
}

/// 写入模拟进程中断后遗留的 pending journal。
pub fn write_pending_journal(
    root: &Path,
    id: &str,
    phase: JournalPhaseFixture,
    entries: &[JournalEntryFixture],
) {
    let directory = root.join(".storage-transactions").join(id);
    fs::create_dir_all(&directory).expect("create transaction directory");
    let source = toml::to_string_pretty(&TransactionJournalFixture {
        schema_version: 1,
        id,
        started_at: "2026-07-13T23:30:00+08:00",
        phase,
        entries,
    })
    .expect("encode transaction journal fixture");
    fs::write(directory.join("pending.toml"), source).expect("write pending journal fixture");
}

/// 写入处于 started 状态的 storage manifest。
pub fn write_started_manifest(root: &Path, id: &str, touched_files: Vec<String>) {
    let mut manifest = StorageManifest::new();
    manifest.begin_change_set(id, "2026-07-13T23:30:00+08:00", touched_files);
    manifest.set_backup_dir(id, format!("backups/{id}"));
    fs::write(
        root.join("storage-manifest.toml"),
        toml::to_string_pretty(&manifest).expect("encode started manifest fixture"),
    )
    .expect("write started manifest fixture");
}

/// 写入生产恢复逻辑期望的备份文件。
pub fn write_backup(root: &Path, id: &str, relative_path: &str, contents: &[u8]) {
    let path = root.join("backups").join(id).join(relative_path);
    fs::create_dir_all(path.parent().expect("backup parent")).expect("create backup parent");
    fs::write(path, contents).expect("write backup fixture");
}

fn content_sha256(contents: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(contents))
}
