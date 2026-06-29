//! SSH 远程终端服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::{
        remote_host::{
            RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroupCreateRequest,
            SshJumpHostOptions, SshOptions,
        },
        terminal::SshTerminalCreateRequest,
    },
    paths::KerminalPaths,
    services::ssh_terminal_service::rules::{
        cleanup_temporary_identity_files, resolve_terminal_launch, temporary_identity_directory,
    },
    state::AppState,
};
use std::{fs, path::PathBuf, time::Duration};
use tempfile::{tempdir, TempDir};

const TEST_PRIVATE_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\nkerminal-test-private-key\n-----END OPENSSH PRIVATE KEY-----\n";
const TEST_PASSWORD: &str = "s3cr3t-ssh-password";
const JUMP_PASSWORD: &str = "jump-password-secret";
const TARGET_PASSWORD: &str = "target-password-secret";

#[test]
fn resolve_terminal_request_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: "missing-host".to_owned(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn resolve_terminal_request_uses_app_known_hosts_file() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    let expected_known_hosts = format!(
        "UserKnownHostsFile={}",
        state.paths().root.join("known_hosts").to_string_lossy()
    );
    assert!(request.args.contains(&expected_known_hosts));
    assert!(request
        .args
        .contains(&"GlobalKnownHostsFile=none".to_owned()));
    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn resolve_terminal_request_sets_default_term_env() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(request.env.get("TERM"), Some(&"xterm-256color".to_owned()));
}

#[test]
fn resolve_terminal_request_enters_requested_remote_cwd() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/dev".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/dev' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_quotes_requested_remote_cwd() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: Some("/srv/app's data".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/srv/app'\\''s data' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_rejects_zero_size() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Agent, None);

    let error = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 0,
            },
        )
        .expect_err("reject zero rows");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn resolve_terminal_request_uses_configured_terminal_type() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.terminal_type = "xterm".to_owned();
    let host_id =
        create_test_remote_host_with_options(&state, RemoteHostAuthType::Agent, None, ssh_options);

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(request.env.get("TERM"), Some(&"xterm".to_owned()));
}

#[test]
fn resolve_terminal_request_uses_key_path_identity_file() {
    let (_home, state) = test_state();
    let key_path = state
        .paths()
        .root
        .join("keys")
        .join("dev ed25519")
        .to_string_lossy()
        .into_owned();
    let host_id = create_test_remote_host(&state, RemoteHostAuthType::Key, Some(key_path.clone()));

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(request
        .args
        .windows(2)
        .any(|pair| pair[0] == "-i" && pair[1] == key_path));
    assert!(request.args.contains(&"IdentitiesOnly=yes".to_owned()));
    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn resolve_terminal_request_expands_home_relative_identity_file() {
    let (_home, state) = test_state();
    let expected_identity = dirs::home_dir()
        .expect("current user home")
        .join(".ssh")
        .join("id_ed25519")
        .to_string_lossy()
        .into_owned();
    let host_id = create_test_remote_host(
        &state,
        RemoteHostAuthType::Key,
        Some("~/.ssh/id_ed25519".to_owned()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(request
        .args
        .windows(2)
        .any(|pair| pair[0] == "-i" && pair[1] == expected_identity));
}

#[test]
fn resolve_terminal_request_materializes_inline_private_key_for_openssh() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Key,
        None,
        Some(TEST_PRIVATE_KEY.to_owned()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh")));
    let identity_path = request
        .args
        .windows(2)
        .find(|pair| pair[0] == "-i")
        .map(|pair| PathBuf::from(&pair[1]))
        .expect("identity path arg");
    assert!(identity_path.starts_with(state.paths().temp.join("ssh-terminal-keys")));
    assert_eq!(request.cleanup_paths, vec![identity_path.clone()]);
    assert_eq!(
        fs::read_to_string(&identity_path).unwrap(),
        TEST_PRIVATE_KEY
    );

    for path in request.cleanup_paths {
        let _ = fs::remove_file(path);
    }
}

#[test]
fn resolve_terminal_request_uses_saved_vault_password_without_exposing_args() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: host_id.clone(),
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh") || arg.contains(TEST_PASSWORD)));
    assert!(request
        .args
        .contains(&"PreferredAuthentications=publickey,password,keyboard-interactive".to_owned(),));
    let host = state
        .remote_hosts()
        .require_host(&host_id)
        .expect("stored host");
    assert!(
        host.secret_ref.is_some(),
        "stored host should keep encrypted vault ref"
    );
    assert_eq!(host.credential_secret, None);
}

#[test]
fn resolve_terminal_launch_uses_saved_vault_password_secret_plan() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host_with_secret(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TEST_PASSWORD.to_owned()),
    );

    let launch = resolve_terminal_launch(
        state.ssh_terminals(),
        state.remote_hosts(),
        state.paths(),
        SshTerminalCreateRequest {
            host_id: host_id.clone(),
            cwd: None,
            remote_command: None,
            cols: 80,
            rows: 24,
        },
    )
    .expect("resolve ssh terminal launch");

    assert!(!launch
        .request
        .args
        .iter()
        .any(|arg| arg.contains(TEST_PASSWORD)));
    let secret_plan = launch.secret_input_plan.expect("password prompt plan");
    assert_eq!(secret_plan.entries.len(), 1);
    let entry = &secret_plan.entries[0];
    assert_eq!(entry.id, "target:password");
    assert_eq!(entry.response, TEST_PASSWORD);
    assert_eq!(entry.redact_values, vec![TEST_PASSWORD.to_owned()]);
    assert_eq!(entry.max_responses, 1);
    assert!(entry
        .prompt_markers
        .iter()
        .any(|marker| marker == "deploy@dev.internal's password:"));

    let host = state
        .remote_hosts()
        .require_host(&host_id)
        .expect("stored host");
    assert!(host.secret_ref.is_some());
    assert_eq!(host.credential_secret, None);
}

#[test]
fn resolve_terminal_request_uses_openssh_config_alias_for_jump_route() {
    let (_home, state) = test_state();
    let ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "bastion".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2200,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            credential_secret: None,
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Agent,
        None,
        None,
        ssh_options,
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.remote_hosts(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cwd: None,
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal jump request");

    let config_path = request
        .args
        .windows(2)
        .find(|pair| pair[0] == "-F")
        .map(|pair| PathBuf::from(&pair[1]))
        .expect("temp config path");
    assert_eq!(
        request.args.last().map(String::as_str),
        Some("kerminal-target")
    );
    assert!(!request
        .args
        .iter()
        .any(|arg| arg == "-J" || arg.contains("ProxyJump")));
    assert!(request.cleanup_paths.contains(&config_path));

    let config = fs::read_to_string(&config_path).expect("read temp config");
    assert!(config.contains("Host kerminal-hop-0"));
    assert!(config.contains("HostName bastion.internal"));
    assert!(config.contains("Port 2200"));
    assert!(config.contains("User jump"));
    assert!(config.contains("Host kerminal-target"));
    assert!(config.contains("HostName dev.internal"));
    assert!(config.contains("ProxyCommand ssh -F "));
    assert!(config.contains(" kerminal-hop-0"));
    assert!(config.contains("UserKnownHostsFile "));
    assert!(config.contains("GlobalKnownHostsFile none"));

    cleanup_paths(&request.cleanup_paths);
}

#[test]
fn app_state_startup_cleans_stale_interactive_ssh_identity_files() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let key_dir = paths.temp.join("ssh-terminal-keys");
    fs::create_dir_all(&key_dir).unwrap();
    let stale_key = key_dir.join("identity-stale.key");
    let unrelated_key = key_dir.join("manual.key");
    fs::write(&stale_key, "leftover private key").unwrap();
    fs::write(&unrelated_key, "not managed by kerminal").unwrap();

    let _state = AppState::initialize_with_paths(paths).expect("initialize app state");

    assert!(!stale_key.exists());
    assert!(unrelated_key.exists());
}

#[test]
fn cleanup_temporary_identity_files_removes_only_managed_keys() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let key_dir = temporary_identity_directory(&paths);
    fs::create_dir_all(&key_dir).unwrap();
    let managed = key_dir.join("identity-managed.key");
    let unrelated = key_dir.join("manual.key");
    let wrong_suffix = key_dir.join("identity-managed.txt");
    fs::write(&managed, "private key").unwrap();
    fs::write(&unrelated, "manual").unwrap();
    fs::write(&wrong_suffix, "not a managed key").unwrap();

    let removed = cleanup_temporary_identity_files(&paths, None).unwrap();

    assert_eq!(removed, 1);
    assert!(!managed.exists());
    assert!(unrelated.exists());
    assert!(wrong_suffix.exists());
}

#[test]
fn cleanup_stale_temporary_identity_files_honors_age_gate() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let key_dir = temporary_identity_directory(&paths);
    fs::create_dir_all(&key_dir).unwrap();
    let fresh = key_dir.join("identity-fresh.key");
    fs::write(&fresh, "private key").unwrap();

    let removed =
        cleanup_temporary_identity_files(&paths, Some(Duration::from_secs(60 * 60))).unwrap();
    assert_eq!(removed, 0);
    assert!(fresh.exists());

    let removed = cleanup_temporary_identity_files(&paths, Some(Duration::ZERO)).unwrap();
    assert_eq!(removed, 1);
    assert!(!fresh.exists());
}

#[test]
fn jump_terminal_launch_uses_multi_secret_plan_without_leaking_args() {
    let (_home, state) = test_state();
    let ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "password-jump".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2022,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            credential_secret: Some(JUMP_PASSWORD.to_owned()),
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    let host_id = create_test_remote_host_with_secret_and_options(
        &state,
        RemoteHostAuthType::Password,
        None,
        Some(TARGET_PASSWORD.to_owned()),
        ssh_options,
    );

    let launch = resolve_terminal_launch(
        state.ssh_terminals(),
        state.remote_hosts(),
        state.paths(),
        SshTerminalCreateRequest {
            host_id,
            cwd: Some("/dev".to_owned()),
            remote_command: None,
            cols: 80,
            rows: 24,
        },
    )
    .expect("build jump terminal launch");

    assert!(launch
        .request
        .shell
        .as_deref()
        .is_some_and(|shell| shell.ends_with("ssh") || shell.ends_with("ssh.exe")));
    assert!(launch
        .request
        .args
        .windows(2)
        .any(|pair| pair[0] == "-F" && PathBuf::from(&pair[1]).exists()));
    assert_eq!(
        launch.request.args.last().map(String::as_str),
        Some("cd -- '/dev' && exec \"${SHELL:-/bin/sh}\" -l")
    );
    assert_eq!(
        launch
            .request
            .args
            .get(launch.request.args.len() - 2)
            .map(String::as_str),
        Some("kerminal-target")
    );
    assert!(!launch
        .request
        .args
        .iter()
        .any(|arg| arg.contains(JUMP_PASSWORD) || arg.contains(TARGET_PASSWORD)));

    let secret_plan = launch.secret_input_plan.expect("multi secret plan");
    assert_eq!(secret_plan.entries.len(), 2);
    assert_eq!(
        secret_plan
            .entries
            .iter()
            .map(|entry| (entry.id.as_str(), entry.response.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("jump-0:password", JUMP_PASSWORD),
            ("target:password", TARGET_PASSWORD),
        ]
    );
    assert_eq!(
        secret_plan.redact_values(),
        vec![JUMP_PASSWORD.to_owned(), TARGET_PASSWORD.to_owned()]
    );

    cleanup_paths(&launch.request.cleanup_paths);
}

fn create_test_remote_host(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
) -> String {
    create_test_remote_host_with_options(state, auth_type, credential_ref, SshOptions::default())
}

fn create_test_remote_host_with_options(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    ssh_options: SshOptions,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type,
            credential_ref,
            credential_secret: None,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            production: false,
            ssh_options,
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
        })
        .expect("create test host")
        .id
}

fn create_test_remote_host_with_secret(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> String {
    create_test_remote_host_with_secret_and_options(
        state,
        auth_type,
        credential_ref,
        credential_secret,
        SshOptions::default(),
    )
}

fn create_test_remote_host_with_secret_and_options(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
    ssh_options: SshOptions,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(RemoteHostGroupCreateRequest {
            name: "虚拟机".to_owned(),
        })
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type,
            credential_ref,
            credential_secret,
            group_id: Some(group.id),
            host: "dev.internal".to_owned(),
            name: "dev ssh".to_owned(),
            port: 22,
            production: false,
            ssh_options,
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
        })
        .expect("create test host")
        .id
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}
