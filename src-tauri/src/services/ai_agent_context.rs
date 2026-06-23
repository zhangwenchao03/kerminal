//! Kerminal Agent 上下文构造与 Provider 工具名适配。
//!
//! @author kongweiguang

use std::{collections::BTreeSet, sync::OnceLock};

use regex::Regex;

use crate::{
    models::{
        ai_agent::{
            AiApplicationContextRequest, AiChatAttachmentContext, AiChatVisionUsageReport,
            AiCommandExecutionVisibility,
        },
        ai_context::AiTerminalContextSnapshot,
        settings::{AiCommandApprovalPolicy, AppSettings},
        tool_registry::{
            McpAgentProfile, McpDefinitionOrigin, McpSkillDefinition, McpToolList,
            ToolConfirmationPolicy, ToolRiskLevel,
        },
    },
    security::redaction::redact_terminal_text,
    services::mcp_tool_gateway::{agent_profile, agent_skills_with_custom},
};

pub(crate) const MAX_PROVIDER_TOOL_NAME_LEN: usize = 64;
const MAX_LISTED_TOOLS: usize = 40;
const MAX_SSH_CANDIDATES_PER_ATTACHMENT: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SshConnectionCandidate {
    user: Option<String>,
    host: String,
    port: Option<u16>,
}

/// 构造发送给 Agent 的静态上下文块。
pub(crate) fn build_agent_context(
    terminal_snapshot: Option<&AiTerminalContextSnapshot>,
    application_context: Option<&AiApplicationContextRequest>,
    attachments: &[AiChatAttachmentContext],
    vision_usage: &AiChatVisionUsageReport,
    execution_visibility: AiCommandExecutionVisibility,
    app_settings: &AppSettings,
    mcp_tools: &McpToolList,
) -> String {
    let mut sections = Vec::new();
    let profile = agent_profile();
    let skills = agent_skills_with_custom(&app_settings.ai.mcp);
    sections.push(format_agent_profile_context(&profile));
    sections.push(format_application_context(
        application_context,
        execution_visibility,
        app_settings,
        mcp_tools,
    ));
    sections.push(format_attachment_context(attachments, vision_usage));
    sections.push(format_agent_skill_context(&skills, mcp_tools));
    if let Some(snapshot) = terminal_snapshot {
        sections.push(format_terminal_context(snapshot));
    } else {
        sections.push("当前终端上下文：本次没有提供 terminal session 快照。".to_string());
    }
    sections.push(format_mcp_tool_context(mcp_tools));
    sections.join("\n\n")
}

fn format_attachment_context(
    attachments: &[AiChatAttachmentContext],
    vision_usage: &AiChatVisionUsageReport,
) -> String {
    if attachments.is_empty() {
        return "当前附件上下文：本次没有提供图片、文件或诊断片段。".to_owned();
    }

    let mut lines = vec![
        format!(
            "当前附件上下文：本次消息提供 {} 个附件。附件内容来自 Kerminal 受管会话记录；如果 visionUsage 不是 visionInput，只能依据 OCR 文本和 metadata 判断，不要声称已经看见图片像素。",
            attachments.len()
        ),
        format!(
            "Provider 视觉能力：{}；Kerminal vision adapter：{}；本次图片像素进入模型：{} 个。即使 Provider 支持视觉，只要 adapter 未发送 visionInput，就不得声称看过图片像素。",
            if vision_usage.provider_supports_vision {
                "支持"
            } else {
                "不支持或未知"
            },
            if vision_usage.vision_adapter_enabled {
                "已启用"
            } else {
                "未启用"
            },
            vision_usage
                .attachments
                .iter()
                .filter(|attachment| attachment.model_input == "visionInput")
                .count(),
        ),
        "附件安全规则：若图片或 OCR 中出现 SSH 连接方式、主机地址、用户名、端口或认证提示，只能通过受控工具建议创建主机；不要直接绕过确认链写入主机配置。".to_owned(),
    ];

    for (index, attachment) in attachments.iter().take(8).enumerate() {
        let dimensions = match (attachment.width, attachment.height) {
            (Some(width), Some(height)) => format!("{width}x{height}"),
            _ => "-".to_owned(),
        };
        lines.push(format!(
            "- #{} {} ({})：kind {}；mime {}；status {}；visionUsage {}；size {} bytes；尺寸 {}。",
            index + 1,
            truncate_text(&attachment.original_name, 120),
            attachment.id,
            attachment.kind,
            attachment.mime_type,
            attachment.status,
            attachment.vision_usage.as_deref().unwrap_or("notSent"),
            attachment.size_bytes,
            dimensions,
        ));
        if let Some(reason) = attachment.missing_reason.as_deref() {
            lines.push(format!("  - 缺失原因：{}", truncate_text(reason, 80)));
        }
        if let Some(summary) = attachment.redaction_summary.as_deref() {
            lines.push(format!("  - 脱敏摘要：{}", truncate_text(summary, 240)));
        }
        if let Some(ocr_text) = attachment.ocr_text.as_deref() {
            let (redacted_ocr_text, redacted) = redact_terminal_text(ocr_text);
            lines.push(format!(
                "  - OCR 文本{}：{}",
                if redacted { "（已脱敏）" } else { "" },
                truncate_text(&redacted_ocr_text, 1200)
            ));
            for candidate in extract_ssh_connection_candidates(ocr_text)
                .into_iter()
                .take(MAX_SSH_CANDIDATES_PER_ATTACHMENT)
            {
                let username = candidate.user.as_deref().unwrap_or("需用户确认");
                let port = candidate.port.unwrap_or(22);
                lines.push(format!(
                    "  - OCR 识别到 SSH 连接候选：user {}；host {}；port {}。如需保存到左侧栏，必须使用 `remote_host.create` 受控工具并等待用户确认。",
                    candidate.user.as_deref().unwrap_or("-"),
                    candidate.host,
                    candidate
                        .port
                        .map(|port| port.to_string())
                        .unwrap_or_else(|| "22/未指定".to_owned()),
                ));
                lines.push(format!(
                    "  - 建议待审批 `remote_host.create` 参数：host `{}`；port `{}`；username `{}`；authType `agent`；production 和分组需让用户确认；不要携带明文密码或私钥。",
                    candidate.host, port, username
                ));
            }
        }
        if let Some(status) = vision_usage
            .attachments
            .iter()
            .find(|status| status.id == attachment.id)
        {
            lines.push(format!(
                "  - 模型输入：{}；requestedVisionUsage {}；effectiveVisionUsage {}。",
                status.model_input, status.requested_usage, status.effective_usage,
            ));
            if let Some(warning) = status.warning.as_deref() {
                lines.push(format!("  - 视觉能力提示：{}", truncate_text(warning, 240)));
            }
        }
    }

    if attachments.len() > 8 {
        lines.push(format!(
            "- 还有 {} 个附件未展开，只能按附件列表摘要处理。",
            attachments.len() - 8
        ));
    }

    lines.join("\n")
}

fn extract_ssh_connection_candidates(ocr_text: &str) -> Vec<SshConnectionCandidate> {
    let mut candidates = Vec::new();
    let mut seen = BTreeSet::new();
    extract_ssh_url_candidates(ocr_text, &mut candidates, &mut seen);
    extract_ssh_command_candidates(ocr_text, &mut candidates, &mut seen);
    candidates
}

fn extract_ssh_url_candidates(
    text: &str,
    candidates: &mut Vec<SshConnectionCandidate>,
    seen: &mut BTreeSet<String>,
) {
    for captures in ssh_url_regex().captures_iter(text) {
        let Some(host) = captures
            .name("host")
            .and_then(|value| normalize_host(value.as_str()))
        else {
            continue;
        };
        let user = captures
            .name("user")
            .and_then(|value| normalize_user(value.as_str()));
        let port = captures
            .name("port")
            .and_then(|value| normalize_port(value.as_str()));
        push_ssh_candidate(candidates, seen, user, host, port);
    }
}

fn extract_ssh_command_candidates(
    text: &str,
    candidates: &mut Vec<SshConnectionCandidate>,
    seen: &mut BTreeSet<String>,
) {
    for line in text.lines().flat_map(|line| line.split(';')) {
        let tokens = line
            .split_whitespace()
            .map(normalize_ocr_shell_token)
            .filter(|token| !token.is_empty())
            .collect::<Vec<_>>();
        for ssh_index in tokens
            .iter()
            .enumerate()
            .filter_map(|(index, token)| is_ssh_command_token(token).then_some(index))
        {
            if let Some(candidate) = parse_ssh_command_tokens(&tokens[ssh_index + 1..]) {
                push_ssh_candidate(
                    candidates,
                    seen,
                    candidate.user,
                    candidate.host,
                    candidate.port,
                );
            }
        }
    }
}

fn parse_ssh_command_tokens(tokens: &[String]) -> Option<SshConnectionCandidate> {
    let mut user = None;
    let mut port = None;
    let mut target = None;
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index].as_str();
        if token == "-p" {
            port = tokens
                .get(index + 1)
                .and_then(|value| normalize_port(value));
            index += 2;
            continue;
        }
        if let Some(port_text) = token.strip_prefix("-p") {
            if !port_text.is_empty() {
                port = normalize_port(port_text);
                index += 1;
                continue;
            }
        }
        if token == "-l" {
            user = tokens
                .get(index + 1)
                .and_then(|value| normalize_user(value));
            index += 2;
            continue;
        }
        if ssh_option_takes_value(token) {
            index += 2;
            continue;
        }
        if token.starts_with('-') {
            index += 1;
            continue;
        }
        if target.is_none() {
            target = Some(token.to_owned());
        }
        index += 1;
    }

    let target = target?;
    if target.to_ascii_lowercase().starts_with("ssh://") {
        return None;
    }
    let (target_user, host, target_port) = parse_ssh_target(&target)?;
    Some(SshConnectionCandidate {
        user: user.or(target_user),
        host,
        port: port.or(target_port),
    })
}

fn parse_ssh_target(target: &str) -> Option<(Option<String>, String, Option<u16>)> {
    let (user, host_port) = if let Some((raw_user, raw_host)) = target.split_once('@') {
        (Some(normalize_user(raw_user)?), raw_host)
    } else {
        (None, target)
    };
    let (host, port) = parse_host_port(host_port)?;
    Some((user, host, port))
}

fn parse_host_port(value: &str) -> Option<(String, Option<u16>)> {
    let value = value.trim();
    if let Some(stripped) = value.strip_prefix('[') {
        if let Some(end) = stripped.find(']') {
            let host_end = end + 1;
            let host = normalize_host(&value[..=host_end])?;
            let port = value
                .get(host_end + 2..)
                .filter(|_| value.as_bytes().get(host_end + 1) == Some(&b':'))
                .and_then(normalize_port);
            return Some((host, port));
        }
    }

    if let Some((host, port_text)) = value.rsplit_once(':') {
        if !host.contains(':') {
            return Some((normalize_host(host)?, normalize_port(port_text)));
        }
    }
    Some((normalize_host(value)?, None))
}

fn push_ssh_candidate(
    candidates: &mut Vec<SshConnectionCandidate>,
    seen: &mut BTreeSet<String>,
    user: Option<String>,
    host: String,
    port: Option<u16>,
) {
    let key = format!(
        "{}@{}:{}",
        user.as_deref().unwrap_or("-"),
        host.to_ascii_lowercase(),
        port.unwrap_or(22)
    );
    if seen.insert(key) {
        candidates.push(SshConnectionCandidate { user, host, port });
    }
}

fn normalize_ocr_shell_token(value: &str) -> String {
    value
        .trim_matches(|character: char| {
            matches!(
                character,
                '\'' | '"' | '`' | '$' | ',' | ';' | '(' | ')' | '[' | ']' | '，' | '。'
            )
        })
        .to_owned()
}

fn normalize_host(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_matches(|character: char| {
            matches!(character, '\'' | '"' | '`' | ',' | ';' | ')' | '(')
        });
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value.contains('@')
        || value.eq_ignore_ascii_case("password")
        || value.eq_ignore_ascii_case("passwd")
    {
        return None;
    }
    Some(value.to_owned())
}

fn normalize_user(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty()
        || value.contains(':')
        || value.contains('@')
        || value.eq_ignore_ascii_case("password")
        || value.eq_ignore_ascii_case("passwd")
    {
        return None;
    }
    Some(value.to_owned())
}

fn normalize_port(value: &str) -> Option<u16> {
    let port = value.trim().parse::<u16>().ok()?;
    (port > 0).then_some(port)
}

fn is_ssh_command_token(token: &str) -> bool {
    token.eq_ignore_ascii_case("ssh") || token.ends_with("/ssh") || token.ends_with("\\ssh.exe")
}

fn ssh_option_takes_value(token: &str) -> bool {
    matches!(
        token,
        "-b" | "-c"
            | "-D"
            | "-E"
            | "-F"
            | "-i"
            | "-J"
            | "-L"
            | "-l"
            | "-m"
            | "-O"
            | "-o"
            | "-R"
            | "-S"
            | "-W"
            | "-w"
    )
}

fn ssh_url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?i)\bssh://(?:(?P<user>[a-z0-9._%+\-]+)@)?(?P<host>\[[0-9a-f:.]+\]|[a-z0-9._\-]+)(?::(?P<port>\d{1,5}))?"#,
        )
        .expect("ssh url regex must be valid")
    })
}

/// 将 Kerminal 内部工具 id 转为 Provider 可接受的工具名。
pub(crate) fn provider_safe_tool_name(tool_id: &str) -> String {
    let mut safe = tool_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.is_empty() {
        safe.push_str("tool");
    }
    if safe == tool_id && safe.len() <= MAX_PROVIDER_TOOL_NAME_LEN {
        return safe;
    }

    let suffix = format!("_{:016x}", stable_tool_name_hash(tool_id));
    let max_prefix_len = MAX_PROVIDER_TOOL_NAME_LEN.saturating_sub(suffix.len());
    if safe.len() > max_prefix_len {
        safe.truncate(max_prefix_len);
    }
    safe.push_str(&suffix);
    safe
}

/// 工具风险中文标签，用于 Provider tool description。
pub(crate) fn risk_label(risk: ToolRiskLevel) -> &'static str {
    match risk {
        ToolRiskLevel::Read => "读取",
        ToolRiskLevel::Write => "写入",
        ToolRiskLevel::Remote => "远程",
        ToolRiskLevel::Batch => "批量",
        ToolRiskLevel::Destructive => "破坏性",
    }
}

/// 工具确认策略中文标签，用于 Provider tool description。
pub(crate) fn confirmation_label(confirmation: ToolConfirmationPolicy) -> &'static str {
    match confirmation {
        ToolConfirmationPolicy::Auto => "可自动执行",
        ToolConfirmationPolicy::Contextual => "按上下文确认",
        ToolConfirmationPolicy::Always => "每次确认",
    }
}

fn stable_tool_name_hash(tool_id: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in tool_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for character in value.chars().take(max_chars) {
        output.push(character);
    }
    if value.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

fn format_application_context(
    application_context: Option<&AiApplicationContextRequest>,
    execution_visibility: AiCommandExecutionVisibility,
    app_settings: &AppSettings,
    mcp_tools: &McpToolList,
) -> String {
    let mut lines = vec![
        "当前应用上下文：Kerminal Agent 是当前 Kerminal 应用的操作层；应用上下文是感知，MCP 工具是可受控调用的手脚。".to_owned(),
        format!(
            "- 工具暴露：当前 MCP 工具 {} 个，所有可操作能力必须从该工具目录中选择。",
            mcp_tools.tools.len()
        ),
        format!(
            "- 用户自定义 MCP：{} 个 server、{} 个已发现 tool、{} 个 skills 文件夹已配置；外部 MCP 工具必须来自 server discovery，不能手工发明。",
            app_settings.ai.mcp.servers.len(),
            app_settings
                .ai
                .mcp
                .servers
                .iter()
                .map(|server| server.tools.len())
                .sum::<usize>(),
            app_settings.ai.mcp.skill_directories.len(),
        ),
        format!(
            "- AI 安全策略：执行模式 {}；远程确认 {}；破坏性工具 {}；上下文上限 {} bytes；命令超时 {} 秒。",
            approval_policy_label(&app_settings.ai.command_approval_policy),
            if app_settings.ai.require_remote_approval {
                "开启"
            } else {
                "关闭"
            },
            if app_settings.ai.allow_destructive_tools {
                "允许进入确认链"
            } else {
                "默认关闭"
            },
            app_settings.ai.context_max_output_bytes,
            app_settings.ai.command_timeout_seconds,
        ),
        format_command_visibility_context(execution_visibility, application_context),
        format!(
            "- UI 设置：主题 {:?}；界面密度 {:?}；终端字体 {} {}px；SFTP 并发 {}/{}。",
            app_settings.theme_mode,
            app_settings.interface_density,
            app_settings.terminal.font_family,
            app_settings.terminal.font_size,
            app_settings.sftp.host_transfers,
            app_settings.sftp.global_transfers,
        ),
    ];

    if let Some(custom_instructions) = (!app_settings.ai.custom_instructions.trim().is_empty())
        .then(|| app_settings.ai.custom_instructions.trim())
    {
        lines.push(format!("- 用户自定义 AI 指令：{custom_instructions}"));
    }

    if let Some(context) = application_context {
        lines.push(format!(
            "- 当前右侧工具：{}",
            context.active_tool_id.as_deref().unwrap_or("ai")
        ));
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
    } else {
        lines.push(
            "- 前端工作台状态：本次没有提供 active tab、focused pane 和选中主机摘要。".to_owned(),
        );
    }

    lines.join("\n")
}

fn format_command_visibility_context(
    execution_visibility: AiCommandExecutionVisibility,
    application_context: Option<&AiApplicationContextRequest>,
) -> String {
    match execution_visibility {
        AiCommandExecutionVisibility::Terminal => {
            let session_id = application_context
                .and_then(|context| context.focused_pane.as_ref())
                .and_then(|pane| pane.session_id.as_deref())
                .unwrap_or("-");
            format!(
                "- AI 命令显示模式：显示在当前终端。需要执行本地或当前会话命令时，优先使用 `terminal.write` 把完整命令和回车写入当前 focused pane 的 session `{session_id}`，让用户在终端里看到命令和随后输出；不要用后台非交互工具替代可见终端执行，除非没有可用 session 或用户明确要求后台运行。"
            )
        }
        AiCommandExecutionVisibility::Background => {
            "- AI 命令显示模式：后台运行。可以使用非交互后台工具执行，但必须在回复和待确认工具卡片中说明将执行的命令；不要声称命令会出现在终端，结果以 AI 工具审计和回复摘要为准。".to_owned()
        }
    }
}

fn format_agent_profile_context(profile: &McpAgentProfile) -> String {
    let capabilities = profile
        .capabilities
        .iter()
        .map(|capability| {
            let tools = capability
                .tool_examples
                .iter()
                .map(|tool| provider_safe_tool_reference(tool))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "- {title}：{description}；代表工具 {tools}",
                title = capability.title,
                description = capability.description,
                tools = tools,
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let rules = profile
        .operating_rules
        .iter()
        .map(|rule| format!("- {rule}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "\
Agent 身份：
- id: {id}
- name: {name}
- role: {role}
- description: {description}
- tool call protocol: {tool_call_protocol}

Agent 能力：
{capabilities}

Agent 行为规则：
{rules}",
        id = profile.id,
        name = profile.name,
        role = profile.role,
        description = profile.description,
        tool_call_protocol = profile.tool_call_protocol,
    )
}

fn format_agent_skill_context(skills: &[McpSkillDefinition], mcp_tools: &McpToolList) -> String {
    let exposed_tool_ids = mcp_tools
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<BTreeSet<_>>();
    let lines = skills
        .iter()
        .map(|skill| {
            let available_tools = skill
                .tool_ids
                .iter()
                .filter(|tool_id| exposed_tool_ids.contains(tool_id.as_str()))
                .map(|tool_id| provider_safe_tool_reference(tool_id))
                .collect::<Vec<_>>();
            format!(
                "- {id} / {title} [{origin}]：{when}\n  guidance: {guidance}\n  tools: {tools}",
                id = skill.id,
                title = skill.title,
                origin = skill_origin_label(skill.origin),
                when = skill.when_to_use,
                guidance = skill.prompt_guidance,
                tools = if available_tools.is_empty() {
                    "-".to_owned()
                } else {
                    available_tools.join(", ")
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Agent Skills 路由：共 {} 个 skill。请先选择 skill，再选择 MCP 工具。\n{}",
        skills.len(),
        lines
    )
}

fn format_terminal_context(snapshot: &AiTerminalContextSnapshot) -> String {
    format!(
        "\
当前终端上下文：
- session: {session_id}
- shell: {shell}
- cwd: {cwd}
- pane: {pane}
- tab: {tab}
- host: {machine}
- 最近输出是否脱敏: {redacted}
- 最近输出：
{output}",
        session_id = snapshot.session.id,
        shell = snapshot.session.shell,
        cwd = snapshot.session.cwd.as_deref().unwrap_or("-"),
        pane = snapshot.source.pane_title.as_deref().unwrap_or("-"),
        tab = snapshot.source.tab_title.as_deref().unwrap_or("-"),
        machine = snapshot.source.machine_name.as_deref().unwrap_or("-"),
        redacted = if snapshot.redacted { "是" } else { "否" },
        output = snapshot.output.data,
    )
}

fn format_mcp_tool_context(mcp_tools: &McpToolList) -> String {
    let mut lines = vec![format!(
        "rmcp 工具目录：协议 {}，共 {} 个工具。需要操作时请使用标准 tool-call；Kerminal 会先创建待审批调用，确认前不得声称已经执行。",
        mcp_tools.protocol,
        mcp_tools.tools.len()
    )];
    let mut tools = mcp_tools.tools.iter().collect::<Vec<_>>();
    tools.sort_by_key(|tool| match tool.origin {
        McpDefinitionOrigin::Custom => 0,
        McpDefinitionOrigin::System => 1,
    });
    for tool in tools.iter().take(MAX_LISTED_TOOLS) {
        lines.push(format!(
            "- {name}：{title}；Kerminal id {source_tool_id}；风险 {risk}；确认策略 {confirmation}",
            name = provider_safe_tool_name(&tool.name),
            title = tool.title.as_deref().unwrap_or("-"),
            source_tool_id = tool.name.as_str(),
            risk = risk_label(tool.risk),
            confirmation = confirmation_label(tool.confirmation),
        ));
    }
    if tools.len() > MAX_LISTED_TOOLS {
        lines.push(format!(
            "- 其余 {} 个工具已省略。",
            tools.len() - MAX_LISTED_TOOLS
        ));
    }
    lines.join("\n")
}

fn provider_safe_tool_reference(tool_id: &str) -> String {
    let name = provider_safe_tool_name(tool_id);
    if name == tool_id {
        name
    } else {
        format!("{name} (Kerminal id {tool_id})")
    }
}

fn skill_origin_label(origin: McpDefinitionOrigin) -> &'static str {
    match origin {
        McpDefinitionOrigin::System => "system",
        McpDefinitionOrigin::Custom => "custom",
    }
}

fn approval_policy_label(policy: &AiCommandApprovalPolicy) -> &'static str {
    match policy {
        AiCommandApprovalPolicy::Always => "每次确认",
        AiCommandApprovalPolicy::Risky => "高风险确认",
        AiCommandApprovalPolicy::Relaxed => "放开模式",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::models::tool_registry::{McpToolAnnotations, ToolAuditPolicy};

    fn mcp_tool(
        name: &str,
        origin: McpDefinitionOrigin,
    ) -> crate::models::tool_registry::McpToolDefinition {
        crate::models::tool_registry::McpToolDefinition {
            annotations: McpToolAnnotations::default(),
            audit: ToolAuditPolicy::Summary,
            confirmation: ToolConfirmationPolicy::Auto,
            description: Some("读取当前服务器配置摘要。".to_owned()),
            input_schema: json!({ "type": "object" }),
            name: name.to_owned(),
            origin,
            risk: ToolRiskLevel::Read,
            server_id: None,
            source_tool_id: name.to_owned(),
            title: Some("读取服务器配置".to_owned()),
        }
    }

    #[test]
    fn build_agent_context_includes_application_and_tool_contracts() {
        let settings = AppSettings::default();
        let tools = McpToolList {
            protocol: "streamable-http".to_owned(),
            tools: vec![mcp_tool(
                "server_info.snapshot",
                McpDefinitionOrigin::System,
            )],
        };

        let context = build_agent_context(
            None,
            None,
            &[],
            &AiChatVisionUsageReport::default(),
            AiCommandExecutionVisibility::Background,
            &settings,
            &tools,
        );

        assert!(context.contains("Agent 身份"));
        assert!(context.contains("AI 命令显示模式：后台运行"));
        assert!(context.contains("当前附件上下文：本次没有提供图片、文件或诊断片段。"));
        assert!(context.contains("当前终端上下文：本次没有提供 terminal session 快照。"));
        assert!(context.contains("Kerminal id server_info.snapshot"));
        assert!(context.contains("风险 读取"));
    }

    #[test]
    fn attachment_context_redacts_ocr_and_extracts_ssh_candidates() {
        let settings = AppSettings::default();
        let tools = McpToolList {
            protocol: "streamable-http".to_owned(),
            tools: vec![mcp_tool("remote_host.create", McpDefinitionOrigin::System)],
        };
        let attachment = AiChatAttachmentContext {
            height: Some(768),
            id: "att-ssh".to_owned(),
            kind: "image".to_owned(),
            mime_type: "image/png".to_owned(),
            missing_reason: None,
            ocr_text: Some(
                "ssh -p 2222 deploy@prod.example.com\npassword: hunter2\nssh://root@10.0.0.7:2200"
                    .to_owned(),
            ),
            original_name: "ssh-setup.png".to_owned(),
            redaction_summary: None,
            size_bytes: 2048,
            status: "available".to_owned(),
            vision_usage: Some("ocrOnly".to_owned()),
            width: Some(1024),
        };
        let vision_usage = AiChatVisionUsageReport {
            attachments: vec![crate::models::ai_agent::AiChatAttachmentVisionStatus {
                effective_usage: "ocrOnly".to_owned(),
                id: "att-ssh".to_owned(),
                model_input: "textContext".to_owned(),
                requested_usage: "ocrOnly".to_owned(),
                warning: None,
            }],
            provider_supports_vision: false,
            vision_adapter_enabled: false,
        };

        let context = build_agent_context(
            None,
            None,
            &[attachment],
            &vision_usage,
            AiCommandExecutionVisibility::Background,
            &settings,
            &tools,
        );

        assert!(context.contains("OCR 文本（已脱敏）"));
        assert!(!context.contains("hunter2"));
        assert!(context.contains("user deploy；host prod.example.com；port 2222"));
        assert!(context.contains("user root；host 10.0.0.7；port 2200"));
        assert!(context.contains("remote_host.create"));
        assert!(context.contains("等待用户确认"));
    }

    #[test]
    fn ssh_candidate_parser_rejects_inline_password_and_deduplicates() {
        let candidates = extract_ssh_connection_candidates(
            "ssh user:secret@bad.example.com\nssh user@example.com -p 2222\nssh -p 2222 user@example.com",
        );

        assert_eq!(
            candidates,
            vec![SshConnectionCandidate {
                user: Some("user".to_owned()),
                host: "example.com".to_owned(),
                port: Some(2222),
            }]
        );
    }
}
