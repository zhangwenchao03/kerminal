import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  normalizeAiMcpSettings,
  type CustomMcpServerSetting,
  type CustomMcpServerToolSetting,
} from "../features/settings/settingsModel";
import {
  normalizeMcpGatewayManifest,
  normalizeMcpPromptRenderResult,
  normalizeMcpResourceReadResult,
  normalizeMcpToolList,
  normalizeToolDefinition,
  type McpGatewayManifest,
  type McpPromptRenderRequest,
  type McpPromptRenderResult,
  type McpResourceReadRequest,
  type McpResourceReadResult,
  type McpToolList,
  type ToolDefinition,
} from "../features/tool-panel/toolRegistryModel";

export interface McpHttpServerStatus {
  running: boolean;
  endpoint?: string | null;
  bindAddress: string;
  port?: number | null;
  localOnly: boolean;
}

const previewTools: ToolDefinition[] = [
  previewTool("terminal.create", "新建终端", "terminal", "write", "contextual"),
  previewTool("terminal.write", "写入终端", "terminal", "write", "contextual"),
  previewTool("terminal.resize", "调整终端尺寸", "terminal", "write", "contextual"),
  previewTool("terminal.list", "列出终端会话", "terminal", "read", "auto"),
  previewTool("terminal.close", "关闭终端会话", "terminal", "destructive", "always", "summary"),
  previewTool("terminal.log.start", "开始终端日志", "terminal", "write", "contextual"),
  previewTool("terminal.log.stop", "停止终端日志", "terminal", "write", "contextual"),
  previewTool("terminal.log.state", "读取终端日志状态", "terminal", "read", "auto"),
  previewTool("workspace.split_pane", "分割当前分屏", "workspace", "write", "contextual"),
  previewTool("workspace.focus_tab", "切换终端 tab", "workspace", "write", "contextual"),
  previewTool("workspace.open_tool", "打开工具面板", "workspace", "write", "contextual"),
  previewTool("settings.update_theme", "更新主题", "settings", "write", "contextual"),
  previewTool("settings.update_terminal_appearance", "更新终端外观", "settings", "write", "contextual"),
  previewTool("settings.get", "读取设置", "settings", "read", "auto"),
  previewTool("settings.update_ai_security", "更新 AI 安全策略", "settings", "write", "always", "full"),
  previewTool("llm_provider.list", "列出模型 Provider", "llmProvider", "read", "auto"),
  previewTool("llm_provider.create", "创建模型 Provider", "llmProvider", "write", "contextual"),
  previewTool("llm_provider.update", "更新模型 Provider", "llmProvider", "write", "contextual"),
  previewTool("llm_provider.delete", "删除模型 Provider", "llmProvider", "destructive", "always", "summary"),
  previewTool("llm_provider.test", "测试模型 Provider", "llmProvider", "read", "auto"),
  previewTool("profile.create", "创建终端配置", "profile", "write", "contextual"),
  previewTool("profile.list", "列出终端配置", "profile", "read", "auto"),
  previewTool("profile.detect_shells", "探测可用 Shell", "profile", "read", "auto"),
  previewTool("profile.update", "更新终端配置", "profile", "write", "contextual"),
  previewTool("profile.delete", "删除终端配置", "profile", "destructive", "always", "summary"),
  previewTool("remote_host.create", "创建远程主机", "remoteHost", "remote", "always"),
  previewTool("remote_host.group_list", "列出远程主机分组", "remoteHost", "read", "auto"),
  previewTool("remote_host.tree", "读取远程主机树", "remoteHost", "read", "auto"),
  previewTool("remote_host.group_create", "创建远程主机分组", "remoteHost", "write", "contextual"),
  previewTool("remote_host.group_update", "更新远程主机分组", "remoteHost", "write", "contextual"),
  previewTool("remote_host.group_delete", "删除远程主机分组", "remoteHost", "destructive", "always", "summary"),
  previewTool("remote_host.update", "更新远程主机", "remoteHost", "remote", "always"),
  previewTool("remote_host.delete", "删除远程主机", "remoteHost", "destructive", "always", "summary"),
  previewTool("ssh.connect", "打开 SSH 终端", "ssh", "remote", "always"),
  previewTool("ssh.command", "执行远程命令", "ssh", "remote", "always"),
  previewTool("connection.rdp_open", "打开 RDP 连接", "connection", "remote", "always"),
  previewTool("sftp.list", "列出远程目录", "sftp", "remote", "always"),
  previewTool("sftp.rename", "重命名远程路径", "sftp", "remote", "always"),
  previewTool("sftp.move", "移动远程路径", "sftp", "remote", "always"),
  previewTool("sftp.preview", "预览远程文件", "sftp", "remote", "always"),
  previewTool("sftp.download", "下载远程文件", "sftp", "remote", "always"),
  previewTool("sftp.upload", "上传本地文件", "sftp", "remote", "always"),
  previewTool("sftp.delete", "删除远程文件", "sftp", "destructive", "always"),
  previewTool("sftp.create_directory", "创建远程目录", "sftp", "remote", "always"),
  previewTool("sftp.chmod", "修改远程权限", "sftp", "remote", "always"),
  previewTool("sftp.upload_directory", "上传本地目录", "sftp", "remote", "always"),
  previewTool("sftp.download_directory", "下载远程目录", "sftp", "remote", "always"),
  previewTool("sftp.transfer.enqueue", "创建 SFTP 传输任务", "sftp", "remote", "always"),
  previewTool("sftp.transfer.list", "列出 SFTP 传输任务", "sftp", "read", "auto"),
  previewTool("sftp.transfer.cancel", "取消 SFTP 传输任务", "sftp", "remote", "always"),
  previewTool("sftp.transfer.clear_completed", "清理已结束 SFTP 任务", "sftp", "write", "contextual"),
  previewTool("server_info.snapshot", "读取服务器信息", "serverInfo", "remote", "always"),
  previewTool("diagnostics.runtime_health", "读取运行体检", "diagnostics", "read", "auto"),
  previewTool("diagnostics.create_bundle", "生成诊断包", "diagnostics", "write", "contextual"),
  previewTool("port_forward.create", "创建端口转发", "portForward", "remote", "always"),
  previewTool("port_forward.list", "列出端口转发", "portForward", "read", "auto"),
  previewTool("port_forward.close", "关闭端口转发", "portForward", "remote", "always"),
  previewTool("snippet.create", "创建脚本片段", "snippet", "write", "contextual"),
  previewTool("snippet.list", "列出脚本片段", "snippet", "read", "auto"),
  previewTool("snippet.update", "更新脚本片段", "snippet", "write", "contextual"),
  previewTool("snippet.delete", "删除脚本片段", "snippet", "destructive", "always", "summary"),
  previewTool("workflow.create", "创建命令工作流", "workflow", "write", "contextual"),
  previewTool("workflow.list", "列出命令工作流", "workflow", "read", "auto"),
  previewTool("workflow.update", "更新命令工作流", "workflow", "write", "contextual"),
  previewTool("workflow.delete", "删除命令工作流", "workflow", "destructive", "always", "summary"),
  previewTool("history.search", "搜索命令历史", "history", "read", "auto"),
  previewTool("history.record", "记录命令历史", "history", "write", "contextual"),
  previewTool("history.delete", "删除命令历史", "history", "destructive", "always", "summary"),
  previewTool("history.clear", "清空命令历史", "history", "destructive", "always"),
  {
    ...previewTool("workflow.run", "执行工作流", "workflow", "batch", "always"),
    enabled: false,
    exposedToMcp: false,
  },
];

const previewAgentProfile = {
  capabilities: [
    {
      description: "读取当前终端状态，建议或准备本地终端输入、分屏、tab 切换和工具面板切换。",
      id: "terminal-workspace",
      title: "终端与工作区",
      toolCategories: ["terminal", "workspace"],
      toolExamples: [
        "terminal.write",
        "terminal.create",
        "workspace.split_pane",
        "workspace.open_tool",
      ],
    },
    {
      description: "管理远程主机、SSH/RDP、远程命令、服务器信息、端口转发和 SFTP 文件传输。",
      id: "remote-files",
      title: "远程与文件",
      toolCategories: [
        "remoteHost",
        "ssh",
        "connection",
        "serverInfo",
        "portForward",
        "sftp",
      ],
      toolExamples: ["ssh.command", "sftp.download", "server_info.snapshot"],
    },
    {
      description: "处理设置、模型 Provider、profile、片段、工作流、命令历史和诊断包。",
      id: "configuration-automation",
      title: "配置、自动化与诊断",
      toolCategories: [
        "settings",
        "llmProvider",
        "profile",
        "snippet",
        "workflow",
        "history",
        "diagnostics",
      ],
      toolExamples: ["settings.get", "snippet.create", "diagnostics.runtime_health"],
    },
  ],
  defaultLanguage: "zh-CN",
  description:
    "结合当前终端上下文、MCP 工具目录和 skills 路由，协助用户完成 Kerminal 内的终端、远程、文件、配置、诊断和自动化操作。",
  id: "kerminal-agent",
  name: "Kerminal Agent",
  operatingRules: [
    "默认使用中文，先解释判断依据，再给出可执行下一步。",
    "需要操作应用时使用标准工具调用；确认前不能声称已经执行工具。",
    "远程、批量、写入和破坏性操作必须标注风险。",
    "不得输出、索要或保存 API key、SSH 密钥、密码、token 等敏感信息。",
  ],
  role: "面向开发者终端工作台的本地 AI 操作代理",
  title: "Kerminal Agent",
  toolCallProtocol:
    "如需操作 Kerminal，请使用模型提供商的标准 tool-call/function-call 机制调用已暴露 MCP 工具。",
} satisfies McpGatewayManifest["agent"];

const previewAgentSkills: McpGatewayManifest["skills"] = [
  previewSkill(
    "terminal-workspace",
    "终端与工作区控制",
    "处理本地终端会话、输入、日志、尺寸、分屏、tab 和右侧工具区切换。",
    "用户要求运行本地命令、解释终端、管理终端布局或切换工具面板时使用。",
    ["运行测试", "新开一个终端", "打开 SFTP 面板"],
    [
      "terminal.create",
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
    "写入终端前说明命令意图和风险，关闭会话必须按破坏性操作确认。",
  ),
  previewSkill(
    "app-configuration",
    "应用、Profile 与模型配置",
    "处理主题、终端外观、AI 安全策略、终端 profile 和 LLM Provider 配置。",
    "用户要求调整设置、配置模型、创建 shell profile 或查看当前设置时使用。",
    ["切换浅色主题", "配置 OpenAI Provider", "创建本地 profile"],
    [
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
    "配置类写入要说明变更范围；Provider 和凭据不在回复中回显密钥。",
  ),
  previewSkill(
    "remote-access",
    "远程主机与连接",
    "处理远程主机树、分组、SSH 终端、非交互远程命令和 RDP 连接。",
    "用户要求管理服务器、连接 SSH/RDP、执行远程命令或维护主机分组时使用。",
    ["连接生产服务器", "远程执行 df -h", "打开 RDP"],
    [
      "remote_host.create",
      "remote_host.group_list",
      "remote_host.tree",
      "remote_host.group_create",
      "remote_host.group_update",
      "remote_host.group_delete",
      "remote_host.update",
      "remote_host.delete",
      "ssh.connect",
      "ssh.command",
      "connection.rdp_open",
    ],
    "远程操作默认先读后写；生产、权限提升、停止服务、批量变更等必须拆成可确认步骤。",
  ),
  previewSkill(
    "sftp-files",
    "SFTP 文件管理与传输",
    "处理远程文件浏览、预览、上传、下载、移动、改名、建目录、改权限和传输队列。",
    "用户要求查看远程目录、传输文件、改远程权限或取消传输任务时使用。",
    ["下载远程日志", "预览配置文件", "上传构建产物"],
    [
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
  previewSkill(
    "server-network-diagnostics",
    "服务器、端口转发与诊断",
    "处理服务器信息快照、SSH 端口转发、本地运行体检和诊断包生成。",
    "用户要求看服务器资源、建立隧道、排查运行状态或导出诊断信息时使用。",
    ["查看服务器 CPU", "创建数据库隧道", "生成诊断包"],
    [
      "server_info.snapshot",
      "port_forward.create",
      "port_forward.list",
      "port_forward.close",
      "diagnostics.runtime_health",
      "diagnostics.create_bundle",
    ],
    "端口和诊断操作要说明目标主机、端口和本地影响；诊断包只生成本地脱敏文件。",
  ),
  previewSkill(
    "snippets-workflows-history",
    "片段、工作流与命令历史",
    "处理可复用命令片段、工作流定义和命令历史检索、记录、清理。",
    "用户要求沉淀常用命令、查历史命令、创建多步骤流程或清理历史时使用。",
    ["保存这条命令", "查上次部署命令", "创建发布工作流"],
    [
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
];

export const browserPreviewMcpToolCount = previewTools.filter(
  (tool) => tool.enabled && tool.exposedToMcp,
).length;

export async function listToolRegistry(): Promise<ToolDefinition[]> {
  if (!isTauri()) {
    return previewTools.map(normalizeToolDefinition);
  }

  const tools = await invoke<ToolDefinition[]>("tool_registry_list");
  return tools.map(normalizeToolDefinition);
}

export async function listMcpTools(): Promise<McpToolList> {
  if (!isTauri()) {
    return normalizeMcpToolList({
      protocol: "mcp-tools/list",
      tools: previewTools
        .filter((tool) => tool.enabled && tool.exposedToMcp)
        .map((tool) => ({
          annotations: {
            destructiveHint: tool.risk === "destructive",
            idempotentHint: tool.confirmation === "auto",
            openWorldHint: ["batch", "destructive", "remote"].includes(tool.risk),
            readOnlyHint: tool.risk === "read",
          },
          audit: tool.audit,
          confirmation: tool.confirmation,
          description: tool.description,
          inputSchema: tool.inputSchema,
          name: tool.id,
          origin: "system",
          risk: tool.risk,
          serverId: null,
          sourceToolId: tool.id,
          title: tool.title,
        })),
    });
  }

  const tools = await invoke<McpToolList>("tool_registry_mcp_list");
  return normalizeMcpToolList(tools);
}

export async function getMcpGatewayManifest(): Promise<McpGatewayManifest> {
  if (!isTauri()) {
    return normalizeMcpGatewayManifest(buildPreviewMcpManifest());
  }

  const manifest = await invoke<McpGatewayManifest>("tool_registry_mcp_manifest");
  return normalizeMcpGatewayManifest(manifest);
}

export async function getMcpHttpServerStatus(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>(
    "tool_registry_mcp_http_status",
  );
  return normalizeMcpHttpServerStatus(status);
}

export async function startMcpHttpServer(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>(
    "tool_registry_mcp_http_start",
    { request: null },
  );
  return normalizeMcpHttpServerStatus(status);
}

export async function discoverMcpServerTools(
  server: CustomMcpServerSetting,
): Promise<CustomMcpServerToolSetting[]> {
  const normalizedServer = normalizeAiMcpSettings({ servers: [server] }).servers[0];
  if (!isTauri()) {
    return normalizedServer?.tools ?? [];
  }
  const tools = await invoke<CustomMcpServerToolSetting[]>(
    "tool_registry_mcp_server_discover_tools",
    { server: normalizedServer },
  );
  return normalizeAiMcpSettings({
    servers: [
      {
        ...(normalizedServer ?? server),
        tools,
      },
    ],
  }).servers[0]?.tools ?? [];
}

export async function readMcpResource(
  request: McpResourceReadRequest,
): Promise<McpResourceReadResult> {
  if (!isTauri()) {
    return normalizeMcpResourceReadResult(buildPreviewMcpResource(request));
  }

  const result = await invoke<McpResourceReadResult>(
    "tool_registry_mcp_resource_read",
    { request },
  );
  return normalizeMcpResourceReadResult(result);
}

export async function renderMcpPrompt(
  request: McpPromptRenderRequest,
): Promise<McpPromptRenderResult> {
  if (!isTauri()) {
    return normalizeMcpPromptRenderResult(buildPreviewMcpPrompt(request));
  }

  const result = await invoke<McpPromptRenderResult>(
    "tool_registry_mcp_prompt_render",
    { request },
  );
  return normalizeMcpPromptRenderResult(result);
}

function previewTool(
  id: string,
  title: string,
  category: ToolDefinition["category"],
  risk: ToolDefinition["risk"],
  confirmation: ToolDefinition["confirmation"],
  audit?: ToolDefinition["audit"],
): ToolDefinition {
  return {
    audit: audit ?? (risk === "destructive" ? "full" : "summary"),
    category,
    confirmation,
    description: `${title}，由 Kerminal Tool Registry 暴露给 UI、AI 和 rmcp。`,
    enabled: true,
    exposedToMcp: true,
    id,
    inputSchema: { properties: {}, required: [], type: "object" },
    risk,
    title,
  };
}

function previewMcpHttpServerStatus(): McpHttpServerStatus {
  return {
    bindAddress: "127.0.0.1",
    endpoint: null,
    localOnly: true,
    port: null,
    running: false,
  };
}

function normalizeMcpHttpServerStatus(
  status: McpHttpServerStatus,
): McpHttpServerStatus {
  return {
    bindAddress: status.bindAddress ?? "127.0.0.1",
    endpoint: status.endpoint ?? null,
    localOnly: status.localOnly ?? true,
    port: status.port ?? null,
    running: Boolean(status.running),
  };
}

function previewSkill(
  id: string,
  title: string,
  description: string,
  whenToUse: string,
  triggerExamples: string[],
  toolIds: string[],
  promptGuidance: string,
): McpGatewayManifest["skills"][number] {
  return {
    description,
    id,
    promptGuidance,
    origin: "system",
    title,
    toolIds,
    triggerExamples,
    whenToUse,
  };
}

function buildPreviewMcpManifest(): McpGatewayManifest {
  const mcpTools = normalizeMcpToolList({
    protocol: "mcp-tools/list",
    tools: previewTools
      .filter((tool) => tool.enabled && tool.exposedToMcp)
      .map((tool) => ({
        annotations: {
          destructiveHint: tool.risk === "destructive",
          idempotentHint: tool.confirmation === "auto",
          openWorldHint: ["batch", "destructive", "remote"].includes(tool.risk),
          readOnlyHint: tool.risk === "read",
        },
        audit: tool.audit,
        confirmation: tool.confirmation,
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.id,
        origin: "system",
        risk: tool.risk,
        serverId: null,
        sourceToolId: tool.id,
        title: tool.title,
      })),
  });

  return {
    agent: previewAgentProfile,
    generatedAt: "browser-preview",
    prompts: [
      {
        arguments: [
          { description: "用户希望完成的目标。", name: "goal", required: true },
          {
            description: "用户给出的约束、目标主机、路径或风险偏好。",
            name: "constraints",
            required: false,
          },
        ],
        description: "根据用户目标选择 Kerminal Agent skill、候选 MCP 工具和确认策略。",
        name: "kerminal.agent.route",
        title: "选择 Agent Skill",
      },
      {
        arguments: [
          { description: "需要重点解释的命令、错误片段或文件名。", name: "focus", required: false },
        ],
        description: "基于当前终端输出解释错误、状态或下一步排查方向。",
        name: "kerminal.terminal.explain",
        title: "解释当前终端",
      },
      {
        arguments: [{ description: "用户希望完成的目标。", name: "goal", required: true }],
        description: "结合当前终端上下文建议下一步命令。",
        name: "kerminal.terminal.suggest",
        title: "建议下一步命令",
      },
      {
        arguments: [
          { description: "已保存的远程主机 id。", name: "hostId", required: true },
          { description: "远程操作目标。", name: "task", required: true },
        ],
        description: "为 SSH/SFTP 操作生成安全执行计划。",
        name: "kerminal.remote.safe_ops",
        title: "远程操作安全计划",
      },
    ],
    protocol: "kerminal-mcp/manifest",
    resources: [
      {
        description: "Kerminal Agent 的名称、角色、能力摘要和系统级行为边界。",
        dynamic: false,
        mimeType: "application/json",
        name: "agent-profile",
        title: "Agent 身份",
        uri: "kerminal://agent/profile",
      },
      {
        description: "用于把用户目标路由到 MCP 工具的 skills catalog。",
        dynamic: false,
        mimeType: "application/json",
        name: "agent-skills",
        title: "Agent Skills 目录",
        uri: "kerminal://agent/skills",
      },
      {
        description: "当前实际用于 Kerminal Agent LLM preamble 的系统 prompt。",
        dynamic: false,
        mimeType: "application/json",
        name: "agent-system-prompt",
        title: "Agent 系统 Prompt",
        uri: "kerminal://agent/system-prompt",
      },
      {
        description: "当前右侧工具、active tab、focused pane 和选中主机的工作台摘要。",
        dynamic: true,
        mimeType: "application/json",
        name: "application-context-current",
        title: "当前应用上下文",
        uri: "kerminal://application/context/current",
      },
      {
        description: "当前可供 AI 和 MCP 网关发现的 Kerminal 工具定义。",
        dynamic: false,
        mimeType: "application/json",
        name: "tool-registry",
        title: "工具目录",
        uri: "kerminal://tool-registry",
      },
      {
        description: "当前终端的脱敏上下文快照。",
        dynamic: true,
        mimeType: "application/json",
        name: "terminal-context-current",
        title: "当前终端上下文",
        uri: "kerminal://terminal-context/current",
      },
      {
        description: "最近 AI 工具调用审计记录摘要。",
        dynamic: true,
        mimeType: "application/json",
        name: "ai-audit-summary",
        title: "AI 工具审计摘要",
        uri: "kerminal://ai/audit-summary",
      },
      {
        description: "当前 AI 上下文、远程确认和破坏性工具策略。",
        dynamic: true,
        mimeType: "application/json",
        name: "ai-policy",
        title: "AI 安全策略",
        uri: "kerminal://settings/ai-policy",
      },
      {
        description: "用户在设置中声明的 MCP Servers、discovered tools 和 skills 文件夹；只返回脱敏后的配置摘要。",
        dynamic: true,
        mimeType: "application/json",
        name: "custom-mcp",
        title: "用户自定义 MCP / Skills",
        uri: "kerminal://settings/custom-mcp",
      },
    ],
    security: {
      auditEnabled: true,
      externalAccessEnabled: false,
      localOnly: true,
      notes: [
        "浏览器预览不会启动外部 MCP Server。",
        "远程、批量和破坏性工具仍必须经过确认策略。",
      ],
      requiresKerminalConfirmation: true,
      secretsRedacted: true,
    },
    server: {
      description: "Kerminal 浏览器预览模式的 MCP 能力清单。",
      name: "kerminal",
      title: "Kerminal",
      version: "browser-preview",
    },
    skills: previewAgentSkills,
    tools: mcpTools,
    transports: [
      {
        args: [],
        command: null,
        description: "浏览器预览中的应用内 rmcp 网关。",
        endpoint: null,
        envKeys: [],
        headerKeys: [],
        id: "system.in_process_rmcp",
        kind: "in-process-rmcp",
        origin: "system",
        status: "enabled",
        title: "应用内 rmcp 网关",
      },
      {
        args: [],
        command: "kerminal mcp serve --transport stdio",
        description: "系统 MCP stdio 服务配置，供 Claude、Codex 等外部工具按状态集成。",
        endpoint: null,
        envKeys: [],
        headerKeys: [],
        id: "system.stdio",
        kind: "stdio",
        origin: "system",
        status: "planned",
        title: "本地 stdio MCP Server",
      },
      {
        args: [],
        command: null,
        description: "本地 Streamable HTTP MCP Server 入口；浏览器预览不会启动真实端口。",
        endpoint: null,
        envKeys: [],
        headerKeys: [],
        id: "system.local_http",
        kind: "streamable-http",
        origin: "system",
        status: "disabled",
        title: "本地 Streamable HTTP MCP Server",
      },
    ],
  };
}

function buildPreviewMcpResource(
  request: McpResourceReadRequest,
): McpResourceReadResult {
  const manifest = buildPreviewMcpManifest();
  const resource = manifest.resources.find((item) => item.uri === request.uri);
  if (!resource) {
    throw new Error(`未知 MCP resource: ${request.uri}`);
  }

  return {
    content: previewResourceContent(request, manifest),
    generatedAt: "browser-preview",
    mimeType: resource.mimeType,
    name: resource.name,
    title: resource.title,
    uri: resource.uri,
  };
}

function previewResourceContent(
  request: McpResourceReadRequest,
  manifest: McpGatewayManifest,
): Record<string, unknown> {
  if (request.uri === "kerminal://tool-registry") {
    return {
      protocol: "kerminal-mcp/resource/tool-registry",
      toolCount: manifest.tools.tools.length,
      tools: manifest.tools.tools,
    };
  }

  if (request.uri === "kerminal://agent/profile") {
    return {
      agent: manifest.agent,
      protocol: "kerminal-mcp/resource/agent-profile",
    };
  }

  if (request.uri === "kerminal://agent/skills") {
    const referencedToolIds = new Set(
      manifest.skills.flatMap((skill) => skill.toolIds),
    );
    const exposedToolIds = new Set(manifest.tools.tools.map((tool) => tool.name));
    return {
      protocol: "kerminal-mcp/resource/agent-skills",
      skillCount: manifest.skills.length,
      skills: manifest.skills,
      toolCoverage: {
        missingToolIds: [...referencedToolIds].filter(
          (toolId) => !previewTools.some((tool) => tool.id === toolId),
        ),
        referencedToolCount: referencedToolIds.size,
        unavailableToolIds: [...referencedToolIds].filter(
          (toolId) => !exposedToolIds.has(toolId),
        ),
      },
    };
  }

  if (request.uri === "kerminal://agent/system-prompt") {
    return {
      agentId: manifest.agent.id,
      prompt: previewAgentSystemPrompt(),
      protocol: "kerminal-mcp/resource/agent-system-prompt",
    };
  }

  if (request.uri === "kerminal://application/context/current") {
    if (request.applicationContext) {
      return {
        available: true,
        context: request.applicationContext,
        notes: [
          "Kerminal Agent 是当前应用的操作层；应用上下文是感知，MCP 工具是可受控调用的手脚。",
          "浏览器预览只回显调用方提供的工作台摘要。",
        ],
        protocol: "kerminal-mcp/resource/application-context",
      };
    }

    return {
      available: false,
      protocol: "kerminal-mcp/resource/application-context",
      reason: "浏览器预览没有提供 active tab、focused pane 和选中主机摘要。",
    };
  }

  if (request.uri === "kerminal://terminal-context/current") {
    if (request.terminalContext) {
      return {
        available: true,
        protocol: "kerminal-mcp/resource/terminal-context",
        request: request.terminalContext,
      };
    }

    return {
      available: false,
      protocol: "kerminal-mcp/resource/terminal-context",
      reason: "浏览器预览没有活动终端 session。",
    };
  }

  if (request.uri === "kerminal://ai/audit-summary") {
    return {
      count: 0,
      limit: request.auditLimit ?? null,
      protocol: "kerminal-mcp/resource/ai-audit-summary",
      records: [],
    };
  }

  if (request.uri === "kerminal://settings/ai-policy") {
    return {
      notes: [
        "浏览器预览不会读取真实凭据。",
        "远程和破坏性工具仍由 Kerminal 确认策略控制。",
      ],
      policy: {
        allowDestructiveTools: false,
        contextMaxOutputBytes: 12288,
        includeCommandHistory: false,
        requireRemoteApproval: true,
      },
      protocol: "kerminal-mcp/resource/ai-policy",
    };
  }

  if (request.uri === "kerminal://settings/custom-mcp") {
    return {
      enabled: {
        servers: 0,
        skillDirectories: 0,
        tools: 0,
      },
      notes: [
        "env 和 header 只暴露 key 名称，不返回 value。",
        "MCP tools 必须由 server discovery 写入缓存；设置页不允许手填 tool schema。",
        "自定义 skills 使用文件夹 + SKILL.md 约定。",
      ],
      protocol: "kerminal-mcp/resource/custom-mcp",
      serverCount: 0,
      servers: [],
      skillDirectoryCount: 0,
      skillDirectories: [],
      toolCount: 0,
    };
  }

  return {};
}

function previewAgentSystemPrompt() {
  return [
    `你是 ${previewAgentProfile.name}，${previewAgentProfile.role}。默认使用中文回复。`,
    "你可以阅读当前应用上下文、终端上下文、MCP 工具目录、Agent profile 和 skills catalog，但本次 LLM 回复本身不会自动执行工具。",
    "你必须根据 skills catalog 选择合适能力路径，再选择对应 MCP 工具。",
    previewAgentProfile.toolCallProtocol,
    "工具调用建议必须只使用 MCP 工具目录中存在且已启用的 toolId；不要发明工具、参数或执行结果。",
    "远程、批量、写入、删除、覆盖、停止服务、清空记录、权限变更等操作必须说明风险并等待 Kerminal 确认。",
  ].join("\n");
}

function buildPreviewMcpPrompt(
  request: McpPromptRenderRequest,
): McpPromptRenderResult {
  const manifest = buildPreviewMcpManifest();
  const prompt = manifest.prompts.find((item) => item.name === request.name);
  if (!prompt) {
    throw new Error(`未知 MCP prompt: ${request.name}`);
  }

  const promptArguments = request.arguments ?? {};
  const missing = prompt.arguments
    .filter((argument) => argument.required)
    .filter((argument) => !hasPromptArgument(promptArguments, argument.name))
    .map((argument) => argument.name);
  if (missing.length > 0) {
    throw new Error(`MCP prompt 参数缺失: ${missing.join(", ")}`);
  }

  return {
    arguments: promptArguments,
    description: prompt.description,
    generatedAt: "browser-preview",
    messages: [
      {
        contentType: "text",
        role: "user",
        text: previewPromptText(
          request.name,
          promptArguments,
          request.terminalContext,
          request.applicationContext,
        ),
      },
    ],
    name: prompt.name,
    protocol: "kerminal-mcp/prompts/get",
    title: prompt.title,
  };
}

function hasPromptArgument(
  promptArguments: Record<string, unknown>,
  name: string,
) {
  const value = promptArguments[name];
  if (value === null || value === undefined) {
    return false;
  }
  return typeof value !== "string" || value.trim().length > 0;
}

function previewPromptText(
  promptName: string,
  promptArguments: Record<string, unknown>,
  terminalContext: unknown,
  applicationContext: unknown,
) {
  const applicationContextLine = applicationContext
    ? `浏览器预览收到应用上下文：${JSON.stringify(applicationContext)}`
    : "浏览器预览没有当前应用上下文。";
  const terminalContextLine = terminalContext
    ? `浏览器预览收到终端上下文请求：${JSON.stringify(terminalContext)}`
    : "浏览器预览没有活动终端上下文。";
  const contextLine = `${applicationContextLine}\n${terminalContextLine}`;

  if (promptName === "kerminal.terminal.explain") {
    return [
      "你是 Kerminal 的终端解释助手。只解释和建议，不执行命令。",
      `关注点：${String(promptArguments.focus ?? "当前终端最近输出")}`,
      contextLine,
    ].join("\n\n");
  }

  if (promptName === "kerminal.remote.safe_ops") {
    return [
      "你是 Kerminal 的远程操作安全规划助手。请生成先读后写、可确认、可审计的计划。",
      `远程主机 ID：${String(promptArguments.hostId ?? "-")}`,
      `任务：${String(promptArguments.task ?? "-")}`,
      contextLine,
    ].join("\n\n");
  }

  if (promptName === "kerminal.agent.route") {
    return [
      "你是 Kerminal Agent 的 skill 路由器。请根据用户目标选择合适的 skill 和候选 MCP 工具，只做规划，不执行操作。",
      `用户目标：${String(promptArguments.goal ?? "-")}`,
      `约束：${String(promptArguments.constraints ?? "用户未提供额外约束。")}`,
      "输出要求：推荐 skill id、候选 MCP 工具、关键参数缺口和风险确认。",
      contextLine,
    ].join("\n\n");
  }

  return [
    "你是 Kerminal 的开发终端助手。请建议下一步命令，但不自动执行。",
    `目标：${String(promptArguments.goal ?? "-")}`,
    contextLine,
  ].join("\n\n");
}
