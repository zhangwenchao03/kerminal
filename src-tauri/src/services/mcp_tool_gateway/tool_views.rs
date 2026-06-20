use super::*;

pub(super) fn enabled_mcp_tools(definitions: &[ToolDefinition]) -> Vec<ToolDefinition> {
    definitions
        .iter()
        .filter(|definition| definition.enabled && definition.exposed_to_mcp)
        .cloned()
        .collect()
}

/// 把 Kerminal Tool Registry 定义转换为标准 MCP tool 描述。
pub fn tool_definition_to_rmcp_tool(definition: &ToolDefinition) -> Tool {
    let annotations = annotations_for(definition);
    Tool::new(
        definition.id.clone(),
        definition.description.clone(),
        object(definition.input_schema.clone()),
    )
    .with_title(definition.title.clone())
    .with_annotations(annotations)
}

pub(super) fn annotations_for(definition: &ToolDefinition) -> ToolAnnotations {
    ToolAnnotations::with_title(definition.title.clone())
        .read_only(definition.risk == ToolRiskLevel::Read)
        .destructive(definition.risk == ToolRiskLevel::Destructive)
        .idempotent(definition.risk == ToolRiskLevel::Read)
        .open_world(matches!(
            definition.risk,
            ToolRiskLevel::Remote | ToolRiskLevel::Batch | ToolRiskLevel::Destructive
        ))
}

pub(super) fn to_mcp_view(tool: &Tool, definition: &ToolDefinition) -> McpToolDefinition {
    let annotations = tool.annotations.as_ref();
    McpToolDefinition {
        name: tool.name.to_string(),
        title: tool.title.clone(),
        description: tool.description.as_ref().map(ToString::to_string),
        input_schema: Value::Object((*tool.input_schema).clone()),
        source_tool_id: definition.id.clone(),
        risk: definition.risk,
        confirmation: definition.confirmation,
        audit: definition.audit,
        annotations: McpToolAnnotations {
            read_only_hint: annotations.and_then(|value| value.read_only_hint),
            destructive_hint: annotations.and_then(|value| value.destructive_hint),
            idempotent_hint: annotations.and_then(|value| value.idempotent_hint),
            open_world_hint: annotations.and_then(|value| value.open_world_hint),
        },
        origin: McpDefinitionOrigin::System,
        server_id: None,
    }
}

pub(super) fn custom_tool_view(
    server: &CustomMcpServerSetting,
    tool: &CustomMcpServerToolSetting,
) -> Option<McpToolDefinition> {
    if !tool.enabled {
        return None;
    }
    let tool_id = custom_tool_id(server, tool);
    Some(McpToolDefinition {
        name: tool_id.clone(),
        title: Some(if tool.title.is_empty() {
            tool.name.clone()
        } else {
            tool.title.clone()
        }),
        description: Some(format!(
            "{}\n\n来源 MCP Server：{}；原始 tool name：{}。工具由 server discovery 得到；Kerminal 负责启停、allowlist、策略验证和审计，外部 Streamable HTTP MCP host 应使用自身 hooks/permission 做准入控制。",
            tool.description, server.name, tool.name
        )),
        input_schema: tool.input_schema.clone(),
        source_tool_id: tool.name.clone(),
        risk: tool.risk,
        confirmation: tool.confirmation,
        audit: tool.audit,
        annotations: McpToolAnnotations {
            read_only_hint: Some(tool.risk == ToolRiskLevel::Read),
            destructive_hint: Some(tool.risk == ToolRiskLevel::Destructive),
            idempotent_hint: Some(tool.risk == ToolRiskLevel::Read),
            open_world_hint: Some(true),
        },
        origin: McpDefinitionOrigin::Custom,
        server_id: Some(server.id.clone()),
    })
}

pub(super) fn custom_tool_id(
    server: &CustomMcpServerSetting,
    tool: &CustomMcpServerToolSetting,
) -> String {
    custom_mcp_tool_id(&server.id, &tool.name)
}

/// 返回自定义 MCP Server 已发现 tool 的 Kerminal 侧稳定 tool id。
pub fn custom_mcp_tool_id(server_id: &str, tool_name: &str) -> String {
    format!("{server_id}.{tool_name}")
}

/// 把用户自定义 MCP Server 已发现的工具转换为 AI 可审批执行的 ToolDefinition。
pub fn custom_mcp_tool_definitions(custom_mcp: &AiMcpSettings) -> Vec<ToolDefinition> {
    custom_mcp
        .servers
        .iter()
        .filter(|server| server.enabled)
        .flat_map(|server| {
            server
                .tools
                .iter()
                .filter(|tool| tool.enabled)
                .map(|tool| {
                    let title = if tool.title.is_empty() {
                        tool.name.clone()
                    } else {
                        tool.title.clone()
                    };
                    ToolDefinition {
                        id: custom_tool_id(server, tool),
                        title,
                        description: format!(
                            "调用自定义 MCP Server `{}` 的 tool `{}`。该工具来自 server discovery；Kerminal 负责 allowlist、策略验证和审计，外部 Streamable HTTP MCP host 应先用自身 hooks/permission 审批。",
                            server.name, tool.name
                        ),
                        category: ToolCategory::Connection,
                        risk: tool.risk,
                        confirmation: tool.confirmation,
                        audit: tool.audit,
                        enabled: true,
                        exposed_to_mcp: true,
                        input_schema: tool.input_schema.clone(),
                    }
                })
        })
        .collect()
}
