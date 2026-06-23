//! Tool Registry 通用契约测试。
//!
//! @author kongweiguang

use std::collections::{BTreeMap, BTreeSet};

use super::*;

#[test]
fn registry_contract_uses_unique_ids_and_closed_object_schemas() {
    let service = ToolRegistryService::new();
    let tools = service.list_tools();
    let mut ids = BTreeSet::new();

    for tool in &tools {
        assert!(!tool.id.trim().is_empty(), "empty tool id");
        assert_eq!(tool.id.trim(), tool.id, "tool id has surrounding spaces");
        assert!(
            !tool.id.chars().any(|ch| ch.is_whitespace()),
            "tool id contains whitespace: {}",
            tool.id
        );
        assert!(
            ids.insert(tool.id.as_str()),
            "duplicate tool id {}",
            tool.id
        );
        assert!(
            !tool.title.trim().is_empty(),
            "tool {} has empty title",
            tool.id
        );
        assert!(
            !tool.description.trim().is_empty(),
            "tool {} has empty description",
            tool.id
        );

        let schema = &tool.input_schema;
        assert_eq!(schema["type"], "object", "tool {} schema type", tool.id);
        assert_eq!(
            schema["additionalProperties"], false,
            "tool {} schema must reject unknown arguments",
            tool.id
        );
        let properties = schema["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("tool {} schema properties", tool.id));
        let required = schema["required"]
            .as_array()
            .unwrap_or_else(|| panic!("tool {} schema required", tool.id));
        for field in required {
            let field = field
                .as_str()
                .unwrap_or_else(|| panic!("tool {} has non-string required field", tool.id));
            assert!(
                properties.contains_key(field),
                "tool {} requires missing property {}",
                tool.id,
                field
            );
        }

        match tool.risk {
            ToolRiskLevel::Read => assert_eq!(
                tool.confirmation,
                ToolConfirmationPolicy::Auto,
                "read tool {} should be auto-confirmed",
                tool.id
            ),
            ToolRiskLevel::Remote | ToolRiskLevel::Batch | ToolRiskLevel::Destructive => {
                assert_eq!(
                    tool.confirmation,
                    ToolConfirmationPolicy::Always,
                    "high-risk tool {} should require confirmation",
                    tool.id
                );
            }
            ToolRiskLevel::Write => {}
        }
    }
}

#[test]
fn registry_covers_user_visible_kerminal_capability_domains() {
    let service = ToolRegistryService::new();
    let tools = service.list_tools();
    let ids: BTreeSet<&str> = tools.iter().map(|tool| tool.id.as_str()).collect();
    let categories: Vec<ToolCategory> = tools.iter().map(|tool| tool.category.clone()).collect();

    for category in [
        ToolCategory::Terminal,
        ToolCategory::Workspace,
        ToolCategory::Settings,
        ToolCategory::LlmProvider,
        ToolCategory::Profile,
        ToolCategory::RemoteHost,
        ToolCategory::Ssh,
        ToolCategory::Sftp,
        ToolCategory::Container,
        ToolCategory::PortForward,
        ToolCategory::ServerInfo,
        ToolCategory::Snippet,
        ToolCategory::History,
        ToolCategory::Diagnostics,
        ToolCategory::Workflow,
    ] {
        assert!(
            categories.contains(&category),
            "missing AI tool capability category: {category:?}"
        );
    }

    for tool_id in [
        "terminal.create",
        "terminal.resolve_current",
        "terminal.write",
        "terminal.list",
        "terminal.close",
        "workspace.split_pane",
        "workspace.focus_tab",
        "workspace.open_tool",
        "settings.get",
        "settings.update_ai_security",
        "llm_provider.list",
        "llm_provider.create",
        "profile.create",
        "profile.list",
        "remote_host.create",
        "remote_host.ensure",
        "remote_host.last_used",
        "remote_host.tree",
        "ssh.connect",
        "ssh.ensure_connected",
        "ssh.command",
        "ssh.command_on_resolved_host",
        "sftp.list",
        "sftp.preview",
        "sftp.upload",
        "sftp.download",
        "sftp.delete",
        "sftp.transfer.enqueue",
        "sftp.transfer.list",
        "container.list",
        "container.files.list",
        "container.files.preview",
        "port_forward.create",
        "port_forward.list",
        "port_forward.close",
        "server_info.snapshot",
        "snippet.create",
        "snippet.list",
        "workflow.create",
        "workflow.list",
        "workflow.run",
        "history.search",
        "history.record",
        "diagnostics.runtime_health",
        "diagnostics.create_bundle",
    ] {
        assert!(ids.contains(tool_id), "missing required AI tool: {tool_id}");
    }
}

#[test]
fn remote_host_tools_document_plaintext_ssh_credential_contract() {
    let service = ToolRegistryService::new();
    let by_id: BTreeMap<_, _> = service
        .list_tools()
        .into_iter()
        .map(|tool| (tool.id.clone(), tool))
        .collect();

    for tool_id in [
        "remote_host.create",
        "remote_host.ensure",
        "remote_host.update",
    ] {
        let tool = by_id
            .get(tool_id)
            .unwrap_or_else(|| panic!("missing {tool_id}"));
        assert!(
            tool.description.contains("明文保存到主机记录"),
            "{tool_id} must tell the model SSH passwords/private keys are stored in the host record"
        );
        assert!(
            tool.description.contains("不接受 credential:"),
            "{tool_id} must reject old SSH credential: refs"
        );
        assert!(
            tool.input_schema["properties"]
                .get("credentialSecret")
                .is_some(),
            "{tool_id} must expose credentialSecret for plaintext SSH password/private key"
        );
        assert!(
            tool.input_schema["properties"].get("password").is_some(),
            "{tool_id} must expose password as an AI-friendly plaintext SSH password alias"
        );
        assert!(
            tool.input_schema["properties"].get("privateKey").is_some(),
            "{tool_id} must expose privateKey as an AI-friendly inline key alias"
        );
    }
}

#[test]
fn enabled_system_tools_have_execution_dispatch() {
    let registry = ToolRegistryService::new();
    let execution_source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/services/ai_tool_invocation_service/execution.rs"
    ))
    .expect("read AI tool execution dispatch source");

    let mut missing = Vec::new();
    for tool in registry.list_tools().iter().filter(|tool| tool.enabled) {
        let dispatch_literal = format!("\"{}\"", tool.id);
        if !execution_source.contains(&dispatch_literal) {
            missing.push(tool.id.clone());
        }
    }

    assert!(
        missing.is_empty(),
        "enabled registry tools must be handled by execute_tool before AI can claim them: {missing:?}"
    );
}

#[test]
fn registry_keeps_local_file_write_commands_out_of_ai_and_mcp_surface() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let mcp_list = gateway.list_tools(&tools);
    let forbidden_prefixes = ["local_files.", "local_file."];

    for tool in &tools {
        assert!(
            !forbidden_prefixes
                .iter()
                .any(|prefix| tool.id.starts_with(prefix)),
            "local file command {} must stay out of the AI Tool Registry",
            tool.id
        );
    }

    for tool in &mcp_list.tools {
        assert!(
            !forbidden_prefixes
                .iter()
                .any(|prefix| tool.name.starts_with(prefix)),
            "local file command {} must stay out of the MCP surface",
            tool.name
        );
    }
}

#[test]
fn sftp_remote_write_tools_keep_confirmation_audit_and_mcp_policy() {
    let registry = ToolRegistryService::new();
    let tools = registry.list_tools();
    let by_id: BTreeMap<&str, _> = tools.iter().map(|tool| (tool.id.as_str(), tool)).collect();

    for tool_id in [
        "sftp.rename",
        "sftp.move",
        "sftp.create_directory",
        "sftp.chmod",
        "sftp.upload",
        "sftp.upload_directory",
        "sftp.download",
        "sftp.download_directory",
        "sftp.transfer.enqueue",
        "sftp.transfer.cancel",
    ] {
        let tool = by_id
            .get(tool_id)
            .unwrap_or_else(|| panic!("missing SFTP remote write tool {tool_id}"));
        assert_eq!(tool.risk, ToolRiskLevel::Remote, "{tool_id} risk");
        assert_eq!(
            tool.confirmation,
            ToolConfirmationPolicy::Always,
            "{tool_id} confirmation"
        );
        assert_eq!(tool.audit, ToolAuditPolicy::Summary, "{tool_id} audit");
        assert!(tool.enabled, "{tool_id} enabled");
        assert!(tool.exposed_to_mcp, "{tool_id} exposed_to_mcp");
    }

    let delete_tool = by_id.get("sftp.delete").expect("sftp.delete tool");
    assert_eq!(delete_tool.risk, ToolRiskLevel::Destructive);
    assert_eq!(delete_tool.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(delete_tool.audit, ToolAuditPolicy::Full);
    assert!(delete_tool.enabled);
    assert!(delete_tool.exposed_to_mcp);
}

#[test]
fn mcp_gateway_projects_enabled_registry_tools_without_contract_drift() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let mcp_list = gateway.list_tools(&tools);
    let exposed_tools: BTreeMap<&str, _> = tools
        .iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .map(|tool| (tool.id.as_str(), tool))
        .collect();

    assert_eq!(mcp_list.protocol, "mcp-tools/list");
    assert_eq!(
        mcp_list.tools.len(),
        exposed_tools.len(),
        "MCP list should contain every enabled and exposed registry tool exactly once"
    );

    let mut mcp_names = BTreeSet::new();
    for mcp_tool in &mcp_list.tools {
        assert!(
            mcp_names.insert(mcp_tool.name.as_str()),
            "duplicate MCP tool {}",
            mcp_tool.name
        );
        let source = exposed_tools
            .get(mcp_tool.source_tool_id.as_str())
            .unwrap_or_else(|| panic!("missing registry source for {}", mcp_tool.name));
        assert_eq!(mcp_tool.name, source.id);
        assert_eq!(mcp_tool.title.as_deref(), Some(source.title.as_str()));
        assert_eq!(
            mcp_tool.description.as_deref(),
            Some(source.description.as_str())
        );
        assert_eq!(mcp_tool.input_schema, source.input_schema);
        assert_eq!(mcp_tool.risk, source.risk);
        assert_eq!(mcp_tool.confirmation, source.confirmation);
        assert_eq!(mcp_tool.audit, source.audit);
        assert_eq!(mcp_tool.origin, McpDefinitionOrigin::System);
        assert_eq!(mcp_tool.server_id, None);
        assert_eq!(
            mcp_tool.annotations.read_only_hint,
            Some(source.risk == ToolRiskLevel::Read)
        );
        assert_eq!(
            mcp_tool.annotations.destructive_hint,
            Some(source.risk == ToolRiskLevel::Destructive)
        );
        assert_eq!(
            mcp_tool.annotations.idempotent_hint,
            Some(source.risk == ToolRiskLevel::Read)
        );
        assert_eq!(
            mcp_tool.annotations.open_world_hint,
            Some(matches!(
                source.risk,
                ToolRiskLevel::Remote | ToolRiskLevel::Batch | ToolRiskLevel::Destructive
            ))
        );
    }
}

#[test]
fn mcp_manifest_skills_reference_available_registry_tools() {
    let registry = ToolRegistryService::new();
    let gateway = McpToolGateway::new();
    let tools = registry.list_tools();
    let manifest = gateway.manifest(&tools, &AiMcpSettings::default());
    let registry_tool_ids: BTreeSet<&str> = tools.iter().map(|tool| tool.id.as_str()).collect();
    let manifest_tool_ids: BTreeSet<&str> = manifest
        .tools
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect();

    assert_eq!(manifest.tools, gateway.list_tools(&tools));
    for skill in &manifest.skills {
        assert!(
            !skill.tool_ids.is_empty(),
            "manifest skill {} has no tools",
            skill.id
        );
        for tool_id in &skill.tool_ids {
            assert!(
                registry_tool_ids.contains(tool_id.as_str()),
                "manifest skill {} references unknown tool {}",
                skill.id,
                tool_id
            );
            assert!(
                manifest_tool_ids.contains(tool_id.as_str()),
                "manifest skill {} references unavailable MCP tool {}",
                skill.id,
                tool_id
            );
        }
    }
}
