use super::*;

pub(super) fn transports() -> Vec<McpTransportDefinition> {
    vec![
        McpTransportDefinition {
            id: Some("system.in_process_rmcp".to_owned()),
            kind: "in-process-rmcp".to_owned(),
            title: "应用内 rmcp 网关".to_owned(),
            status: McpTransportStatus::Enabled,
            command: None,
            endpoint: None,
            args: Vec::new(),
            env_keys: Vec::new(),
            header_keys: Vec::new(),
            description: "Kerminal Agent 在应用内部通过 rmcp 工具网关发现并建议受控工具调用。"
                .to_owned(),
            origin: McpDefinitionOrigin::System,
        },
        McpTransportDefinition {
            id: Some("system.stdio".to_owned()),
            kind: "stdio".to_owned(),
            title: "本地 stdio MCP Server".to_owned(),
            status: McpTransportStatus::Planned,
            command: Some("kerminal mcp serve --transport stdio".to_owned()),
            endpoint: None,
            args: Vec::new(),
            env_keys: Vec::new(),
            header_keys: Vec::new(),
            description: "后续用于外部本地 MCP Client 连接，当前尚未启用。".to_owned(),
            origin: McpDefinitionOrigin::System,
        },
        McpTransportDefinition {
            id: Some("system.local_http".to_owned()),
            kind: "streamable-http".to_owned(),
            title: "本地 Streamable HTTP MCP Server".to_owned(),
            status: McpTransportStatus::Enabled,
            command: Some("tool_registry_mcp_http_start".to_owned()),
            endpoint: Some("http://127.0.0.1:<dynamic>/mcp".to_owned()),
            args: Vec::new(),
            env_keys: Vec::new(),
            header_keys: Vec::new(),
            description:
                "通过 Tauri Command 按需启动；默认只绑定 loopback，实际 endpoint 由状态命令返回。"
                    .to_owned(),
            origin: McpDefinitionOrigin::System,
        },
    ]
}

pub(super) fn transports_with_custom(custom_mcp: &AiMcpSettings) -> Vec<McpTransportDefinition> {
    let mut definitions = transports();
    definitions.extend(custom_mcp.servers.iter().map(custom_transport_definition));
    definitions
}

pub(super) fn custom_transport_definition(
    server: &CustomMcpServerSetting,
) -> McpTransportDefinition {
    McpTransportDefinition {
        id: Some(server.id.clone()),
        kind: custom_transport_kind(server.transport).to_owned(),
        title: server.name.clone(),
        status: if server.enabled {
            McpTransportStatus::Enabled
        } else {
            McpTransportStatus::Disabled
        },
        command: (server.transport == CustomMcpTransportKind::Stdio)
            .then(|| server.command.clone())
            .filter(|command| !command.is_empty()),
        endpoint: (server.transport != CustomMcpTransportKind::Stdio)
            .then(|| server.url.clone())
            .filter(|url| !url.is_empty()),
        args: server.args.clone(),
        env_keys: server.env.iter().map(|item| item.name.clone()).collect(),
        header_keys: server
            .headers
            .iter()
            .map(|item| item.name.clone())
            .collect(),
        description: if server.description.is_empty() {
            "用户在设置中添加的自定义 MCP Server；工具来自 server discovery，可在该 server 下启停。"
                .to_owned()
        } else {
            server.description.clone()
        },
        origin: McpDefinitionOrigin::Custom,
    }
}

pub(super) fn custom_transport_kind(kind: CustomMcpTransportKind) -> &'static str {
    match kind {
        CustomMcpTransportKind::Stdio => "stdio",
        CustomMcpTransportKind::Http
        | CustomMcpTransportKind::Sse
        | CustomMcpTransportKind::WebSocket => "http",
    }
}

pub(super) fn origin_label(origin: McpDefinitionOrigin) -> &'static str {
    match origin {
        McpDefinitionOrigin::System => "system",
        McpDefinitionOrigin::Custom => "custom",
    }
}

pub(super) fn confirmation_policy_label(policy: ToolConfirmationPolicy) -> &'static str {
    match policy {
        ToolConfirmationPolicy::Auto => "auto",
        ToolConfirmationPolicy::Contextual => "contextual",
        ToolConfirmationPolicy::Always => "always",
    }
}

pub(super) fn risk_level_label(risk: ToolRiskLevel) -> &'static str {
    match risk {
        ToolRiskLevel::Read => "read",
        ToolRiskLevel::Write => "write",
        ToolRiskLevel::Remote => "remote",
        ToolRiskLevel::Batch => "batch",
        ToolRiskLevel::Destructive => "destructive",
    }
}

pub(super) fn security_policy() -> McpSecurityPolicy {
    McpSecurityPolicy {
        local_only: true,
        external_access_enabled: true,
        requires_kerminal_confirmation: false,
        audit_enabled: true,
        secrets_redacted: true,
        notes: vec![
            "Kerminal 可按需启动本机 Streamable HTTP MCP Server；默认只绑定 loopback。".to_owned(),
            "外部 MCP host 负责通过 hooks/permission 系统确认工具调用，Kerminal 不暴露私有 pending/confirm 协议。".to_owned(),
            "Kerminal 仍负责工具白名单、参数校验、本地安全设置和审计记录。".to_owned(),
            "终端输出、工具参数摘要和审计记录默认执行敏感信息脱敏。".to_owned(),
        ],
    }
}

pub(super) fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
