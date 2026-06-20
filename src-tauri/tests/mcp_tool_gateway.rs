//! MCP Tool Gateway 测试。
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::{
        settings::{AiMcpSettings, CustomMcpSkillDirectorySetting},
        tool_registry::McpResourceReadRequest,
    },
    services::{
        mcp_tool_gateway::{
            McpResourceReadRuntime, McpToolGateway, AGENT_SKILLS_RESOURCE_URI,
            CUSTOM_MCP_RESOURCE_URI,
        },
        tool_registry_service::ToolRegistryService,
    },
};
use tempfile::tempdir;

fn custom_mcp_with_skill_root(path: &str) -> AiMcpSettings {
    AiMcpSettings {
        servers: Vec::new(),
        skill_directories: vec![CustomMcpSkillDirectorySetting {
            enabled: true,
            id: "agent-skills".to_owned(),
            path: path.to_owned(),
        }],
    }
}

#[test]
fn agent_skills_resource_exposes_custom_skill_repository_details() {
    let root = tempdir().expect("create temp skills root");
    let skill = root.path().join("ops");
    fs::create_dir_all(skill.join("assets")).expect("create skill assets");
    fs::write(
        skill.join("SKILL.md"),
        "---\nname: ops-skill\ndescription: Use for local ops runbooks.\n---\n\nFollow read-only checks before write operations.\n",
    )
    .expect("write skill");
    let custom_mcp = custom_mcp_with_skill_root(root.path().to_string_lossy().as_ref());
    let gateway = McpToolGateway::new();
    let tools = ToolRegistryService::new().list_tools();

    let result = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                uri: AGENT_SKILLS_RESOURCE_URI.to_owned(),
                application_context: None,
                terminal_context: None,
                audit_limit: None,
            },
            McpResourceReadRuntime {
                custom_mcp: custom_mcp.clone(),
                ..Default::default()
            },
        )
        .expect("read agent skills resource");

    assert_eq!(result.content["customSkillCount"], 1);
    assert_eq!(
        result.content["customSkills"][0]["id"],
        "custom-skill.agent-skills.ops"
    );
    assert_eq!(result.content["customSkills"][0]["hasAssets"], true);
    assert!(result.content["customSkills"][0]["instructionPreview"]
        .as_str()
        .expect("instruction preview")
        .contains("read-only checks"));
    assert_eq!(result.content["customSkillDirectories"][0]["skillCount"], 1);
}

#[test]
fn custom_mcp_resource_reports_configured_skill_directory_existence() {
    let root = tempdir().expect("create temp skills root");
    let custom_mcp = custom_mcp_with_skill_root(root.path().to_string_lossy().as_ref());
    let gateway = McpToolGateway::new();
    let tools = ToolRegistryService::new().list_tools();

    let result = gateway
        .read_resource(
            &tools,
            McpResourceReadRequest {
                uri: CUSTOM_MCP_RESOURCE_URI.to_owned(),
                application_context: None,
                terminal_context: None,
                audit_limit: None,
            },
            McpResourceReadRuntime {
                custom_mcp,
                ..Default::default()
            },
        )
        .expect("read custom mcp resource");

    assert_eq!(result.content["skillDirectoryCount"], 1);
    assert_eq!(result.content["skillDirectories"][0]["exists"], true);
}
