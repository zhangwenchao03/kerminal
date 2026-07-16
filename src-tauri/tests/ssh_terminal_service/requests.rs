use super::support::*;

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
fn resolve_terminal_request_uses_configured_default_remote_directory() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.startup_command = "/srv/app".to_owned();
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
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/srv/app' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_cwd_overrides_configured_default_remote_directory() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.startup_command = "/srv/app".to_owned();
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
                cwd: Some("/opt/release".to_owned()),
                remote_command: None,
                cols: 80,
                rows: 24,
            },
        )
        .expect("resolve ssh terminal request");

    assert_eq!(
        request.args.last().map(String::as_str),
        Some("cd -- '/opt/release' && exec \"${SHELL:-/bin/sh}\" -l")
    );
}

#[test]
fn resolve_terminal_request_uses_configured_server_alive_interval() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions::default();
    ssh_options.terminal.keepalive_seconds = 23;
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
        .expect("resolve ssh terminal request");

    assert!(request
        .args
        .windows(2)
        .any(|args| args[0] == "-o" && args[1] == "ServerAliveInterval=23"));
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
fn resolve_terminal_launch_uses_materialized_external_target_without_host_toml() {
    let (_home, state) = test_state();
    let launch_id = queued_launch_id(
        state
            .external_launch_intake()
            .accept_args(
                vec![
                    "putty.exe".to_owned(),
                    "-ssh".to_owned(),
                    "deploy@example.internal".to_owned(),
                    "-P".to_owned(),
                    "2202".to_owned(),
                    "-pw".to_owned(),
                    TEST_PASSWORD.to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue external launch"),
    );
    let _ = state
        .external_launch_intake()
        .take_pending()
        .expect("activate pending launch");
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");

    let launch = resolve_terminal_launch(
        state.ssh_terminals(),
        state.remote_hosts(),
        state.paths(),
        SshTerminalCreateRequest {
            host_id: target.host_id,
            cwd: None,
            remote_command: Some("uptime".to_owned()),
            cols: 80,
            rows: 24,
        },
    )
    .expect("resolve external terminal launch");

    assert!(launch.request.args.contains(&"2202".to_owned()));
    assert!(launch
        .request
        .args
        .contains(&"deploy@example.internal".to_owned()));
    assert!(!launch
        .request
        .args
        .iter()
        .any(|arg| arg.contains(TEST_PASSWORD)));
    assert_eq!(
        launch.request.args.last().map(String::as_str),
        Some("exec uptime")
    );

    let secret_plan = launch
        .secret_input_plan
        .expect("external password secret input plan");
    assert_eq!(secret_plan.entries.len(), 1);
    assert_eq!(secret_plan.entries[0].response, TEST_PASSWORD);
    assert_eq!(secret_plan.redact_values(), vec![TEST_PASSWORD.to_owned()]);
}

#[test]
fn resolve_terminal_request_uses_openssh_config_alias_for_jump_route() {
    let (_home, state) = test_state();
    let mut ssh_options = SshOptions {
        jump_hosts: vec![SshJumpHostOptions {
            name: "bastion".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2200,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            secret_ref: None,
            key_passphrase_ref: None,
            key_passphrase_secret: None,
            credential_secret: None,
            credential_status: Default::default(),
        }],
        ..Default::default()
    };
    ssh_options.terminal.keepalive_seconds = 19;
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
    assert!(config.contains("ServerAliveInterval 19"));

    cleanup_paths(&request.cleanup_paths);
}
