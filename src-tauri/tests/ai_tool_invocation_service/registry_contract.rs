//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;

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
