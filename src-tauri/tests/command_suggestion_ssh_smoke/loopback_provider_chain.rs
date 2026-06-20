use super::*;

#[tokio::test]
async fn loopback_ssh_sftp_provider_chain_uses_native_credentials_and_cache_only_query() {
    let remote_root = tempdir().expect("create loopback remote root");
    let repo_dir = remote_root.path().join("srv").join("repo");
    std_fs::create_dir_all(&repo_dir).expect("create loopback repo directory");
    std_fs::write(repo_dir.join("app.log"), "loopback app log\n").expect("seed app.log");
    std_fs::write(repo_dir.join("deploy.sh"), "#!/bin/sh\n").expect("seed deploy.sh");

    let server = start_loopback_provider_server(remote_root.path().to_path_buf()).await;
    let harness = SmokeHarness::new();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        harness.paths.root.join("known_hosts"),
    )
    .expect("trust loopback host key");

    let config = SmokeConfig {
        auth_type: RemoteHostAuthType::Password,
        builtin_command: "umask".to_owned(),
        builtin_prefix: "c".to_owned(),
        command_prefix: "ku".to_owned(),
        credential_ref: None,
        credential_secret: Some("secret".to_owned()),
        cwd: "/srv/repo".to_owned(),
        git_prefix: "git checkout fe".to_owned(),
        history_prefix: Some("deploy --dry".to_owned()),
        host: "127.0.0.1".to_owned(),
        path: "/srv/repo".to_owned(),
        path_prefix: "ls app".to_owned(),
        port: server.addr.port(),
        username: "deploy".to_owned(),
    };
    let remote_host = harness.create_remote_host(&config);

    let command_refresh = harness
        .suggestions
        .refresh_remote_commands(
            &harness.storage,
            &harness.credentials,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionRemoteCommandRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("refresh loopback remote commands");
    assert!(command_refresh.command_count >= 4);

    let history_refresh = harness
        .suggestions
        .refresh_remote_history(
            &harness.storage,
            &harness.credentials,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionRemoteHistoryRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("refresh loopback remote shell history");
    assert_eq!(history_refresh.command_count, 4);

    let path_refresh = harness
        .suggestions
        .refresh_remote_paths(
            &harness.storage,
            &harness.credentials,
            &harness.paths,
            &harness.sftp,
            CommandSuggestionRemotePathRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                path: config.path.clone(),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("refresh loopback remote paths");
    assert_eq!(path_refresh.path, "/srv/repo");
    assert!(path_refresh.entry_count >= 2);

    let git_refresh = harness
        .suggestions
        .refresh_git_refs(
            &harness.storage,
            &harness.credentials,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionGitRefreshRequest {
                cwd: config.cwd.clone(),
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("refresh loopback git refs");
    assert_eq!(git_refresh.repo_root.as_deref(), Some("/srv/repo"));
    assert!(git_refresh.entry_count >= 4);
    assert_eq!(server.counters.exec_requests.load(Ordering::SeqCst), 3);
    assert_eq!(server.counters.sftp_subsystems.load(Ordering::SeqCst), 1);

    drop(server);

    let cache_only_suggestions = CommandSuggestionService::new();
    let command_candidates = harness.list_from(
        &cache_only_suggestions,
        &remote_host.id,
        &config.cwd,
        &config.command_prefix,
        SuggestionProviderKind::RemoteCommand,
    );
    assert!(
        command_candidates
            .iter()
            .any(|candidate| candidate.replacement_text == "kubectl"),
        "expected cached kubectl remote command suggestion: {command_candidates:?}"
    );

    let history_candidates = harness.list_from(
        &cache_only_suggestions,
        &remote_host.id,
        &config.cwd,
        "deploy --dry",
        SuggestionProviderKind::History,
    );
    assert!(
        history_candidates.iter().any(|candidate| {
            candidate.replacement_text == "deploy --dry-run --target staging"
                && candidate.description.as_deref() == Some("远端 shell history，匹配当前主机")
                && candidate
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("source"))
                    .is_some_and(|source| source == "remoteShellHistory")
        }),
        "expected cached remote shell history suggestion: {history_candidates:?}"
    );
    assert!(
        history_candidates
            .iter()
            .all(|candidate| !candidate.replacement_text.contains("API_TOKEN")),
        "sensitive remote shell history must not be suggested: {history_candidates:?}"
    );

    let path_candidates = harness.list_from(
        &cache_only_suggestions,
        &remote_host.id,
        &config.cwd,
        &config.path_prefix,
        SuggestionProviderKind::RemotePath,
    );
    assert!(
        path_candidates
            .iter()
            .any(|candidate| candidate.replacement_text == "ls app.log"),
        "expected cached app.log remote path suggestion: {path_candidates:?}"
    );

    let git_candidates = harness.list_from(
        &cache_only_suggestions,
        &remote_host.id,
        &config.cwd,
        &config.git_prefix,
        SuggestionProviderKind::Git,
    );
    assert!(
        git_candidates
            .iter()
            .any(|candidate| candidate.replacement_text == "git checkout feature/local-loopback"),
        "expected cached feature/local-loopback git suggestion: {git_candidates:?}"
    );

    let export = cache_only_suggestions
        .telemetry_export(&harness.storage)
        .expect("export loopback suggestion telemetry");
    for provider in [
        SuggestionProviderKind::History,
        SuggestionProviderKind::RemoteCommand,
        SuggestionProviderKind::RemotePath,
        SuggestionProviderKind::Git,
    ] {
        assert!(
            export
                .audit_events
                .iter()
                .any(|event| event.provider == Some(provider)),
            "expected refresh audit event for {provider:?}"
        );
    }
}
