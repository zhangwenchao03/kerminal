//! ConfigFileStore integration tests.
//!
//! @author kongweiguang

use std::{collections::HashMap, fs};

use kerminal_lib::{
    models::{
        profile::TerminalProfile,
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostCredentialStatus, SshJumpHostOptions,
            SshOptions,
        },
        settings::{AppSettings, ThemeMode},
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};
use tempfile::tempdir;

#[test]
fn settings_toml_roundtrip_keeps_runtime_model() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    let settings = AppSettings {
        theme_mode: ThemeMode::Light,
        ..AppSettings::default()
    };

    store.write_settings(&settings).expect("write settings");
    let loaded = store.read_settings().expect("read settings");
    let source = fs::read_to_string(temp.path().join("settings.toml")).expect("settings source");

    assert_eq!(loaded, settings);
    assert!(source.contains("schema_version = 1"));
    assert!(source.contains("themeMode = \"light\""));
}

#[test]
fn profile_toml_roundtrip_uses_one_file_per_profile() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    let mut env = HashMap::new();
    env.insert("RUST_LOG".to_owned(), "debug".to_owned());
    let profile = TerminalProfile {
        id: "profile-pwsh".to_owned(),
        name: "PowerShell".to_owned(),
        shell: "pwsh".to_owned(),
        args: vec!["-NoLogo".to_owned()],
        cwd: Some("C:/dev".to_owned()),
        env,
        is_default: true,
        sidebar_group_id: Some("group-local".to_owned()),
        sort_order: 10,
        created_at: "2026-06-24 08:00:00".to_owned(),
        updated_at: "2026-06-24 08:00:00".to_owned(),
    };

    store.write_profile(&profile).expect("write profile");
    let loaded = store.read_profile("profile-pwsh").expect("read profile");

    assert_eq!(loaded, profile);
    let source = fs::read_to_string(temp.path().join("profiles").join("profile-pwsh.toml"))
        .expect("profile source");
    assert!(source.contains("sidebar_group_id = \"group-local\""));
    assert!(temp
        .path()
        .join("profiles")
        .join("profile-pwsh.toml")
        .is_file());
}

#[test]
fn profile_toml_rejects_path_like_profile_ids() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());

    let error = store
        .read_profile("../default")
        .expect_err("path traversal profile id should fail");

    assert!(matches!(error, FileStoreError::InvalidPath(_)));
}

#[test]
fn settings_toml_rejects_wrong_schema_version() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    fs::write(
        temp.path().join("settings.toml"),
        "schema_version = 99\ntheme = \"dark\"\n",
    )
    .expect("write invalid schema");

    let error = store.read_settings().expect_err("wrong schema should fail");

    assert!(matches!(error, FileStoreError::TomlParse(_)));
}

#[test]
fn remote_host_toml_does_not_persist_transient_secrets() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    let mut host = RemoteHost {
        id: "host-1".to_owned(),
        group_id: None,
        name: "prod".to_owned(),
        host: "prod.internal".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        credential_secret: Some("target-secret".to_owned()),
        credential_status: Default::default(),
        tags: vec!["prod".to_owned()],
        production: true,
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "1".to_owned(),
        updated_at: "1".to_owned(),
    };
    host.ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "jump".to_owned(),
        host: "jump.internal".to_owned(),
        port: 22,
        username: "ops".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        credential_secret: Some("jump-secret".to_owned()),
        credential_status: Default::default(),
    });

    store
        .apply_remote_host_change_set(None, &[host.clone()], &[])
        .expect("write host");

    let host_source =
        fs::read_to_string(temp.path().join("hosts/host-1.toml")).expect("host source");
    let loaded = store
        .remote_host_by_id("host-1")
        .expect("read host")
        .expect("host exists");

    assert!(!host_source.contains("target-secret"));
    assert!(!host_source.contains("jump-secret"));
    assert!(!host_source.contains("credential_secret"));
    assert!(!temp.path().join("secrets/hosts/host-1.toml").exists());
    assert_eq!(loaded.credential_secret, None);
    assert_eq!(
        loaded
            .ssh_options
            .jump_hosts
            .first()
            .and_then(|jump| jump.credential_secret.as_ref()),
        None
    );
}

#[test]
fn remote_host_toml_tree_uses_runtime_ungrouped_group() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    let host = RemoteHost {
        id: "host-2".to_owned(),
        group_id: None,
        name: "standalone".to_owned(),
        host: "standalone.internal".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        auth_type: RemoteHostAuthType::Agent,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        credential_secret: None,
        credential_status: RemoteHostCredentialStatus::Agent,
        tags: Vec::new(),
        production: false,
        ssh_options: SshOptions::default(),
        sort_order: 10,
        created_at: "1".to_owned(),
        updated_at: "1".to_owned(),
    };

    store
        .apply_remote_host_change_set(None, std::slice::from_ref(&host), &[])
        .expect("write host");

    let tree = store.list_remote_host_tree().expect("tree");

    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].id, "__ungrouped__");
    assert_eq!(tree[0].hosts, vec![host]);
    assert!(!temp.path().join("hosts/__ungrouped__.toml").exists());
}

#[test]
fn remote_host_toml_defaults_missing_production_to_false() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    fs::create_dir_all(temp.path().join("hosts")).expect("hosts dir");
    fs::write(
        temp.path().join("hosts/host-missing-production.toml"),
        r#"schema_version = 1
id = "host-missing-production"
name = "AI added host"
host = "host.internal"
port = 22
username = "deploy"
auth_type = "agent"
sort_order = 10
created_at = "1"
updated_at = "1"
"#,
    )
    .expect("write host");

    let loaded = store
        .remote_host_by_id("host-missing-production")
        .expect("read host")
        .expect("host exists");

    assert!(!loaded.production);
}

#[test]
fn remote_host_toml_rejects_secret_fields_in_public_host_file() {
    let temp = tempdir().expect("temp dir");
    let store = ConfigFileStore::new(temp.path());
    fs::create_dir_all(temp.path().join("hosts")).expect("hosts dir");
    fs::write(
        temp.path().join("hosts/host-3.toml"),
        "schema_version = 1\nid = \"host-3\"\ncredential_secret = \"leak\"\n",
    )
    .expect("write invalid host");

    let error = store
        .remote_host_by_id("host-3")
        .expect_err("secret in public host must fail");

    assert!(matches!(error, FileStoreError::TomlParse(_)));
}
