//! Agent session command boundary tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    commands::agent_session::{
        agent_session_create, agent_session_rebind_target, AgentSessionCreateCommandRequest,
        AgentSessionTargetCommandRequest,
    },
    models::agent_session::{AgentId, AgentSessionCreateRequest},
    paths::KerminalPaths,
    state::AppState,
};
use tauri::Manager;

#[test]
fn create_rejects_non_live_agent_target_without_partial_session() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();

    let result = agent_session_create(
        state,
        AgentSessionCreateCommandRequest {
            agent_id: AgentId::Codex,
            title: Some("Codex".to_owned()),
            launch: None,
            target: Some(target_request("pane-prod", "missing-terminal")),
            provider: None,
            mcp_endpoint: None,
        },
    );

    assert!(
        format!("{result:?}").contains("终端会话不存在: missing-terminal"),
        "expected missing terminal rejection, got {result:?}"
    );
    assert!(
        app.state::<AppState>()
            .agent_sessions()
            .list_sessions()
            .expect("list sessions")
            .sessions
            .is_empty(),
        "failed create must not leave a partial Agent session on disk"
    );
}

#[test]
fn rebind_rejects_missing_target_terminal_and_agent_terminal_panes() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();
    let agent_session = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("Codex".to_owned()),
            launch: None,
            target: None,
            provider: None,
            mcp_endpoint: None,
        })
        .expect("create agent session");
    let agent_session_id = agent_session.session.agent_session_id.as_str().to_owned();

    let missing = agent_session_rebind_target(
        app.state::<AppState>(),
        agent_session_id.clone(),
        target_request("pane-prod", "missing-terminal"),
    );
    assert!(
        format!("{missing:?}").contains("终端会话不存在: missing-terminal"),
        "expected missing terminal rejection, got {missing:?}"
    );

    let agent_pane = agent_session_rebind_target(
        app.state::<AppState>(),
        agent_session_id,
        target_request("agent-terminal-ags_test", "any-terminal"),
    );
    assert!(
        format!("{agent_pane:?}").contains("right-panel Agent terminal"),
        "expected Agent terminal pane rejection, got {agent_pane:?}"
    );
}

fn target_request(
    pane_id: &str,
    target_terminal_session_id: &str,
) -> AgentSessionTargetCommandRequest {
    AgentSessionTargetCommandRequest {
        binding_id: None,
        binding_generation: 0,
        pane_id: Some(pane_id.to_owned()),
        tab_id: Some("tab-main".to_owned()),
        target_terminal_session_id: Some(target_terminal_session_id.to_owned()),
        target_ref: Some("ssh:prod-web".to_owned()),
        target_kind: Some("ssh".to_owned()),
        cwd: Some("/srv/app".to_owned()),
        shell: Some("bash".to_owned()),
        live_status: None,
        last_seen_at: None,
    }
}
