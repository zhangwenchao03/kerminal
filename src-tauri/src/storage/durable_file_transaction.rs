//! 带 journal 与崩溃恢复的文件事务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    atomic_file::{durable_copy, durable_remove_file, is_missing_path_error, sync_parent_dir},
    file_store::{
        manifest_path_string, validate_change_set_id, FileStore, FileStoreChange, FileStoreError,
        FileStoreResult, TomlDocument,
    },
    storage_manifest::{ChangeSetStatus, StorageManifest},
};

mod recovery;

use recovery::{finish_rollback_metadata, rollback_entries};
pub(crate) use recovery::{recover_pending_locked, restore_change_set_locked};

const TRANSACTION_JOURNAL_SCHEMA_VERSION: u32 = 1;
const TRANSACTION_ROOT: &str = ".storage-transactions";
const PENDING_JOURNAL_FILE: &str = "pending.toml";
const COMMITTED_JOURNAL_FILE: &str = "committed.toml";
const ROLLED_BACK_JOURNAL_FILE: &str = "rolled-back.toml";

/// 在同一 FileStore 锁内完成读取、决策与写集构造。
///
/// 闭包成功返回后由 `FileStore` 持久化写集；闭包返回错误时不会创建 change-set。
pub struct DurableFileTransaction<'a> {
    store: &'a FileStore,
    changes: Vec<FileStoreChange>,
    read_revisions: HashMap<PathBuf, String>,
}

impl<'a> DurableFileTransaction<'a> {
    pub(crate) fn new(store: &'a FileStore) -> Self {
        Self {
            store,
            changes: Vec::new(),
            read_revisions: HashMap::new(),
        }
    }

    /// 在当前事务锁内读取原始字节。
    pub fn read(&mut self, relative_path: impl AsRef<Path>) -> FileStoreResult<Vec<u8>> {
        let relative_path = self.store.validate_change_path(relative_path.as_ref())?;
        let contents = fs::read(self.store.path_for(&relative_path)?)?;
        self.record_read_revision(&relative_path, &contents)?;
        Ok(contents)
    }

    /// 在当前事务锁内读取 UTF-8 文本。
    pub fn read_to_string(&mut self, relative_path: impl AsRef<Path>) -> FileStoreResult<String> {
        let relative_path = self.store.validate_change_path(relative_path.as_ref())?;
        let source = fs::read_to_string(self.store.path_for(&relative_path)?)?;
        self.record_read_revision(&relative_path, source.as_bytes())?;
        Ok(source)
    }

    /// 在当前事务锁内读取并解码 TOML。
    pub fn read_toml<T: TomlDocument>(
        &mut self,
        relative_path: impl AsRef<Path>,
    ) -> FileStoreResult<T> {
        let relative_path = self.store.validate_change_path(relative_path.as_ref())?;
        let source = fs::read_to_string(self.store.path_for(&relative_path)?)?;
        self.record_read_revision(&relative_path, source.as_bytes())?;
        T::decode_toml(&source).map_err(|error| error.with_path(relative_path).into())
    }

    /// 将文件写入加入当前事务；同一路径在一个事务中只能出现一次。
    pub fn write(
        &mut self,
        relative_path: impl AsRef<Path>,
        contents: impl Into<Vec<u8>>,
    ) -> FileStoreResult<()> {
        let mut change = FileStoreChange::new(relative_path, contents)?;
        change.expected_original_sha256 = self.read_revisions.get(&change.relative_path).cloned();
        self.push_change(change)
    }

    /// 将文件删除加入当前事务；同一路径在一个事务中只能出现一次。
    pub fn delete(&mut self, relative_path: impl AsRef<Path>) -> FileStoreResult<()> {
        let mut change = FileStoreChange::delete(relative_path)?;
        change.expected_original_sha256 = self.read_revisions.get(&change.relative_path).cloned();
        self.push_change(change)
    }

    pub(crate) fn into_changes(self) -> Vec<FileStoreChange> {
        self.changes
    }

    fn push_change(&mut self, change: FileStoreChange) -> FileStoreResult<()> {
        if self
            .changes
            .iter()
            .any(|existing| existing.relative_path == change.relative_path)
        {
            return Err(FileStoreError::InvalidPath(format!(
                "duplicate transaction path: {}",
                change.relative_path.display()
            )));
        }
        self.changes.push(change);
        Ok(())
    }

    fn record_read_revision(
        &mut self,
        relative_path: &Path,
        contents: &[u8],
    ) -> FileStoreResult<()> {
        let revision = content_sha256(contents);
        if self
            .read_revisions
            .get(relative_path)
            .is_some_and(|existing| existing != &revision)
        {
            return Err(FileStoreError::RevisionConflict(
                relative_path.to_path_buf(),
            ));
        }
        self.read_revisions
            .insert(relative_path.to_path_buf(), revision);
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum JournalPhase {
    Preparing,
    Prepared,
    Applying,
    Committed,
    RollingBack,
    RolledBack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum JournalAction {
    Write,
    Delete,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TransactionJournalEntry {
    relative_path: String,
    original_exists: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    backup_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original_sha256: Option<String>,
    action: JournalAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    staged_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    intended_sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TransactionJournal {
    schema_version: u32,
    id: String,
    started_at: String,
    phase: JournalPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    entries: Vec<TransactionJournalEntry>,
}

/// 在已持有 FileStore 锁时应用写集。
pub(crate) fn apply_changes_locked(
    store: &FileStore,
    id: &str,
    timestamp: &str,
    changes: Vec<FileStoreChange>,
) -> FileStoreResult<StorageManifest> {
    validate_change_set_id(id)?;
    validate_changes(store, &changes)?;
    let mut manifest = store.read_storage_manifest_locked()?;
    if let Some(active_id) = manifest.active_change_set_id.as_deref() {
        return Err(FileStoreError::TransactionRecovery {
            id: active_id.to_owned(),
            reason: "another change-set is still active".to_owned(),
        });
    }
    if manifest.change_set(id).is_some() || transaction_directory(store, id)?.exists() {
        return Err(FileStoreError::InvalidPath(format!(
            "change set id already exists: {id}"
        )));
    }

    let mut journal = build_journal(store, id, timestamp, &changes)?;
    write_pending_journal(store, &journal)?;

    let touched_files = journal
        .entries
        .iter()
        .map(|entry| entry.relative_path.clone())
        .collect::<Vec<_>>();
    manifest.begin_change_set(id, timestamp, touched_files);
    manifest.set_backup_dir(id, manifest_path_string(&backup_root(id)?));
    store.write_storage_manifest_locked(&manifest)?;

    if let Err(error) = prepare_files(store, &changes, &mut journal) {
        return finish_preparation_failure(store, &mut manifest, &mut journal, timestamp, error);
    }
    journal.phase = JournalPhase::Prepared;
    if let Err(error) = write_pending_journal(store, &journal) {
        return finish_preparation_failure(store, &mut manifest, &mut journal, timestamp, error);
    }

    // `Applying` 必须先耐久化；恢复逻辑只会对这个阶段及之后修改目标文件。
    journal.phase = JournalPhase::Applying;
    write_pending_journal(store, &journal)?;
    if let Err(error) = apply_prepared_files(store, &journal) {
        return rollback_after_apply_failure(store, &mut manifest, &mut journal, timestamp, error);
    }
    if let Err(error) = remove_staged_files(store, &journal) {
        return rollback_after_apply_failure(store, &mut manifest, &mut journal, timestamp, error);
    }

    journal.phase = JournalPhase::Committed;
    if let Err(error) = write_pending_journal(store, &journal) {
        return rollback_after_apply_failure(store, &mut manifest, &mut journal, timestamp, error);
    }
    manifest.mark_applied(id, timestamp);
    store.write_storage_manifest_locked(&manifest)?;
    finalize_terminal_journal(store, &journal)?;
    Ok(manifest)
}

fn validate_changes(store: &FileStore, changes: &[FileStoreChange]) -> FileStoreResult<()> {
    if changes.is_empty() {
        return Err(FileStoreError::InvalidPath(
            "change set must include at least one file".to_owned(),
        ));
    }
    let mut paths = HashSet::new();
    for change in changes {
        store.validate_change_path(&change.relative_path)?;
        if !paths.insert(change.relative_path.clone()) {
            return Err(FileStoreError::InvalidPath(format!(
                "duplicate transaction path: {}",
                change.relative_path.display()
            )));
        }
    }
    Ok(())
}

fn build_journal(
    store: &FileStore,
    id: &str,
    timestamp: &str,
    changes: &[FileStoreChange],
) -> FileStoreResult<TransactionJournal> {
    let directory = transaction_directory(store, id)?;
    let backup_relative_root = backup_root(id)?;
    let backup_directory = store.path_for(&backup_relative_root)?;
    if directory.exists() || backup_directory.exists() {
        return Err(FileStoreError::InvalidPath(format!(
            "transaction storage already exists for change set: {id}"
        )));
    }

    let mut entries = Vec::with_capacity(changes.len());
    for change in changes {
        let target = store.path_for(&change.relative_path)?;
        let original_exists = match fs::metadata(&target) {
            Ok(metadata) if metadata.is_file() => true,
            Ok(_) => {
                return Err(FileStoreError::InvalidPath(format!(
                    "transaction target is not a file: {}",
                    change.relative_path.display()
                )))
            }
            Err(error) if is_missing_path_error(&error) => false,
            Err(error) => return Err(error.into()),
        };
        if let Some(expected_revision) = change.expected_original_sha256.as_deref() {
            let current = fs::read(&target).map_err(|error| {
                if is_missing_path_error(&error) {
                    FileStoreError::RevisionConflict(change.relative_path.clone())
                } else {
                    error.into()
                }
            })?;
            if content_sha256(&current) != expected_revision {
                return Err(FileStoreError::RevisionConflict(
                    change.relative_path.clone(),
                ));
            }
        }
        let relative_text = manifest_path_string(&change.relative_path);
        let backup_path = original_exists
            .then(|| manifest_path_string(&backup_relative_root.join(&change.relative_path)));
        let (action, staged_path, intended_sha256) = match &change.contents {
            Some(contents) => (
                JournalAction::Write,
                Some(manifest_path_string(
                    &transaction_relative_directory(id)?
                        .join("staged")
                        .join(&change.relative_path),
                )),
                Some(content_sha256(contents)),
            ),
            None => (JournalAction::Delete, None, None),
        };
        entries.push(TransactionJournalEntry {
            relative_path: relative_text,
            original_exists,
            backup_path,
            original_sha256: None,
            action,
            staged_path,
            intended_sha256,
        });
    }
    Ok(TransactionJournal {
        schema_version: TRANSACTION_JOURNAL_SCHEMA_VERSION,
        id: id.to_owned(),
        started_at: timestamp.to_owned(),
        phase: JournalPhase::Preparing,
        last_error: None,
        entries,
    })
}

fn prepare_files(
    store: &FileStore,
    changes: &[FileStoreChange],
    journal: &mut TransactionJournal,
) -> FileStoreResult<()> {
    for (change, entry) in changes.iter().zip(&mut journal.entries) {
        if entry.original_exists {
            let source = store.path_for(&change.relative_path)?;
            let backup_relative = entry.backup_path.as_deref().ok_or_else(|| {
                journal_error(
                    pending_journal_path(store, &journal.id).unwrap_or_default(),
                    "present original has no backup path",
                )
            })?;
            let backup = store.path_for(backup_relative)?;
            durable_copy(&source, &backup)?;
            let backup_contents = fs::read(&backup)?;
            entry.original_sha256 = Some(content_sha256(&backup_contents));
        }
        if let Some(contents) = &change.contents {
            let staged_relative = entry
                .staged_path
                .as_deref()
                .ok_or_else(|| recovery_error(&journal.id, "write action has no staged path"))?;
            store.atomic_write_locked(staged_relative, contents)?;
        }
    }
    for entry in &journal.entries {
        ensure_target_matches_original(store, journal, entry)?;
    }
    Ok(())
}

fn apply_prepared_files(store: &FileStore, journal: &TransactionJournal) -> FileStoreResult<()> {
    validate_prepared_entries(journal)?;
    for entry in &journal.entries {
        ensure_target_matches_original(store, journal, entry)?;
        match entry.action {
            JournalAction::Write => {
                let staged_path =
                    store.path_for(entry.staged_path.as_deref().ok_or_else(|| {
                        recovery_error(&journal.id, "write action has no staged path")
                    })?)?;
                let contents = fs::read(&staged_path)?;
                let expected = entry.intended_sha256.as_deref().ok_or_else(|| {
                    recovery_error(&journal.id, "write action has no intended digest")
                })?;
                if content_sha256(&contents) != expected {
                    return Err(recovery_error(&journal.id, "staged file digest mismatch"));
                }
                store.atomic_write_locked(&entry.relative_path, &contents)?;
            }
            JournalAction::Delete => {
                store.remove_file_locked(&entry.relative_path)?;
            }
        }
    }
    Ok(())
}

fn ensure_target_matches_original(
    store: &FileStore,
    journal: &TransactionJournal,
    entry: &TransactionJournalEntry,
) -> FileStoreResult<()> {
    let target = store.path_for(&entry.relative_path)?;
    match fs::read(&target) {
        Ok(contents) if entry.original_exists => {
            let expected = entry
                .original_sha256
                .as_deref()
                .ok_or_else(|| recovery_error(&journal.id, "present original has no digest"))?;
            if content_sha256(&contents) == expected {
                Ok(())
            } else {
                Err(FileStoreError::TransactionConflict(PathBuf::from(
                    &entry.relative_path,
                )))
            }
        }
        Ok(_) => Err(FileStoreError::TransactionConflict(PathBuf::from(
            &entry.relative_path,
        ))),
        Err(error) if is_missing_path_error(&error) && !entry.original_exists => Ok(()),
        Err(error) if is_missing_path_error(&error) => Err(FileStoreError::TransactionConflict(
            PathBuf::from(&entry.relative_path),
        )),
        Err(error) => Err(error.into()),
    }
}

fn remove_staged_files(store: &FileStore, journal: &TransactionJournal) -> FileStoreResult<()> {
    for entry in &journal.entries {
        if let Some(staged_path) = entry.staged_path.as_deref() {
            let staged_path = store.path_for(staged_path)?;
            durable_remove_file(&staged_path)?;
        }
    }
    Ok(())
}

fn finish_preparation_failure(
    store: &FileStore,
    manifest: &mut StorageManifest,
    journal: &mut TransactionJournal,
    timestamp: &str,
    error: FileStoreError,
) -> FileStoreResult<StorageManifest> {
    journal.last_error = Some(error.to_string());
    journal.phase = JournalPhase::RolledBack;
    if let Err(recovery_error) = finish_rollback_metadata(store, manifest, journal, timestamp) {
        return Err(FileStoreError::TransactionRecovery {
            id: journal.id.clone(),
            reason: format!("{error}; rollback bookkeeping failed: {recovery_error}"),
        });
    }
    Err(error)
}

fn rollback_after_apply_failure(
    store: &FileStore,
    manifest: &mut StorageManifest,
    journal: &mut TransactionJournal,
    timestamp: &str,
    error: FileStoreError,
) -> FileStoreResult<StorageManifest> {
    journal.last_error = Some(error.to_string());
    journal.phase = JournalPhase::RollingBack;
    let rollback_result = write_pending_journal(store, journal)
        .and_then(|()| rollback_entries(store, journal))
        .and_then(|()| {
            journal.phase = JournalPhase::RolledBack;
            finish_rollback_metadata(store, manifest, journal, timestamp)
        });
    match rollback_result {
        Ok(()) => Err(error),
        Err(rollback_error) => {
            manifest.mark_failed(
                &journal.id,
                timestamp,
                format!("{error}; automatic rollback failed: {rollback_error}"),
            );
            let _ = store.write_storage_manifest_locked(manifest);
            Err(FileStoreError::TransactionRecovery {
                id: journal.id.clone(),
                reason: format!("{error}; automatic rollback failed: {rollback_error}"),
            })
        }
    }
}

fn validate_prepared_entries(journal: &TransactionJournal) -> FileStoreResult<()> {
    for entry in &journal.entries {
        if entry.original_exists && (entry.backup_path.is_none() || entry.original_sha256.is_none())
        {
            return Err(recovery_error(
                &journal.id,
                "present original is missing backup metadata",
            ));
        }
        if entry.action == JournalAction::Write
            && (entry.staged_path.is_none() || entry.intended_sha256.is_none())
        {
            return Err(recovery_error(
                &journal.id,
                "write action is missing staged metadata",
            ));
        }
    }
    Ok(())
}

fn validate_journal(
    store: &FileStore,
    path: &Path,
    journal: &TransactionJournal,
) -> FileStoreResult<()> {
    if journal.schema_version != TRANSACTION_JOURNAL_SCHEMA_VERSION {
        return Err(journal_error(path, "unsupported journal schema version"));
    }
    validate_change_set_id(&journal.id)?;
    if journal.started_at.trim().is_empty() || journal.entries.is_empty() {
        return Err(journal_error(
            path,
            "journal requires started_at and at least one entry",
        ));
    }
    let expected_directory = transaction_directory(store, &journal.id)?;
    if path.parent() != Some(expected_directory.as_path()) {
        return Err(journal_error(
            path,
            "journal id does not match its directory",
        ));
    }
    let mut paths = HashSet::new();
    for entry in &journal.entries {
        let relative = Path::new(&entry.relative_path);
        store.validate_change_path(relative)?;
        if !paths.insert(entry.relative_path.clone()) {
            return Err(journal_error(
                path,
                "journal contains duplicate target paths",
            ));
        }
        let expected_backup = manifest_path_string(&backup_root(&journal.id)?.join(relative));
        if entry.original_exists && entry.backup_path.as_deref() != Some(expected_backup.as_str()) {
            return Err(journal_error(
                path,
                "journal backup path does not match target",
            ));
        }
        if !entry.original_exists
            && (entry.backup_path.is_some() || entry.original_sha256.is_some())
        {
            return Err(journal_error(
                path,
                "missing original declares backup metadata",
            ));
        }
        let expected_stage = manifest_path_string(
            &transaction_relative_directory(&journal.id)?
                .join("staged")
                .join(relative),
        );
        match entry.action {
            JournalAction::Write
                if entry.staged_path.as_deref() != Some(expected_stage.as_str()) =>
            {
                return Err(journal_error(
                    path,
                    "journal staged path does not match target",
                ));
            }
            JournalAction::Delete
                if entry.staged_path.is_some() || entry.intended_sha256.is_some() =>
            {
                return Err(journal_error(path, "delete action declares write metadata"));
            }
            _ => {}
        }
    }
    if matches!(
        journal.phase,
        JournalPhase::Prepared
            | JournalPhase::Applying
            | JournalPhase::Committed
            | JournalPhase::RollingBack
    ) {
        validate_prepared_entries(journal)?;
    }
    Ok(())
}

fn write_pending_journal(store: &FileStore, journal: &TransactionJournal) -> FileStoreResult<()> {
    let path = pending_journal_path(store, &journal.id)?;
    write_journal(store, &path, journal)
}

fn write_journal(
    store: &FileStore,
    path: &Path,
    journal: &TransactionJournal,
) -> FileStoreResult<()> {
    let source = toml::to_string_pretty(journal)
        .map_err(|error| journal_error(path, format!("journal encoding failed: {error}")))?;
    store.atomic_write_absolute_locked(path, source.as_bytes())
}

fn read_journal(path: &Path) -> FileStoreResult<TransactionJournal> {
    let source = fs::read_to_string(path)?;
    toml::from_str(&source)
        .map_err(|error| journal_error(path, format!("journal parsing failed: {error}")))
}

fn finalize_terminal_journal(
    store: &FileStore,
    journal: &TransactionJournal,
) -> FileStoreResult<()> {
    let terminal_path = terminal_journal_path(store, &journal.id, journal.phase)?;
    write_journal(store, &terminal_path, journal)?;
    let pending_path = pending_journal_path(store, &journal.id)?;
    durable_remove_file(&pending_path)?;
    if let Some(parent) = terminal_path.parent() {
        sync_parent_dir(parent)?;
    }
    Ok(())
}

fn list_pending_journals(store: &FileStore) -> FileStoreResult<Vec<PathBuf>> {
    let root = store.path_for(TRANSACTION_ROOT)?;
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if is_missing_path_error(&error) => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let pending = entry.path().join(PENDING_JOURNAL_FILE);
        if pending.is_file() {
            paths.push(pending);
        }
    }
    paths.sort();
    Ok(paths)
}

fn transaction_relative_directory(id: &str) -> FileStoreResult<PathBuf> {
    validate_change_set_id(id)?;
    Ok(PathBuf::from(TRANSACTION_ROOT).join(id))
}

fn transaction_directory(store: &FileStore, id: &str) -> FileStoreResult<PathBuf> {
    store.path_for(transaction_relative_directory(id)?)
}

fn pending_journal_path(store: &FileStore, id: &str) -> FileStoreResult<PathBuf> {
    Ok(transaction_directory(store, id)?.join(PENDING_JOURNAL_FILE))
}

fn terminal_journal_path(
    store: &FileStore,
    id: &str,
    phase: JournalPhase,
) -> FileStoreResult<PathBuf> {
    let file_name = match phase {
        JournalPhase::Committed => COMMITTED_JOURNAL_FILE,
        JournalPhase::RolledBack => ROLLED_BACK_JOURNAL_FILE,
        _ => {
            return Err(recovery_error(
                id,
                "non-terminal journal cannot be finalized",
            ))
        }
    };
    Ok(transaction_directory(store, id)?.join(file_name))
}

fn backup_root(id: &str) -> FileStoreResult<PathBuf> {
    validate_change_set_id(id)?;
    Ok(PathBuf::from("backups").join(id))
}

fn content_sha256(contents: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(contents))
}

fn recovery_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("unix-ms:{millis}")
}

fn journal_error(path: impl Into<PathBuf>, reason: impl Into<String>) -> FileStoreError {
    FileStoreError::TransactionJournal {
        path: path.into(),
        reason: reason.into(),
    }
}

fn recovery_error(id: &str, reason: impl Into<String>) -> FileStoreError {
    FileStoreError::TransactionRecovery {
        id: id.to_owned(),
        reason: reason.into(),
    }
}
