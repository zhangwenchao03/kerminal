//! MCP allowlisted resource 读取测试。
//!
//! @author kongweiguang

use super::*;

#[test]
fn mcp_gateway_reads_allowlisted_resources_and_rejects_unknown_uri() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();

    let tool_registry = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: TOOL_REGISTRY_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime::default(),
        )
        .expect("tool registry resource");
    assert_eq!(tool_registry.uri, TOOL_REGISTRY_RESOURCE_URI);
    assert_eq!(tool_registry.name, "tool-registry");
    assert_eq!(
        tool_registry.content["protocol"],
        "kerminal-mcp/resource/tool-registry"
    );
    assert!(
        tool_registry.content["toolCount"]
            .as_u64()
            .unwrap_or_default()
            > 5
    );
    assert!(tool_registry.content["tools"]
        .as_array()
        .expect("tools array")
        .iter()
        .any(|tool| tool["name"] == "terminal.write"));

    let agent_profile = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: AGENT_PROFILE_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime::default(),
        )
        .expect("agent profile resource");
    assert_eq!(agent_profile.uri, AGENT_PROFILE_RESOURCE_URI);
    assert_eq!(
        agent_profile.content["protocol"],
        "kerminal-mcp/resource/agent-profile"
    );
    assert_eq!(agent_profile.content["agent"]["name"], "Kerminal Agent");

    let agent_skills = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: AGENT_SKILLS_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime::default(),
        )
        .expect("agent skills resource");
    assert_eq!(agent_skills.uri, AGENT_SKILLS_RESOURCE_URI);
    assert_eq!(
        agent_skills.content["protocol"],
        "kerminal-mcp/resource/agent-skills"
    );
    assert_eq!(
        agent_skills.content["toolCoverage"]["missingToolIds"],
        serde_json::json!([])
    );
    assert!(agent_skills.content["skills"]
        .as_array()
        .expect("skills array")
        .iter()
        .any(|skill| skill["id"] == "sftp-files"));

    let agent_system_prompt = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: AGENT_SYSTEM_PROMPT_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime::default(),
        )
        .expect("agent system prompt resource");
    assert_eq!(agent_system_prompt.uri, AGENT_SYSTEM_PROMPT_RESOURCE_URI);
    assert!(agent_system_prompt.content["prompt"]
        .as_str()
        .expect("system prompt")
        .contains("当前应用上下文"));

    let application_context = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: Some(app_context_request()),
                audit_limit: None,
                terminal_context: None,
                uri: APPLICATION_CONTEXT_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime {
                application_context: Some(app_context_request()),
                ..McpResourceReadRuntime::default()
            },
        )
        .expect("application context resource");
    assert_eq!(application_context.uri, APPLICATION_CONTEXT_RESOURCE_URI);
    assert_eq!(application_context.content["available"], true);
    assert_eq!(
        application_context.content["context"]["focusedPane"]["title"],
        "本地 PowerShell"
    );

    let terminal_context = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: TERMINAL_CONTEXT_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime::default(),
        )
        .expect("terminal context resource");
    assert_eq!(terminal_context.uri, TERMINAL_CONTEXT_RESOURCE_URI);
    assert_eq!(terminal_context.content["available"], false);
    assert!(terminal_context.content["reason"]
        .as_str()
        .expect("terminal context reason")
        .contains("活动终端 session"));

    let ai_policy = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: AI_POLICY_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime {
                ai_policy: Some(AiSecuritySettings::default()),
                ..McpResourceReadRuntime::default()
            },
        )
        .expect("ai policy resource");
    assert_eq!(ai_policy.uri, AI_POLICY_RESOURCE_URI);
    assert_eq!(
        ai_policy.content["protocol"],
        "kerminal-mcp/resource/ai-policy"
    );
    assert_eq!(ai_policy.content["policy"]["requireRemoteApproval"], true);
    assert_eq!(ai_policy.content["policy"]["allowDestructiveTools"], false);

    let unknown = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: "kerminal://unknown".to_owned(),
            },
            McpResourceReadRuntime::default(),
        )
        .expect_err("unknown resource should fail");
    assert!(unknown.to_string().contains("未知 MCP resource"));
}
