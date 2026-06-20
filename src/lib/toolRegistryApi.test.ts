import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  McpGatewayManifest,
  McpPromptRenderResult,
  McpToolList,
  ToolDefinition,
} from "../features/tool-panel/toolRegistryModel";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

const tool: ToolDefinition = {
  audit: "summary",
  category: "terminal",
  confirmation: "contextual",
  description: "向终端写入输入。",
  enabled: true,
  exposedToMcp: true,
  id: "terminal.write",
  inputSchema: { properties: {}, required: [], type: "object" },
  risk: "write",
  title: "写入终端",
};

const mcpList: McpToolList = {
  protocol: "mcp-tools/list",
  tools: [
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      audit: "summary",
      confirmation: "contextual",
      description: "向终端写入输入。",
      inputSchema: { properties: {}, required: [], type: "object" },
      name: "terminal.write",
      origin: "system",
      risk: "write",
      serverId: null,
      sourceToolId: "terminal.write",
      title: "写入终端",
    },
  ],
};

const manifest: McpGatewayManifest = {
  agent: {
    capabilities: [],
    defaultLanguage: "zh-CN",
    description: "用于测试的 Kerminal Agent。",
    id: "kerminal-agent",
    name: "Kerminal Agent",
    operatingRules: [],
    role: "本地终端操作代理",
    title: "Kerminal Agent",
    toolCallProtocol: "mcp-tools/call",
  },
  generatedAt: "42",
  prompts: [
    {
      arguments: [{ description: "目标。", name: "goal", required: true }],
      description: "选择 Agent skill。",
      name: "kerminal.agent.route",
      title: "选择 Agent Skill",
    },
    {
      arguments: [{ description: "目标。", name: "goal", required: true }],
      description: "建议下一步命令。",
      name: "kerminal.terminal.suggest",
      title: "建议下一步命令",
    },
  ],
  protocol: "kerminal-mcp/manifest",
  resources: [
    {
      description: "当前应用上下文。",
      dynamic: true,
      mimeType: "application/json",
      name: "application-context-current",
      title: "当前应用上下文",
      uri: "kerminal://application/context/current",
    },
    {
      description: "工具目录。",
      dynamic: false,
      mimeType: "application/json",
      name: "tool-registry",
      title: "工具目录",
      uri: "kerminal://tool-registry",
    },
  ],
  security: {
    auditEnabled: true,
    externalAccessEnabled: false,
    localOnly: true,
    notes: ["需要确认。"],
    requiresKerminalConfirmation: true,
    secretsRedacted: true,
  },
  server: {
    description: "Kerminal MCP 清单。",
    name: "kerminal",
    title: "Kerminal",
    version: "0.1.0",
  },
  skills: [
    {
      description: "处理本地终端和工作区。",
      id: "terminal-workspace",
      origin: "system",
      promptGuidance: "写入终端前说明风险。",
      title: "终端与工作区控制",
      toolIds: ["terminal.write"],
      triggerExamples: ["运行测试"],
      whenToUse: "用户要求运行本地命令时使用。",
    },
  ],
  tools: mcpList,
  transports: [
    {
      args: [],
      command: undefined,
      description: "应用内 rmcp。",
      endpoint: undefined,
      envKeys: [],
      headerKeys: [],
      id: "system.in_process_rmcp",
      kind: "in-process-rmcp",
      origin: "system",
      status: "enabled",
      title: "应用内 rmcp 网关",
    },
  ],
};

const resourceResult = {
  content: {
    policy: {
      allowDestructiveTools: false,
      contextMaxOutputBytes: 12288,
      includeCommandHistory: false,
      requireRemoteApproval: true,
    },
    protocol: "kerminal-mcp/resource/ai-policy",
  },
  generatedAt: "43",
  mimeType: "application/json",
  name: "ai-policy",
  title: "AI 安全策略",
  uri: "kerminal://settings/ai-policy",
};

const promptResult: McpPromptRenderResult = {
  arguments: { goal: "解释测试失败" },
  description: "结合当前终端上下文建议下一步命令。",
  generatedAt: "44",
  messages: [
    {
      contentType: "text",
      role: "user",
      text: "请建议下一步命令，但不自动执行。",
    },
  ],
  name: "kerminal.terminal.suggest",
  protocol: "kerminal-mcp/prompts/get",
  title: "建议下一步命令",
};

describe("toolRegistryApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists registry tools through Tauri commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([tool]);
    const { listToolRegistry } = await import("./toolRegistryApi");

    const tools = await listToolRegistry();

    expect(invokeMock).toHaveBeenCalledWith("tool_registry_list");
    expect(tools[0]).toMatchObject({
      id: "terminal.write",
      risk: "write",
    });
  });

  it("lists MCP-compatible tools through a dedicated command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(mcpList);
    const { listMcpTools } = await import("./toolRegistryApi");

    const result = await listMcpTools();

    expect(invokeMock).toHaveBeenCalledWith("tool_registry_mcp_list");
    expect(result.tools[0]).toMatchObject({
      name: "terminal.write",
      sourceToolId: "terminal.write",
    });
  });

  it("loads the MCP gateway manifest through a dedicated command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(manifest);
    const { getMcpGatewayManifest } = await import("./toolRegistryApi");

    const result = await getMcpGatewayManifest();

    expect(invokeMock).toHaveBeenCalledWith("tool_registry_mcp_manifest");
    expect(result).toMatchObject({
      agent: { name: "Kerminal Agent" },
      protocol: "kerminal-mcp/manifest",
      server: { name: "kerminal" },
      security: { externalAccessEnabled: false },
    });
    expect(result.skills[0]).toMatchObject({
      id: "terminal-workspace",
      toolIds: ["terminal.write"],
    });
    expect(result.transports[0]).toMatchObject({
      command: null,
      endpoint: null,
      kind: "in-process-rmcp",
    });
  });

  it("loads and starts the local HTTP MCP server through dedicated commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        bindAddress: "127.0.0.1",
        endpoint: null,
        localOnly: true,
        port: null,
        running: false,
      })
      .mockResolvedValueOnce({
        bindAddress: "127.0.0.1",
        endpoint: "http://127.0.0.1:30456/mcp",
        localOnly: true,
        port: 30456,
        running: true,
      });
    const { getMcpHttpServerStatus, startMcpHttpServer } = await import(
      "./toolRegistryApi"
    );

    const current = await getMcpHttpServerStatus();
    const started = await startMcpHttpServer();

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "tool_registry_mcp_http_status",
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "tool_registry_mcp_http_start",
      { request: null },
    );
    expect(current).toMatchObject({ running: false, endpoint: null });
    expect(started).toMatchObject({
      endpoint: "http://127.0.0.1:30456/mcp",
      port: 30456,
      running: true,
    });
  });

  it("reads MCP resources through a dedicated command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(resourceResult);
    const { readMcpResource } = await import("./toolRegistryApi");

    const result = await readMcpResource({
      applicationContext: {
        activeToolId: "ai",
        focusedPane: { id: "pane-1", mode: "local", status: "online", title: "本地终端" },
      },
      auditLimit: 5,
      uri: "kerminal://settings/ai-policy",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "tool_registry_mcp_resource_read",
      {
        request: {
          applicationContext: {
            activeToolId: "ai",
            focusedPane: { id: "pane-1", mode: "local", status: "online", title: "本地终端" },
          },
          auditLimit: 5,
          uri: "kerminal://settings/ai-policy",
        },
      },
    );
    expect(result).toMatchObject({
      content: { protocol: "kerminal-mcp/resource/ai-policy" },
      mimeType: "application/json",
      title: "AI 安全策略",
    });
  });

  it("renders MCP prompts through a dedicated command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(promptResult);
    const { renderMcpPrompt } = await import("./toolRegistryApi");

    const result = await renderMcpPrompt({
      arguments: { goal: "解释测试失败" },
      applicationContext: {
        activeToolId: "ai",
        focusedPane: { id: "pane-1", mode: "local", status: "online", title: "本地终端" },
      },
      name: "kerminal.terminal.suggest",
      terminalContext: { sessionId: "session-1" },
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "tool_registry_mcp_prompt_render",
      {
        request: {
          arguments: { goal: "解释测试失败" },
          applicationContext: {
            activeToolId: "ai",
            focusedPane: { id: "pane-1", mode: "local", status: "online", title: "本地终端" },
          },
          name: "kerminal.terminal.suggest",
          terminalContext: { sessionId: "session-1" },
        },
      },
    );
    expect(result).toMatchObject({
      messages: [{ contentType: "text", role: "user" }],
      name: "kerminal.terminal.suggest",
      protocol: "kerminal-mcp/prompts/get",
    });
  });

  it("returns preview tools without Tauri and filters disabled MCP tools", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      getMcpGatewayManifest,
      listMcpTools,
      listToolRegistry,
      readMcpResource,
      renderMcpPrompt,
    } =
      await import("./toolRegistryApi");

    const registry = await listToolRegistry();
    const mcp = await listMcpTools();
    const previewManifest = await getMcpGatewayManifest();
    const previewResource = await readMcpResource({
      uri: "kerminal://tool-registry",
    });
    const previewAgentSkills = await readMcpResource({
      uri: "kerminal://agent/skills",
    });
    const previewApplicationContext = await readMcpResource({
      applicationContext: {
        activeToolId: "ai",
        focusedPane: {
          id: "pane-preview",
          mode: "local",
          status: "online",
          title: "预览终端",
        },
      },
      uri: "kerminal://application/context/current",
    });
    const previewSystemPrompt = await readMcpResource({
      uri: "kerminal://agent/system-prompt",
    });
    const previewCustomMcp = await readMcpResource({
      uri: "kerminal://settings/custom-mcp",
    });
    const previewPrompt = await renderMcpPrompt({
      arguments: { goal: "排查当前错误" },
      applicationContext: {
        activeToolId: "ai",
        focusedPane: {
          id: "pane-preview",
          mode: "local",
          status: "online",
          title: "预览终端",
        },
      },
      name: "kerminal.terminal.suggest",
      terminalContext: { sessionId: "browser-preview-session" },
    });
    const previewRoutePrompt = await renderMcpPrompt({
      arguments: { constraints: "只读优先", goal: "打开 SFTP 面板并预览日志" },
      applicationContext: {
        activeToolId: "ai",
        focusedPane: {
          id: "pane-preview",
          mode: "local",
          status: "online",
          title: "预览终端",
        },
      },
      name: "kerminal.agent.route",
    });

    expect(registry.some((item) => item.id === "workflow.run")).toBe(true);
    expect(registry.some((item) => item.id === "ssh.command")).toBe(true);
    expect(registry.some((item) => item.id === "sftp.download")).toBe(true);
    expect(registry.some((item) => item.id === "sftp.move")).toBe(true);
    expect(registry.some((item) => item.id === "sftp.preview")).toBe(true);
    expect(registry.some((item) => item.id === "sftp.upload")).toBe(true);
    expect(registry.some((item) => item.id === "snippet.create")).toBe(true);
    expect(registry.some((item) => item.id === "workspace.focus_tab")).toBe(true);
    expect(registry.some((item) => item.id === "workspace.open_tool")).toBe(true);
    expect(registry.some((item) => item.id === "diagnostics.runtime_health")).toBe(true);
    expect(registry.some((item) => item.id === "diagnostics.create_bundle")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "ssh.command")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "sftp.download")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "sftp.move")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "sftp.preview")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "sftp.upload")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "snippet.create")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "workspace.focus_tab")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "workspace.open_tool")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "diagnostics.runtime_health")).toBe(true);
    expect(mcp.tools.some((item) => item.name === "diagnostics.create_bundle")).toBe(true);
    expect(registry.find((item) => item.id === "ssh.command")).toMatchObject({
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      title: "执行远程命令",
    });
    expect(
      registry.find((item) => item.id === "sftp.preview"),
    ).toMatchObject({
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      title: "预览远程文件",
    });
    expect(
      registry.find((item) => item.id === "snippet.create"),
    ).toMatchObject({
      audit: "summary",
      confirmation: "contextual",
      risk: "write",
      title: "创建脚本片段",
    });
    expect(
      registry.find((item) => item.id === "workspace.open_tool"),
    ).toMatchObject({
      audit: "summary",
      confirmation: "contextual",
      risk: "write",
      title: "打开工具面板",
    });
    expect(
      registry.find((item) => item.id === "diagnostics.runtime_health"),
    ).toMatchObject({
      audit: "summary",
      confirmation: "auto",
      risk: "read",
      title: "读取运行体检",
    });
    expect(
      registry.find((item) => item.id === "diagnostics.create_bundle"),
    ).toMatchObject({
      audit: "summary",
      confirmation: "contextual",
      risk: "write",
      title: "生成诊断包",
    });
    expect(mcp.tools.some((item) => item.name === "workflow.run")).toBe(false);
    expect(mcp.tools.length).toBeGreaterThan(5);
    expect(previewManifest.protocol).toBe("kerminal-mcp/manifest");
    expect(previewManifest.agent.name).toBe("Kerminal Agent");
    expect(previewManifest.skills.some((skill) => skill.id === "sftp-files")).toBe(true);
    expect(previewManifest.resources.length).toBeGreaterThan(0);
    expect(
      previewManifest.resources.some(
        (resource) => resource.uri === "kerminal://application/context/current",
      ),
    ).toBe(true);
    expect(
      previewManifest.resources.some(
        (resource) => resource.uri === "kerminal://settings/ai-policy",
      ),
    ).toBe(true);
    expect(
      previewManifest.resources.some(
        (resource) => resource.uri === "kerminal://settings/custom-mcp",
      ),
    ).toBe(true);
    expect(previewManifest.prompts.length).toBeGreaterThan(0);
    expect(
      previewManifest.prompts.some(
        (prompt) => prompt.name === "kerminal.terminal.explain",
      ),
    ).toBe(true);
    expect(previewManifest.security.externalAccessEnabled).toBe(false);
    expect(previewResource.content).toMatchObject({
      protocol: "kerminal-mcp/resource/tool-registry",
    });
    expect(previewAgentSkills.content).toMatchObject({
      protocol: "kerminal-mcp/resource/agent-skills",
    });
    expect(previewAgentSkills.content.toolCoverage).toMatchObject({
      missingToolIds: [],
      unavailableToolIds: [],
    });
    expect(previewApplicationContext.content).toMatchObject({
      available: true,
      protocol: "kerminal-mcp/resource/application-context",
    });
    expect(previewSystemPrompt.content).toMatchObject({
      agentId: "kerminal-agent",
      protocol: "kerminal-mcp/resource/agent-system-prompt",
    });
    expect(previewCustomMcp.content).toMatchObject({
      protocol: "kerminal-mcp/resource/custom-mcp",
      serverCount: 0,
      skillDirectoryCount: 0,
      toolCount: 0,
    });
    expect(previewPrompt).toMatchObject({
      name: "kerminal.terminal.suggest",
      protocol: "kerminal-mcp/prompts/get",
    });
    expect(previewPrompt.messages[0].text).toContain("不自动执行");
    expect(previewPrompt.messages[0].text).toContain("预览终端");
    expect(previewRoutePrompt.name).toBe("kerminal.agent.route");
    expect(previewRoutePrompt.messages[0].text).toContain("skill 路由器");
    expect(previewRoutePrompt.messages[0].text).toContain("预览终端");
    expect(
      previewManifest.transports.some((transport) => transport.status === "planned"),
    ).toBe(true);
  });
});
