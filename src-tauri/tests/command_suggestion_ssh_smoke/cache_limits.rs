use super::*;

#[tokio::test]
async fn loopback_remote_probe_handles_slow_large_outputs_with_cache_limits() {
    let remote_root = tempdir().expect("create slow loopback remote root");
    let repo_dir = remote_root.path().join("srv").join("repo");
    std_fs::create_dir_all(repo_dir.join("app-cache")).expect("seed app-cache directory");
    for index in 0..180 {
        std_fs::create_dir_all(repo_dir.join(format!("app-dir-{index:04}")))
            .expect("seed large directory entry");
    }
    for index in 0..360 {
        std_fs::write(
            repo_dir.join(format!("app-file-{index:04}.log")),
            "loopback\n",
        )
        .expect("seed large file entry");
    }

    let profile = LoopbackProviderProfile {
        generated_command_count: 12_000,
        generated_git_branch_count: 4_000,
        response_delay: Duration::from_millis(25),
    };
    let server =
        start_loopback_provider_server_with_profile(remote_root.path().to_path_buf(), profile)
            .await;
    let harness = SmokeHarness::new();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        harness.paths.root.join("known_hosts"),
    )
    .expect("trust slow loopback host key");

    let config = SmokeConfig {
        auth_type: RemoteHostAuthType::Password,
        builtin_command: "umask".to_owned(),
        builtin_prefix: "c".to_owned(),
        command_prefix: "cmd00".to_owned(),
        credential_ref: None,
        credential_secret: Some("secret".to_owned()),
        cwd: "/srv/repo".to_owned(),
        git_prefix: "git checkout feature/slow-00".to_owned(),
        history_prefix: None,
        host: "127.0.0.1".to_owned(),
        path: "/srv/repo".to_owned(),
        path_prefix: "ls app-c".to_owned(),
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
        .expect("refresh slow large remote commands");
    assert_eq!(command_refresh.command_count, 64);

    let path_refresh = harness
        .suggestions
        .refresh_remote_paths(
            &harness.storage,
            &harness.credentials,
            &harness.paths,
            &harness.sftp,
            CommandSuggestionRemotePathRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(32),
                path: config.path.clone(),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("refresh slow large remote paths");
    assert_eq!(path_refresh.entry_count, 32);

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
                max_entries: Some(32),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("refresh slow large git refs");
    assert_eq!(git_refresh.repo_root.as_deref(), Some("/srv/repo"));
    assert_eq!(git_refresh.entry_count, 32);

    let counters = Arc::clone(&server.counters);
    assert_eq!(counters.exec_requests.load(Ordering::SeqCst), 2);
    assert_eq!(counters.sftp_subsystems.load(Ordering::SeqCst), 1);
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
            .any(|candidate| candidate.replacement_text == "cmd0000"),
        "expected cached capped command suggestion from large output: {command_candidates:?}"
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
            .any(|candidate| candidate.replacement_text == "ls app-cache/"),
        "expected cached capped path suggestion from large directory: {path_candidates:?}"
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
            .any(|candidate| candidate.replacement_text == "git checkout feature/slow-0000"),
        "expected cached capped git suggestion from large refs: {git_candidates:?}"
    );
    assert_eq!(counters.exec_requests.load(Ordering::SeqCst), 2);
    assert_eq!(counters.sftp_subsystems.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn loopback_refresh_failure_keeps_existing_provider_cache_available() {
    let remote_root = tempdir().expect("create offline loopback remote root");
    let repo_dir = remote_root.path().join("srv").join("repo");
    std_fs::create_dir_all(&repo_dir).expect("create offline repo directory");
    std_fs::write(repo_dir.join("app.log"), "loopback app log\n").expect("seed app.log");

    let server = start_loopback_provider_server(remote_root.path().to_path_buf()).await;
    let harness = SmokeHarness::new();
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        harness.paths.root.join("known_hosts"),
    )
    .expect("trust offline loopback host key");

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

    harness
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
        .expect("prime remote command cache before disconnect");
    harness
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
        .expect("prime remote path cache before disconnect");
    harness
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
        .expect("prime remote shell history cache before disconnect");
    harness
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
        .expect("prime git cache before disconnect");

    let counters = Arc::clone(&server.counters);
    drop(server);

    assert!(
        harness
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
            .is_err(),
        "remote command refresh should fail after disconnect"
    );
    assert!(
        harness
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
            .is_err(),
        "remote path refresh should fail after disconnect"
    );
    assert!(
        harness
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
            .is_err(),
        "remote shell history refresh should fail after disconnect"
    );
    assert!(
        harness
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
            .is_err(),
        "git refresh should fail after disconnect"
    );

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
        "expected cached command suggestion after failed refresh: {command_candidates:?}"
    );

    let history_candidates = harness.list_from(
        &cache_only_suggestions,
        &remote_host.id,
        &config.cwd,
        "deploy --dry",
        SuggestionProviderKind::History,
    );
    assert!(
        history_candidates
            .iter()
            .any(|candidate| candidate.replacement_text == "deploy --dry-run --target staging"),
        "expected cached remote shell history suggestion after failed refresh: {history_candidates:?}"
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
        "expected cached path suggestion after failed refresh: {path_candidates:?}"
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
        "expected cached git suggestion after failed refresh: {git_candidates:?}"
    );
    assert_eq!(
        counters.exec_requests.load(Ordering::SeqCst),
        3,
        "cache-only queries must not reconnect over SSH"
    );
    assert_eq!(
        counters.sftp_subsystems.load(Ordering::SeqCst),
        1,
        "cache-only queries must not reconnect over SFTP"
    );

    let export = harness
        .suggestions
        .telemetry_export(&harness.storage)
        .expect("export offline refresh telemetry");
    for provider in [
        SuggestionProviderKind::History,
        SuggestionProviderKind::RemoteCommand,
        SuggestionProviderKind::RemotePath,
        SuggestionProviderKind::Git,
    ] {
        assert!(
            export.runtime.providers.iter().any(|telemetry| {
                telemetry.provider == provider && telemetry.refresh_failure_count >= 1
            }),
            "expected runtime refresh failure telemetry for {provider:?}: {:?}",
            export.runtime.providers
        );
        assert!(
            export.audit_events.iter().any(|event| {
                event.event_kind == CommandSuggestionAuditEventKind::RemoteProbeRefresh
                    && event.provider == Some(provider)
                    && event.decision == CommandSuggestionAuditDecision::Failed
                    && event.reason.as_deref() == Some("refresh-failed")
            }),
            "expected failed refresh audit event for {provider:?}: {:?}",
            export.audit_events
        );
    }
}
