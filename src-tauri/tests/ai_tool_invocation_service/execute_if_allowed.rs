//! AI 工具 execute-if-allowed observation 测试。
//!
//! @author kongweiguang

use super::support::*;
use kerminal_lib::models::{
    ai_tool_invocation::{AiToolExecuteIfAllowedRequest, AiToolObservationStatus},
    settings::AiCommandApprovalPolicy,
};
use serde_json::json;

fn execute_request(tool_id: &str, arguments: serde_json::Value) -> AiToolExecuteIfAllowedRequest {
    AiToolExecuteIfAllowedRequest {
        tool_id: tool_id.to_owned(),
        arguments,
        requested_by: Some("test-agent-loop".to_owned()),
        reason: Some("验证 execute-if-allowed".to_owned()),
        conversation_id: Some("conv-agent-loop".to_owned()),
        conversation_slot_json: None,
        run_id: None,
        step_id: None,
        audit_context: None,
    }
}

#[test]
fn execute_if_allowed_runs_auto_read_tool_and_returns_succeeded_observation() {
    let (_home, state) = setup_state();

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("terminal.list", json!({})),
    ))
    .expect("execute terminal.list");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::Succeeded
    );
    assert!(response.pending_invocation.is_none());
    assert!(response.audit.is_some());
    assert!(response.observation.audit_id.is_some());
    assert_eq!(
        response
            .observation
            .data
            .get("sessionCount")
            .and_then(|value| value.as_u64()),
        Some(0)
    );
    assert!(response.observation.entities.is_empty());
    assert!(response.observation.error_kind.is_none());
}

#[test]
fn execute_if_allowed_returns_needs_approval_for_remote_write_without_execution() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "ssh.connect",
            json!({ "hostId": host_id, "cols": 100, "rows": 30 }),
        ),
    ))
    .expect("prepare ssh.connect");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::NeedsApproval
    );
    assert!(response.audit.is_none());
    assert_eq!(
        response.observation.pending_invocation_id.as_deref(),
        response
            .pending_invocation
            .as_ref()
            .map(|pending| pending.id.as_str())
    );
    assert_eq!(
        state
            .ai_tools()
            .list_audits(state.storage())
            .expect("list audits")
            .len(),
        0
    );
    assert_eq!(
        state
            .ai_tools()
            .list_pending(state.storage())
            .expect("list pending")
            .len(),
        1
    );
}

#[test]
fn execute_if_allowed_keeps_destructive_tool_pending_when_policy_allows_preparation() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.allow_destructive_tools = true);

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "sftp.delete",
            json!({
                "directory": false,
                "hostId": "dev-server",
                "path": "/tmp/kerminal-ai-preview.tmp"
            }),
        ),
    ))
    .expect("prepare destructive sftp.delete");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::NeedsApproval
    );
    assert!(response.audit.is_none());
    assert!(response.pending_invocation.is_some());
}

#[test]
fn execute_if_allowed_failed_execution_has_error_kind_and_recoverable_flag() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "terminal.write",
            json!({ "sessionId": "missing-session", "data": "echo test\r" }),
        ),
    ))
    .expect("execute terminal.write");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("targetNotFound")
    );
    assert!(response.observation.recoverable);
    assert!(response.audit.is_some());
}
