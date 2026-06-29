//! Workspace sync and encrypted vault bootstrap tests.
//!
//! @author kongweiguang

use std::{ffi::OsStr, fs, path::Path, process::Command};

use kerminal_lib::{
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::{write_toml_atomically, EncryptedVaultService, VaultFile},
        workspace_sync_service::{WorkspaceSyncRunStatus, WorkspaceSyncService},
    },
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
