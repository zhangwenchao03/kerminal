//! Durable file transaction restart recovery integration tests.
//!
//! @author kongweiguang

#[path = "support/durable_file_transaction.rs"]
mod durable_file_transaction_support;

use std::fs;

use kerminal_lib::models::settings::AppSettings;
use kerminal_lib::storage::{
    config_file_store::ConfigFileStore,
    file_store::{FileStore, FileStoreError},
    storage_manifest::ChangeSetStatus,
};
use tempfile::tempdir;

use durable_file_transaction_support::{
    write_backup, write_pending_journal, write_started_manifest, JournalEntryFixture,
    JournalPhaseFixture,
};

#[test]
fn config_read_runs_startup_recovery_before_parsing_user_toml() {
    let temp = tempdir().expect("temp dir");
    let id = "startup-config-change";
    let config = ConfigFileStore::new(temp.path());
    let expected = AppSettings::default();
    config.write_settings(&expected).expect("seed settings");
    let old = fs::read(temp.path().join("settings.toml")).expect("old settings");
    let interrupted = b"invalid = [";
    fs::write(temp.path().join("settings.toml"), interrupted).expect("partial target");
    write_backup(temp.path(), id, "settings.toml", &old);
    let entries = vec![JournalEntryFixture::present_write(
        id,
        "settings.toml",
        &old,
        interrupted,
    )];
    write_started_manifest(temp.path(), id, vec!["settings.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Applying, &entries);

    let restarted = ConfigFileStore::new(temp.path());
    let loaded = restarted.read_settings().expect("recover before parse");

    assert_eq!(loaded, expected);
    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("restored settings"),
        old
    );
}

#[test]
fn preparing_recovery_never_deletes_a_path_merely_because_backup_is_missing() {
    let temp = tempdir().expect("temp dir");
    let id = "preparing-change";
    let external = b"created outside interrupted transaction";
    fs::write(temp.path().join("new.toml"), external).expect("external file");
    let entries = vec![JournalEntryFixture::missing_write(
        id,
        "new.toml",
        b"transaction value",
    )];
    write_started_manifest(temp.path(), id, vec!["new.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Preparing, &entries);
    let store = FileStore::new(temp.path());

    let manifest = store.read_storage_manifest().expect("recover preparing");

    assert_eq!(
        fs::read(temp.path().join("new.toml")).expect("external"),
        external
    );
    assert_eq!(
        manifest.change_set(id).expect("change set").status,
        ChangeSetStatus::Repaired
    );
}

#[test]
fn prepared_recovery_leaves_all_targets_untouched() {
    let temp = tempdir().expect("temp dir");
    let id = "prepared-change";
    let old = b"old";
    let new = b"new";
    fs::write(temp.path().join("settings.toml"), old).expect("old target");
    write_backup(temp.path(), id, "settings.toml", old);
    let entries = vec![JournalEntryFixture::present_write(
        id,
        "settings.toml",
        old,
        new,
    )];
    write_started_manifest(temp.path(), id, vec!["settings.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Prepared, &entries);
    let store = FileStore::new(temp.path());

    store.read_storage_manifest().expect("recover prepared");

    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("target"),
        old
    );
}

#[test]
fn applying_recovery_restores_present_and_missing_original_states() {
    let temp = tempdir().expect("temp dir");
    let id = "applying-change";
    let old = b"old settings";
    let new = b"new settings";
    let generated = b"generated";
    fs::write(temp.path().join("settings.toml"), new).expect("partially replaced target");
    fs::write(temp.path().join("generated.toml"), generated).expect("partially created target");
    write_backup(temp.path(), id, "settings.toml", old);
    let entries = vec![
        JournalEntryFixture::present_write(id, "settings.toml", old, new),
        JournalEntryFixture::missing_write(id, "generated.toml", generated),
    ];
    write_started_manifest(
        temp.path(),
        id,
        vec!["settings.toml".to_owned(), "generated.toml".to_owned()],
    );
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Applying, &entries);
    let store = FileStore::new(temp.path());

    let manifest = store.read_storage_manifest().expect("recover applying");

    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("restored"),
        old
    );
    assert!(!temp.path().join("generated.toml").exists());
    assert_eq!(
        manifest.change_set(id).expect("change set").status,
        ChangeSetStatus::Repaired
    );
    assert!(temp
        .path()
        .join(".storage-transactions")
        .join(id)
        .join("rolled-back.toml")
        .is_file());
    assert!(!temp
        .path()
        .join(".storage-transactions")
        .join(id)
        .join("pending.toml")
        .exists());

    let second = store.read_storage_manifest().expect("idempotent recovery");
    assert_eq!(second, manifest);
    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("restored"),
        old
    );
}

#[test]
fn committed_recovery_finalizes_manifest_without_rolling_back_targets() {
    let temp = tempdir().expect("temp dir");
    let id = "committed-change";
    let old = b"old";
    let new = b"new";
    fs::write(temp.path().join("settings.toml"), new).expect("committed target");
    write_backup(temp.path(), id, "settings.toml", old);
    let entries = vec![JournalEntryFixture::present_write(
        id,
        "settings.toml",
        old,
        new,
    )];
    write_started_manifest(temp.path(), id, vec!["settings.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Committed, &entries);
    let store = FileStore::new(temp.path());

    let manifest = store.read_storage_manifest().expect("finalize commit");

    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("target"),
        new
    );
    assert_eq!(
        manifest.change_set(id).expect("change set").status,
        ChangeSetStatus::Applied
    );
    assert!(temp
        .path()
        .join(".storage-transactions")
        .join(id)
        .join("committed.toml")
        .is_file());
}

#[test]
fn rolling_back_recovery_is_idempotent_after_a_partial_restore() {
    let temp = tempdir().expect("temp dir");
    let id = "rolling-back-change";
    let first_old = b"first old";
    let first_new = b"first new";
    let second_old = b"second old";
    let second_new = b"second new";
    fs::write(temp.path().join("first.toml"), first_old).expect("already restored target");
    fs::write(temp.path().join("second.toml"), second_new).expect("pending restore target");
    write_backup(temp.path(), id, "first.toml", first_old);
    write_backup(temp.path(), id, "second.toml", second_old);
    let entries = vec![
        JournalEntryFixture::present_write(id, "first.toml", first_old, first_new),
        JournalEntryFixture::present_write(id, "second.toml", second_old, second_new),
    ];
    write_started_manifest(
        temp.path(),
        id,
        vec!["first.toml".to_owned(), "second.toml".to_owned()],
    );
    write_pending_journal(temp.path(), id, JournalPhaseFixture::RollingBack, &entries);
    let store = FileStore::new(temp.path());

    store.read_storage_manifest().expect("finish rollback");
    store.read_storage_manifest().expect("repeat recovery");

    assert_eq!(
        fs::read(temp.path().join("first.toml")).expect("first"),
        first_old
    );
    assert_eq!(
        fs::read(temp.path().join("second.toml")).expect("second"),
        second_old
    );
}

#[test]
fn applying_recovery_fails_closed_when_a_declared_backup_is_missing() {
    let temp = tempdir().expect("temp dir");
    let id = "missing-backup-change";
    let old = b"old";
    let new = b"new";
    fs::write(temp.path().join("settings.toml"), new).expect("partially replaced target");
    let entries = vec![JournalEntryFixture::present_write(
        id,
        "settings.toml",
        old,
        new,
    )];
    write_started_manifest(temp.path(), id, vec!["settings.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Applying, &entries);
    let store = FileStore::new(temp.path());

    let error = store
        .read_storage_manifest()
        .expect_err("missing declared backup must fail closed");

    assert!(matches!(error, FileStoreError::TransactionRecovery { .. }));
    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("target"),
        new
    );
    assert!(temp
        .path()
        .join(".storage-transactions")
        .join(id)
        .join("pending.toml")
        .is_file());
}

#[test]
fn rolled_back_pending_journal_only_finishes_manifest_bookkeeping() {
    let temp = tempdir().expect("temp dir");
    let id = "rolled-back-change";
    let old = b"old";
    let new = b"new";
    fs::write(temp.path().join("settings.toml"), old).expect("restored target");
    write_backup(temp.path(), id, "settings.toml", old);
    let mut entry = JournalEntryFixture::present_write(id, "settings.toml", old, new);
    // 准备阶段失败可能尚未生成后续文件的 backup digest，但 RolledBack 已证明未触碰目标。
    entry.original_sha256 = None;
    let entries = vec![entry];
    write_started_manifest(temp.path(), id, vec!["settings.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::RolledBack, &entries);
    let store = FileStore::new(temp.path());

    let manifest = store.read_storage_manifest().expect("finalize rollback");

    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("target"),
        old
    );
    assert_eq!(
        manifest.change_set(id).expect("change set").status,
        ChangeSetStatus::Repaired
    );
}

#[test]
fn applying_delete_recovery_restores_the_declared_original_file() {
    let temp = tempdir().expect("temp dir");
    let id = "delete-change";
    let old = b"must return";
    write_backup(temp.path(), id, "settings.toml", old);
    let entries = vec![JournalEntryFixture::present_delete(
        id,
        "settings.toml",
        old,
    )];
    write_started_manifest(temp.path(), id, vec!["settings.toml".to_owned()]);
    write_pending_journal(temp.path(), id, JournalPhaseFixture::Applying, &entries);
    let store = FileStore::new(temp.path());

    store.read_storage_manifest().expect("recover delete");

    assert_eq!(
        fs::read(temp.path().join("settings.toml")).expect("restored"),
        old
    );
}
