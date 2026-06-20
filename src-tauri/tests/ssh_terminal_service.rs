//! SSH 远程终端服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::{
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroupCreateRequest},
        terminal::SshTerminalCreateRequest,
    },
    paths::KerminalPaths,
    services::credential_service::{CredentialService, MemoryCredentialVault},
    state::AppState,
};
use std::{fs, path::PathBuf, sync::Arc};
use tempfile::{tempdir, TempDir};

const TEST_PRIVATE_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\nkerminal-test-private-key\n-----END OPENSSH PRIVATE KEY-----\n";
const TEST_PASSWORD: &str = "s3cr3t-ssh-password";

#[test]
fn resolve_terminal_request_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.storage(),
            state.credentials(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id: "missing-host".to_owned(),
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
            state.storage(),
            state.credentials(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
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
            state.storage(),
            state.credentials(),
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
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
fn resolve_terminal_request_materializes_credential_private_key_for_openssh() {
    let (_home, state) = test_state();
    let credentials = CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()));
    let credential_ref = "credential:ssh/dev/private-key".to_owned();
    let secret = serde_json::json!({
        "privateKey": TEST_PRIVATE_KEY,
        "passphrase": "interactive-passphrase"
    })
    .to_string();
    credentials
        .set_secret(&credential_ref, &secret)
        .expect("store private key credential");
    let host_id = create_test_remote_host(
        &state,
        RemoteHostAuthType::Key,
        Some(credential_ref.clone()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.storage(),
            &credentials,
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
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
fn resolve_terminal_request_uses_password_credential_as_internal_prompt_response() {
    let (_home, state) = test_state();
    let credentials = CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()));
    let credential_ref = "credential:ssh/dev/password".to_owned();
    credentials
        .set_secret(&credential_ref, TEST_PASSWORD)
        .expect("store password credential");
    let host_id = create_test_remote_host(
        &state,
        RemoteHostAuthType::Password,
        Some(credential_ref.clone()),
    );

    let request = state
        .ssh_terminals()
        .resolve_terminal_request(
            state.storage(),
            &credentials,
            state.paths(),
            SshTerminalCreateRequest {
                host_id,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert!(!request
        .args
        .iter()
        .any(|arg| arg.contains("credential:ssh") || arg.contains(TEST_PASSWORD)));
    let response = request
        .secret_input_response
        .expect("password prompt response");
    assert_eq!(response.response, TEST_PASSWORD);
    assert_eq!(response.redact_values, vec![TEST_PASSWORD.to_owned()]);
    assert_eq!(response.max_responses, 1);
    assert!(response
        .prompt_markers
        .iter()
        .any(|marker| marker == "deploy@dev.internal's password:"));
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

fn create_test_remote_host(
    state: &AppState,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
) -> String {
    let group = state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "虚拟机".to_owned(),
            },
        )
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(
            state.storage(),
            RemoteHostCreateRequest {
                auth_type,
                credential_ref,
                credential_secret: None,
                group_id: Some(group.id),
                host: "dev.internal".to_owned(),
                name: "dev ssh".to_owned(),
                port: 22,
                production: false,
                ssh_options: Default::default(),
                tags: vec!["dev".to_owned()],
                username: "deploy".to_owned(),
            },
        )
        .expect("create test host")
        .id
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
