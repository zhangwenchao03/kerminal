#[test]
fn remote_path_suggestions_use_cached_sftp_listing() {
    let (_home, state) = test_state();
    cache_listing(
        &state,
        "/srv/app",
        vec![
            sftp_entry("/srv/app/config", "config", SftpEntryKind::Directory),
            sftp_entry("/srv/app/app.log", "app.log", SftpEntryKind::File),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "cd co".to_owned(),
                cursor: "cd co".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemotePath]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::RemotePath);
    assert_eq!(suggestions[0].replacement_text, "cd config/");
    assert_eq!(suggestions[0].suffix, "nfig/");
    assert_eq!(suggestions[0].replacement_range.start, 3);
    assert_eq!(suggestions[0].replacement_range.end, 5);
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("entryKind"))
            .map(String::as_str),
        Some("directory")
    );
}

#[test]
fn remote_path_suggestions_escape_unquoted_names_with_spaces() {
    let (_home, state) = test_state();
    cache_listing(
        &state,
        "/srv/app",
        vec![sftp_entry(
            "/srv/app/My Folder",
            "My Folder",
            SftpEntryKind::Directory,
        )],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "cd My".to_owned(),
                cursor: "cd My".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemotePath]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].replacement_text, "cd My\\ Folder/");
    assert_eq!(suggestions[0].suffix, "\\ Folder/");
}

#[test]
fn remote_command_suggestions_use_cached_path_commands() {
    let (_home, state) = test_state();
    cache_commands(
        &state,
        vec![
            "git".to_owned(),
            "grep".to_owned(),
            "bad name".to_owned(),
            "/bin/sh".to_owned(),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "gi".to_owned(),
                cursor: "gi".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(
        suggestions[0].provider,
        SuggestionProviderKind::RemoteCommand
    );
    assert_eq!(suggestions[0].replacement_text, "git");
    assert_eq!(suggestions[0].suffix, "t");
}

#[test]
fn remote_command_suggestions_include_posix_builtins_without_path_commands() {
    let (_home, state) = test_state();
    cache_commands(&state, Vec::new());

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "c".to_owned(),
                cursor: "c".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("sh".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(10),
            },
        )
        .expect("list builtin suggestions");

    let cd = suggestions
        .iter()
        .find(|suggestion| suggestion.replacement_text == "cd")
        .expect("cd builtin suggestion");
    assert_eq!(cd.provider, SuggestionProviderKind::RemoteCommand);
    assert_eq!(cd.suffix, "d");
    assert_eq!(
        cd.metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .map(String::as_str),
        Some("posixBuiltin")
    );
    assert_eq!(
        cd.description.as_deref(),
        Some("远端 shell 内建命令，来自 POSIX sh 默认集合")
    );
}

#[test]
fn remote_command_builtins_survive_noisy_capped_path_cache() {
    let (_home, state) = test_state();
    let noisy_path_commands = (0..240)
        .map(|index| format!("c{index:04}"))
        .chain((0..240).map(|index| format!("aaa{index:04}")))
        .collect::<Vec<_>>();
    cache_commands_with_limit(&state, noisy_path_commands, 40);

    let cd_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "c".to_owned(),
                cursor: "c".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("sh".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(8),
            },
        )
        .expect("list capped cd builtin suggestions");
    assert!(
        cd_suggestions
            .iter()
            .any(|suggestion| suggestion.replacement_text == "cd"
                && suggestion
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("source"))
                    .is_some_and(|source| source == "posixBuiltin")),
        "cd builtin should outrank noisy PATH commands: {cd_suggestions:?}"
    );

    let umask_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "umas".to_owned(),
                cursor: "umas".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("sh".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(8),
            },
        )
        .expect("list capped umask builtin suggestions");
    assert!(
        umask_suggestions
            .iter()
            .any(|suggestion| suggestion.replacement_text == "umask"
                && suggestion
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("source"))
                    .is_some_and(|source| source == "posixBuiltin")),
        "umask builtin should survive remote command cache cap: {umask_suggestions:?}"
    );
}

#[test]
fn remote_history_suggestions_restore_from_persistent_cache() {
    let (_home, state) = test_state();
    cache_remote_history(
        &state,
        vec![
            "kubectl get pods -n prod".to_owned(),
            "kubectl rollout status deployment/api -n prod".to_owned(),
            "export API_TOKEN=secret-value".to_owned(),
        ],
    );

    let cache_only_suggestions = CommandSuggestionService::new();
    let suggestions = cache_only_suggestions
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "kubectl ".to_owned(),
                cursor: "kubectl ".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::History]),
                limit: Some(5),
            },
        )
        .expect("list remote history suggestions from persistent cache");

    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::History);
    assert_eq!(suggestions[0].replacement_text, "kubectl get pods -n prod");
    assert_eq!(suggestions[0].suffix, "get pods -n prod");
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .map(String::as_str),
        Some("remoteShellHistory")
    );
    assert!(!suggestions
        .iter()
        .any(|suggestion| suggestion.replacement_text.contains("API_TOKEN")));
}

#[test]
fn remote_command_suggestions_do_not_apply_to_argument_position() {
    let (_home, state) = test_state();
    cache_commands(&state, vec!["checkout".to_owned()]);

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git ch".to_owned(),
                cursor: "git ch".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert!(suggestions.is_empty());
}

#[test]
fn git_suggestions_use_cached_refs_for_checkout() {
    let (_home, state) = test_state();
    cache_git_refs(
        &state,
        vec![
            git_ref("main", GitRefKind::Branch),
            git_ref("feature/current", GitRefKind::Branch),
            git_ref("origin/main", GitRefKind::RemoteBranch),
            git_ref("v1.0.0", GitRefKind::Tag),
            git_ref("origin", GitRefKind::Remote),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git checkout fe".to_owned(),
                cursor: "git checkout fe".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::Git);
    assert_eq!(
        suggestions[0].replacement_text,
        "git checkout feature/current"
    );
    assert_eq!(suggestions[0].suffix, "ature/current");
    assert_eq!(suggestions[0].replacement_range.start, 13);
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("kind"))
            .map(String::as_str),
        Some("branch")
    );
}

#[test]
fn git_suggestions_use_remote_position_for_pull() {
    let (_home, state) = test_state();
    cache_git_refs(
        &state,
        vec![
            git_ref("origin", GitRefKind::Remote),
            git_ref("main", GitRefKind::Branch),
            git_ref("origin/main", GitRefKind::RemoteBranch),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git pull or".to_owned(),
                cursor: "git pull or".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].replacement_text, "git pull origin");
    assert_eq!(suggestions[0].suffix, "igin");
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("kind"))
            .map(String::as_str),
        Some("remote")
    );
}

#[test]
fn provider_cache_survives_app_state_reopen() {
    let (home, state) = test_state();
    cache_commands(&state, vec!["git".to_owned(), "grep".to_owned()]);
    cache_listing(
        &state,
        "/srv/app",
        vec![sftp_entry(
            "/srv/app/config",
            "config",
            SftpEntryKind::Directory,
        )],
    );
    cache_git_refs(&state, vec![git_ref("feature/current", GitRefKind::Branch)]);
    drop(state);

    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("reopen app state");

    let remote_command_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "gi".to_owned(),
                cursor: "gi".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list remote command suggestions after reopen");
    assert_eq!(remote_command_suggestions[0].replacement_text, "git");

    let remote_path_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "cd co".to_owned(),
                cursor: "cd co".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemotePath]),
                limit: Some(5),
            },
        )
        .expect("list remote path suggestions after reopen");
    assert_eq!(remote_path_suggestions[0].replacement_text, "cd config/");

    let git_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git checkout fe".to_owned(),
                cursor: "git checkout fe".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list git suggestions after reopen");
    assert_eq!(
        git_suggestions[0].replacement_text,
        "git checkout feature/current"
    );
}
