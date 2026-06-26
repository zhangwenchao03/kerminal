use super::*;

#[test]
fn history_suggestions_prefer_same_host_and_cwd() {
    let (_home, state) = test_state();
    record(
        &state,
        "git checkout main",
        CommandHistoryTarget::Ssh,
        Some("host-prod"),
        Some("/srv/app"),
        Some("session-1"),
    );
    record(
        &state,
        "git checkout feature/other-host",
        CommandHistoryTarget::Ssh,
        Some("host-dev"),
        Some("/srv/app"),
        Some("session-2"),
    );
    record(
        &state,
        "git checkout feature/current",
        CommandHistoryTarget::Ssh,
        Some("host-prod"),
        Some("/srv/app"),
        Some("session-1"),
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                input: "git checkout ".to_owned(),
                cursor: "git checkout ".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: None,
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 2);
    assert_eq!(
        suggestions[0].replacement_text,
        "git checkout feature/current"
    );
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::History);
    assert_eq!(suggestions[0].suffix, "feature/current");
    assert_eq!(
        suggestions[0].sensitivity,
        CommandSuggestionSensitivity::Normal
    );
    assert!(suggestions[0]
        .description
        .as_deref()
        .expect("description")
        .contains("当前目录"));
}

#[test]
fn provider_filter_can_disable_history_suggestions() {
    let (_home, state) = test_state();
    record(
        &state,
        "kubectl get pods -n prod",
        CommandHistoryTarget::Ssh,
        Some("host-prod"),
        Some("/srv/app"),
        Some("session-1"),
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                input: "kubectl".to_owned(),
                cursor: "kubectl".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: None,
                shell: None,
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert!(suggestions.is_empty());
}

#[test]
fn dangerous_history_suggestions_are_marked_and_demoted() {
    let (_home, state) = test_state();
    record(
        &state,
        "rm -rf /tmp/build-cache",
        CommandHistoryTarget::Local,
        None,
        Some("C:/dev/rust/kerminal"),
        Some("session-1"),
    );
    record(
        &state,
        "rm -rf target",
        CommandHistoryTarget::Local,
        None,
        Some("C:/dev/rust/kerminal"),
        Some("session-1"),
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                input: "rm -rf ".to_owned(),
                cursor: "rm -rf ".chars().count(),
                target: CommandHistoryTarget::Local,
                session_id: Some("session-1".to_owned()),
                pane_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: Some("C:/dev/rust/kerminal".to_owned()),
                shell: Some("pwsh.exe".to_owned()),
                providers: None,
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0].replacement_text, "rm -rf target");
    assert_eq!(
        suggestions[1].sensitivity,
        CommandSuggestionSensitivity::Dangerous
    );
    assert!(suggestions[1].score < suggestions[0].score);
}

#[test]
fn dismissed_feedback_demotes_matching_suggestion() {
    let (_home, state) = test_state();
    record(
        &state,
        "git stash",
        CommandHistoryTarget::Local,
        None,
        Some("C:/dev/rust/kerminal"),
        Some("session-1"),
    );
    record(
        &state,
        "git status",
        CommandHistoryTarget::Local,
        None,
        Some("C:/dev/rust/kerminal"),
        Some("session-1"),
    );

    for _ in 0..3 {
        state
            .command_suggestions()
            .record_feedback(
                state.command_store(),
                CommandSuggestionFeedbackRecordRequest {
                    action: CommandSuggestionFeedbackAction::Dismissed,
                    cwd: Some("C:/dev/rust/kerminal".to_owned()),
                    input: "git st".to_owned(),
                    pane_id: Some("pane-1".to_owned()),
                    profile_id: None,
                    provider: SuggestionProviderKind::History,
                    remote_host_id: None,
                    replacement_text: "git status".to_owned(),
                    session_id: Some("session-1".to_owned()),
                    shell: Some("pwsh.exe".to_owned()),
                    source_id: None,
                    target: CommandHistoryTarget::Local,
                },
            )
            .expect("record dismissed feedback");
    }

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                input: "git st".to_owned(),
                cursor: "git st".chars().count(),
                target: CommandHistoryTarget::Local,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: None,
                cwd: Some("C:/dev/rust/kerminal".to_owned()),
                shell: Some("pwsh.exe".to_owned()),
                providers: Some(vec![SuggestionProviderKind::History]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0].replacement_text, "git stash");
    assert_eq!(suggestions[1].replacement_text, "git status");
    assert_eq!(
        suggestions[1]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("feedbackDismissedCount"))
            .map(String::as_str),
        Some("3")
    );
}

#[test]
fn sensitive_feedback_is_not_recorded() {
    let (_home, state) = test_state();

    let result = state
        .command_suggestions()
        .record_feedback(
            state.command_store(),
            CommandSuggestionFeedbackRecordRequest {
                action: CommandSuggestionFeedbackAction::Accepted,
                cwd: None,
                input: "echo password".to_owned(),
                pane_id: None,
                profile_id: None,
                provider: SuggestionProviderKind::History,
                remote_host_id: None,
                replacement_text: "echo password=secret".to_owned(),
                session_id: None,
                shell: None,
                source_id: None,
                target: CommandHistoryTarget::Local,
            },
        )
        .expect("record sensitive feedback");

    assert!(!result.recorded);
    assert_eq!(result.skip_reason.as_deref(), Some("sensitive-command"));
    let summary = state
        .command_suggestions()
        .telemetry_summary()
        .expect("telemetry summary");
    let history = summary
        .providers
        .iter()
        .find(|provider| provider.provider == SuggestionProviderKind::History)
        .expect("history telemetry");
    assert_eq!(history.feedback_skipped_count, 1);
}
