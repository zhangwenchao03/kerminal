//! 脚本片段服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::snippet::{
        SnippetCreateRequest, SnippetListRequest, SnippetScope, SnippetUpdateRequest,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn create_snippet_persists_scope_tags_and_command() {
    let (_home, state) = test_state();

    let snippet = state
        .snippets()
        .create_snippet(
            state.storage(),
            SnippetCreateRequest {
                title: "检查 Git 状态".to_owned(),
                command: "git status --short".to_owned(),
                description: Some("日常开发检查".to_owned()),
                tags: vec![" git ".to_owned(), "GIT".to_owned(), "daily".to_owned()],
                scope: SnippetScope::Local,
            },
        )
        .expect("create snippet");

    assert_eq!(snippet.title, "检查 Git 状态");
    assert_eq!(snippet.command, "git status --short");
    assert_eq!(snippet.description.as_deref(), Some("日常开发检查"));
    assert_eq!(snippet.tags, vec!["git", "daily"]);
    assert_eq!(snippet.scope, SnippetScope::Local);

    let snippets = state
        .snippets()
        .list_snippets(state.storage(), SnippetListRequest::default())
        .expect("list snippets");
    assert_eq!(snippets.len(), 1);
    assert_eq!(snippets[0].id, snippet.id);
}

#[test]
fn list_snippets_filters_by_query_scope_and_tag() {
    let (_home, state) = test_state();

    state
        .snippets()
        .create_snippet(
            state.storage(),
            SnippetCreateRequest {
                title: "检查 Git 状态".to_owned(),
                command: "git status --short".to_owned(),
                description: None,
                tags: vec!["git".to_owned(), "daily".to_owned()],
                scope: SnippetScope::Local,
            },
        )
        .expect("create local snippet");
    state
        .snippets()
        .create_snippet(
            state.storage(),
            SnippetCreateRequest {
                title: "查看服务日志".to_owned(),
                command: "journalctl -u app.service -n 200 --no-pager".to_owned(),
                description: Some("SSH 日志排查".to_owned()),
                tags: vec!["ssh".to_owned(), "logs".to_owned()],
                scope: SnippetScope::Ssh,
            },
        )
        .expect("create ssh snippet");

    let git = state
        .snippets()
        .list_snippets(
            state.storage(),
            SnippetListRequest {
                query: Some("git".to_owned()),
                scope: Some(SnippetScope::Local),
                tag: None,
            },
        )
        .expect("filter by query and scope");
    assert_eq!(git.len(), 1);
    assert_eq!(git[0].title, "检查 Git 状态");

    let logs = state
        .snippets()
        .list_snippets(
            state.storage(),
            SnippetListRequest {
                query: None,
                scope: None,
                tag: Some("LOGS".to_owned()),
            },
        )
        .expect("filter by tag");
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].scope, SnippetScope::Ssh);
}

#[test]
fn update_and_delete_snippet_round_trip() {
    let (_home, state) = test_state();
    let snippet = state
        .snippets()
        .create_snippet(
            state.storage(),
            SnippetCreateRequest {
                title: "旧片段".to_owned(),
                command: "echo old".to_owned(),
                description: None,
                tags: Vec::new(),
                scope: SnippetScope::Any,
            },
        )
        .expect("create snippet");

    let updated = state
        .snippets()
        .update_snippet(
            state.storage(),
            SnippetUpdateRequest {
                id: snippet.id.clone(),
                title: "新片段".to_owned(),
                command: "echo new".to_owned(),
                description: Some("updated".to_owned()),
                tags: vec!["shell".to_owned()],
                scope: SnippetScope::Ssh,
                sort_order: snippet.sort_order,
            },
        )
        .expect("update snippet");

    assert_eq!(updated.title, "新片段");
    assert_eq!(updated.command, "echo new");
    assert_eq!(updated.scope, SnippetScope::Ssh);

    assert!(state
        .snippets()
        .delete_snippet(state.storage(), &updated.id)
        .expect("delete snippet"));
    assert!(state
        .snippets()
        .list_snippets(state.storage(), SnippetListRequest::default())
        .expect("list after delete")
        .is_empty());
}

#[test]
fn create_snippet_rejects_empty_or_too_long_values() {
    let (_home, state) = test_state();

    let empty_error = state
        .snippets()
        .create_snippet(
            state.storage(),
            SnippetCreateRequest {
                title: "空命令".to_owned(),
                command: " ".to_owned(),
                description: None,
                tags: Vec::new(),
                scope: SnippetScope::Any,
            },
        )
        .expect_err("reject empty command");
    assert!(matches!(empty_error, AppError::InvalidInput(_)));

    let long_title = "x".repeat(81);
    let long_error = state
        .snippets()
        .create_snippet(
            state.storage(),
            SnippetCreateRequest {
                title: long_title,
                command: "echo ok".to_owned(),
                description: None,
                tags: Vec::new(),
                scope: SnippetScope::Any,
            },
        )
        .expect_err("reject long title");
    assert!(matches!(long_error, AppError::InvalidInput(_)));
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
