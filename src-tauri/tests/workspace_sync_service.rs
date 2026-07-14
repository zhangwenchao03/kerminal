//! Workspace sync and encrypted vault bootstrap tests.
//!
//! @author kongweiguang

use std::{
    ffi::OsStr,
    fs,
    path::Path,
    process::Command,
    sync::{Arc, Barrier},
    thread,
};

#[cfg(windows)]
use std::{
    env,
    process::Stdio,
    time::{Duration, Instant},
};

use kerminal_lib::{
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::{write_toml_atomically, EncryptedVaultService, VaultFile},
        workspace_sync_service::{WorkspaceSyncRunStatus, WorkspaceSyncService},
    },
    storage::{file_store::FileStore, storage_manifest::ChangeSetStatus},
};

#[test]
fn workspace_sync_bootstrap_creates_key_and_safe_gitignore() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = WorkspaceSyncService::new(paths.clone());

    let status = service.ensure_bootstrap().expect("bootstrap");

    assert!(paths.vault_key_file().is_file());
    assert!(paths.gitignore_file().is_file());
    assert!(status.vault.vault_key_present);
    assert_eq!(status.vault.key_id.as_deref(), Some("workspace-default"));
    let gitignore = fs::read_to_string(paths.gitignore_file()).expect("gitignore");
    assert!(gitignore.contains("secrets/vault-key.toml"));
    assert!(!gitignore.contains("secrets/hosts/"));
    assert!(!gitignore.contains("secrets/vault.toml"));
    assert!(status.gitignore.has_required_rules);
}

#[test]
fn workspace_sync_repairs_missing_gitignore_rules_without_removing_user_rules() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    fs::create_dir_all(&paths.root).expect("root");
    fs::write(paths.gitignore_file(), "user-rule\n").expect("seed gitignore");
    let service = WorkspaceSyncService::new(paths.clone());

    service.ensure_bootstrap().expect("bootstrap");

    let gitignore = fs::read_to_string(paths.gitignore_file()).expect("gitignore");
    assert!(gitignore.contains("user-rule"));
    assert!(gitignore.contains("secrets/vault-key.toml"));
    assert!(gitignore.contains("data/command.sqlite"));
}

#[test]
fn workspace_sync_does_not_create_new_key_over_existing_vault() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    fs::create_dir_all(&paths.secrets).expect("secrets");
    fs::write(paths.vault_file(), "not valid toml").expect("seed invalid vault");
    let service = WorkspaceSyncService::new(paths.clone());

    let status = service.ensure_bootstrap().expect("bootstrap");

    assert!(!paths.vault_key_file().exists());
    assert!(status.vault.vault_present);
    assert!(!status.vault.vault_key_present);
    assert_eq!(status.vault.status, "keyMissingEmptyVault");
}

#[test]
fn workspace_sync_never_treats_corrupt_key_as_missing() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    fs::create_dir_all(&paths.secrets).expect("create secrets");
    let corrupt_source = "not valid vault key toml\n";
    fs::write(paths.vault_key_file(), corrupt_source).expect("seed corrupt key");
    let service = EncryptedVaultService::new(paths.clone());

    let error = service
        .ensure_workspace_key_if_safe()
        .expect_err("corrupt key must fail closed");

    assert!(error.to_string().contains("vault"));
    assert_eq!(
        fs::read_to_string(paths.vault_key_file()).expect("read corrupt key"),
        corrupt_source
    );
}

#[test]
fn encrypted_vault_roundtrip_requires_matching_associated_data() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = EncryptedVaultService::new(KerminalPaths::from_root(temp.path()));
    let key = service.create_workspace_key().expect("key");
    let entry = service
        .encrypt_secret(
            &key,
            "credential:kerminal:ssh-host:test:target:password:v1",
            "ssh-password",
            b"host:test",
            b"secret-password",
        )
        .expect("encrypt");

    let plaintext = service
        .decrypt_secret(&key, &entry, b"host:test")
        .expect("decrypt");
    assert_eq!(plaintext, b"secret-password");

    let error = service
        .decrypt_secret(&key, &entry, b"host:other")
        .expect_err("wrong aad must fail");
    assert!(error.to_string().contains("associated data"));

    let mut invalid_nonce = entry;
    invalid_nonce.nonce = "short".to_owned();
    let error = service
        .decrypt_secret(&key, &invalid_nonce, b"host:test")
        .expect_err("invalid nonce length must fail without panic");
    assert!(error.to_string().contains("vault nonce"));
}

#[test]
fn concurrent_vault_upserts_preserve_every_entry() {
    const WORKERS: usize = 16;
    let temp = tempfile::tempdir().expect("tempdir");
    let service = EncryptedVaultService::new(KerminalPaths::from_root(temp.path()));
    service.create_workspace_key().expect("create key");
    let barrier = Arc::new(Barrier::new(WORKERS));
    let workers = (0..WORKERS)
        .map(|index| {
            let service = service.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                let entry_id = format!("credential:kerminal:ssh-host:{index}:target:password:v1");
                barrier.wait();
                service
                    .upsert_secret(
                        &entry_id,
                        "ssh-host",
                        entry_id.as_bytes(),
                        format!("secret-{index}").as_bytes(),
                    )
                    .expect("upsert vault entry")
            })
        })
        .collect::<Vec<_>>();

    for worker in workers {
        worker.join().expect("join vault worker");
    }
    let vault = service.read_vault().expect("read vault");

    assert_eq!(vault.entries.len(), WORKERS);
    for index in 0..WORKERS {
        let entry_id = format!("credential:kerminal:ssh-host:{index}:target:password:v1");
        assert!(vault.entries.iter().any(|entry| entry.id == entry_id));
    }
}

#[test]
fn vault_key_export_import_supports_dry_run_and_write() {
    let source_temp = tempfile::tempdir().expect("source tempdir");
    let source_paths = KerminalPaths::from_root(source_temp.path());
    let source_service = WorkspaceSyncService::new(source_paths.clone());
    source_service.ensure_bootstrap().expect("source bootstrap");
    let exported = source_service.export_vault_key_toml().expect("export key");

    let target_temp = tempfile::tempdir().expect("target tempdir");
    let target_paths = KerminalPaths::from_root(target_temp.path());
    let target_service = WorkspaceSyncService::new(target_paths.clone());
    let dry_run = target_service
        .import_vault_key_toml(&exported, true)
        .expect("dry run import");
    assert!(dry_run.dry_run);
    assert_eq!(dry_run.key_id, "workspace-default");
    assert!(!target_paths.vault_key_file().exists());

    let written = target_service
        .import_vault_key_toml(&exported, false)
        .expect("write import");
    assert!(!written.dry_run);
    assert_eq!(written.entry_count, 0);
    assert!(target_paths.vault_key_file().is_file());
    assert_eq!(
        fs::read_to_string(target_paths.vault_key_file()).expect("imported key"),
        exported
    );
}

#[test]
fn vault_key_save_validates_existing_vault_before_write() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = EncryptedVaultService::new(paths.clone());
    let old_key = service.create_workspace_key().expect("key");
    let entry = service
        .encrypt_secret(
            &old_key,
            "credential:kerminal:ssh-host:test:target:password:v1",
            "ssh-password",
            b"host:test",
            b"secret-password",
        )
        .expect("encrypt");
    write_toml_atomically(
        &paths.vault_file(),
        &VaultFile {
            schema_version: 1,
            entries: vec![entry],
        },
    )
    .expect("write vault");
    let sync = WorkspaceSyncService::new(paths.clone());
    let original_key_source = sync.read_vault_key_toml().expect("read key");

    let other_temp = tempfile::tempdir().expect("other tempdir");
    let other_paths = KerminalPaths::from_root(other_temp.path());
    let other_sync = WorkspaceSyncService::new(other_paths);
    other_sync.ensure_bootstrap().expect("other bootstrap");
    let incompatible_key = other_sync.export_vault_key_toml().expect("other key");

    let error = sync
        .save_vault_key_toml(&incompatible_key)
        .expect_err("incompatible key must fail");

    assert!(error.to_string().contains("vault decryption failed"));
    assert_eq!(
        fs::read_to_string(paths.vault_key_file()).expect("key after failed save"),
        original_key_source
    );
}

#[test]
fn workspace_sync_run_commits_local_changes_without_remote() {
    if which::which("git").is_err() {
        return;
    }

    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = WorkspaceSyncService::new(paths.clone());
    service.ensure_bootstrap().expect("bootstrap");
    configure_test_git(&paths.root);
    fs::write(paths.root.join("settings.toml"), "theme_mode = \"dark\"\n").expect("write settings");

    let result = service.run_sync().expect("run sync");

    assert_eq!(result.status, WorkspaceSyncRunStatus::Warning);
    assert!(result.skipped_remote);
    assert!(result.committed);
    assert!(!result.pulled);
    assert!(result.commit_hash.is_some());
    let files = git(&paths.root, ["ls-files"]);
    assert!(files.contains("settings.toml"));
    assert!(files.contains(".gitignore"));
    assert!(!files.contains("secrets/vault-key.toml"));
}

#[test]
fn workspace_sync_never_commits_vault_recovery_artifacts() {
    if which::which("git").is_err() {
        return;
    }

    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let sync = WorkspaceSyncService::new(paths.clone());
    sync.ensure_bootstrap().expect("bootstrap");
    configure_test_git(&paths.root);
    let vault = EncryptedVaultService::new(paths.clone());
    let old_key = vault.read_key().expect("old key");
    vault
        .upsert_secret(
            "credential:kerminal:ssh-host:sync-safety:target:password:v1",
            "ssh-host",
            b"credential:kerminal:ssh-host:sync-safety:target:password:v1",
            b"synthetic-sync-secret",
        )
        .expect("write synthetic entry");
    sync.rotate_vault_key(false).expect("rotate key");
    let next_key = vault.read_key().expect("next key");
    git(
        &paths.root,
        [
            "add",
            "--force",
            "--",
            "secrets/vault-key.toml.bak.*",
            ".storage-transactions/",
            "backups/",
            "storage-manifest.toml",
        ],
    );
    fs::write(paths.root.join("settings.toml"), "theme_mode = \"dark\"\n").expect("write settings");

    let result = sync.run_sync().expect("run sync");

    assert!(result.committed);
    let tracked = git(&paths.root, ["ls-files"]);
    for forbidden in [
        "secrets/vault-key.toml",
        "secrets/vault-key.toml.bak.",
        ".storage-transactions/",
        "backups/",
        ".storage.lock",
        "storage-manifest.toml",
    ] {
        assert!(
            !tracked.contains(forbidden),
            "tracked local-only path: {forbidden}"
        );
    }
    let commit = git(&paths.root, ["show", "--format=fuller", "HEAD"]);
    assert!(!commit.contains(&old_key.master_key));
    assert!(!commit.contains(&next_key.master_key));
    let gitignore = fs::read_to_string(paths.gitignore_file()).expect("read gitignore");
    for rule in [
        "secrets/vault-key.toml.bak.*",
        ".storage-transactions/",
        "backups/",
        ".storage.lock",
        "storage-manifest.toml",
    ] {
        assert!(gitignore.contains(rule));
    }
}

#[test]
fn workspace_sync_run_does_not_commit_tracked_vault_key_changes() {
    if which::which("git").is_err() {
        return;
    }

    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = WorkspaceSyncService::new(paths.clone());
    service.ensure_bootstrap().expect("bootstrap");
    configure_test_git(&paths.root);
    git(&paths.root, ["add", "--all", "--", "."]);
    git(
        &paths.root,
        ["add", "--force", "--", "secrets/vault-key.toml"],
    );
    git(&paths.root, ["commit", "-m", "track key by mistake"]);
    fs::write(paths.root.join("settings.toml"), "theme_mode = \"dark\"\n").expect("write settings");
    fs::write(paths.vault_key_file(), "not a real key\n").expect("modify key");

    let result = service.run_sync().expect("run sync");

    assert_eq!(result.status, WorkspaceSyncRunStatus::Warning);
    assert!(result.committed);
    let committed_files = git(&paths.root, ["show", "--name-only", "--format=", "HEAD"]);
    assert!(committed_files.contains("settings.toml"));
    assert!(!committed_files.contains("secrets/vault-key.toml"));
    let status = git(
        &paths.root,
        ["status", "--porcelain", "--", "secrets/vault-key.toml"],
    );
    assert!(status.contains("secrets/vault-key.toml"));
}

#[test]
fn workspace_sync_run_pulls_upstream_then_commits_local_changes() {
    if which::which("git").is_err() {
        return;
    }

    let temp = tempfile::tempdir().expect("tempdir");
    let remote = temp.path().join("remote.git");
    let remote_text = remote.to_string_lossy().into_owned();
    git(temp.path(), ["init", "--bare", remote_text.as_str()]);

    let paths = KerminalPaths::from_root(temp.path().join("workspace"));
    let service = WorkspaceSyncService::new(paths.clone());
    service.ensure_bootstrap().expect("bootstrap");
    configure_test_git(&paths.root);
    fs::write(paths.root.join("base.toml"), "base = true\n").expect("write base");
    git(&paths.root, ["add", "--all", "--", "."]);
    git(&paths.root, ["commit", "-m", "initial"]);
    git(&paths.root, ["branch", "-M", "main"]);
    git(
        &paths.root,
        ["remote", "add", "origin", remote_text.as_str()],
    );
    git(&paths.root, ["push", "-u", "origin", "main"]);
    fs::write(paths.root.join("settings.toml"), "theme_mode = \"dark\"\n").expect("write settings");

    let result = service.run_sync().expect("run sync");

    assert_eq!(result.status, WorkspaceSyncRunStatus::Success);
    assert!(!result.skipped_remote);
    assert!(result.pulled);
    assert!(result.committed);
    let files = git(&paths.root, ["ls-files"]);
    assert!(files.contains("settings.toml"));
    assert!(!files.contains("secrets/vault-key.toml"));
}

#[test]
fn vault_key_rotation_reencrypts_entries_and_keeps_backup() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = EncryptedVaultService::new(paths.clone());
    let old_key = service.create_workspace_key().expect("key");
    let entry = service
        .encrypt_secret(
            &old_key,
            "credential:kerminal:ssh-host:test:target:password:v1",
            "ssh-password",
            b"host:test",
            b"secret-password",
        )
        .expect("encrypt");
    write_toml_atomically(
        &paths.vault_file(),
        &VaultFile {
            schema_version: 1,
            entries: vec![entry.clone()],
        },
    )
    .expect("write vault");
    let sync = WorkspaceSyncService::new(paths.clone());

    let dry_run = sync.rotate_vault_key(true).expect("dry-run rotate");
    assert!(dry_run.dry_run);
    assert_eq!(dry_run.entry_count, 1);
    assert_eq!(service.read_key().expect("key after dry-run"), old_key);

    let rotated = sync.rotate_vault_key(false).expect("rotate");
    assert!(!rotated.dry_run);
    assert!(rotated.backup_created);
    let manifest = FileStore::new(&paths.root)
        .read_storage_manifest()
        .expect("read rotation manifest");
    let rotation_change_set = manifest
        .last_applied_change_set_id
        .as_deref()
        .and_then(|id| manifest.change_set(id))
        .expect("rotation change set");
    assert!(rotation_change_set
        .touched_files
        .contains(&"secrets/vault-key.toml".to_owned()));
    assert!(rotation_change_set
        .touched_files
        .contains(&"secrets/vault.toml".to_owned()));
    assert!(rotation_change_set
        .touched_files
        .iter()
        .any(|path| path.starts_with("secrets/vault-key.toml.bak.")));
    assert!(rotation_change_set
        .touched_files
        .iter()
        .any(|path| path.starts_with("secrets/vault.toml.bak.")));
    let next_key = service.read_key().expect("new key");
    assert_ne!(next_key.master_key, old_key.master_key);
    let next_vault = service.read_vault().expect("new vault");
    assert_eq!(next_vault.entries.len(), 1);
    assert!(service
        .decrypt_secret(&old_key, &next_vault.entries[0], b"host:test")
        .is_err());
    let plaintext = service
        .decrypt_secret(&next_key, &next_vault.entries[0], b"host:test")
        .expect("decrypt with rotated key");
    assert_eq!(plaintext, b"secret-password");

    let backup_count = fs::read_dir(&paths.secrets)
        .expect("secrets")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".bak."))
        .count();
    assert!(backup_count >= 2);
}

#[test]
fn consecutive_vault_rotations_keep_distinct_key_backups() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = EncryptedVaultService::new(paths.clone());
    service.create_workspace_key().expect("create key");
    service
        .upsert_secret(
            "credential:kerminal:ssh-host:backup-uniqueness:target:password:v1",
            "ssh-host",
            b"credential:kerminal:ssh-host:backup-uniqueness:target:password:v1",
            b"synthetic-backup-secret",
        )
        .expect("seed vault");

    service.rotate_workspace_key(false).expect("first rotation");
    service
        .rotate_workspace_key(false)
        .expect("second rotation");

    let key_backups = fs::read_dir(&paths.secrets)
        .expect("read secrets")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("vault-key.toml.bak."))
        .collect::<Vec<_>>();
    assert_eq!(key_backups.len(), 2);
    assert_ne!(key_backups[0], key_backups[1]);
}

#[cfg(windows)]
#[test]
fn killed_vault_rotation_recovers_key_and_vault_on_restart() {
    const ENTRY_COUNT: usize = 64;
    const SECRET_BYTES: usize = 512 * 1024;
    const CHILD_ROOT_ENV: &str = "KERMINAL_VAULT_ROTATION_CHILD_ROOT";

    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    let service = EncryptedVaultService::new(paths.clone());
    let old_key = service.create_workspace_key().expect("create old key");
    let plaintext = vec![b'v'; SECRET_BYTES];
    let entries = (0..ENTRY_COUNT)
        .map(|index| {
            let id = format!("credential:kerminal:ssh-host:recovery-{index}:target:password:v1");
            service
                .encrypt_secret(&old_key, &id, "ssh-host", id.as_bytes(), &plaintext)
                .expect("seed encrypted entry")
        })
        .collect::<Vec<_>>();
    write_toml_atomically(
        &paths.vault_file(),
        &VaultFile {
            schema_version: 1,
            entries,
        },
    )
    .expect("write original vault");

    let executable = env::current_exe().expect("current test executable");
    let mut child = Command::new(executable)
        .args([
            "--exact",
            "vault_rotation_child_process",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_ROOT_ENV, &paths.root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn vault rotation child");
    let deadline = Instant::now() + Duration::from_secs(120);
    let transaction_id = loop {
        if let Some(id) = applying_vault_rotation_transaction(&paths.root) {
            break id;
        }
        if let Some(status) = child.try_wait().expect("poll vault rotation child") {
            panic!("vault rotation child exited before interruption: {status}");
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for vault rotation journal"
        );
        thread::sleep(Duration::from_millis(1));
    };

    child.kill().expect("kill vault rotation child");
    assert!(!child.wait().expect("wait killed child").success());
    let store = FileStore::new(&paths.root);
    store
        .recover_pending_transactions()
        .expect("recover interrupted vault rotation");

    let recovered_key = service.read_key().expect("read recovered key");
    let recovered_vault = service.read_vault().expect("read recovered vault");
    assert_eq!(recovered_key, old_key);
    assert_eq!(recovered_vault.entries.len(), ENTRY_COUNT);
    for entry in [
        recovered_vault.entries.first().expect("first entry"),
        recovered_vault.entries.last().expect("last entry"),
    ] {
        let decrypted = service
            .decrypt_secret(&recovered_key, entry, entry.id.as_bytes())
            .expect("decrypt recovered entry");
        assert_eq!(decrypted, plaintext);
    }
    let manifest = store.read_storage_manifest().expect("read manifest");
    assert_eq!(
        manifest
            .change_set(&transaction_id)
            .expect("recovered rotation change set")
            .status,
        ChangeSetStatus::Repaired
    );
}

#[cfg(windows)]
#[test]
fn vault_rotation_child_process() {
    const CHILD_ROOT_ENV: &str = "KERMINAL_VAULT_ROTATION_CHILD_ROOT";
    let Some(root) = env::var_os(CHILD_ROOT_ENV) else {
        return;
    };
    WorkspaceSyncService::new(KerminalPaths::from_root(root))
        .rotate_vault_key(false)
        .expect("rotate vault in child");
}

#[cfg(windows)]
fn applying_vault_rotation_transaction(root: &Path) -> Option<String> {
    let transaction_root = root.join(".storage-transactions");
    for entry in fs::read_dir(transaction_root).ok()?.filter_map(Result::ok) {
        let id = entry.file_name().to_string_lossy().into_owned();
        if !id.starts_with("vault-key-rotate-") {
            continue;
        }
        let source = fs::read_to_string(entry.path().join("pending.toml")).ok()?;
        if source.contains("phase = \"applying\"") {
            return Some(id);
        }
    }
    None
}

fn configure_test_git(root: &Path) {
    git(root, ["config", "user.name", "Kerminal Test"]);
    git(
        root,
        ["config", "user.email", "kerminal-test@example.invalid"],
    );
}

fn git<I, S>(root: &Path, args: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}
