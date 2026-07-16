//! FileStore lock ownership and stale takeover integration tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::storage::file_store::{FileStore, FileStoreError};
use tempfile::tempdir;

#[test]
fn lock_file_records_process_identity_nonce_and_creation_time() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());

    let lock = store.acquire_lock().expect("acquire lock");
    let source = fs::read_to_string(temp.path().join(".storage.lock")).expect("lock source");
    let value = source.parse::<toml::Table>().expect("lock TOML");

    assert_eq!(
        value
            .get("schema_version")
            .and_then(toml::Value::as_integer),
        Some(1)
    );
    assert_eq!(
        value.get("pid").and_then(toml::Value::as_integer),
        Some(i64::from(std::process::id()))
    );
    assert!(value
        .get("process_started_at_unix_seconds")
        .and_then(toml::Value::as_integer)
        .is_some_and(|value| value > 0));
    assert!(value
        .get("created_at_unix_ms")
        .and_then(toml::Value::as_integer)
        .is_some_and(|value| value > 0));
    assert!(value
        .get("nonce")
        .and_then(toml::Value::as_str)
        .is_some_and(|value| !value.is_empty()));

    drop(lock);
    assert!(!temp.path().join(".storage.lock").exists());
}

#[test]
fn malformed_lock_fails_closed_instead_of_being_deleted() {
    let temp = tempdir().expect("temp dir");
    fs::write(temp.path().join(".storage.lock"), "not = [valid").expect("malformed lock");
    let store = FileStore::new(temp.path());

    let error = store.acquire_lock().expect_err("malformed lock must block");

    assert!(matches!(error, FileStoreError::InvalidLock(_)));
    assert!(temp.path().join(".storage.lock").is_file());
}

#[test]
fn lock_with_provably_dead_owner_is_reclaimed() {
    let temp = tempdir().expect("temp dir");
    fs::write(
        temp.path().join(".storage.lock"),
        "schema_version = 1\npid = 4294967295\nprocess_started_at_unix_seconds = 1\ncreated_at_unix_ms = 1\nnonce = \"dead-owner\"\n",
    )
    .expect("stale lock");
    let store = FileStore::new(temp.path());

    let lock = store.acquire_lock().expect("reclaim stale lock");
    let source = fs::read_to_string(temp.path().join(".storage.lock")).expect("new lock source");

    assert!(!source.contains("dead-owner"));
    drop(lock);
}

#[test]
fn reused_pid_with_different_start_time_is_reclaimed() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    let lock = store.acquire_lock().expect("capture current identity");
    let lock_path = temp.path().join(".storage.lock");
    let source = fs::read_to_string(&lock_path).expect("lock source");
    drop(lock);
    let mut value = source.parse::<toml::Table>().expect("lock TOML");
    let started_at = value
        .get("process_started_at_unix_seconds")
        .and_then(toml::Value::as_integer)
        .expect("process start time");
    value.insert(
        "process_started_at_unix_seconds".to_owned(),
        toml::Value::Integer(started_at + 1),
    );
    fs::write(
        &lock_path,
        toml::to_string_pretty(&value).expect("encode reused PID lock"),
    )
    .expect("write reused PID lock");

    let reclaimed = store.acquire_lock().expect("reclaim reused PID lock");

    drop(reclaimed);
    assert!(!lock_path.exists());
}

#[test]
fn dropping_old_guard_does_not_delete_a_replaced_lock_nonce() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    let lock = store.acquire_lock().expect("acquire lock");
    let lock_path = temp.path().join(".storage.lock");
    let source = fs::read_to_string(&lock_path).expect("lock source");
    let replaced = source
        .lines()
        .map(|line| {
            if line.starts_with("nonce = ") {
                "nonce = \"replacement-owner\"".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&lock_path, format!("{replaced}\n")).expect("replace lock identity");

    drop(lock);

    assert!(lock_path.is_file());
}
