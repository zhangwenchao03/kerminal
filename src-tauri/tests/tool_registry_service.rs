//! Tool Registry 与 rmcp Gateway 服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::{
        ai_agent::{
            AiApplicationContextRequest, AiApplicationMachineContext, AiApplicationPaneContext,
            AiApplicationTabContext,
        },
        settings::{
            AiMcpSettings, AiSecuritySettings, CustomMcpNameValue, CustomMcpServerSetting,
            CustomMcpServerToolSetting, CustomMcpSkillDirectorySetting, CustomMcpTransportKind,
        },
        tool_registry::{
            McpDefinitionOrigin, McpPromptRenderRequest, McpResourceReadRequest,
            McpTransportStatus, ToolAuditPolicy, ToolCategory, ToolConfirmationPolicy,
            ToolRiskLevel,
        },
    },
    services::{
        mcp_tool_gateway::{
            McpPromptRenderRuntime, McpResourceReadRuntime, McpToolGateway,
            AGENT_PROFILE_RESOURCE_URI, AGENT_SKILLS_RESOURCE_URI,
            AGENT_SKILL_DETAIL_RESOURCE_URI_PREFIX, AGENT_SYSTEM_PROMPT_RESOURCE_URI,
            AI_POLICY_RESOURCE_URI, APPLICATION_CONTEXT_RESOURCE_URI, CUSTOM_MCP_RESOURCE_URI,
            TERMINAL_CONTEXT_RESOURCE_URI, TOOL_REGISTRY_RESOURCE_URI,
        },
        tool_registry_service::ToolRegistryService,
    },
};
use serde_json::json;
use tempfile::tempdir;

fn app_context_request() -> AiApplicationContextRequest {
    AiApplicationContextRequest {
        active_tool_id: Some("ai".to_owned()),
        active_tab: Some(AiApplicationTabContext {
            id: "tab-1".to_owned(),
            title: "本地终端".to_owned(),
            machine_id: Some("local-powershell".to_owned()),
        }),
        focused_pane: Some(AiApplicationPaneContext {
            id: "pane-1".to_owned(),
            title: "本地 PowerShell".to_owned(),
            mode: "local".to_owned(),
            status: "online".to_owned(),
            machine_id: Some("local-powershell".to_owned()),
            session_id: Some("session-1".to_owned()),
        }),
        selected_machine: Some(AiApplicationMachineContext {
            id: "local-powershell".to_owned(),
            name: "PowerShell".to_owned(),
            kind: "local".to_owned(),
            status: "online".to_owned(),
            production: Some(false),
        }),
    }
}

fn custom_mcp_settings(skill_directory: &str) -> AiMcpSettings {
    AiMcpSettings {
        servers: vec![CustomMcpServerSetting {
            args: vec![
                "-y".to_owned(),
                "@modelcontextprotocol/server-filesystem".to_owned(),
            ],
            bearer_token_env_var: String::new(),
            command: "npx".to_owned(),
            description: "本地文件系统 MCP Server".to_owned(),
            enabled: true,
            env: vec![CustomMcpNameValue {
                name: "FILESYSTEM_ROOT".to_owned(),
                value: "C:\\\\dev".to_owned(),
            }],
            headers: Vec::new(),
            id: "custom.filesystem".to_owned(),
            last_discovered_at: Some(123),
            last_discovery_error: None,
            name: "Filesystem MCP".to_owned(),
            tools: vec![CustomMcpServerToolSetting {
                audit: ToolAuditPolicy::Summary,
                confirmation: ToolConfirmationPolicy::Always,
                description: "列出用户允许的文件系统目录".to_owned(),
                discovered_at: Some(123),
                enabled: true,
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"]
                }),
                name: "list".to_owned(),
                risk: ToolRiskLevel::Remote,
                title: "Custom Filesystem List".to_owned(),
            }],
            transport: CustomMcpTransportKind::Stdio,
            url: String::new(),
        }],
        skill_directories: vec![CustomMcpSkillDirectorySetting {
            enabled: true,
            id: "custom-skills".to_owned(),
            path: skill_directory.to_owned(),
        }],
    }
}

#[path = "tool_registry_service/contract.rs"]
mod contract;
#[path = "tool_registry_service/custom_mcp.rs"]
mod custom_mcp;
#[path = "tool_registry_service/prompts.rs"]
mod prompts;
#[path = "tool_registry_service/resources.rs"]
mod resources;

#[test]
fn registry_lists_core_tools_with_risk_and_confirmation_policy() {
    let service = ToolRegistryService::new();
    let tools = service.list_tools();

    assert!(tools.len() >= 10);

    let terminal_write = tools
        .iter()
        .find(|tool| tool.id == "terminal.write")
        .expect("terminal.write tool");
    assert_eq!(terminal_write.risk, ToolRiskLevel::Write);
    assert_eq!(
        terminal_write.confirmation,
        ToolConfirmationPolicy::Contextual
    );
    assert!(terminal_write.exposed_to_mcp);

    let server_info = tools
        .iter()
        .find(|tool| tool.id == "server_info.snapshot")
        .expect("server_info.snapshot tool");
    assert_eq!(server_info.risk, ToolRiskLevel::Remote);
    assert_eq!(server_info.confirmation, ToolConfirmationPolicy::Always);

    let ssh_command = tools
        .iter()
        .find(|tool| tool.id == "ssh.command")
        .expect("ssh command tool");
    assert_eq!(ssh_command.risk, ToolRiskLevel::Remote);
    assert_eq!(ssh_command.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        ssh_command.input_schema["properties"]["command"]["type"],
        "string"
    );
    assert_eq!(
        ssh_command.input_schema["properties"]["timeoutSeconds"]["type"],
        "number"
    );
    assert_eq!(
        ssh_command.input_schema["properties"]["proxyUrl"]["type"],
        "string"
    );
    assert_eq!(
        ssh_command.input_schema["properties"]["proxyProtocol"]["enum"],
        serde_json::json!(["http", "socks5"])
    );
    assert_eq!(
        ssh_command.input_schema["required"],
        serde_json::json!(["hostId", "command"])
    );

    let ssh_command_on_resolved_host = tools
        .iter()
        .find(|tool| tool.id == "ssh.command_on_resolved_host")
        .expect("ssh command on resolved host tool");
    assert_eq!(ssh_command_on_resolved_host.risk, ToolRiskLevel::Remote);
    assert_eq!(
        ssh_command_on_resolved_host.confirmation,
        ToolConfirmationPolicy::Always
    );
    assert_eq!(
        ssh_command_on_resolved_host.input_schema["properties"]["hostId"]["type"],
        "string"
    );
    assert_eq!(
        ssh_command_on_resolved_host.input_schema["properties"]["groupName"]["type"],
        "string"
    );
    assert_eq!(
        ssh_command_on_resolved_host.input_schema["properties"]["command"]["type"],
        "string"
    );
    assert_eq!(
        ssh_command_on_resolved_host.input_schema["properties"]["proxyProtocol"]["enum"],
        serde_json::json!(["http", "socks5"])
    );
    assert_eq!(
        ssh_command_on_resolved_host.input_schema["required"],
        serde_json::json!(["command"])
    );

    let sftp_rename = tools
        .iter()
        .find(|tool| tool.id == "sftp.rename")
        .expect("sftp.rename tool");
    assert_eq!(sftp_rename.risk, ToolRiskLevel::Remote);
    assert_eq!(sftp_rename.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        sftp_rename.input_schema["properties"]["fromPath"]["type"],
        "string"
    );
    assert_eq!(
        sftp_rename.input_schema["properties"]["toPath"]["type"],
        "string"
    );

    let sftp_move = tools
        .iter()
        .find(|tool| tool.id == "sftp.move")
        .expect("sftp.move tool");
    assert_eq!(sftp_move.risk, ToolRiskLevel::Remote);
    assert_eq!(sftp_move.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        sftp_move.input_schema["properties"]["fromPath"]["type"],
        "string"
    );
    assert_eq!(
        sftp_move.input_schema["properties"]["toPath"]["type"],
        "string"
    );

    let sftp_preview = tools
        .iter()
        .find(|tool| tool.id == "sftp.preview")
        .expect("sftp preview tool");
    assert_eq!(sftp_preview.risk, ToolRiskLevel::Remote);
    assert_eq!(sftp_preview.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        sftp_preview.input_schema["properties"]["path"]["type"],
        "string"
    );
    assert_eq!(
        sftp_preview.input_schema["properties"]["maxBytes"]["type"],
        "number"
    );
    assert_eq!(
        sftp_preview.input_schema["required"],
        serde_json::json!(["hostId", "path"])
    );

    let sftp_download = tools
        .iter()
        .find(|tool| tool.id == "sftp.download")
        .expect("sftp download tool");
    assert_eq!(sftp_download.risk, ToolRiskLevel::Remote);
    assert_eq!(sftp_download.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        sftp_download.input_schema["properties"]["remotePath"]["type"],
        "string"
    );
    assert_eq!(
        sftp_download.input_schema["properties"]["localPath"]["type"],
        "string"
    );

    let sftp_upload = tools
        .iter()
        .find(|tool| tool.id == "sftp.upload")
        .expect("sftp upload tool");
    assert_eq!(sftp_upload.risk, ToolRiskLevel::Remote);
    assert_eq!(sftp_upload.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        sftp_upload.input_schema["properties"]["localPath"]["type"],
        "string"
    );
    assert_eq!(
        sftp_upload.input_schema["properties"]["remotePath"]["type"],
        "string"
    );

    let snippet_create = tools
        .iter()
        .find(|tool| tool.id == "snippet.create")
        .expect("snippet create tool");
    assert_eq!(snippet_create.risk, ToolRiskLevel::Write);
    assert_eq!(
        snippet_create.confirmation,
        ToolConfirmationPolicy::Contextual
    );
    assert_eq!(
        snippet_create.input_schema["properties"]["command"]["type"],
        "string"
    );
    assert_eq!(
        snippet_create.input_schema["properties"]["scope"]["enum"],
        serde_json::json!(["any", "local", "ssh"])
    );
    assert_eq!(
        snippet_create.input_schema["required"],
        serde_json::json!(["title", "command"])
    );

    let history_search = tools
        .iter()
        .find(|tool| tool.id == "history.search")
        .expect("history search tool");
    assert_eq!(history_search.risk, ToolRiskLevel::Read);
    assert_eq!(history_search.confirmation, ToolConfirmationPolicy::Auto);
    assert_eq!(
        history_search.input_schema["properties"]["target"]["enum"],
        serde_json::json!(["local", "ssh"])
    );
    assert_eq!(
        history_search.input_schema["properties"]["paneId"]["type"],
        "string"
    );

    let terminal_appearance = tools
        .iter()
        .find(|tool| tool.id == "settings.update_terminal_appearance")
        .expect("settings.update_terminal_appearance tool");
    assert_eq!(terminal_appearance.risk, ToolRiskLevel::Write);
    assert_eq!(
        terminal_appearance.confirmation,
        ToolConfirmationPolicy::Contextual
    );
    assert_eq!(
        terminal_appearance.input_schema["properties"]["fontSize"]["type"],
        "number"
    );
    assert_eq!(
        terminal_appearance.input_schema["properties"]["cursorBlink"]["type"],
        "boolean"
    );

    let port_forward_list = tools
        .iter()
        .find(|tool| tool.id == "port_forward.list")
        .expect("port_forward.list tool");
    assert_eq!(port_forward_list.risk, ToolRiskLevel::Read);
    assert_eq!(port_forward_list.confirmation, ToolConfirmationPolicy::Auto);

    let port_forward_create = tools
        .iter()
        .find(|tool| tool.id == "port_forward.create")
        .expect("port_forward.create tool");
    assert_eq!(port_forward_create.risk, ToolRiskLevel::Remote);
    assert_eq!(
        port_forward_create.input_schema["properties"]["purpose"]["enum"],
        serde_json::json!(["generic", "hostNetworkAssist"])
    );
    assert_eq!(
        port_forward_create.input_schema["properties"]["proxyApplyScope"]["enum"],
        serde_json::json!([
            "none",
            "currentTerminal",
            "futureTerminals",
            "userProfile",
            "toolOnly"
        ])
    );

    let port_forward_close = tools
        .iter()
        .find(|tool| tool.id == "port_forward.close")
        .expect("port_forward.close tool");
    assert_eq!(port_forward_close.risk, ToolRiskLevel::Remote);
    assert_eq!(
        port_forward_close.confirmation,
        ToolConfirmationPolicy::Always
    );
    assert_eq!(
        port_forward_close.input_schema["required"],
        serde_json::json!(["forwardId"])
    );
}

#[test]
fn destructive_and_remote_tools_require_confirmation() {
    let service = ToolRegistryService::new();
    let tools = service.list_tools();

    let remote_host_create = tools
        .iter()
        .find(|tool| tool.id == "remote_host.create")
        .expect("remote host tool");
    assert_eq!(remote_host_create.risk, ToolRiskLevel::Remote);
    assert_eq!(
        remote_host_create.confirmation,
        ToolConfirmationPolicy::Always
    );

    let sftp_delete = tools
        .iter()
        .find(|tool| tool.id == "sftp.delete")
        .expect("sftp delete tool");
    assert_eq!(sftp_delete.risk, ToolRiskLevel::Destructive);
    assert_eq!(sftp_delete.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        sftp_delete.input_schema["properties"]["directory"]["type"],
        "boolean"
    );
    assert!(sftp_delete.input_schema["properties"]["recursive"].is_null());
}

#[test]
fn terminal_appearance_tool_is_exposed_with_write_policy() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let tool = tools
        .iter()
        .find(|tool| tool.id == "settings.update_terminal_appearance")
        .expect("terminal appearance tool");

    assert_eq!(tool.title, "更新终端外观");
    assert_eq!(tool.risk, ToolRiskLevel::Write);
    assert_eq!(tool.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(tool.exposed_to_mcp);
    assert_eq!(
        tool.input_schema["properties"]["scrollback"]["type"],
        "number"
    );

    let mcp_list = gateway.list_tools(&tools);
    let mcp_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "settings.update_terminal_appearance")
        .expect("terminal appearance mcp tool");
    assert_eq!(mcp_tool.annotations.read_only_hint, Some(false));
    assert_eq!(mcp_tool.annotations.destructive_hint, Some(false));
    assert_eq!(mcp_tool.annotations.idempotent_hint, Some(false));
    assert_eq!(
        mcp_tool.input_schema["properties"]["cursorBlink"]["type"],
        "boolean"
    );
}

#[test]
fn workspace_focus_tab_tool_is_exposed_with_write_policy() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let tool = tools
        .iter()
        .find(|tool| tool.id == "workspace.focus_tab")
        .expect("workspace focus tab tool");

    assert_eq!(tool.title, "切换终端 tab");
    assert_eq!(tool.risk, ToolRiskLevel::Write);
    assert_eq!(tool.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(tool.exposed_to_mcp);
    assert_eq!(tool.input_schema["properties"]["tabId"]["type"], "string");
    assert_eq!(tool.input_schema["required"], serde_json::json!(["tabId"]));

    let mcp_list = gateway.list_tools(&tools);
    let mcp_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "workspace.focus_tab")
        .expect("workspace focus tab mcp tool");
    assert_eq!(mcp_tool.annotations.read_only_hint, Some(false));
    assert_eq!(mcp_tool.annotations.destructive_hint, Some(false));
    assert_eq!(
        mcp_tool.input_schema["properties"]["tabId"]["type"],
        "string"
    );
}

#[test]
fn workspace_open_tool_tool_is_exposed_with_write_policy() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let tool = tools
        .iter()
        .find(|tool| tool.id == "workspace.open_tool")
        .expect("workspace open tool");

    assert_eq!(tool.title, "打开工具面板");
    assert_eq!(tool.risk, ToolRiskLevel::Write);
    assert_eq!(tool.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(tool.exposed_to_mcp);
    assert_eq!(tool.input_schema["properties"]["toolId"]["type"], "string");
    assert_eq!(tool.input_schema["required"], serde_json::json!(["toolId"]));
    assert!(tool.input_schema["properties"]["toolId"]["enum"]
        .as_array()
        .expect("tool enum")
        .contains(&serde_json::json!("sftp")));

    let mcp_list = gateway.list_tools(&tools);
    let mcp_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "workspace.open_tool")
        .expect("workspace open tool mcp tool");
    assert_eq!(mcp_tool.annotations.read_only_hint, Some(false));
    assert_eq!(mcp_tool.annotations.destructive_hint, Some(false));
    assert_eq!(
        mcp_tool.input_schema["properties"]["toolId"]["type"],
        "string"
    );
}

#[test]
fn diagnostics_tools_are_exposed_with_expected_policies() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();

    let runtime_health = tools
        .iter()
        .find(|tool| tool.id == "diagnostics.runtime_health")
        .expect("diagnostics runtime health tool");
    assert_eq!(runtime_health.title, "读取运行体检");
    assert_eq!(runtime_health.risk, ToolRiskLevel::Read);
    assert_eq!(runtime_health.confirmation, ToolConfirmationPolicy::Auto);
    assert!(runtime_health.exposed_to_mcp);
    assert_eq!(
        runtime_health.input_schema["required"],
        serde_json::json!([])
    );

    let create_bundle = tools
        .iter()
        .find(|tool| tool.id == "diagnostics.create_bundle")
        .expect("diagnostics create bundle tool");
    assert_eq!(create_bundle.title, "生成诊断包");
    assert_eq!(create_bundle.risk, ToolRiskLevel::Write);
    assert_eq!(
        create_bundle.confirmation,
        ToolConfirmationPolicy::Contextual
    );
    assert!(create_bundle.exposed_to_mcp);

    let mcp_list = gateway.list_tools(&tools);
    let runtime_mcp = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "diagnostics.runtime_health")
        .expect("diagnostics runtime health mcp tool");
    assert_eq!(runtime_mcp.annotations.read_only_hint, Some(true));
    assert_eq!(runtime_mcp.annotations.destructive_hint, Some(false));
    assert_eq!(runtime_mcp.annotations.idempotent_hint, Some(true));

    let bundle_mcp = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "diagnostics.create_bundle")
        .expect("diagnostics create bundle mcp tool");
    assert_eq!(bundle_mcp.annotations.read_only_hint, Some(false));
    assert_eq!(bundle_mcp.annotations.destructive_hint, Some(false));
    assert_eq!(bundle_mcp.annotations.idempotent_hint, Some(false));
}

#[test]
fn mcp_gateway_exports_enabled_tools_with_json_schema_and_annotations() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let mcp_list = gateway.list_tools(&tools);

    assert_eq!(mcp_list.protocol, "mcp-tools/list");
    assert!(mcp_list
        .tools
        .iter()
        .any(|tool| tool.name == "terminal.write"));

    let server_info = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "server_info.snapshot")
        .expect("server info mcp tool");
    assert_eq!(server_info.annotations.read_only_hint, Some(false));
    assert_eq!(server_info.annotations.open_world_hint, Some(true));
    assert_eq!(server_info.input_schema["type"], "object");
    assert_eq!(
        server_info.input_schema["properties"]["hostId"]["type"],
        "string"
    );

    let ssh_command = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "ssh.command")
        .expect("ssh command mcp tool");
    assert_eq!(ssh_command.annotations.read_only_hint, Some(false));
    assert_eq!(ssh_command.annotations.destructive_hint, Some(false));
    assert_eq!(ssh_command.annotations.open_world_hint, Some(true));
    assert_eq!(ssh_command.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        ssh_command.input_schema["properties"]["command"]["type"],
        "string"
    );

    let delete_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.delete")
        .expect("delete mcp tool");
    assert_eq!(delete_tool.annotations.destructive_hint, Some(true));
    assert_eq!(delete_tool.confirmation, ToolConfirmationPolicy::Always);

    let rename_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.rename")
        .expect("rename mcp tool");
    assert_eq!(rename_tool.annotations.destructive_hint, Some(false));
    assert_eq!(rename_tool.annotations.open_world_hint, Some(true));
    assert_eq!(rename_tool.confirmation, ToolConfirmationPolicy::Always);

    let move_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.move")
        .expect("move mcp tool");
    assert_eq!(move_tool.annotations.destructive_hint, Some(false));
    assert_eq!(move_tool.annotations.open_world_hint, Some(true));
    assert_eq!(move_tool.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        move_tool.input_schema["properties"]["fromPath"]["type"],
        "string"
    );

    let preview_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.preview")
        .expect("preview mcp tool");
    assert_eq!(preview_tool.annotations.destructive_hint, Some(false));
    assert_eq!(preview_tool.annotations.open_world_hint, Some(true));
    assert_eq!(preview_tool.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(preview_tool.risk, ToolRiskLevel::Remote);
    assert_eq!(
        preview_tool.input_schema["properties"]["path"]["type"],
        "string"
    );
    assert_eq!(
        preview_tool.input_schema["properties"]["maxBytes"]["type"],
        "number"
    );

    let download_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.download")
        .expect("download mcp tool");
    assert_eq!(download_tool.annotations.destructive_hint, Some(false));
    assert_eq!(download_tool.annotations.open_world_hint, Some(true));
    assert_eq!(
        download_tool.input_schema["properties"]["localPath"]["type"],
        "string"
    );

    let upload_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.upload")
        .expect("upload mcp tool");
    assert_eq!(upload_tool.annotations.destructive_hint, Some(false));
    assert_eq!(upload_tool.annotations.open_world_hint, Some(true));
    assert_eq!(upload_tool.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(
        upload_tool.input_schema["properties"]["remotePath"]["type"],
        "string"
    );

    let snippet_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "snippet.create")
        .expect("snippet mcp tool");
    assert_eq!(snippet_tool.annotations.destructive_hint, Some(false));
    assert_eq!(snippet_tool.annotations.open_world_hint, Some(false));
    assert_eq!(
        snippet_tool.confirmation,
        ToolConfirmationPolicy::Contextual
    );
    assert_eq!(snippet_tool.risk, ToolRiskLevel::Write);
    assert_eq!(
        snippet_tool.input_schema["properties"]["command"]["type"],
        "string"
    );

    let history_tool = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "history.search")
        .expect("history mcp tool");
    assert_eq!(history_tool.annotations.read_only_hint, Some(true));
    assert_eq!(history_tool.annotations.destructive_hint, Some(false));
    assert_eq!(history_tool.annotations.idempotent_hint, Some(true));
    assert_eq!(history_tool.confirmation, ToolConfirmationPolicy::Auto);
    assert_eq!(
        history_tool.input_schema["properties"]["query"]["type"],
        "string"
    );
    assert_eq!(
        history_tool.input_schema["properties"]["paneId"]["type"],
        "string"
    );

    let terminal_appearance = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "settings.update_terminal_appearance")
        .expect("terminal appearance mcp tool");
    assert_eq!(terminal_appearance.annotations.read_only_hint, Some(false));
    assert_eq!(terminal_appearance.annotations.idempotent_hint, Some(false));
    assert_eq!(
        terminal_appearance.confirmation,
        ToolConfirmationPolicy::Contextual
    );
    assert_eq!(
        terminal_appearance.input_schema["properties"]["lineHeight"]["type"],
        "number"
    );

    let focus_tab = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "workspace.focus_tab")
        .expect("workspace focus tab mcp tool");
    assert_eq!(focus_tab.annotations.read_only_hint, Some(false));
    assert_eq!(focus_tab.confirmation, ToolConfirmationPolicy::Contextual);
    assert_eq!(
        focus_tab.input_schema["properties"]["tabId"]["type"],
        "string"
    );

    let port_forward_list = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "port_forward.list")
        .expect("port forward list mcp tool");
    assert_eq!(port_forward_list.annotations.read_only_hint, Some(true));
    assert_eq!(port_forward_list.confirmation, ToolConfirmationPolicy::Auto);

    let port_forward_close = mcp_list
        .tools
        .iter()
        .find(|tool| tool.name == "port_forward.close")
        .expect("port forward close mcp tool");
    assert_eq!(port_forward_close.annotations.open_world_hint, Some(true));
    assert_eq!(
        port_forward_close.confirmation,
        ToolConfirmationPolicy::Always
    );
    assert_eq!(
        port_forward_close.input_schema["properties"]["forwardId"]["type"],
        "string"
    );
}

#[test]
fn mcp_gateway_does_not_export_disabled_or_non_exposed_tools() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let mcp_list = gateway.list_tools(&tools);

    assert!(tools.iter().any(|tool| tool.id == "workflow.run"));
    assert!(!mcp_list
        .tools
        .iter()
        .any(|tool| tool.name == "workflow.run"));
}

#[test]
fn mcp_gateway_manifest_describes_local_server_resources_prompts_and_security() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let manifest = gateway.manifest(&tools, &AiMcpSettings::default());

    assert_eq!(manifest.protocol, "kerminal-mcp/manifest");
    assert_eq!(manifest.server.name, "kerminal");
    assert_eq!(manifest.server.title, "Kerminal");
    assert!(!manifest.server.version.trim().is_empty());
    assert!(!manifest.generated_at.trim().is_empty());
    assert_eq!(manifest.agent.id, "kerminal-agent");
    assert_eq!(manifest.agent.name, "Kerminal Agent");
    assert!(manifest
        .agent
        .description
        .contains("MCP 工具目录和 skills 路由"));
    assert!(manifest
        .agent
        .operating_rules
        .iter()
        .any(|rule| rule.contains("内置 Agent 走 Kerminal 确认链路")
            && rule.contains("外部 Streamable HTTP MCP host")));

    assert_eq!(manifest.tools.protocol, "mcp-tools/list");
    assert!(manifest
        .tools
        .tools
        .iter()
        .any(|tool| tool.name == "terminal.write"));
    assert!(manifest
        .tools
        .tools
        .iter()
        .any(|tool| tool.name == "sftp.delete"));
    assert!(manifest
        .skills
        .iter()
        .any(|skill| skill.id == "terminal-workspace"
            && skill
                .tool_ids
                .iter()
                .any(|tool_id| tool_id == "terminal.write")));
    assert!(manifest.skills.iter().any(|skill| skill.id == "sftp-files"
        && skill
            .tool_ids
            .iter()
            .any(|tool_id| tool_id == "sftp.preview")));

    assert!(manifest
        .resources
        .iter()
        .any(|resource| resource.uri == AGENT_PROFILE_RESOURCE_URI && !resource.dynamic));
    assert!(manifest
        .resources
        .iter()
        .any(|resource| resource.uri == AGENT_SKILLS_RESOURCE_URI && !resource.dynamic));
    assert!(manifest
        .resources
        .iter()
        .any(|resource| resource.uri == AGENT_SYSTEM_PROMPT_RESOURCE_URI && !resource.dynamic));
    assert!(manifest
        .resources
        .iter()
        .any(|resource| { resource.uri == APPLICATION_CONTEXT_RESOURCE_URI && resource.dynamic }));
    assert!(manifest
        .resources
        .iter()
        .any(|resource| resource.uri == "kerminal://tool-registry" && !resource.dynamic));
    assert!(manifest.resources.iter().any(|resource| {
        resource.uri == "kerminal://terminal-context/current" && resource.dynamic
    }));
    assert!(manifest
        .prompts
        .iter()
        .any(|prompt| prompt.name == "kerminal.agent.route"
            && prompt
                .arguments
                .iter()
                .any(|argument| argument.name == "goal" && argument.required)));
    assert!(manifest
        .prompts
        .iter()
        .any(|prompt| prompt.name == "kerminal.terminal.suggest"
            && prompt.arguments.iter().any(|argument| argument.required)));

    let in_process = manifest
        .transports
        .iter()
        .find(|transport| transport.kind == "in-process-rmcp")
        .expect("in-process rmcp transport");
    assert_eq!(in_process.status, McpTransportStatus::Enabled);

    let stdio = manifest
        .transports
        .iter()
        .find(|transport| transport.kind == "stdio")
        .expect("stdio transport");
    assert_eq!(stdio.status, McpTransportStatus::Planned);
    assert_eq!(
        stdio.command.as_deref(),
        Some("kerminal mcp serve --transport stdio")
    );

    let streamable_http = manifest
        .transports
        .iter()
        .find(|transport| transport.kind == "streamable-http")
        .expect("streamable http transport");
    assert_eq!(streamable_http.status, McpTransportStatus::Enabled);
    assert_eq!(
        streamable_http.command.as_deref(),
        Some("tool_registry_mcp_http_start")
    );
    assert_eq!(
        streamable_http.endpoint.as_deref(),
        Some("http://127.0.0.1:<dynamic>/mcp")
    );

    assert!(manifest.security.local_only);
    assert!(manifest.security.external_access_enabled);
    assert!(!manifest.security.requires_kerminal_confirmation);
    assert!(manifest.security.audit_enabled);
    assert!(manifest.security.secrets_redacted);
}
