//! Windows 子进程 kill/restart 的真实事务恢复测试。
//!
//! @author kongweiguang

#![cfg(windows)]

use std::{
    env, fs,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use kerminal_lib::storage::{
    file_store::{FileStore, FileStoreChange},
    storage_manifest::ChangeSetStatus,
};
use tempfile::tempdir;

const CHILD_ROOT_ENV: &str = "KERMINAL_FILE_TRANSACTION_CHILD_ROOT";
const CHANGE_SET_ID: &str = "killed-process-change";
const FILE_COUNT: usize = 128;

#[test]
fn killed_applying_transaction_recovers_on_restart() {
    let temp = tempdir().expect("temp dir");
    seed_original_files(temp.path());
    let executable = env::current_exe().expect("current test executable");
    let mut child = Command::new(executable)
        .args([
            "--exact",
            "transaction_child_process",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_ROOT_ENV, temp.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn transaction child");
    let pending = temp
        .path()
        .join(".storage-transactions")
        .join(CHANGE_SET_ID)
        .join("pending.toml");
    let deadline = Instant::now() + Duration::from_secs(60);

    loop {
        if let Ok(source) = fs::read_to_string(&pending) {
            assert!(
                !source.contains("phase = \"committed\""),
                "transaction completed before the parent could interrupt it"
            );
            if source.contains("phase = \"applying\"") {
                break;
            }
        }
        if let Some(status) = child.try_wait().expect("poll transaction child") {
            panic!("transaction child exited before applying: {status}");
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for applying journal"
        );
        thread::sleep(Duration::from_millis(2));
    }

    child.kill().expect("kill applying transaction child");
    let status = child.wait().expect("wait killed transaction child");
    assert!(!status.success());
    assert!(temp.path().join(".storage.lock").is_file());

    let restarted = FileStore::new(temp.path());
    restarted
        .recover_pending_transactions()
        .expect("recover killed transaction");
    let manifest = restarted
        .read_storage_manifest()
        .expect("recovered manifest");

    assert_eq!(
        manifest
            .change_set(CHANGE_SET_ID)
            .expect("recovered change set")
            .status,
        ChangeSetStatus::Repaired
    );
    assert!(!temp.path().join(".storage.lock").exists());
    for index in 0..FILE_COUNT {
        assert_eq!(
            fs::read_to_string(file_path(temp.path(), index)).expect("restored file"),
            original_contents(index)
        );
    }
}

#[test]
fn transaction_child_process() {
    let Some(root) = env::var_os(CHILD_ROOT_ENV) else {
        return;
    };
    let store = FileStore::new(root);
    let replacement = vec![b'x'; 64 * 1024];
    let changes = (0..FILE_COUNT)
        .map(|index| {
            FileStoreChange::new(relative_path(index), replacement.clone()).expect("child change")
        })
        .collect::<Vec<_>>();

    store
        .apply_change_set(CHANGE_SET_ID, "2026-07-13T23:32:00+08:00", changes)
        .expect("child transaction");
}

fn seed_original_files(root: &Path) {
    fs::create_dir_all(root.join("documents")).expect("documents directory");
    for index in 0..FILE_COUNT {
        fs::write(file_path(root, index), original_contents(index)).expect("seed original file");
    }
}

fn relative_path(index: usize) -> String {
    format!("documents/file-{index:03}.txt")
}

fn file_path(root: &Path, index: usize) -> std::path::PathBuf {
    root.join(relative_path(index))
}

fn original_contents(index: usize) -> String {
    format!("original-{index:03}")
}
