//! 自定义 MCP manifest 与资源测试。
//!
//! @author kongweiguang

use super::*;

#[test]
fn mcp_gateway_manifest_and_resources_include_custom_mcp_without_secret_values() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let skill_root = tempdir().expect("skill root");
    let skill_dir = skill_root.path().join("custom-filesystem");
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: 自定义文件系统 Skill\ndescription: |\n  处理用户自定义文件系统 MCP 能力。\n---\n\n# 兜底标题\n",
    )
    .expect("write skill");
    let custom_mcp = custom_mcp_settings(skill_root.path().to_string_lossy().as_ref());

    let manifest = gateway.manifest(&tools, &custom_mcp);

    let custom_tool = manifest
        .tools
        .tools
        .iter()
        .find(|tool| tool.name == "custom.filesystem.list")
        .expect("custom tool in manifest");
    assert_eq!(custom_tool.origin, McpDefinitionOrigin::Custom);
    assert_eq!(custom_tool.server_id.as_deref(), Some("custom.filesystem"));
    assert_eq!(custom_tool.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(custom_tool.annotations.idempotent_hint, Some(false));
    assert!(custom_tool
        .description
        .as_deref()
        .unwrap_or_default()
        .contains("工具由 server discovery 得到"));

    let custom_skill = manifest
        .skills
        .iter()
        .find(|skill| skill.id == "custom-skill.custom-skills.custom-filesystem")
        .expect("custom skill");
    assert_eq!(custom_skill.origin, McpDefinitionOrigin::Custom);
    assert_eq!(custom_skill.title, "自定义文件系统 Skill");
    assert_eq!(
        custom_skill.description,
        "处理用户自定义文件系统 MCP 能力。"
    );
    let custom_transport = manifest
        .transports
        .iter()
        .find(|transport| transport.id.as_deref() == Some("custom.filesystem"))
        .expect("custom transport");
    assert_eq!(custom_transport.origin, McpDefinitionOrigin::Custom);
    assert_eq!(custom_transport.command.as_deref(), Some("npx"));
    assert_eq!(custom_transport.env_keys, vec!["FILESYSTEM_ROOT"]);

    let custom_resource = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: CUSTOM_MCP_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime {
                custom_mcp: custom_mcp.clone(),
                ..McpResourceReadRuntime::default()
            },
        )
        .expect("custom mcp resource");

    assert_eq!(custom_resource.uri, CUSTOM_MCP_RESOURCE_URI);
    assert_eq!(
        custom_resource.content["protocol"],
        "kerminal-mcp/resource/custom-mcp"
    );
    assert_eq!(custom_resource.content["serverCount"], 1);
    assert_eq!(custom_resource.content["toolCount"], 1);
    assert_eq!(
        custom_resource.content["servers"][0]["envKeys"][0],
        "FILESYSTEM_ROOT"
    );
    assert_eq!(
        custom_resource.content["servers"][0]["tools"][0]["name"],
        "list"
    );
    assert!(!custom_resource.content.to_string().contains("C:\\\\dev"));

    let skills_resource = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: AGENT_SKILLS_RESOURCE_URI.to_owned(),
            },
            McpResourceReadRuntime {
                custom_mcp: custom_mcp.clone(),
                ..McpResourceReadRuntime::default()
            },
        )
        .expect("skills resource");
    assert!(skills_resource.content["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["id"] == "custom-skill.custom-skills.custom-filesystem"));

    let skill_detail = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                application_context: None,
                audit_limit: None,
                terminal_context: None,
                uri: format!(
                    "{}{}",
                    AGENT_SKILL_DETAIL_RESOURCE_URI_PREFIX,
                    "custom-skill.custom-skills.custom-filesystem"
                ),
            },
            McpResourceReadRuntime {
                custom_mcp,
                ..McpResourceReadRuntime::default()
            },
        )
        .expect("skill detail resource");
    assert_eq!(
        skill_detail.content["protocol"],
        "kerminal-mcp/resource/agent-skill-detail"
    );
    assert_eq!(
        skill_detail.content["skill"]["id"],
        "custom-skill.custom-skills.custom-filesystem"
    );
    assert!(skill_detail.content["instructions"]
        .as_str()
        .expect("skill instructions")
        .contains("# 兜底标题"));
    assert_eq!(skill_detail.content["hasScripts"], false);
}
