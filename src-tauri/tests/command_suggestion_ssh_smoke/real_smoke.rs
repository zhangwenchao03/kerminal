use super::*;

#[tokio::test]
#[ignore = "requires RUN_KERMINAL_SSH_SMOKE=1 and a reachable SSH host"]
async fn real_ssh_sftp_provider_chain_produces_command_path_and_git_suggestions() {
    let Some(config) = SmokeConfig::from_env() else {
        eprintln!(
            "skipping real SSH smoke: set {RUN_FLAG}=1 plus KERMINAL_SSH_SMOKE_HOST, \
             KERMINAL_SSH_SMOKE_USER and one SSH auth variable"
        );
        return;
    };

    let harness = SmokeHarness::new();
    let remote_host = harness.create_remote_host(&config);
    let cwd = config.cwd.clone();
    let path = config.path.clone();
    harness
        .sftp
        .trust_host_key(
            &harness.storage,
            &harness.paths,
            SftpTrustHostKeyRequest {
                host_id: remote_host.id.clone(),
            },
        )
        .await
        .expect("trust real SSH smoke host key");

    let command_refresh = harness
        .suggestions
        .refresh_remote_commands(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionRemoteCommandRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(1024),
                ttl_seconds: Some(120),
            },
        )
        .await
        .expect("refresh remote command suggestions through SSH");
    assert!(
        command_refresh.command_count > 0,
        "remote command probe returned no commands"
    );

    let path_refresh = harness
        .suggestions
        .refresh_remote_paths(
            &harness.storage,
            &harness.paths,
            &harness.sftp,
            CommandSuggestionRemotePathRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(256),
                path: path.clone(),
                ttl_seconds: Some(120),
            },
        )
        .await
        .expect("refresh remote path suggestions through SFTP");
    assert!(
        path_refresh.entry_count > 0,
        "remote path probe returned no entries for {path}"
    );

    let history_refresh = harness
        .suggestions
        .refresh_remote_history(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionRemoteHistoryRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(256),
                ttl_seconds: Some(120),
            },
        )
        .await
        .expect("refresh remote shell history suggestions through SSH");

    let git_refresh = harness
        .suggestions
        .refresh_git_refs(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionGitRefreshRequest {
                cwd: cwd.clone(),
                host_id: remote_host.id.clone(),
                max_entries: Some(256),
                ttl_seconds: Some(120),
            },
        )
        .await
        .expect("refresh git suggestions through SSH");

    let command_candidates = harness.list(
        &remote_host.id,
        &cwd,
        &config.command_prefix,
        SuggestionProviderKind::RemoteCommand,
    );
    assert!(
        !command_candidates.is_empty(),
        "expected remote command suggestions for prefix {:?}",
        config.command_prefix
    );
    let builtin_candidates = harness.list(
        &remote_host.id,
        &cwd,
        &config.builtin_prefix,
        SuggestionProviderKind::RemoteCommand,
    );
    let cd_builtin = builtin_candidates
        .iter()
        .find(|candidate| candidate.replacement_text == config.builtin_command)
        .unwrap_or_else(|| {
            panic!(
                "expected {:?} POSIX builtin suggestion for prefix {:?}: {builtin_candidates:?}",
                config.builtin_command, config.builtin_prefix
            )
        });
    assert_eq!(
        cd_builtin
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .map(String::as_str),
        Some("posixBuiltin")
    );
    assert_eq!(
        cd_builtin.description.as_deref(),
        Some("远端 shell 内建命令，来自 POSIX sh 默认集合")
    );

    let path_candidates = harness.list(
        &remote_host.id,
        &cwd,
        &config.path_prefix,
        SuggestionProviderKind::RemotePath,
    );
    assert!(
        !path_candidates.is_empty(),
        "expected remote path suggestions for prefix {:?} after caching {path}",
        config.path_prefix
    );

    if let Some(history_prefix) = config.history_prefix.as_deref() {
        assert!(
            history_refresh.command_count > 0,
            "remote history probe returned no commands"
        );
        let history_candidates = harness.list(
            &remote_host.id,
            &cwd,
            history_prefix,
            SuggestionProviderKind::History,
        );
        assert!(
            !history_candidates.is_empty(),
            "expected remote shell history suggestions for prefix {history_prefix:?}"
        );
        assert!(
            history_candidates.iter().any(|candidate| candidate
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("source"))
                .is_some_and(|source| source == "remoteShellHistory")),
            "expected remote shell history metadata marker"
        );
    } else if history_refresh.command_count == 0 {
        eprintln!("remote shell history provider smoke skipped: target returned no history rows");
    }

    if git_refresh.repo_root.is_some() {
        let git_candidates = harness.list(
            &remote_host.id,
            &cwd,
            &config.git_prefix,
            SuggestionProviderKind::Git,
        );
        assert!(
            !git_candidates.is_empty(),
            "expected git suggestions for prefix {:?} in repo cwd {cwd}; repo_root={:?}; entry_count={}",
            config.git_prefix,
            git_refresh.repo_root,
            git_refresh.entry_count
        );
    } else {
        eprintln!("git provider smoke skipped: {cwd} is not a git worktree on the target host");
    }

    let export = harness
        .suggestions
        .telemetry_export(&harness.storage)
        .expect("export command suggestion telemetry");
    assert!(
        export
            .audit_events
            .iter()
            .any(|event| event.provider == Some(SuggestionProviderKind::RemoteCommand)),
        "expected remote command refresh audit event"
    );
    assert!(
        export
            .audit_events
            .iter()
            .any(|event| event.provider == Some(SuggestionProviderKind::RemotePath)),
        "expected remote path refresh audit event"
    );
    assert!(
        export
            .audit_events
            .iter()
            .any(|event| event.provider == Some(SuggestionProviderKind::History)),
        "expected remote shell history refresh audit event"
    );
}

#[tokio::test]
#[ignore = "requires RUN_KERMINAL_SSH_SMOKE=1 and a reachable SSH host"]
async fn real_ssh_remote_command_posix_builtin_fallback_survives_minimal_path() {
    let Some(config) = SmokeConfig::from_env() else {
        eprintln!(
            "skipping real SSH POSIX smoke: set {RUN_FLAG}=1 plus KERMINAL_SSH_SMOKE_HOST, \
             KERMINAL_SSH_SMOKE_USER and one SSH auth variable"
        );
        return;
    };

    let harness = SmokeHarness::new();
    let remote_host = harness.create_remote_host(&config);
    harness
        .sftp
        .trust_host_key(
            &harness.storage,
            &harness.paths,
            SftpTrustHostKeyRequest {
                host_id: remote_host.id.clone(),
            },
        )
        .await
        .expect("trust real SSH POSIX smoke host key");

    let command_refresh = harness
        .suggestions
        .refresh_remote_commands(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            CommandSuggestionRemoteCommandRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(120),
            },
        )
        .await
        .expect("refresh minimal PATH remote command suggestions through SSH");
    assert!(
        command_refresh.command_count >= 20,
        "minimal PATH remote command cache should retain POSIX builtins, got {}",
        command_refresh.command_count
    );

    let builtin_candidates = harness.list(
        &remote_host.id,
        &config.cwd,
        &config.builtin_prefix,
        SuggestionProviderKind::RemoteCommand,
    );
    let builtin = builtin_candidates
        .iter()
        .find(|candidate| candidate.replacement_text == config.builtin_command)
        .unwrap_or_else(|| {
            panic!(
                "expected {:?} POSIX builtin suggestion for prefix {:?}: {builtin_candidates:?}",
                config.builtin_command, config.builtin_prefix
            )
        });
    assert_eq!(
        builtin
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .map(String::as_str),
        Some("posixBuiltin")
    );
    assert_eq!(
        builtin.description.as_deref(),
        Some("远端 shell 内建命令，来自 POSIX sh 默认集合")
    );

    let path_command_candidates = harness.list(
        &remote_host.id,
        &config.cwd,
        &config.command_prefix,
        SuggestionProviderKind::RemoteCommand,
    );
    assert!(
        path_command_candidates.is_empty(),
        "minimal PATH smoke must not see full PATH command fixtures: {path_command_candidates:?}"
    );

    let export = harness
        .suggestions
        .telemetry_export(&harness.storage)
        .expect("export POSIX remote command telemetry");
    assert!(
        export
            .audit_events
            .iter()
            .any(|event| event.provider == Some(SuggestionProviderKind::RemoteCommand)),
        "expected remote command refresh audit event"
    );
}
