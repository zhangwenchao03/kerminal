use super::support::*;

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
            key_passphrase_secret: None,
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
