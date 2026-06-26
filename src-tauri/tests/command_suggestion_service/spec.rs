use super::*;

#[test]
fn spec_suggestions_complete_git_subcommands() {
    let (_home, state) = test_state();

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                input: "git ch".to_owned(),
                cursor: "git ch".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Spec]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.replacement_text == "git checkout"));
    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.replacement_text == "git cherry-pick"));
    assert!(suggestions
        .iter()
        .all(|suggestion| suggestion.provider == SuggestionProviderKind::Spec));
}

#[test]
fn spec_suggestions_complete_kubectl_options() {
    let (_home, state) = test_state();

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                input: "kubectl get --".to_owned(),
                cursor: "kubectl get --".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Spec]),
                limit: Some(10),
            },
        )
        .expect("list suggestions");

    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.replacement_text == "kubectl get --namespace"));
    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.replacement_text == "kubectl get --output"));
}
