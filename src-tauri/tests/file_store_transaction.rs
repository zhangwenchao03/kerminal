//! DurableFileTransaction read-modify-write integration tests.
//!
//! @author kongweiguang

use std::{fs, sync::Arc, thread, time::Duration};

use kerminal_lib::storage::file_store::{FileStore, FileStoreError};
use tempfile::tempdir;

#[test]
fn concurrent_read_modify_write_transactions_do_not_lose_updates() {
    let temp = tempdir().expect("temp dir");
    fs::write(temp.path().join("counter.txt"), "0").expect("seed counter");
    let store = Arc::new(FileStore::new(temp.path()));
    let mut workers = Vec::new();

    for worker in 0..8 {
        let store = Arc::clone(&store);
        workers.push(thread::spawn(move || {
            store
                .run_transaction(
                    &format!("counter-{worker}"),
                    "2026-07-13T23:31:00+08:00",
                    |transaction| {
                        let current = transaction
                            .read_to_string("counter.txt")?
                            .parse::<u32>()
                            .expect("counter integer");
                        thread::sleep(Duration::from_millis(5));
                        transaction.write("counter.txt", (current + 1).to_string())?;
                        Ok(())
                    },
                )
                .expect("increment transaction");
        }));
    }
    for worker in workers {
        worker.join().expect("worker join");
    }

    assert_eq!(
        fs::read_to_string(temp.path().join("counter.txt")).expect("counter"),
        "8"
    );
}

#[test]
fn read_only_transaction_does_not_create_manifest_entry() {
    let temp = tempdir().expect("temp dir");
    fs::write(temp.path().join("value.txt"), "stable").expect("seed value");
    let store = FileStore::new(temp.path());

    let value = store
        .run_transaction("read-only", "2026-07-13T23:31:00+08:00", |transaction| {
            transaction.read_to_string("value.txt")
        })
        .expect("read-only transaction");

    assert_eq!(value, "stable");
    assert!(!temp.path().join("storage-manifest.toml").exists());
}

#[test]
fn external_edit_after_transaction_read_is_never_overwritten() {
    let temp = tempdir().expect("temp dir");
    let target = temp.path().join("settings.toml");
    fs::write(&target, "original").expect("seed target");
    let store = FileStore::new(temp.path());

    let error = store
        .run_transaction(
            "external-edit",
            "2026-07-13T23:31:00+08:00",
            |transaction| {
                assert_eq!(transaction.read_to_string("settings.toml")?, "original");
                fs::write(&target, "external").expect("simulate direct workspace edit");
                transaction.write("settings.toml", "transaction".to_owned())
            },
        )
        .expect_err("stale decision must not overwrite external edit");

    assert!(matches!(error, FileStoreError::RevisionConflict(_)));
    assert_eq!(fs::read_to_string(&target).expect("target"), "external");
    assert!(!temp.path().join("storage-manifest.toml").exists());
}

#[cfg(windows)]
#[test]
fn failed_windows_replace_preserves_original_target_contents() {
    use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    let temp = tempdir().expect("temp dir");
    let target = temp.path().join("settings.toml");
    fs::write(&target, "original").expect("seed target");
    let _exclusive = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&target)
        .expect("hold target without delete sharing");
    let store = FileStore::new(temp.path());

    store
        .atomic_write("settings.toml", b"replacement")
        .expect_err("replace should fail while target denies delete sharing");

    assert_eq!(
        fs::read_to_string(target).expect("original target"),
        "original"
    );
}
