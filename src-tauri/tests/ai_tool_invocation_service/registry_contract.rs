//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use kerminal_lib::models::ai_tool_invocation::{
    AiToolExecuteIfAllowedRequest, AiToolObservationStatus,
};

#[test]
fn prepare_accepts_valid_arguments_for_every_enabled_mcp_tool() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.allow_destructive_tools = true);

    let tools = state
        .tools()
        .list_tools()
        .into_iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .collect::<Vec<_>>();
    assert!(
        tools.len() > 60,
        "expected broad AI/MCP coverage, got {} tools",
        tools.len()
    );

    for tool in tools {
        let pending = prepare_with_current_settings(
            &state,
            prepare_request(&tool.id, sample_arguments_for_tool(&tool.id)),
        )
        .unwrap_or_else(|error| panic!("prepare {} should pass: {error}", tool.id));

        assert_eq!(pending.tool_id, tool.id);
    }
}

#[test]
fn prepare_accepts_valid_arguments_for_every_enabled_registry_tool() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.allow_destructive_tools = true);

    let tools = state
        .tools()
        .list_tools()
        .into_iter()
        .filter(|tool| tool.enabled)
        .collect::<Vec<_>>();
    assert!(
        tools.len() > 60,
        "expected broad enabled AI tool coverage, got {} tools",
        tools.len()
    );

    for tool in tools {
        let pending = prepare_with_current_settings(
            &state,
            prepare_request(&tool.id, sample_arguments_for_tool(&tool.id)),
        )
        .unwrap_or_else(|error| panic!("prepare {} should pass: {error}", tool.id));

        assert_eq!(pending.tool_id, tool.id);
    }
}

#[test]
fn execute_if_allowed_dispatches_every_enabled_registry_tool() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.allow_destructive_tools = true);

    let tools = state
        .tools()
        .list_tools()
        .into_iter()
        .filter(|tool| tool.enabled)
        .collect::<Vec<_>>();

    for tool in tools {
        let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
            ai_tool_execution_context(&state),
            state.tools(),
            AiToolExecuteIfAllowedRequest {
                tool_id: tool.id.clone(),
                arguments: sample_arguments_for_tool(&tool.id),
                requested_by: Some("test-agent".to_owned()),
                reason: Some("验证所有 enabled AI 工具都有执行入口".to_owned()),
                conversation_id: Some("conversation-registry-contract".to_owned()),
                conversation_slot_json: None,
                run_id: Some("run-registry-contract".to_owned()),
                step_id: Some(format!("step-{}", tool.id.replace('.', "-"))),
                audit_context: None,
            },
        ))
        .unwrap_or_else(|error| panic!("execute_if_allowed {} should dispatch: {error}", tool.id));

        if response.pending_invocation.is_some() {
            assert_eq!(
                response.observation.status,
                AiToolObservationStatus::NeedsApproval,
                "{} pending tools must return a needs-approval observation",
                tool.id
            );
            assert!(
                response.audit.is_none(),
                "{} pending tools must not be audited before approval",
                tool.id
            );
        } else {
            assert!(
                matches!(
                    response.observation.status,
                    AiToolObservationStatus::Succeeded | AiToolObservationStatus::Failed
                ),
                "{} auto-dispatched tools must return an execution observation, got {:?}",
                tool.id,
                response.observation.status
            );
            assert!(
                response.audit.is_some(),
                "{} auto-dispatched tools must create an audit record",
                tool.id
            );
        }
    }
}
