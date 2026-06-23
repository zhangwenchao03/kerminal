//! AI 终端目标 resolver 工具测试。
//!
//! @author kongweiguang

use super::support::*;
use kerminal_lib::{
    models::ai_tool_invocation::{AiToolExecuteIfAllowedRequest, AiToolObservationStatus},
    services::terminal_session_binding_service::TerminalSessionBindingMetadata,
};
use serde_json::json;

fn execute_request(tool_id: &str, arguments: serde_json::Value) -> AiToolExecuteIfAllowedRequest {
    AiToolExecuteIfAllowedRequest {
        tool_id: tool_id.to_owned(),
        arguments,
        requested_by: Some("test-agent-loop".to_owned()),
        reason: Some("验证终端 resolver 工具".to_owned()),
        conversation_id: Some("conv-terminal-resolver".to_owned()),
        conversation_slot_json: None,
        run_id: None,
        step_id: None,
        audit_context: None,
    }
}

#[test]
fn terminal_resolve_current_returns_bound_running_session() {
    let (_home, state) = setup_state();
    let summary = state
        .terminals()
        .create_session(interactive_shell_request(), |_| true)
        .expect("create terminal session");
    state
        .terminal_session_bindings()
        .register_with_metadata(
            "pane-main",
            summary.id.clone(),
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-main".to_owned()),
                target_ref: None,
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: Some("profile-main".to_owned()),
                cwd: summary.cwd.clone(),
                shell: Some(summary.shell.clone()),
            }),
        )
        .expect("register pane binding");
    state
        .terminal_session_bindings()
        .ready("pane-main", &summary.id)
        .expect("mark binding ready");

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "terminal.resolve_current",
            json!({
                "paneId": "pane-main",
                "sessionId": summary.id.clone(),
                "tabId": "tab-main",
                "targetKind": "local"
            }),
        ),
    ))
    .expect("execute terminal.resolve_current");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::Succeeded
    );
    assert_eq!(
        response
            .observation
            .data
            .get("paneId")
            .and_then(|value| value.as_str()),
        Some("pane-main")
    );
    assert_eq!(
        response
            .observation
            .data
            .get("sessionId")
            .and_then(|value| value.as_str()),
        Some(summary.id.as_str())
    );
    assert!(response.observation.entities.iter().any(|entity| {
        entity.get("type").and_then(|value| value.as_str()) == Some("terminalPane")
            && entity.get("id").and_then(|value| value.as_str()) == Some("pane-main")
    }));

    state
        .terminals()
        .close(&summary.id)
        .expect("close terminal session");
}

#[test]
fn terminal_resolve_current_requires_focused_pane_id() {
    let (_home, state) = setup_state();

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("terminal.resolve_current", json!({})),
    ))
    .expect("execute terminal.resolve_current");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("missingTarget")
    );
    assert!(response.observation.recoverable);
}

#[test]
fn terminal_resolve_current_rejects_pane_session_mismatch() {
    let (_home, state) = setup_state();
    let summary = state
        .terminals()
        .create_session(interactive_shell_request(), |_| true)
        .expect("create terminal session");
    state
        .terminal_session_bindings()
        .register("pane-main", summary.id.clone())
        .expect("register pane binding");

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "terminal.resolve_current",
            json!({ "paneId": "pane-main", "sessionId": "other-session" }),
        ),
    ))
    .expect("execute terminal.resolve_current");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("paneSessionMismatch")
    );
    assert!(response.observation.recoverable);

    state
        .terminals()
        .close(&summary.id)
        .expect("close terminal session");
}

#[test]
fn terminal_resolve_current_rejects_stale_binding_session() {
    let (_home, state) = setup_state();
    state
        .terminal_session_bindings()
        .register("pane-main", "missing-session")
        .expect("register stale pane binding");

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("terminal.resolve_current", json!({ "paneId": "pane-main" })),
    ))
    .expect("execute terminal.resolve_current");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("staleSession")
    );
    assert!(response.observation.recoverable);
}
