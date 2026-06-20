use super::*;

pub(super) fn prompts() -> Vec<McpPromptDefinition> {
    vec![
        prompt(
            "kerminal.agent.route",
            "选择 Agent Skill",
            "根据用户目标选择 Kerminal Agent skill、候选 MCP 工具和确认策略。",
            vec![
                argument("goal", "用户希望完成的目标。", true),
                argument(
                    "constraints",
                    "用户给出的约束、目标主机、路径或风险偏好。",
                    false,
                ),
            ],
        ),
        prompt(
            "kerminal.terminal.explain",
            "解释当前终端",
            "基于当前终端输出解释错误、状态或下一步排查方向。",
            vec![argument(
                "focus",
                "需要重点解释的命令、错误片段或文件名。",
                false,
            )],
        ),
        prompt(
            "kerminal.terminal.suggest",
            "建议下一步命令",
            "结合当前 shell、cwd、主机和最近输出建议下一步命令，但不自动执行。",
            vec![argument("goal", "用户希望完成的目标。", true)],
        ),
        prompt(
            "kerminal.remote.safe_ops",
            "远程操作安全计划",
            "为 SSH/SFTP/服务器信息操作生成先读后写、可确认、可审计的执行计划。",
            vec![
                argument("hostId", "已保存的远程主机 id。", true),
                argument("task", "远程操作目标。", true),
            ],
        ),
    ]
}

pub(super) fn prompt(
    name: &str,
    title: &str,
    description: &str,
    arguments: Vec<McpPromptArgument>,
) -> McpPromptDefinition {
    McpPromptDefinition {
        name: name.to_owned(),
        title: title.to_owned(),
        description: description.to_owned(),
        arguments,
    }
}

pub(super) fn argument(name: &str, description: &str, required: bool) -> McpPromptArgument {
    McpPromptArgument {
        name: name.to_owned(),
        description: description.to_owned(),
        required,
    }
}

pub(super) fn prompt_by_name(name: &str) -> Option<McpPromptDefinition> {
    prompts().into_iter().find(|prompt| prompt.name == name)
}

pub(super) fn validate_prompt_arguments(
    prompt: &McpPromptDefinition,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<()> {
    let missing = prompt
        .arguments
        .iter()
        .filter(|argument| argument.required)
        .filter(|argument| !has_prompt_argument(arguments, &argument.name))
        .map(|argument| argument.name.as_str())
        .collect::<Vec<_>>();

    if missing.is_empty() {
        return Ok(());
    }

    Err(AppError::InvalidInput(format!(
        "MCP prompt 参数缺失: {}",
        missing.join(", ")
    )))
}

pub(super) fn has_prompt_argument(arguments: &serde_json::Map<String, Value>, name: &str) -> bool {
    arguments.get(name).is_some_and(|value| match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        _ => true,
    })
}

pub(super) fn prompt_argument_text(
    arguments: &serde_json::Map<String, Value>,
    name: &str,
) -> Option<String> {
    arguments.get(name).and_then(|value| match value {
        Value::Null => None,
        Value::String(text) => {
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_owned())
        }
        next => Some(next.to_string()),
    })
}

pub(super) fn render_agent_route_prompt(
    arguments: &serde_json::Map<String, Value>,
    runtime: &McpPromptRenderRuntime,
) -> GetPromptResult {
    let goal = prompt_argument_text(arguments, "goal")
        .expect("goal is validated as a required MCP prompt argument");
    let constraints = prompt_argument_text(arguments, "constraints")
        .unwrap_or_else(|| "用户未提供额外约束。".to_owned());
    let skills = agent_skills_with_custom(&runtime.custom_mcp)
        .into_iter()
        .map(|skill| {
            format!(
                "- {id} / {title} [{origin}]: {when}\n  工具: {tools}\n  规则: {guidance}",
                id = skill.id,
                title = skill.title,
                origin = origin_label(skill.origin),
                when = skill.when_to_use,
                tools = skill.tool_ids.join(", "),
                guidance = skill.prompt_guidance
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let context = prompt_runtime_context_block(runtime);

    GetPromptResult::new(vec![PromptMessage::new_text(
        PromptMessageRole::User,
        format!(
            "你是 Kerminal Agent 的 skill 路由器。请根据用户目标选择合适的 skill 和候选 MCP 工具，只做规划，不执行操作。\n\
             \n\
             用户目标：{goal}\n\
             约束：{constraints}\n\
             \n\
             可用 skills：\n\
             {skills}\n\
             \n\
             输出要求：\n\
             - 先给出推荐 skill id 和原因。\n\
             - 列出 1-5 个候选 MCP 工具，说明用途、关键参数缺口和风险等级。\n\
             - 远程、写入、批量或破坏性操作必须说明需要 Kerminal 确认。\n\
             - 如果上下文不足，优先推荐只读工具或需要用户补充的信息。\n\
             \n\
             {context}"
        ),
    )])
    .with_description("根据用户目标选择 Kerminal Agent skill、候选 MCP 工具和确认策略。")
}

pub(super) fn render_terminal_explain_prompt(
    arguments: &serde_json::Map<String, Value>,
    runtime: &McpPromptRenderRuntime,
) -> GetPromptResult {
    let focus = prompt_argument_text(arguments, "focus")
        .unwrap_or_else(|| "当前终端最近输出、错误和状态".to_owned());
    let context = prompt_runtime_context_block(runtime);
    GetPromptResult::new(vec![PromptMessage::new_text(
        PromptMessageRole::User,
        format!(
            "你是 Kerminal 的终端解释助手。请基于当前终端上下文解释用户关注的问题。\n\
             \n\
             约束：\n\
             - 只解释和建议，不执行命令。\n\
             - 如果需要命令，给出候选命令、用途和风险提醒。\n\
             - 不要要求读取完整历史；只能基于已提供的最近输出和上下文。\n\
             \n\
             关注点：{focus}\n\
             \n\
             {context}"
        ),
    )])
    .with_description("基于当前终端输出解释错误、状态或下一步排查方向。")
}

pub(super) fn render_terminal_suggest_prompt(
    arguments: &serde_json::Map<String, Value>,
    runtime: &McpPromptRenderRuntime,
) -> GetPromptResult {
    let goal = prompt_argument_text(arguments, "goal")
        .expect("goal is validated as a required MCP prompt argument");
    let context = prompt_runtime_context_block(runtime);
    GetPromptResult::new(vec![PromptMessage::new_text(
        PromptMessageRole::User,
        format!(
            "你是 Kerminal 的开发终端助手。请结合当前终端上下文，为用户目标建议下一步命令。\n\
             \n\
             目标：{goal}\n\
             \n\
             输出要求：\n\
             - 给出 1-3 条候选命令或操作。\n\
             - 每条说明用途、预期结果和风险等级。\n\
             - 不自动执行任何命令；远程、批量或破坏性操作必须提醒用户走 Kerminal 确认策略。\n\
             - 如果上下文不足，先说明缺口，再给出低风险读取类命令。\n\
             \n\
             {context}"
        ),
    )])
    .with_description("结合当前 shell、cwd、主机和最近输出建议下一步命令。")
}

pub(super) fn render_remote_safe_ops_prompt(
    arguments: &serde_json::Map<String, Value>,
    runtime: &McpPromptRenderRuntime,
) -> GetPromptResult {
    let host_id = prompt_argument_text(arguments, "hostId")
        .expect("hostId is validated as a required MCP prompt argument");
    let task = prompt_argument_text(arguments, "task")
        .expect("task is validated as a required MCP prompt argument");
    let context = prompt_runtime_context_block(runtime);
    GetPromptResult::new(vec![PromptMessage::new_text(
        PromptMessageRole::User,
        format!(
            "你是 Kerminal 的远程操作安全规划助手。请为 SSH/SFTP/服务器信息操作生成安全执行计划。\n\
             \n\
             远程主机 ID：{host_id}\n\
             任务：{task}\n\
             \n\
             规划要求：\n\
             - 先读后写，优先使用只读工具确认环境和风险。\n\
             - 每一步都标注使用的 Kerminal 工具、目标、输入摘要、风险等级和是否需要用户确认。\n\
             - 删除、覆盖、停止服务、权限提升、批量操作必须单独列为高风险步骤。\n\
             - 不直接执行命令，不假设生产授权，不输出密钥或凭据。\n\
             - 给出失败回滚或人工复核建议。\n\
             \n\
             {context}"
        ),
    )])
    .with_description("为 SSH/SFTP/服务器信息操作生成先读后写、可确认、可审计的执行计划。")
}

pub(super) fn prompt_runtime_context_block(runtime: &McpPromptRenderRuntime) -> String {
    format!(
        "{}\n\n{}\n\n{}",
        application_context_prompt_block(runtime.application_context.as_ref()),
        terminal_context_prompt_block(runtime),
        custom_mcp_prompt_block(&runtime.custom_mcp),
    )
}

pub(super) fn custom_mcp_prompt_block(custom_mcp: &AiMcpSettings) -> String {
    let enabled_servers = custom_mcp
        .servers
        .iter()
        .filter(|server| server.enabled)
        .count();
    let enabled_tools = custom_mcp
        .servers
        .iter()
        .filter(|server| server.enabled)
        .flat_map(|server| server.tools.iter())
        .filter(|tool| tool.enabled)
        .count();
    let enabled_skill_dirs = custom_mcp
        .skill_directories
        .iter()
        .filter(|directory| directory.enabled)
        .count();
    let mut lines = vec![format!(
        "用户自定义 MCP / Skills：{} 个 server、{} 个已发现 tool、{} 个 skills 文件夹已启用。",
        enabled_servers, enabled_tools, enabled_skill_dirs
    )];

    if enabled_servers == 0 && enabled_tools == 0 && enabled_skill_dirs == 0 {
        lines.push("当前没有用户自定义 MCP 扩展。".to_owned());
    } else {
        lines.push(
            "自定义 MCP Server 通过 stdio 或 Streamable HTTP 配置；工具必须来自 server discovery，不能手工发明。"
                .to_owned(),
        );
        for server in custom_mcp
            .servers
            .iter()
            .filter(|server| server.enabled)
            .take(8)
        {
            lines.push(format!(
                "- server {id} / {name}: {transport}",
                id = server.id,
                name = server.name,
                transport = custom_transport_kind(server.transport),
            ));
        }
        for server in custom_mcp.servers.iter().filter(|server| server.enabled) {
            for tool in server.tools.iter().filter(|tool| tool.enabled).take(12) {
                lines.push(format!(
                    "- tool {id}: server {server}; upstream {upstream}; 风险 {risk}; 确认 {confirmation}",
                    id = custom_tool_id(server, tool),
                    server = server.id,
                    upstream = tool.name,
                    risk = risk_level_label(tool.risk),
                    confirmation = confirmation_policy_label(tool.confirmation),
                ));
            }
        }
    }

    lines.join("\n")
}

pub(super) fn application_context_prompt_block(
    context: Option<&AiApplicationContextRequest>,
) -> String {
    let Some(context) = context else {
        return "当前应用上下文不可用：本次没有提供 active tab、focused pane 和选中主机摘要。"
            .to_owned();
    };

    let mut lines = vec![
        "当前应用上下文：Kerminal Agent 是当前 Kerminal 应用的操作层；MCP 工具是可受控调用的手脚。"
            .to_owned(),
        format!(
            "- 当前右侧工具：{}",
            context.active_tool_id.as_deref().unwrap_or("ai")
        ),
    ];

    if let Some(tab) = context.active_tab.as_ref() {
        lines.push(format!(
            "- 当前 tab：{} ({})，主机 {}",
            tab.title,
            tab.id,
            tab.machine_id.as_deref().unwrap_or("-")
        ));
    }
    if let Some(pane) = context.focused_pane.as_ref() {
        lines.push(format!(
            "- 当前 pane：{} ({})，mode {}，status {}，session {}，主机 {}",
            pane.title,
            pane.id,
            pane.mode,
            pane.status,
            pane.session_id.as_deref().unwrap_or("-"),
            pane.machine_id.as_deref().unwrap_or("-")
        ));
    }
    if let Some(machine) = context.selected_machine.as_ref() {
        lines.push(format!(
            "- 当前主机：{} ({})，kind {}，status {}，production {}",
            machine.name,
            machine.id,
            machine.kind,
            machine.status,
            match machine.production {
                Some(true) => "是",
                Some(false) => "否",
                None => "-",
            }
        ));
    }

    lines.join("\n")
}

pub(super) fn terminal_context_prompt_block(runtime: &McpPromptRenderRuntime) -> String {
    let Some(snapshot) = runtime.terminal_context.as_ref() else {
        return format!(
            "当前终端上下文不可用：{}",
            runtime
                .terminal_context_error
                .clone()
                .unwrap_or_else(|| "当前没有活动终端 session，无法生成终端上下文。".to_owned())
        );
    };

    let tab = snapshot.source.tab_title.as_deref().unwrap_or("-");
    let pane = snapshot.source.pane_title.as_deref().unwrap_or("-");
    let machine = snapshot.source.machine_name.as_deref().unwrap_or("-");
    let machine_kind = snapshot.source.machine_kind.as_deref().unwrap_or("-");
    let cwd = snapshot.session.cwd.as_deref().unwrap_or("-");
    let truncated = if snapshot.output.truncated {
        "，已截断"
    } else {
        ""
    };
    let redacted = if snapshot.redacted {
        "，已脱敏"
    } else {
        ""
    };
    let output = if snapshot.output.data.trim().is_empty() {
        "当前 session 暂无可读取输出。"
    } else {
        snapshot.output.data.as_str()
    };

    format!(
        "当前终端上下文：\n\
         - Tab：{tab}\n\
         - Pane：{pane}\n\
         - 主机：{machine}（{machine_kind}）\n\
         - Session：{}\n\
         - Shell：{}\n\
         - CWD：{cwd}\n\
         - 尺寸：{}x{}\n\
         - 最近输出：{} / {} bytes{truncated}{redacted}\n\
         \n\
         ```text\n\
         {output}\n\
         ```",
        snapshot.session.id,
        snapshot.session.shell,
        snapshot.session.cols,
        snapshot.session.rows,
        snapshot.output.captured_bytes,
        snapshot.output.max_bytes,
    )
}

pub(super) fn to_prompt_message_view(message: PromptMessage) -> McpPromptMessage {
    let role = match message.role {
        PromptMessageRole::User => "user",
        PromptMessageRole::Assistant => "assistant",
    }
    .to_owned();

    match message.content {
        PromptMessageContent::Text { text } => McpPromptMessage {
            role,
            content_type: "text".to_owned(),
            text,
        },
        PromptMessageContent::Image { .. } => McpPromptMessage {
            role,
            content_type: "image".to_owned(),
            text: "[MCP image content omitted in local prompt preview]".to_owned(),
        },
        PromptMessageContent::Resource { .. } => McpPromptMessage {
            role,
            content_type: "resource".to_owned(),
            text: "[MCP embedded resource content omitted in local prompt preview]".to_owned(),
        },
        PromptMessageContent::ResourceLink { .. } => McpPromptMessage {
            role,
            content_type: "resource_link".to_owned(),
            text: "[MCP resource link content omitted in local prompt preview]".to_owned(),
        },
    }
}
