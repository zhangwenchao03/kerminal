//! AI 工具待确认调用恢复测试。
//!
//! @author kongweiguang

use super::support::*;
use kerminal_lib::services::ai_tool_invocation_service::AiToolInvocationService;
use serde_json::json;

#[test]
fn pending_invocation_survives_service_recreation_until_confirmed() {
    let (_home, state) = setup_state();

    let mut request = prepare_request(
        "terminal.write",
        json!({
            "sessionId": "session-restore",
            "data": "echo recovered\n",
            "apiToken": "secret-token"
        }),
    );
    request.conversation_id = Some("conv-restore".to_owned());
    request.conversation_slot_json =
        Some(r#"{"slotKey":"pane:pane-restore","routeMode":"followWorkspaceTarget"}"#.to_owned());
    request.run_id = Some("run-restore".to_owned());
    request.step_id = Some("step-restore".to_owned());
    let pending = prepare_with_current_settings(&state, request).expect("prepare terminal write");

    let stored_pending = state
        .ai_tools()
        .list_pending(state.storage())
        .expect("list pending");
    assert_eq!(stored_pending.len(), 1);
    assert_eq!(stored_pending[0].id, pending.id);
    assert_eq!(
        stored_pending[0].conversation_id.as_deref(),
        Some("conv-restore")
    );
    assert_eq!(
        stored_pending[0].conversation_slot_json.as_deref(),
        Some(r#"{"slotKey":"pane:pane-restore","routeMode":"followWorkspaceTarget"}"#)
    );
    assert_eq!(stored_pending[0].run_id.as_deref(), Some("run-restore"));
    assert_eq!(stored_pending[0].step_id.as_deref(), Some("step-restore"));
    assert!(stored_pending[0]
        .arguments_summary
        .contains("apiToken=[已脱敏]"));

    let (stored, arguments) = state
        .storage()
        .ai_tool_pending_state(&pending.id)
        .expect("load pending state")
        .expect("pending state exists");
    assert_eq!(stored.run_id.as_deref(), Some("run-restore"));
    assert_eq!(stored.step_id.as_deref(), Some("step-restore"));
    assert_eq!(
        arguments.get("data").and_then(|value| value.as_str()),
        Some("echo recovered\n")
    );
    assert_eq!(
        arguments.get("apiToken").and_then(|value| value.as_str()),
        Some("secret-token")
    );

    let restored_service = AiToolInvocationService::new();
    let audit = restored_service
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id.clone(),
                approved: false,
                audit_context: None,
            },
        )
        .expect("confirm recovered pending");

    assert_eq!(audit.invocation_id, pending.id);
    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(audit.tool_id, "terminal.write");
    assert!(state
        .storage()
        .ai_tool_pending_state(&pending.id)
        .expect("reload pending state")
        .is_none());
}
