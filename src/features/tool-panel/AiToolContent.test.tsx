import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiToolPendingInvocation } from "../../lib/aiToolInvocationApi";
import type { Machine, TerminalPane, TerminalTab } from "../workspace/types";
import { AiToolContent } from "./AiToolContent";

const contextApiMock = vi.hoisted(() => ({ getAiTerminalContextSnapshot: vi.fn() }));
const agentApiMock = vi.hoisted(() => ({ streamAiChatMessage: vi.fn() }));
const agentRunApiMock = vi.hoisted(() => ({
  cancelAiAgentRun: vi.fn(),
  getAiAgentRun: vi.fn(),
  resumeAiAgentRun: vi.fn(),
  retryAiAgentRunLastStep: vi.fn(),
}));
const providerApiMock = vi.hoisted(() => ({ listLlmProviders: vi.fn() }));
const invocationApiMock = vi.hoisted(() => ({
  clearAiToolAudits: vi.fn(),
  confirmAiToolInvocation: vi.fn(),
  exportAiToolAudits: vi.fn(),
  listAiToolAudits: vi.fn(),
}));
const snapshotApiMock = vi.hoisted(() => ({ getAiContextSnapshot: vi.fn() }));
const sessionRegistryMock = vi.hoisted(() => ({ getTerminalPaneSession: vi.fn() }));

vi.mock("../../lib/aiAgentApi", () => agentApiMock);
vi.mock("../../lib/aiAgentRunApi", () => agentRunApiMock);
vi.mock("../../lib/llmProviderApi", () => providerApiMock);
vi.mock("../../lib/aiContextApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiContextApi")>("../../lib/aiContextApi");
  return {
    ...actual,
    getAiTerminalContextSnapshot: contextApiMock.getAiTerminalContextSnapshot,
  };
});
vi.mock("../../lib/aiToolInvocationApi", () => invocationApiMock);
vi.mock("../../lib/aiConversationSnapshotApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiConversationSnapshotApi")>("../../lib/aiConversationSnapshotApi");
  return {
    ...actual,
    getAiContextSnapshot: snapshotApiMock.getAiContextSnapshot,
  };
});
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

const remoteHostPendingInvocation: AiToolPendingInvocation = {
  argumentsSummary:
    "name=OCR prod.example.com, host=prod.example.com, port=2222, username=deploy, authType=agent",
  audit: "summary",
  confirmation: "always",
  createdAt: "5",
  id: "tool-call-remote-host",
  reason: "图片 OCR 识别到 SSH 连接方式，建议保存为远程主机。",
  requestedBy: "kerminal-agent",
  requiresConfirmation: true,
  risk: "remote",
  status: "pending",
  toolId: "remote_host.create",
  toolTitle: "创建远程主机",
};

const remoteHostAuditRecord = {
  argumentsSummary:
    "name=OCR prod.example.com, host=prod.example.com, port=2222, username=deploy, authType=agent",
  completedAt: "6",
  confirmation: "always" as const,
  createdAt: "5",
  error: null,
  id: "tool-audit-remote-host",
  invocationId: "tool-call-remote-host",
  resultSummary: "已创建远程主机 OCR prod.example.com (deploy@prod.example.com:2222)。",
  risk: "remote" as const,
  status: "succeeded" as const,
  toolId: "remote_host.create",
  toolTitle: "创建远程主机",
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
    agentRunApiMock.cancelAiAgentRun.mockReset();
    agentRunApiMock.getAiAgentRun.mockReset();
    agentRunApiMock.resumeAiAgentRun.mockReset();
    agentRunApiMock.retryAiAgentRunLastStep.mockReset();
    providerApiMock.listLlmProviders.mockReset();
    invocationApiMock.clearAiToolAudits.mockReset();
    invocationApiMock.confirmAiToolInvocation.mockReset();
    invocationApiMock.exportAiToolAudits.mockReset();
    invocationApiMock.listAiToolAudits.mockReset();
    snapshotApiMock.getAiContextSnapshot.mockReset();
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
    agentRunApiMock.resumeAiAgentRun.mockResolvedValue({
      finalMessage: null,
      lastObservation: null,
      pendingInvocation: null,
      snapshot: {
        run: {
          conversationId: null,
          conversationSlotJson: null,
          createdAt: 1,
          goal: "goal",
          id: "run-default",
          iteration: 1,
          maxIterations: 20,
          maxToolCalls: 5,
          status: "completed",
          updatedAt: 2,
        },
        steps: [],
      },
    });
    agentRunApiMock.getAiAgentRun.mockResolvedValue({
      run: {
        conversationId: "chat-1",
        conversationSlotJson: null,
        createdAt: 1,
        goal: "goal",
        id: "run-default",
        iteration: 1,
        maxIterations: 20,
        maxToolCalls: 5,
        status: "waitingApproval",
        updatedAt: 2,
      },
      steps: [],
    });
    agentRunApiMock.cancelAiAgentRun.mockResolvedValue({
      run: {
        conversationId: "chat-1",
        conversationSlotJson: null,
        createdAt: 1,
        goal: "goal",
        id: "run-default",
        iteration: 1,
        maxIterations: 20,
        maxToolCalls: 5,
        status: "cancelled",
        updatedAt: 3,
      },
      steps: [],
    });
    agentRunApiMock.retryAiAgentRunLastStep.mockResolvedValue({
      finalMessage: null,
      lastObservation: null,
      pendingInvocation: null,
      snapshot: {
        run: {
          conversationId: "chat-1",
          conversationSlotJson: null,
          createdAt: 1,
          goal: "goal",
          id: "run-retry",
          iteration: 1,
          maxIterations: 20,
          maxToolCalls: 5,
          status: "running",
          updatedAt: 2,
        },
        steps: [],
      },
    });
    snapshotApiMock.getAiContextSnapshot.mockResolvedValue({
      applicationContextJson: JSON.stringify({
        activeTab: { id: "tab-audit", title: "prod tab" },
      }),
      attachmentRefsJson: JSON.stringify([{ id: "att-audit" }]),
      conversationId: "conv-audit",
      createdAt: 1_765_000_000_000,
      generatedAt: 1_765_000_000_000,
      id: "ctx-audit",
      messageId: "audit-user",
      policyJson: JSON.stringify({ providerId: "llm-test" }),
      routeMode: "followWorkspaceTarget",
      scopeKind: "lockedPane",
      scopeRefJson: JSON.stringify({ paneId: "pane-audit" }),
      targetRefJson: JSON.stringify({ machineName: "prod-api" }),
      terminalContextJson: JSON.stringify({ sessionId: "session-audit" }),
    });
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
    expect(screen.queryByText(/当前上下文已连接/)).not.toBeInTheDocument();
    const contextUsage = await screen.findByRole("status", {
      name: "使用量 1%",
    });
    expect(contextUsage).toHaveAttribute(
      "title",
      "1% · <0.1K/12K",
    );
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
          conversationSlotJson: expect.stringContaining("\"slotKey\":\"pane:pane-1\""),
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
    expect(screen.getByLabelText("AI 处理过程")).toHaveClass(
      "kerminal-muted-surface",
    );
    expect(screen.getByText("已使用上下文")).toHaveClass(
      "bg-[var(--surface-selected)]",
    );
  });

  it("keeps pane-bound chat usable without a readable terminal session", async () => {
    const user = userEvent.setup();
    sessionRegistryMock.getTerminalPaneSession.mockReturnValue(undefined);
    renderAiToolContent();

    await screen.findByText("Kerminal Agent");
    expect(
      (
        await screen.findAllByText(
          "终端会话未就绪，暂时不可读取终端上下文。",
        )
      ).length,
    ).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("AI 对话输入"), "帮我解释当前输出");
    const sendButton = screen.getByRole("button", { name: "发送 AI 消息" });
    expect(sendButton).not.toBeDisabled();
    await user.click(sendButton);

    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationContext: expect.objectContaining({
            activeTab: expect.objectContaining({ id: "tab-1" }),
            focusedPane: expect.objectContaining({
              id: "pane-1",
              sessionId: undefined,
            }),
            selectedMachine: expect.objectContaining({ id: "local-powershell" }),
          }),
          conversationSlotJson: expect.stringContaining(
            "\"slotKey\":\"pane:pane-1\"",
          ),
          message: "帮我解释当前输出",
          terminalContext: undefined,
        }),
        expect.anything(),
      );
    });
  });

  it("does not gate ordinary no-context chat when no terminal session exists", async () => {
    const user = userEvent.setup();
    sessionRegistryMock.getTerminalPaneSession.mockReturnValue(undefined);
    renderAiToolContent({
      activeTab: undefined,
      focusedPane: undefined,
      selectedMachine: undefined,
    });

    await screen.findByText("Kerminal Agent");
    await user.type(screen.getByLabelText("AI 对话输入"), "只聊一个普通问题");
    const sendButton = screen.getByRole("button", { name: "发送 AI 消息" });
    expect(sendButton).not.toBeDisabled();
    await user.click(sendButton);

    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationSlotJson: expect.stringContaining(
            "\"slotKey\":\"no-context\"",
          ),
          message: "只聊一个普通问题",
          terminalContext: undefined,
        }),
        expect.anything(),
      );
    });
  });

  it("shows when an assistant response used image pixels as vision input", async () => {
    const user = userEvent.setup();
    agentApiMock.streamAiChatMessage.mockImplementation(async (_request, options) => {
      const response = {
        contextUsed: true,
        conversationId: "chat-vision",
        generatedAt: "1",
        message: "这张图里有 SSH 连接信息。",
        model: "gpt-vision",
        pendingInvocations: [],
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 0,
        visionUsage: {
          attachments: [
            {
              effectiveUsage: "visionInput",
              id: "att-image",
              modelInput: "visionInput",
              requestedUsage: "visionInput",
              warning: null,
            },
          ],
          providerSupportsVision: true,
          visionAdapterEnabled: true,
        },
      };
      options?.onDelta?.(response.message);
      return response;
    });
    renderAiToolContent();

    await user.type(screen.getByLabelText("AI 对话输入"), "分析这张截图");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect(await screen.findByText("这张图里有 SSH 连接信息。")).toBeInTheDocument();
    expect(await screen.findByText(/图片已进入模型 1\/1/)).toBeInTheDocument();
  });

  it("lets users choose whether AI commands run in the visible terminal or background", async () => {
    const user = userEvent.setup();
    renderAiToolContent();

    await screen.findByRole("heading", { name: "Kerminal Agent" });
    const terminalModeButton = screen.getByRole("button", {
      name: "命令显示在终端",
    });
    const backgroundModeButton = screen.getByRole("button", {
      name: "命令后台运行",
    });
    expect(terminalModeButton).toHaveAttribute("aria-pressed", "true");
    expect(terminalModeButton).toHaveClass(
      "kerminal-focus-ring",
      "kerminal-pressable",
    );
    expect(backgroundModeButton).toHaveAttribute("aria-pressed", "false");
    expect(backgroundModeButton).toHaveClass(
      "kerminal-focus-ring",
      "kerminal-pressable",
    );

    await user.click(backgroundModeButton);
    expect(backgroundModeButton).toHaveAttribute("aria-pressed", "true");

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

  it("continues a conversation by sending structured history separately", async () => {
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
      expect(secondRequest.message).toBe("继续给下一步");
      expect(secondRequest.history).toEqual([
        { content: "帮我解释当前输出", role: "user" },
        { content: "第一条回复。", role: "assistant" },
      ]);
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

    const searchbox = screen.getByRole("searchbox", { name: "搜索历史会话" });
    await user.type(searchbox, "rsync");

    expect(screen.queryByText("构建失败定位")).not.toBeInTheDocument();
    expect(screen.getByText("发布策略")).toBeInTheDocument();
    const clearSearchButton = screen.getByRole("button", {
      name: "清空历史搜索",
    });
    expect(clearSearchButton).toHaveClass(
      "kerminal-focus-ring",
      "kerminal-pressable",
    );

    await user.click(clearSearchButton);
    expect(searchbox).toHaveValue("");

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
      expect(invocationApiMock.confirmAiToolInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          auditContext: expect.objectContaining({
            assistantMessageId: expect.any(String),
            conversationId: expect.any(String),
            userMessageId: expect.any(String),
          }),
          invocationId: "tool-call-split",
        }),
      );
      expect(onSplitPane).toHaveBeenCalledWith("horizontal");
    });
    await user.click(screen.getByRole("button", { name: "查看工具审计" }));
    expect(
      await screen.findByText("工作区左右分屏已批准。"),
    ).toBeInTheDocument();
  });

  it("refreshes remote hosts after approving an OCR-created remote host suggestion", async () => {
    const user = userEvent.setup();
    const onRemoteHostCreated = vi.fn().mockResolvedValue(undefined);
    agentApiMock.streamAiChatMessage.mockImplementation(
      async (_request, options) => {
        const response = {
          contextUsed: true,
          conversationId: "chat-1",
          generatedAt: "1",
          message: "我识别到 SSH 连接方式，已创建待确认的远程主机配置。",
          model: "gpt-test",
          pendingInvocations: [remoteHostPendingInvocation],
          providerId: "llm-test",
          providerName: "测试 Provider",
          responseRedacted: false,
          toolCount: 20,
        };
        options?.onDelta?.(response.message);
        return response;
      },
    );
    invocationApiMock.confirmAiToolInvocation.mockResolvedValue(
      remoteHostAuditRecord,
    );

    renderAiToolContent({ onRemoteHostCreated });

    await user.type(
      screen.getByLabelText("AI 对话输入"),
      "这张图里有 SSH 连接方式，帮我配置主机",
    );
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect(
      (await screen.findAllByText(/prod\.example\.com/)).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "批准" }));

    await waitFor(() => {
      expect(invocationApiMock.confirmAiToolInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          auditContext: expect.objectContaining({
            assistantMessageId: expect.any(String),
            conversationId: expect.any(String),
            userMessageId: expect.any(String),
          }),
          invocationId: "tool-call-remote-host",
        }),
      );
      expect(onRemoteHostCreated).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "查看工具审计" }));
    expect(
      await screen.findByText(/已创建远程主机 OCR prod\.example\.com/),
    ).toBeInTheDocument();
  });

  it("resumes the agent run after approving a run-bound pending invocation", async () => {
    const user = userEvent.setup();
    const runPendingInvocation: AiToolPendingInvocation = {
      ...remoteHostPendingInvocation,
      id: "tool-call-agent-run-host",
      runId: "run-agent-1",
      stepId: "step-tool-1",
    };
    const nextPendingInvocation: AiToolPendingInvocation = {
      ...splitPendingInvocation,
      argumentsSummary: "hostId=host-created",
      id: "tool-call-agent-run-ssh",
      runId: "run-agent-1",
      stepId: "step-tool-2",
      toolId: "ssh.connect",
      toolTitle: "连接 SSH 主机",
    };
    agentApiMock.streamAiChatMessage.mockImplementation(
      async (_request, options) => {
        const response = {
          contextUsed: true,
          conversationId: "chat-1",
          generatedAt: "1",
          message: "我会先创建主机，批准后继续连接。",
          model: "gpt-test",
          pendingInvocations: [runPendingInvocation],
          providerId: "llm-test",
          providerName: "测试 Provider",
          responseRedacted: false,
          toolCount: 20,
        };
        options?.onDelta?.(response.message);
        return response;
      },
    );
    invocationApiMock.confirmAiToolInvocation.mockResolvedValue({
      ...remoteHostAuditRecord,
      id: "tool-audit-agent-run-host",
      invocationId: "tool-call-agent-run-host",
    });
    agentRunApiMock.getAiAgentRun.mockResolvedValue({
      run: {
        conversationId: "chat-1",
        conversationSlotJson: null,
        createdAt: 1,
        goal: "添加主机后连接",
        id: "run-agent-1",
        iteration: 2,
        maxIterations: 20,
        maxToolCalls: 5,
        status: "waitingApproval",
        updatedAt: 2,
      },
      steps: [
        {
          createdAt: 1,
          id: "step-model-1",
          inputJson: null,
          kind: "model",
          observationJson: null,
          runId: "run-agent-1",
          status: "succeeded",
          summary: "需要创建主机。",
          toolId: null,
          updatedAt: 1,
        },
      ],
    });
    agentRunApiMock.resumeAiAgentRun.mockResolvedValue({
      finalMessage: "已创建主机，等待继续连接。",
      lastObservation: null,
      pendingInvocation: nextPendingInvocation,
      snapshot: {
        run: {
          conversationId: "chat-1",
          conversationSlotJson: null,
          createdAt: 1,
          goal: "添加主机后连接",
          id: "run-agent-1",
          iteration: 5,
          maxIterations: 20,
          maxToolCalls: 5,
          status: "waitingApproval",
          updatedAt: 2,
        },
        steps: [
          {
            createdAt: 1,
            id: "step-model-1",
            inputJson: null,
            kind: "model",
            observationJson: null,
            runId: "run-agent-1",
            status: "succeeded",
            summary: "需要创建主机。",
            toolId: null,
            updatedAt: 1,
          },
          {
            createdAt: 2,
            id: "step-observation-1",
            inputJson: null,
            kind: "observation",
            observationJson: null,
            runId: "run-agent-1",
            status: "succeeded",
            summary: "已创建远程主机。",
            toolId: "remote_host.create",
            updatedAt: 2,
          },
          {
            createdAt: 3,
            id: "step-tool-2",
            inputJson: null,
            kind: "toolCall",
            observationJson: null,
            runId: "run-agent-1",
            status: "waitingApproval",
            summary: "连接 SSH 主机",
            toolId: "ssh.connect",
            updatedAt: 3,
          },
        ],
      },
    });
    agentRunApiMock.cancelAiAgentRun.mockResolvedValue({
      run: {
        conversationId: "chat-1",
        conversationSlotJson: null,
        createdAt: 1,
        goal: "添加主机后连接",
        id: "run-agent-1",
        iteration: 5,
        maxIterations: 20,
        maxToolCalls: 5,
        status: "cancelled",
        updatedAt: 3,
      },
      steps: [],
    });

    renderAiToolContent();

    await user.type(
      screen.getByLabelText("AI 对话输入"),
      "添加主机后继续连接",
    );
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect(
      (await screen.findAllByText(/prod\.example\.com/)).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "批准" }));

    await waitFor(() => {
      expect(agentRunApiMock.resumeAiAgentRun).toHaveBeenCalledWith({
        audit: expect.objectContaining({
          id: "tool-audit-agent-run-host",
        }),
        runId: "run-agent-1",
      });
    });
    expect(await screen.findByText("hostId=host-created")).toBeInTheDocument();
    expect(await screen.findByText("工具结果")).toBeInTheDocument();
    expect(
      await screen.findByText("已创建主机，等待继续连接。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消 run" }));

    await waitFor(() => {
      expect(agentRunApiMock.cancelAiAgentRun).toHaveBeenCalledWith({
        runId: "run-agent-1",
      });
    });
    expect(await screen.findByText("已取消")).toBeInTheDocument();
    expect(screen.queryByText("hostId=host-created")).not.toBeInTheDocument();
  });

  it("retries the last step of a blocked agent run", async () => {
    const user = userEvent.setup();
    const onRemoteHostCreated = vi.fn().mockResolvedValue(undefined);
    const runPendingInvocation: AiToolPendingInvocation = {
      ...remoteHostPendingInvocation,
      id: "tool-call-blocked-run",
      runId: "run-blocked-1",
      stepId: "step-tool-1",
    };
    agentApiMock.streamAiChatMessage.mockImplementation(
      async (_request, options) => {
        const response = {
          contextUsed: true,
          conversationId: "chat-1",
          generatedAt: "1",
          message: "我会先创建主机。",
          model: "gpt-test",
          pendingInvocations: [runPendingInvocation],
          providerId: "llm-test",
          providerName: "测试 Provider",
          responseRedacted: false,
          toolCount: 20,
        };
        options?.onDelta?.(response.message);
        return response;
      },
    );
    agentRunApiMock.getAiAgentRun.mockResolvedValue({
      run: {
        conversationId: "chat-1",
        conversationSlotJson: null,
        createdAt: 1,
        goal: "添加主机后连接",
        id: "run-blocked-1",
        iteration: 3,
        maxIterations: 20,
        maxToolCalls: 5,
        status: "blocked",
        updatedAt: 2,
      },
      steps: [
        {
          createdAt: 2,
          id: "step-error",
          inputJson: null,
          kind: "error",
          observationJson: null,
          runId: "run-blocked-1",
          status: "blocked",
          summary: "缺少分组 id。",
          toolId: null,
          updatedAt: 2,
        },
      ],
    });
    agentRunApiMock.retryAiAgentRunLastStep.mockResolvedValue({
      finalMessage: "重试后已经完成。",
      lastObservation: {
        auditId: "audit-retry-host",
        data: { created: true, hostId: "host-created" },
        entities: [{ id: "host-created", type: "remoteHost" }],
        status: "succeeded",
      },
      pendingInvocation: null,
      snapshot: {
        run: {
          conversationId: "chat-1",
          conversationSlotJson: null,
          createdAt: 3,
          goal: "添加主机后连接",
          id: "run-retry-1",
          iteration: 2,
          maxIterations: 20,
          maxToolCalls: 5,
          status: "completed",
          updatedAt: 4,
        },
        steps: [
          {
            createdAt: 4,
            id: "step-observation",
            inputJson: null,
            kind: "observation",
            observationJson: {
              auditId: "audit-retry-host",
              data: { created: true, hostId: "host-created" },
              entities: [{ id: "host-created", type: "remoteHost" }],
              status: "succeeded",
            },
            runId: "run-retry-1",
            status: "succeeded",
            summary: "已创建远程主机。",
            toolId: "remote_host.ensure",
            updatedAt: 4,
          },
          {
            createdAt: 5,
            id: "step-final",
            inputJson: null,
            kind: "final",
            observationJson: null,
            runId: "run-retry-1",
            status: "succeeded",
            summary: "重试后已经完成。",
            toolId: null,
            updatedAt: 5,
          },
        ],
      },
    });

    renderAiToolContent({ onRemoteHostCreated });

    await user.type(screen.getByLabelText("AI 对话输入"), "添加主机后继续连接");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect(await screen.findByText("缺少分组 id。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试上一步" }));

    await waitFor(() => {
      expect(agentRunApiMock.retryAiAgentRunLastStep).toHaveBeenCalledWith({
        runId: "run-blocked-1",
      });
      expect(onRemoteHostCreated).toHaveBeenCalledTimes(1);
    });
    expect((await screen.findAllByText("重试后已经完成。")).length).toBeGreaterThan(0);
  });

  it("jumps from an audit context chip back to the related conversation message", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    window.localStorage.setItem(
      "kerminal.ai.conversations.v1",
      JSON.stringify({
        activeConversationId: "conv-other",
        conversations: [
          {
            createdAt: now - 20_000,
            id: "conv-other",
            messages: [
              {
                content: "当前普通会话",
                createdAt: now - 19_000,
                id: "other-user",
                role: "user",
              },
            ],
            title: "普通会话",
            updatedAt: now - 19_000,
          },
          {
            createdAt: now - 10_000,
            id: "conv-audit",
            messages: [
              {
                attachments: [
                  {
                    id: "att-audit",
                    kind: "image",
                    mimeType: "image/png",
                    originalName: "ssh.png",
                    sizeBytes: 128,
                    status: "available",
                  },
                ],
                content: "这张图里有 SSH 登录方式",
                contextSnapshotId: "ctx-audit",
                createdAt: now - 9_000,
                id: "audit-user",
                role: "user",
              },
              {
                content: "我可以创建远程主机配置。",
                createdAt: now - 8_000,
                id: "audit-assistant",
                role: "assistant",
              },
            ],
            title: "图片配置主机",
            updatedAt: now - 8_000,
          },
        ],
      }),
    );
    invocationApiMock.listAiToolAudits.mockResolvedValue([
      {
        argumentsSummary: "host=prod.example.com",
        auditContext: {
          assistantMessageId: "audit-assistant",
          attachmentIds: ["att-audit"],
          contextSnapshotId: "ctx-audit",
          conversationId: "conv-audit",
          userMessageId: "audit-user",
        },
        completedAt: "6",
        confirmation: "always",
        createdAt: "5",
        error: null,
        id: "audit-image-host",
        invocationId: "tool-call-image-host",
        resultSummary: "已创建远程主机。",
        risk: "remote",
        riskSummary: null,
        status: "succeeded",
        toolId: "remote_host.create",
        toolTitle: "创建远程主机",
      },
    ]);

    renderAiToolContent();

    expect(await screen.findByText("当前普通会话")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看工具审计" }));
    expect(await screen.findByText("已创建远程主机。")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "打开审计上下文 AI消息 audit-assistant",
      }),
    );

    expect(await screen.findByText("我可以创建远程主机配置。")).toBeInTheDocument();
    expect(screen.queryByText("审计列表")).not.toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-kerminal-ai-message-id="audit-assistant"]',
      ),
    ).toHaveAttribute("data-kerminal-ai-message-highlighted", "true");

    await user.click(screen.getByRole("button", { name: "查看工具审计" }));
    await user.click(
      screen.getByRole("button", {
        name: "打开审计上下文 快照 ctx-audit",
      }),
    );

    expect(
      await screen.findByRole("dialog", { name: "上下文快照详情" }),
    ).toBeInTheDocument();
    expect(snapshotApiMock.getAiContextSnapshot).toHaveBeenCalledWith(
      "ctx-audit",
    );
    expect(screen.getByText("ctx-audit")).toBeInTheDocument();
    expect(screen.getByText("session-audit")).toBeInTheDocument();
    expect(screen.getAllByText(/prod-api/).length).toBeGreaterThan(0);
  });

  it("opens snapshot details even when the referenced conversation is stale", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    window.localStorage.setItem(
      "kerminal.ai.conversations.v1",
      JSON.stringify({
        activeConversationId: "conv-other",
        conversations: [
          {
            createdAt: now - 20_000,
            id: "conv-other",
            messages: [
              {
                content: "当前普通会话",
                createdAt: now - 19_000,
                id: "other-user",
                role: "user",
              },
            ],
            title: "普通会话",
            updatedAt: now - 19_000,
          },
        ],
      }),
    );
    invocationApiMock.listAiToolAudits.mockResolvedValue([
      {
        argumentsSummary: "snapshot only",
        auditContext: {
          contextSnapshotId: "ctx-audit",
          conversationId: "conv-missing",
        },
        completedAt: "6",
        confirmation: "always",
        createdAt: "5",
        error: null,
        id: "audit-stale-snapshot",
        invocationId: "tool-call-stale-snapshot",
        resultSummary: "读取过上下文快照。",
        risk: "read",
        riskSummary: null,
        status: "succeeded",
        toolId: "server_info.snapshot",
        toolTitle: "读取服务器信息",
      },
    ]);

    renderAiToolContent();

    await user.click(screen.getByRole("button", { name: "查看工具审计" }));
    await user.click(
      screen.getByRole("button", {
        name: "打开审计上下文 快照 ctx-audit",
      }),
    );

    expect(
      await screen.findByRole("dialog", { name: "上下文快照详情" }),
    ).toBeInTheDocument();
    expect(snapshotApiMock.getAiContextSnapshot).toHaveBeenCalledWith(
      "ctx-audit",
    );
    expect(
      await screen.findByText(/已打开快照详情，但无法恢复关联会话/),
    ).toBeInTheDocument();
  });
});
