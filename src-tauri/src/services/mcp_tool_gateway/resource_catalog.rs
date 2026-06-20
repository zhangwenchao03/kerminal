use super::*;

pub(super) fn resources() -> Vec<McpResourceDefinition> {
    vec![
        resource(
            AGENT_PROFILE_RESOURCE_URI,
            "agent-profile",
            "Agent 身份",
            "Kerminal Agent 的名称、角色、能力摘要和系统级行为边界。",
            "application/json",
            false,
        ),
        resource(
            AGENT_SKILLS_RESOURCE_URI,
            "agent-skills",
            "Agent Skills 目录",
            "用于把用户目标路由到 MCP 工具的 skills catalog，并给出工具覆盖校验。",
            "application/json",
            false,
        ),
        resource(
            AGENT_SYSTEM_PROMPT_RESOURCE_URI,
            "agent-system-prompt",
            "Agent 系统 Prompt",
            "当前实际用于 Kerminal Agent LLM preamble 的系统 prompt。",
            "application/json",
            false,
        ),
        resource(
            APPLICATION_CONTEXT_RESOURCE_URI,
            "application-context-current",
            "当前应用上下文",
            "当前右侧工具、active tab、focused pane 和选中主机的工作台摘要。",
            "application/json",
            true,
        ),
        resource(
            TOOL_REGISTRY_RESOURCE_URI,
            "tool-registry",
            "工具目录",
            "当前可供 AI 和 MCP 网关发现的 Kerminal 工具定义、风险等级和确认策略。",
            "application/json",
            false,
        ),
        resource(
            TERMINAL_CONTEXT_RESOURCE_URI,
            "terminal-context-current",
            "当前终端上下文",
            "当前 tab、pane、session、shell、cwd 和最近输出的脱敏快照。",
            "application/json",
            true,
        ),
        resource(
            AI_AUDIT_SUMMARY_RESOURCE_URI,
            "ai-audit-summary",
            "AI 工具审计摘要",
            "最近 AI 工具调用的已脱敏审计记录摘要。",
            "application/json",
            true,
        ),
        resource(
            AI_POLICY_RESOURCE_URI,
            "ai-policy",
            "AI 安全策略",
            "当前 AI 上下文、远程工具确认和破坏性工具限制策略。",
            "application/json",
            true,
        ),
        resource(
            CUSTOM_MCP_RESOURCE_URI,
            "custom-mcp",
            "用户自定义 MCP / Skills",
            "用户在设置中声明的 MCP Servers、discovered tools 和 skills 文件夹；只返回脱敏后的配置摘要。",
            "application/json",
            true,
        ),
    ]
}

pub(super) fn resource(
    uri: &str,
    name: &str,
    title: &str,
    description: &str,
    mime_type: &str,
    dynamic: bool,
) -> McpResourceDefinition {
    McpResourceDefinition {
        uri: uri.to_owned(),
        name: name.to_owned(),
        title: title.to_owned(),
        description: description.to_owned(),
        mime_type: mime_type.to_owned(),
        dynamic,
    }
}

pub(super) fn resource_by_uri(uri: &str) -> Option<McpResourceDefinition> {
    resources().into_iter().find(|resource| resource.uri == uri)
}

pub(super) fn agent_skill_detail_id(uri: &str) -> Option<&str> {
    uri.strip_prefix(AGENT_SKILL_DETAIL_RESOURCE_URI_PREFIX)
        .map(str::trim)
        .filter(|skill_id| !skill_id.is_empty())
}

pub(super) fn agent_skill_detail_resource_definition(skill_id: &str) -> McpResourceDefinition {
    resource(
        &format!("{AGENT_SKILL_DETAIL_RESOURCE_URI_PREFIX}{skill_id}"),
        "agent-skill-detail",
        "Agent Skill 详情",
        "按 skill id 读取用户自定义标准 SKILL.md 的完整说明正文和文件夹能力摘要。",
        "application/json",
        true,
    )
}

pub(super) fn agent_profile_resource() -> Value {
    json!({
        "protocol": "kerminal-mcp/resource/agent-profile",
        "agent": agent_profile(),
    })
}

pub(super) fn agent_skills_resource(
    definitions: &[ToolDefinition],
    custom_mcp: &AiMcpSettings,
    gateway: &McpToolGateway,
) -> Value {
    let custom_catalog = custom_skill_catalog(custom_mcp);
    let mut skills = agent_skills();
    skills.extend(custom_catalog.definitions());
    let mcp_tools = gateway.list_tools_with_custom(definitions, custom_mcp);
    let registered_tool_ids = mcp_tools
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<BTreeSet<_>>();
    let exposed_tool_ids = mcp_tools
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<BTreeSet<_>>();
    let referenced_tool_ids = skills
        .iter()
        .flat_map(|skill| skill.tool_ids.iter().map(String::as_str))
        .collect::<BTreeSet<_>>();
    let missing_tool_ids = referenced_tool_ids
        .iter()
        .filter(|tool_id| !registered_tool_ids.contains(**tool_id))
        .copied()
        .collect::<Vec<_>>();
    let unavailable_tool_ids = referenced_tool_ids
        .iter()
        .filter(|tool_id| registered_tool_ids.contains(**tool_id))
        .filter(|tool_id| !exposed_tool_ids.contains(**tool_id))
        .copied()
        .collect::<Vec<_>>();

    json!({
        "protocol": "kerminal-mcp/resource/agent-skills",
        "skillCount": skills.len(),
        "skills": skills,
        "customSkillCount": custom_catalog.entries.len(),
        "customSkillDirectories": custom_skill_directories_resource(&custom_catalog),
        "customSkills": custom_skills_resource(&custom_catalog),
        "toolCoverage": {
            "referencedToolCount": referenced_tool_ids.len(),
            "missingToolIds": missing_tool_ids,
            "unavailableToolIds": unavailable_tool_ids,
        },
    })
}

pub(super) fn custom_skill_directories_resource(catalog: &SkillCatalog) -> Vec<Value> {
    catalog
        .directories
        .iter()
        .map(|directory| {
            json!({
                "id": directory.id.as_str(),
                "configuredPath": directory.configured_path.as_str(),
                "resolvedPath": directory.resolved_path.display().to_string(),
                "enabled": directory.enabled,
                "exists": directory.exists,
                "skillCount": directory.skill_count,
            })
        })
        .collect()
}

pub(super) fn custom_skills_resource(catalog: &SkillCatalog) -> Vec<Value> {
    catalog
        .entries
        .iter()
        .map(|entry| {
            json!({
                "id": entry.definition.id.as_str(),
                "title": entry.definition.title.as_str(),
                "description": entry.definition.description.as_str(),
                "whenToUse": entry.definition.when_to_use.as_str(),
                "directoryId": entry.directory_id.as_str(),
                "configuredRoot": entry.configured_root.as_str(),
                "resolvedRoot": entry.resolved_root.display().to_string(),
                "directory": entry.directory.display().to_string(),
                "skillPath": entry.skill_path.display().to_string(),
                "folderName": entry.folder_name.as_str(),
                "instructionPreview": entry.instruction_preview.as_str(),
                "instructionChars": entry.instruction_chars,
                "previewTruncated": entry.preview_truncated,
                "hasScripts": entry.has_scripts,
                "hasReferences": entry.has_references,
                "hasAssets": entry.has_assets,
            })
        })
        .collect()
}

pub(super) fn agent_skill_detail_resource(
    skill_id: &str,
    custom_mcp: &AiMcpSettings,
) -> AppResult<Value> {
    let catalog = custom_skill_catalog(custom_mcp);
    let entry = catalog
        .entries
        .iter()
        .find(|entry| entry.definition.id == skill_id)
        .ok_or_else(|| AppError::NotFound(format!("未知自定义 Agent Skill: {skill_id}")))?;
    let content = fs::read_to_string(&entry.skill_path)?;
    let instructions = skill_instructions_from_markdown(&content);
    let instruction_chars = instructions.chars().count();
    let limited_instructions = instructions
        .chars()
        .take(MAX_SKILL_DETAIL_INSTRUCTION_CHARS)
        .collect::<String>();

    Ok(json!({
        "protocol": "kerminal-mcp/resource/agent-skill-detail",
        "skill": &entry.definition,
        "directoryId": entry.directory_id.as_str(),
        "configuredRoot": entry.configured_root.as_str(),
        "resolvedRoot": entry.resolved_root.display().to_string(),
        "directory": entry.directory.display().to_string(),
        "skillPath": entry.skill_path.display().to_string(),
        "folderName": entry.folder_name.as_str(),
        "instructions": limited_instructions,
        "instructionChars": instruction_chars,
        "instructionsTruncated": instruction_chars > MAX_SKILL_DETAIL_INSTRUCTION_CHARS,
        "maxInstructionChars": MAX_SKILL_DETAIL_INSTRUCTION_CHARS,
        "hasScripts": entry.has_scripts,
        "hasReferences": entry.has_references,
        "hasAssets": entry.has_assets,
        "executionNotes": [
            "该资源用于标准 Agent Skills 的渐进披露：先读取 skills catalog 判断是否适用，再按 skill id 读取完整 SKILL.md 正文。",
            "scripts、references 和 assets 只给出目录存在性；实际执行仍只能通过已暴露 MCP 工具或宿主允许的文件读取能力完成。",
            "自定义 skill 不会绕过 Kerminal allowlist、策略验证、审计或外部 MCP host 的 hooks/permission。"
        ],
    }))
}

pub(super) fn agent_system_prompt_resource() -> Value {
    json!({
        "protocol": "kerminal-mcp/resource/agent-system-prompt",
        "agentId": agent_profile().id,
        "prompt": agent_system_prompt(),
    })
}

pub(super) fn application_context_resource(runtime: McpResourceReadRuntime) -> Value {
    match runtime.application_context {
        Some(context) => json!({
            "protocol": "kerminal-mcp/resource/application-context",
            "available": true,
            "context": context,
            "notes": [
                "Kerminal Agent 是当前应用的操作层；应用上下文是感知，MCP 工具是可受控调用的手脚。",
                "该资源只返回前端提供的当前工作台摘要，不包含凭据、完整终端输出或远程文件内容。"
            ],
        }),
        None => json!({
            "protocol": "kerminal-mcp/resource/application-context",
            "available": false,
            "reason": "本次没有提供 active tab/pane/machine 摘要。",
        }),
    }
}

pub(super) fn terminal_context_resource(runtime: McpResourceReadRuntime) -> Value {
    match runtime.terminal_context {
        Some(snapshot) => json!({
            "protocol": "kerminal-mcp/resource/terminal-context",
            "available": true,
            "snapshot": snapshot,
        }),
        None => json!({
            "protocol": "kerminal-mcp/resource/terminal-context",
            "available": false,
            "reason": runtime
                .terminal_context_error
                .unwrap_or_else(|| "当前没有活动终端 session，无法生成终端上下文。".to_owned()),
        }),
    }
}

pub(super) fn audit_summary_resource(
    runtime: McpResourceReadRuntime,
    requested_limit: Option<usize>,
) -> Value {
    json!({
        "protocol": "kerminal-mcp/resource/ai-audit-summary",
        "count": runtime.audit_records.len(),
        "limit": requested_limit,
        "records": runtime.audit_records,
    })
}

pub(super) fn ai_policy_resource(runtime: McpResourceReadRuntime) -> Value {
    json!({
        "protocol": "kerminal-mcp/resource/ai-policy",
        "policy": runtime.ai_policy.unwrap_or_default(),
        "notes": [
            "AI 上下文只按策略读取最近输出，不默认包含完整终端历史。",
            "远程和破坏性工具仍由 Kerminal 确认策略控制。",
            "资源内容只返回设置摘要，不包含 LLM API key 或 SSH 凭据。"
        ],
    })
}

pub(super) fn custom_mcp_resource(runtime: McpResourceReadRuntime) -> Value {
    let custom_mcp = runtime.custom_mcp;
    let servers = custom_mcp
        .servers
        .iter()
        .map(|server| {
            let tools = server
                .tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "id": custom_tool_id(server, tool),
                        "title": tool.title,
                        "description": tool.description,
                        "enabled": tool.enabled,
                        "risk": tool.risk,
                        "confirmation": tool.confirmation,
                        "audit": tool.audit,
                        "inputSchema": tool.input_schema,
                        "discoveredAt": tool.discovered_at,
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "id": server.id,
                "name": server.name,
                "description": server.description,
                "enabled": server.enabled,
                "transport": custom_transport_kind(server.transport),
                "command": if server.command.is_empty() { Value::Null } else { Value::String(server.command.clone()) },
                "args": server.args,
                "url": if server.url.is_empty() { Value::Null } else { Value::String(server.url.clone()) },
                "bearerTokenEnvVar": if server.bearer_token_env_var.is_empty() { Value::Null } else { Value::String(server.bearer_token_env_var.clone()) },
                "envKeys": server.env.iter().map(|item| item.name.clone()).collect::<Vec<_>>(),
                "headerKeys": server.headers.iter().map(|item| item.name.clone()).collect::<Vec<_>>(),
                "toolCount": server.tools.len(),
                "enabledToolCount": server.tools.iter().filter(|tool| tool.enabled).count(),
                "lastDiscoveredAt": server.last_discovered_at,
                "lastDiscoveryError": server.last_discovery_error,
                "tools": tools,
            })
        })
        .collect::<Vec<_>>();
    let skill_directories = custom_mcp
        .skill_directories
        .iter()
        .map(|directory| {
            json!({
                "id": directory.id,
                "path": directory.path,
                "enabled": directory.enabled,
                "exists": expand_user_path(&directory.path).is_dir(),
            })
        })
        .collect::<Vec<_>>();
    let tool_count = custom_mcp
        .servers
        .iter()
        .map(|server| server.tools.len())
        .sum::<usize>();
    let enabled_tool_count = custom_mcp
        .servers
        .iter()
        .filter(|server| server.enabled)
        .flat_map(|server| server.tools.iter())
        .filter(|tool| tool.enabled)
        .count();

    json!({
        "protocol": "kerminal-mcp/resource/custom-mcp",
        "serverCount": custom_mcp.servers.len(),
        "toolCount": tool_count,
        "skillDirectoryCount": custom_mcp.skill_directories.len(),
        "enabled": {
            "servers": custom_mcp.servers.iter().filter(|server| server.enabled).count(),
            "tools": enabled_tool_count,
            "skillDirectories": custom_mcp.skill_directories.iter().filter(|directory| directory.enabled).count(),
        },
        "servers": servers,
        "skillDirectories": skill_directories,
        "notes": [
            "env 和 header 只暴露 key 名称，不返回 value。",
            "MCP tools 必须由 server discovery 写入缓存；设置页不允许手填 tool schema。",
            "自定义 skills 使用文件夹 + SKILL.md 约定，扫描失败不会阻断系统 MCP manifest。"
        ],
    })
}
