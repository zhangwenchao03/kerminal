import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiToolPendingInvocation } from "../../lib/aiToolInvocationApi";
import type { Machine, TerminalPane, TerminalTab } from "../workspace/types";
import { AiToolContent } from "./AiToolContent";

const contextApiMock = vi.hoisted(() => ({
  getAiTerminalContextSnapshot: vi.fn(),
}));
const agentApiMock = vi.hoisted(() => ({
  streamAiChatMessage: vi.fn(),
}));
const providerApiMock = vi.hoisted(() => ({
  listLlmProviders: vi.fn(),
}));
const invocationApiMock = vi.hoisted(() => ({
  clearAiToolAudits: vi.fn(),
  confirmAiToolInvocation: vi.fn(),
  exportAiToolAudits: vi.fn(),
  listAiToolAudits: vi.fn(),
}));
const sessionRegistryMock = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
}));

vi.mock("../../lib/aiAgentApi", () => agentApiMock);
vi.mock("../../lib/llmProviderApi", () => providerApiMock);
vi.mock("../../lib/aiContextApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiContextApi")>(
    "../../lib/aiContextApi",
  );
  return {
    ...actual,
    getAiTerminalContextSnapshot: contextApiMock.getAiTerminalContextSnapshot,
  };
});
vi.mock("../../lib/aiToolInvocationApi", () => invocationApiMock);
vi.mock("../terminal/terminalSessionRegistry", () => sessionRegistryMock);

const activeTab: TerminalTab = {
  id: "tab-1",
  layout: { paneId: "pane-1", type: "pane" },
  machineId: "local-powershell",
  title: "本地终端",
};

const focusedPane: TerminalPane = {
  id: "pane-1",
  latencyMs: 1,
  lines: [],
  machineId: "local-powershell",
  mode: "local",
  prompt: "PS>",
  status: "online",
  title: "本地 PowerShell",
};

const selectedMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  latencyMs: 1,
  name: "PowerShell",
  status: "online",
  tags: ["local"],
};

const splitPendingInvocation: AiToolPendingInvocation = {
  argumentsSummary: "direction=horizontal",
  audit: "summary",
  clientAction: {
    direction: "horizontal",
    kind: "workspaceSplitPane",
  },
  confirmation: "contextual",
  createdAt: "3",
  id: "tool-call-split",
  reason: "AI 请求向右拆分当前终端工作区。",
  requestedBy: "kerminal-agent",
  requiresConfirmation: true,
  risk: "write",
  status: "pending",
  toolId: "workspace.split_pane",
  toolTitle: "拆分终端工作区",
};

const splitAuditRecord = {
  argumentsSummary: "direction=horizontal",
  completedAt: "4",
  confirmation: "contextual" as const,
  createdAt: "3",
  error: null,
  id: "tool-audit-split",
  invocationId: "tool-call-split",
  resultSummary: "工作区左右分屏已批准。",
  risk: "write" as const,
  status: "succeeded" as const,
  toolId: "workspace.split_pane",
  toolTitle: "拆分终端工作区",
};

function renderAiToolContent(
  props: Partial<ComponentProps<typeof AiToolContent>> = {},
) {
  return render(
    <AiToolContent
      activeTab={activeTab}
      focusedPane={focusedPane}
      selectedMachine={selectedMachine}
      {...props}
    />,
  );
}

describe("AiToolContent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    contextApiMock.getAiTerminalContextSnapshot.mockReset();
    agentApiMock.streamAiChatMessage.mockReset();
    providerApiMock.listLlmProviders.mockReset();
    invocationApiMock.clearAiToolAudits.mockReset();
    invocationApiMock.confirmAiToolInvocation.mockReset();
    invocationApiMock.exportAiToolAudits.mockReset();
    invocationApiMock.listAiToolAudits.mockReset();
    sessionRegistryMock.getTerminalPaneSession.mockReset();

    sessionRegistryMock.getTerminalPaneSession.mockReturnValue("session-1");
    providerApiMock.listLlmProviders.mockResolvedValue([
      {
        apiKeyConfigured: true,
        apiKeyCredentialRef: "credential:llm/llm-test/api-key",
        baseUrl: "https://api.test/v1",
        contextStrategy: "currentTerminal",
        createdAt: "1",
        enabled: true,
        id: "llm-test",
        isDefault: true,
        kind: "openAiChat",
        model: "gpt-test",
        name: "测试 Provider",
        temperature: 0.2,
        updatedAt: "1",
      },
    ]);
    invocationApiMock.listAiToolAudits.mockResolvedValue([]);
    agentApiMock.streamAiChatMessage.mockImplementation(async (_request, options) => {
      const response = {
        contextUsed: true,
        conversationId: "chat-1",
        generatedAt: "1",
        message: "这是 AI 回复。",
        model: "gpt-test",
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 20,
        pendingInvocations: [],
      };
      options?.onStep?.({
        id: "prepare",
        status: "done",
        title: "请求已整理",
      });
      options?.onDelta?.(response.message);
      return response;
    });
    contextApiMock.getAiTerminalContextSnapshot.mockResolvedValue({
      generatedAt: "1",
      output: {
        capturedBytes: 32,
        data: "cargo test\nkerminal context ready",
        maxBytes: 12288,
        truncated: false,
      },
      policy: {
        includesFullHistory: false,
        includesRecentOutput: true,
        maxOutputBytes: 12288,
        mode: "currentTerminal",
        secretRedaction: true,
      },
      redacted: false,
      session: {
        cols: 80,
        cwd: "C:/dev/rust/kerminal",
        id: "session-1",
        rows: 24,
        shell: "powershell.exe",
        status: "running",
      },
      source: {
        machineId: "local-powershell",
        machineKind: "local",
        machineName: "PowerShell",
        paneId: "pane-1",
        paneTitle: "本地 PowerShell",
        tabId: "tab-1",
        tabTitle: "本地终端",
      },
    });
  });

  it("renders a conversational assistant instead of the full tool catalog", async () => {
    const user = userEvent.setup();
    renderAiToolContent();

    expect(
      await screen.findByRole("heading", { name: "Kerminal Agent" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("历史会话")).not.toBeInTheDocument();
    expect(
      screen.getByText("描述你想做什么，Kerminal Agent 会结合当前应用上下文和终端状态协助你。"),
    ).toBeInTheDocument();
    expect(await screen.findByText(/当前上下文已连接/)).toBeInTheDocument();
    expect(screen.getByText(/本地 PowerShell/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "AI 执行模式" })).toHaveAttribute(
      "data-value",
      "risky",
    );
    expect(screen.getByRole("combobox", { name: "AI 模型" })).toHaveAttribute(
      "data-value",
      "llm-test",
    );
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    expect(screen.getByText("历史会话")).toBeInTheDocument();
    expect(screen.queryByText("MCP 本地清单")).not.toBeInTheDocument();
    expect(screen.queryByText("受控工具调用")).not.toBeInTheDocument();
    expect(contextApiMock.getAiTerminalContextSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: "pane-1",
        sessionId: "session-1",
        tabId: "tab-1",
      }),
    );
  });

  it("sends an AI chat message with the current terminal context", async () => {
    const user = userEvent.setup();
    renderAiToolContent();

    await screen.findByText("Kerminal Agent");
    await user.type(screen.getByLabelText("AI 对话输入"), "帮我解释当前输出");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledWith(
        {
          conversationId: expect.any(String),
          applicationContext: expect.objectContaining({
            activeToolId: "ai",
            activeTab: expect.objectContaining({
              id: "tab-1",
              title: "本地终端",
            }),
            focusedPane: expect.objectContaining({
              id: "pane-1",
              sessionId: "session-1",
              title: "本地 PowerShell",
            }),
            selectedMachine: expect.objectContaining({
              id: "local-powershell",
              kind: "local",
              name: "PowerShell",
            }),
          }),
          executionVisibility: "terminal",
          message: "帮我解释当前输出",
          providerId: "llm-test",
          terminalContext: expect.objectContaining({
            maxOutputBytes: 12288,
            paneId: "pane-1",
            sessionId: "session-1",
            tabId: "tab-1",
          }),
        },
        expect.objectContaining({
          onDelta: expect.any(Function),
          onStep: expect.any(Function),
        }),
      );
    });
    expect((await screen.findAllByText("帮我解释当前输出")).length).toBeGreaterThan(0);
    expect(await screen.findByText("这是 AI 回复。")).toBeInTheDocument();
    expect(screen.getAllByText(/测试 Provider · gpt-test/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("已使用上下文")).toBeInTheDocument();
    expect(screen.getByText("请求已整理")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 处理过程")).toBeInTheDocument();
  });

  it("lets users choose whether AI commands run in the visible terminal or background", async () => {
    const user = userEvent.setup();
    renderAiToolContent();

    await screen.findByRole("heading", { name: "Kerminal Agent" });
    expect(
      screen.getByRole("button", { name: "命令显示在终端" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "命令后台运行" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "命令后台运行" }));
    expect(screen.getByRole("button", { name: "命令后台运行" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.type(screen.getByLabelText("AI 对话输入"), "后台执行一次检查");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          executionVisibility: "background",
          message: "后台执行一次检查",
        }),
        expect.anything(),
      );
    });

    expect(window.localStorage.getItem("kerminal.ai.command-visibility.v1")).toBe(
      "background",
    );
  });

  it("renders streamed process steps and markdown content", async () => {
    const user = userEvent.setup();
    agentApiMock.streamAiChatMessage.mockImplementation(async (_request, options) => {
      const response = {
        contextUsed: true,
        conversationId: "chat-1",
        generatedAt: "1",
        message: "## 处理结果\n\n- 已读取上下文\n- 建议运行 `npm run build`",
        model: "gpt-test",
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 20,
        pendingInvocations: [],
      };
      options?.onStep?.({
        id: "provider",
        status: "active",
        title: "等待模型响应",
      });
      options?.onDelta?.("## 处理结果\n\n");
      options?.onDelta?.("- 已读取上下文\n");
      options?.onDelta?.("- 建议运行 `npm run build`");
      return response;
    });

    renderAiToolContent();

    await user.type(screen.getByLabelText("AI 对话输入"), "给我一个计划");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect(await screen.findByRole("heading", { name: "处理结果" })).toBeInTheDocument();
    expect(screen.getByText("等待模型响应")).toBeInTheDocument();
    expect(screen.getByText("已读取上下文")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
  });

  it("continues a conversation by sending a compact history transcript", async () => {
    const user = userEvent.setup();
    agentApiMock.streamAiChatMessage
      .mockResolvedValueOnce({
        contextUsed: true,
        conversationId: "chat-1",
        generatedAt: "1",
        message: "第一条回复。",
        model: "gpt-test",
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 20,
        pendingInvocations: [],
      })
      .mockResolvedValueOnce({
        contextUsed: true,
        conversationId: "chat-1",
        generatedAt: "2",
        message: "第二条回复。",
        model: "gpt-test",
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 20,
        pendingInvocations: [],
      });

    renderAiToolContent();

    await user.type(screen.getByLabelText("AI 对话输入"), "帮我解释当前输出");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));
    expect(await screen.findByText("第一条回复。")).toBeInTheDocument();

    await user.type(screen.getByLabelText("AI 对话输入"), "继续给下一步");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      const secondRequest = agentApiMock.streamAiChatMessage.mock.calls[1][0];
      expect(secondRequest.message).toContain("<history>");
      expect(secondRequest.message).toContain("用户: 帮我解释当前输出");
      expect(secondRequest.message).toContain("AI: 第一条回复。");
      expect(secondRequest.message).toContain("用户最新问题: 继续给下一步");
    });
    expect(await screen.findByText("第二条回复。")).toBeInTheDocument();
  });

  it("creates and switches between local history conversations", async () => {
    const user = userEvent.setup();
    renderAiToolContent();

    expect(screen.getByRole("button", { name: "新建 AI 对话" })).toBeDisabled();

    await user.type(screen.getByLabelText("AI 对话输入"), "定位构建失败原因");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));
    expect(await screen.findByText("这是 AI 回复。")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "新建 AI 对话" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "新建 AI 对话" }));
    expect(
      screen.getByText("描述你想做什么，Kerminal Agent 会结合当前应用上下文和终端状态协助你。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建 AI 对话" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    expect(screen.getByText("定位构建失败原因")).toBeInTheDocument();
    expect(screen.queryByText("新对话")).not.toBeInTheDocument();

    await user.click(screen.getByText("定位构建失败原因"));
    expect(screen.getByText("这是 AI 回复。")).toBeInTheDocument();

    const raw = window.localStorage.getItem("kerminal.ai.conversations.v1");
    expect(raw).toContain("定位构建失败原因");
    expect(raw).not.toContain("新对话");
  });

  it("searches history and filters legacy blank conversations", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    window.localStorage.setItem(
      "kerminal.ai.conversations.v1",
      JSON.stringify({
        activeConversationId: "blank-legacy",
        conversations: [
          {
            createdAt: now - 30_000,
            id: "blank-legacy",
            messages: [],
            title: "旧空白会话",
            updatedAt: now,
          },
          {
            createdAt: now - 20_000,
            id: "conv-build",
            messages: [
              {
                content: "npm run build 报错，需要定位前端构建失败。",
                createdAt: now - 19_000,
                id: "build-user",
                role: "user",
              },
              {
                content: "优先检查 TypeScript 类型错误。",
                createdAt: now - 18_000,
                id: "build-ai",
                model: "gpt-test",
                providerName: "测试 Provider",
                role: "assistant",
              },
            ],
            title: "构建失败定位",
            updatedAt: now - 18_000,
          },
          {
            createdAt: now - 10_000,
            id: "conv-deploy",
            messages: [
              {
                content: "请检查 rsync 部署脚本。",
                createdAt: now - 9_000,
                id: "deploy-user",
                role: "user",
              },
            ],
            title: "发布策略",
            updatedAt: now - 9_000,
          },
        ],
      }),
    );

    renderAiToolContent();

    await user.click(screen.getByRole("button", { name: "查看历史会话" }));

    expect(screen.queryByText("旧空白会话")).not.toBeInTheDocument();
    expect(screen.getByText("构建失败定位")).toBeInTheDocument();
    expect(screen.getByText("发布策略")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "搜索历史会话" }), "rsync");

    expect(screen.queryByText("构建失败定位")).not.toBeInTheDocument();
    expect(screen.getByText("发布策略")).toBeInTheDocument();

    await waitFor(() => {
      const raw = window.localStorage.getItem("kerminal.ai.conversations.v1");
      expect(raw).not.toContain("blank-legacy");
      expect(raw).not.toContain("旧空白会话");
    });
  });

  it("opens the AI settings section from the toolbar settings button", async () => {
    const user = userEvent.setup();
    const onOpenSettingsSection = vi.fn();

    renderAiToolContent({ onOpenSettingsSection });

    await user.click(screen.getByRole("button", { name: "打开 AI 设置" }));

    expect(onOpenSettingsSection).toHaveBeenCalledWith("settings-ai");
  });

  it("confirms a controlled invocation returned by standard tool calling", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();
    agentApiMock.streamAiChatMessage.mockImplementation(async (_request, options) => {
      const response = {
        contextUsed: true,
        conversationId: "chat-1",
        generatedAt: "1",
        message: "建议向右拆分一个终端，等待你确认。",
        model: "gpt-test",
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 20,
        pendingInvocations: [splitPendingInvocation],
      };
      options?.onDelta?.(response.message);
      return response;
    });
    invocationApiMock.confirmAiToolInvocation.mockResolvedValue(splitAuditRecord);

    renderAiToolContent({ onSplitPane });

    await user.type(screen.getByLabelText("AI 对话输入"), "帮我拆分终端");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect((await screen.findAllByText("direction=horizontal")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "批准" }));

    await waitFor(() => {
      expect(invocationApiMock.confirmAiToolInvocation).toHaveBeenCalledWith({
        approved: true,
        invocationId: "tool-call-split",
      });
      expect(onSplitPane).toHaveBeenCalledWith("horizontal");
    });
    await user.click(screen.getByRole("button", { name: "查看工具审计" }));
    expect(
      await screen.findByText("工作区左右分屏已批准。"),
    ).toBeInTheDocument();
  });
});
