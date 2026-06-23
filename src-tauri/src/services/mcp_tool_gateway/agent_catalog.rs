use super::*;

pub(super) fn server_info() -> McpServerInfo {
    McpServerInfo {
        name: "kerminal".to_owned(),
        title: "Kerminal".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        description: "Kerminal 本地终端工作台的 MCP 能力清单。".to_owned(),
    }
}

/// 返回 Kerminal 内置 Agent 身份定义。
pub fn agent_profile() -> McpAgentProfile {
    McpAgentProfile {
        id: "kerminal-agent".to_owned(),
        name: "Kerminal Agent".to_owned(),
        title: "Kerminal Agent".to_owned(),
        role: "面向开发者终端工作台的本地 AI 操作代理".to_owned(),
        default_language: "zh-CN".to_owned(),
        description:
            "结合当前终端上下文、MCP 工具目录和 skills 路由，协助用户完成本地终端、SSH/SFTP、工作区、设置、诊断和自动化操作。"
                .to_owned(),
        capabilities: vec![
            capability(
                "terminal-workspace",
                "终端与工作区",
                "读取当前终端状态，建议或准备本地终端输入、分屏、tab 切换和工具面板切换。",
                vec![ToolCategory::Terminal, ToolCategory::Workspace],
                &[
                    "terminal.resolve_current",
                    "terminal.write",
                    "terminal.create",
                    "workspace.split_pane",
                    "workspace.open_tool",
                ],
            ),
            capability(
                "remote-ops",
                "远程连接与服务器操作",
                "管理远程主机、打开 SSH/RDP、执行受控远程命令、读取服务器信息和管理端口转发。",
                vec![
                    ToolCategory::RemoteHost,
                    ToolCategory::Ssh,
                    ToolCategory::Connection,
                    ToolCategory::ServerInfo,
                    ToolCategory::PortForward,
                ],
                &[
                    "remote_host.last_used",
                    "remote_host.tree",
                    "ssh.connect",
                    "ssh.command",
                    "ssh.command_on_resolved_host",
                    "server_info.snapshot",
                ],
            ),
            capability(
                "file-transfer",
                "SFTP 文件与传输",
                "浏览、预览、上传、下载、移动、改名、改权限和取消 SFTP 传输任务。",
                vec![ToolCategory::Sftp],
                &[
                    "sftp.list",
                    "sftp.preview",
                    "sftp.upload",
                    "sftp.download",
                    "sftp.transfer.enqueue",
                ],
            ),
            capability(
                "configuration",
                "设置与模型配置",
                "读取和修改应用主题、终端外观、AI 安全策略、终端 profile 和 LLM Provider。",
                vec![
                    ToolCategory::Settings,
                    ToolCategory::Profile,
                    ToolCategory::LlmProvider,
                ],
                &[
                    "settings.get",
                    "settings.update_ai_security",
                    "profile.list",
                    "llm_provider.list",
                ],
            ),
            capability(
                "automation-memory",
                "片段、工作流与命令历史",
                "创建和检索可复用命令片段、工作流以及命令历史，供后续受控执行链路复用。",
                vec![
                    ToolCategory::Snippet,
                    ToolCategory::Workflow,
                    ToolCategory::History,
                ],
                &[
                    "snippet.list",
                    "snippet.create",
                    "workflow.list",
                    "history.search",
                ],
            ),
            capability(
                "diagnostics",
                "诊断与审计",
                "读取运行体检、生成本地诊断包，并解释 AI 工具审计摘要和安全策略。",
                vec![ToolCategory::Diagnostics],
                &["diagnostics.runtime_health", "diagnostics.create_bundle"],
            ),
        ],
        operating_rules: vec![
            "默认使用中文，先解释判断依据，再给出可执行下一步。".to_owned(),
            "需要操作应用时使用标准工具调用；内置 Agent 走 Kerminal 确认链路，外部 Streamable HTTP MCP host 应使用自身 hooks/permission 先做准入控制。".to_owned(),
            "远程、批量、写入和破坏性操作必须标注风险；删除、覆盖、停止服务、清空记录等操作必须等待明确确认。".to_owned(),
            "不得输出、索要或保存 API key、SSH 密钥、密码、token 等敏感信息。".to_owned(),
            "上下文不足时优先建议只读工具或说明缺口，不编造终端输出、远程状态或文件内容。".to_owned(),
        ],
        tool_call_protocol:
            "如需操作 Kerminal，请使用模型提供商的标准 tool-call/function-call 或 MCP tools/call 机制调用已暴露工具；不要用文本或代码块伪造工具调用。"
                .to_owned(),
    }
}

/// 返回 Agent skills 路由目录。
pub fn agent_skills() -> Vec<McpSkillDefinition> {
    vec![
        skill(
            "terminal-workspace",
            "终端与工作区控制",
            "处理本地终端会话、输入、日志、尺寸、分屏、tab 和右侧工具区切换。",
            "用户要求运行本地命令、解释终端、管理终端布局或切换工具面板时使用。",
            &[
                "运行测试",
                "新开一个终端",
                "把当前窗口左右分屏",
                "打开 SFTP 面板",
            ],
            &[
                "terminal.create",
                "terminal.resolve_current",
                "terminal.write",
                "terminal.resize",
                "terminal.list",
                "terminal.close",
                "terminal.log.start",
                "terminal.log.stop",
                "terminal.log.state",
                "workspace.split_pane",
                "workspace.focus_tab",
                "workspace.open_tool",
            ],
            "优先读取当前上下文；写入终端前说明命令意图和风险，关闭会话必须按破坏性操作确认。",
        ),
        skill(
            "app-configuration",
            "应用、Profile 与模型配置",
            "处理主题、终端外观、AI 安全策略、终端 profile 和 LLM Provider 配置。",
            "用户要求调整设置、配置模型、创建 shell profile 或查看当前设置时使用。",
            &[
                "切换浅色主题",
                "配置 OpenAI Provider",
                "把 PowerShell 设为默认 profile",
            ],
            &[
                "settings.update_theme",
                "settings.update_terminal_appearance",
                "settings.get",
                "settings.update_ai_security",
                "llm_provider.list",
                "llm_provider.create",
                "llm_provider.update",
                "llm_provider.delete",
                "llm_provider.test",
                "profile.create",
                "profile.list",
                "profile.detect_shells",
                "profile.update",
                "profile.delete",
            ],
            "配置类写入要说明变更范围；Provider 和凭据只处理引用或受控输入，不在回复中回显密钥。",
        ),
        skill(
            "remote-access",
            "远程主机与连接",
            "处理远程主机树、分组、SSH 终端、非交互远程命令和 RDP 连接。",
            "用户要求管理服务器、连接 SSH/RDP、执行远程命令或维护主机分组时使用。",
            &[
                "连接生产服务器",
                "远程执行 df -h",
                "新增一台 SSH 主机",
                "打开 RDP",
            ],
            &[
                "remote_host.create",
                "remote_host.last_used",
                "remote_host.group_list",
                "remote_host.tree",
                "remote_host.group_create",
                "remote_host.group_update",
                "remote_host.group_delete",
                "remote_host.update",
                "remote_host.delete",
                "ssh.connect",
                "ssh.command",
                "ssh.command_on_resolved_host",
                "connection.rdp_open",
            ],
            "远程操作默认先读后写；生产、权限提升、停止服务、批量变更等必须拆成可确认步骤。",
        ),
        skill(
            "sftp-files",
            "SFTP 文件管理与传输",
            "处理远程文件浏览、预览、上传、下载、移动、改名、建目录、改权限和传输队列。",
            "用户要求查看远程目录、传输文件、改远程权限或取消传输任务时使用。",
            &[
                "下载远程日志",
                "预览配置文件",
                "上传构建产物",
                "修改文件权限",
            ],
            &[
                "sftp.list",
                "sftp.rename",
                "sftp.move",
                "sftp.preview",
                "sftp.download",
                "sftp.upload",
                "sftp.delete",
                "sftp.create_directory",
                "sftp.chmod",
                "sftp.upload_directory",
                "sftp.download_directory",
                "sftp.transfer.enqueue",
                "sftp.transfer.list",
                "sftp.transfer.cancel",
                "sftp.transfer.clear_completed",
            ],
            "默认先列目录或预览再写入；删除、覆盖、递归传输和 chmod 要明确路径、影响和确认。",
        ),
        skill(
            "server-network-diagnostics",
            "服务器、端口转发与诊断",
            "处理服务器信息快照、SSH 端口转发、本地运行体检和诊断包生成。",
            "用户要求看服务器资源、建立隧道、排查运行状态或导出诊断信息时使用。",
            &[
                "查看服务器 CPU",
                "创建数据库隧道",
                "生成诊断包",
                "检查应用运行状态",
            ],
            &[
                "server_info.snapshot",
                "port_forward.create",
                "port_forward.list",
                "port_forward.close",
                "diagnostics.runtime_health",
                "diagnostics.create_bundle",
            ],
            "端口和诊断操作要说明目标主机、端口和本地影响；诊断包只生成本地脱敏文件。",
        ),
        skill(
            "snippets-workflows-history",
            "片段、工作流与命令历史",
            "处理可复用命令片段、工作流定义和命令历史检索/记录/清理。",
            "用户要求沉淀常用命令、查历史命令、创建多步骤流程或清理历史时使用。",
            &[
                "保存这条命令",
                "查一下上次怎么部署的",
                "创建一个发布工作流",
                "清空命令历史",
            ],
            &[
                "snippet.create",
                "snippet.list",
                "snippet.update",
                "snippet.delete",
                "workflow.create",
                "workflow.list",
                "workflow.update",
                "workflow.delete",
                "history.search",
                "history.record",
                "history.delete",
                "history.clear",
            ],
            "片段和工作流只保存定义不自动执行；删除或清空历史必须标为破坏性并等待确认。",
        ),
    ]
}

/// 返回合并内置和用户 skills 文件夹的路由目录。
pub fn agent_skills_with_custom(custom_mcp: &AiMcpSettings) -> Vec<McpSkillDefinition> {
    let mut skills = agent_skills();
    skills.extend(custom_skill_catalog(custom_mcp).definitions());
    skills
}

/// 返回实际用于 LLM preamble 的 Kerminal Agent 系统 prompt。
pub fn agent_system_prompt() -> String {
    let profile = agent_profile();
    [
        format!(
            "你是 {name}，{role}。默认使用中文回复。",
            name = profile.name,
            role = profile.role
        ),
        "你可以阅读当前应用上下文、终端上下文、MCP 工具目录、Agent profile 和 skills catalog；需要操作时使用标准工具调用。".to_owned(),
        "你必须根据 skills catalog 选择合适能力路径：先判断目标属于终端、远程、SFTP、设置、诊断、片段/工作流或历史，再选择对应 MCP 工具。".to_owned(),
        profile.tool_call_protocol,
        "工具调用必须只使用 MCP 工具目录中存在且已启用的工具；不要发明工具、参数或执行结果。".to_owned(),
        "远程、批量、写入、删除、覆盖、停止服务、清空记录、权限变更等操作必须说明风险并等待 Kerminal 确认。".to_owned(),
        "不要输出、索要或保存密钥、密码、token、API key 或 SSH 私钥；如果上下文含敏感信息，按已脱敏内容处理。".to_owned(),
        "如果上下文不足，先说明缺口并优先建议只读工具或安全检查步骤。".to_owned(),
    ]
    .join("\n")
}

pub(super) fn capability(
    id: &str,
    title: &str,
    description: &str,
    tool_categories: Vec<ToolCategory>,
    tool_examples: &[&str],
) -> McpAgentCapability {
    McpAgentCapability {
        id: id.to_owned(),
        title: title.to_owned(),
        description: description.to_owned(),
        tool_categories,
        tool_examples: strings(tool_examples),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn skill(
    id: &str,
    title: &str,
    description: &str,
    when_to_use: &str,
    trigger_examples: &[&str],
    tool_ids: &[&str],
    prompt_guidance: &str,
) -> McpSkillDefinition {
    McpSkillDefinition {
        id: id.to_owned(),
        title: title.to_owned(),
        description: description.to_owned(),
        when_to_use: when_to_use.to_owned(),
        trigger_examples: strings(trigger_examples),
        tool_ids: strings(tool_ids),
        prompt_guidance: prompt_guidance.to_owned(),
        origin: McpDefinitionOrigin::System,
    }
}

pub(super) fn custom_skill_catalog(custom_mcp: &AiMcpSettings) -> SkillCatalog {
    SkillsRepository::new().discover(custom_mcp)
}

pub(super) fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}
