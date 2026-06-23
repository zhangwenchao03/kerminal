import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiConversation,
  AiConversationMessage,
  AiConversationSummary,
} from "../../lib/aiConversationApi";
import type { Machine, TerminalPane, TerminalTab } from "../workspace/types";
import { AiToolContent } from "./AiToolContent";

const tauriCoreMock = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
const webviewMock = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
}));
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
  listAiToolPendingInvocations: vi.fn(),
}));
const sessionRegistryMock = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
}));
const conversationApiMock = vi.hoisted(() => ({
  appendAiConversationMessage: vi.fn(),
  bindAiConversationAttachmentToMessage: vi.fn(),
  createAiConversation: vi.fn(),
  deleteAiConversation: vi.fn(),
  getAiConversation: vi.fn(),
  getAiConversationAttachmentAssetInfo: vi.fn(),
  getAiConversationSlot: vi.fn(),
  importAiConversationAttachment: vi.fn(),
  importAiConversationAttachmentBytes: vi.fn(),
  listAiConversations: vi.fn(),
  openAiConversationAttachment: vi.fn(),
  setAiConversationSlotActive: vi.fn(),
}));
const conversationSnapshotApiMock = vi.hoisted(() => ({
  createAiContextSnapshot: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (...args: unknown[]) => webviewMock.onDragDropEvent(...args),
  }),
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
vi.mock("../../lib/aiConversationApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiConversationApi")>(
    "../../lib/aiConversationApi",
  );
  return {
    ...actual,
    appendAiConversationMessage:
      conversationApiMock.appendAiConversationMessage,
    bindAiConversationAttachmentToMessage:
      conversationApiMock.bindAiConversationAttachmentToMessage,
    createAiConversation: conversationApiMock.createAiConversation,
    deleteAiConversation: conversationApiMock.deleteAiConversation,
    getAiConversation: conversationApiMock.getAiConversation,
    getAiConversationAttachmentAssetInfo:
      conversationApiMock.getAiConversationAttachmentAssetInfo,
    getAiConversationSlot: conversationApiMock.getAiConversationSlot,
    importAiConversationAttachment:
      conversationApiMock.importAiConversationAttachment,
    importAiConversationAttachmentBytes:
      conversationApiMock.importAiConversationAttachmentBytes,
    listAiConversations: conversationApiMock.listAiConversations,
    openAiConversationAttachment: conversationApiMock.openAiConversationAttachment,
    setAiConversationSlotActive: conversationApiMock.setAiConversationSlotActive,
  };
});
vi.mock("../../lib/aiConversationSnapshotApi", () => ({
  createAiContextSnapshot: conversationSnapshotApiMock.createAiContextSnapshot,
}));

const activeTab: TerminalTab = {
  id: "tab-1",
  layout: { paneId: "pane-1", type: "pane" },
  machineId: "host-prod",
  title: "prod-api tab",
};

const focusedPane: TerminalPane = {
  id: "pane-1",
  latencyMs: 1,
  lines: [],
  machineId: "host-prod",
  mode: "ssh",
  prompt: "$",
  status: "online",
  title: "prod-api shell",
};

const selectedMachine: Machine = {
  description: "生产 SSH 主机",
  id: "host-prod",
  kind: "ssh",
  name: "prod-api",
  production: true,
  status: "online",
  tags: ["prod"],
};

describe("AiToolContent backend history", () => {
  beforeEach(() => {
    tauriCoreMock.isTauri.mockReturnValue(true);
    webviewMock.onDragDropEvent.mockResolvedValue(() => undefined);
    sessionRegistryMock.getTerminalPaneSession.mockReturnValue("session-1");
    providerApiMock.listLlmProviders.mockResolvedValue([]);
    invocationApiMock.listAiToolAudits.mockResolvedValue([]);
    invocationApiMock.listAiToolPendingInvocations.mockResolvedValue([]);
    contextApiMock.getAiTerminalContextSnapshot.mockResolvedValue({
      generatedAt: "1",
      output: {
        capturedBytes: 0,
        data: "",
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
        cwd: "/srv/app",
        id: "session-1",
        rows: 24,
        shell: "bash",
        status: "running",
      },
      source: {
        machineId: "host-prod",
        machineKind: "ssh",
        machineName: "prod-api",
        paneId: "pane-1",
        paneTitle: "prod-api shell",
        tabId: "tab-1",
        tabTitle: "prod-api tab",
      },
    });
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-active",
      draftText: null,
      lastActiveAt: 1_000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: targetRefJson(),
      updatedAt: 1_000,
    });
    conversationApiMock.getAiConversation.mockImplementation(
      async (conversationId: string) =>
        conversationId === "conv-history"
          ? storedConversation({
              id: "conv-history",
              messageContent: "历史完整消息已恢复",
              title: "历史生产排障",
              withVisionUsage: true,
            })
          : storedConversation({
              id: "conv-active",
              messageContent: "当前后端会话",
              title: "当前会话",
            }),
    );
    conversationApiMock.listAiConversations.mockResolvedValue([
      storedSummary({
        id: "conv-history",
        title: "历史生产排障",
      }),
    ]);
    conversationApiMock.setAiConversationSlotActive.mockResolvedValue({
      activeConversationId: "conv-history",
      draftText: null,
      lastActiveAt: 2_000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: targetRefJson(),
      updatedAt: 2_000,
    });
    conversationSnapshotApiMock.createAiContextSnapshot.mockResolvedValue({
      id: "ctx-history",
    });
  });

  it("loads backend history summaries and restores full conversation on continue", async () => {
    const user = userEvent.setup();
    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        selectedMachine={selectedMachine}
      />,
    );

    expect(await screen.findByText("当前后端会话")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));

    expect(await screen.findByText("历史生产排障")).toBeInTheDocument();
    expect(conversationApiMock.listAiConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 7,
        offset: 0,
      }),
    );

    await user.click(screen.getByRole("button", { name: "继续会话 历史生产排障" }));

    await waitFor(() => {
      expect(conversationApiMock.getAiConversation).toHaveBeenCalledWith(
        "conv-history",
      );
      expect(conversationApiMock.setAiConversationSlotActive).toHaveBeenCalledWith(
        expect.objectContaining({
          activeConversationId: "conv-history",
          slotKey: "pane:pane-1",
        }),
      );
    });
    expect(await screen.findByText("历史完整消息已恢复")).toBeInTheDocument();
    expect(await screen.findByText("图片已进入模型 1/1")).toBeInTheDocument();
  });

  it("keeps another pane conversation sendable while the current one is streaming", async () => {
    const user = userEvent.setup();
    const deployTab: TerminalTab = {
      id: "tab-deploy",
      layout: { paneId: "pane-deploy", type: "pane" },
      machineId: "host-deploy",
      title: "deploy tab",
    };
    const deployPane: TerminalPane = {
      id: "pane-deploy",
      latencyMs: 2,
      lines: [],
      machineId: "host-deploy",
      mode: "ssh",
      prompt: "$",
      status: "online",
      title: "deploy shell",
    };
    const deployMachine: Machine = {
      description: "发布 SSH 主机",
      id: "host-deploy",
      kind: "ssh",
      name: "deploy-box",
      production: false,
      status: "online",
      tags: ["deploy"],
    };
    conversationApiMock.getAiConversationSlot.mockImplementation(
      async (slotKey: string) => ({
        activeConversationId:
          slotKey === "pane:pane-deploy" ? "conv-deploy" : "conv-active",
        draftText: null,
        lastActiveAt: 1_000,
        routeMode: "followWorkspaceTarget",
        slotKey,
        targetRefJson:
          slotKey === "pane:pane-deploy"
            ? deployTargetRefJson()
            : targetRefJson(),
        updatedAt: 1_000,
      }),
    );
    conversationApiMock.getAiConversation.mockImplementation(
      async (conversationId: string) =>
        conversationId === "conv-deploy"
          ? storedConversation({
              hostId: "host-deploy",
              id: "conv-deploy",
              messageContent: "deploy 后端会话",
              paneId: "pane-deploy",
              scopeRefJson: deployTargetRefJson(),
              tabId: "tab-deploy",
              targetKey: "pane:pane-deploy",
              title: "deploy 会话",
            })
          : storedConversation({
              id: "conv-active",
              messageContent: "当前后端会话",
              title: "当前会话",
            }),
    );
    conversationApiMock.appendAiConversationMessage.mockImplementation(
      async (request: {
        content: string;
        conversationId: string;
        role: "assistant" | "user";
        status?: "complete" | "error" | "streaming";
      }) =>
        storedMessage({
          content: request.content,
          conversationId: request.conversationId,
          id: `${request.conversationId}-${request.role}-${Date.now()}`,
          role: request.role,
          status: request.status ?? "complete",
        }),
    );
    sessionRegistryMock.getTerminalPaneSession.mockImplementation(
      (paneId: string) =>
        paneId === "pane-deploy" ? "session-deploy" : "session-1",
    );

    let resolveFirstResponse: (() => void) | undefined;
    agentApiMock.streamAiChatMessage.mockImplementation((request, options) => {
      const response = {
        contextUsed: true,
        conversationId: request.conversationId ?? "unknown",
        generatedAt: "1",
        message:
          request.conversationId === "conv-deploy"
            ? "deploy 已分析"
            : "当前会话已分析",
        model: "gpt-test",
        pendingInvocations: [],
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 0,
      };
      if (request.conversationId === "conv-active") {
        return new Promise((resolve) => {
          resolveFirstResponse = () => {
            options?.onDelta?.(response.message);
            resolve(response);
          };
        });
      }
      options?.onDelta?.(response.message);
      return Promise.resolve(response);
    });

    const view = render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        selectedMachine={selectedMachine}
      />,
    );

    expect(await screen.findByText("当前后端会话")).toBeInTheDocument();
    await user.type(screen.getByLabelText("AI 对话输入"), "继续看当前主机");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));
    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <AiToolContent
        activeTab={deployTab}
        focusedPane={deployPane}
        selectedMachine={deployMachine}
      />,
    );

    expect(await screen.findByText("deploy 后端会话")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 对话输入")).toBeEnabled();
    await user.type(screen.getByLabelText("AI 对话输入"), "继续看 deploy 主机");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledTimes(2);
    });
    const firstRequest = agentApiMock.streamAiChatMessage.mock.calls[0][0];
    const secondRequest = agentApiMock.streamAiChatMessage.mock.calls[1][0];
    expect(firstRequest).toEqual(
      expect.objectContaining({
        conversationId: "conv-active",
        terminalContext: expect.objectContaining({
          sessionId: "session-1",
        }),
        applicationContext: expect.objectContaining({
          focusedPane: expect.objectContaining({
            id: "pane-1",
            sessionId: "session-1",
          }),
        }),
      }),
    );
    expect(secondRequest).toEqual(
      expect.objectContaining({
        conversationId: "conv-deploy",
        terminalContext: expect.objectContaining({
          sessionId: "session-deploy",
        }),
        applicationContext: expect.objectContaining({
          focusedPane: expect.objectContaining({
            id: "pane-deploy",
            sessionId: "session-deploy",
          }),
        }),
      }),
    );

    resolveFirstResponse?.();
  });

  it("does not bind a non-current tab history conversation to the current slot", async () => {
    const user = userEvent.setup();
    const onFocusTab = vi.fn();
    conversationApiMock.listAiConversations.mockResolvedValue([
      storedSummary({
        hostId: "host-deploy",
        id: "conv-background",
        paneId: "pane-deploy",
        scopeRefJson: deployTargetRefJson(),
        tabId: "tab-deploy",
        targetKey: "pane:pane-deploy",
        title: "后台发布排障",
      }),
    ]);
    conversationApiMock.getAiConversation.mockImplementation(
      async (conversationId: string) =>
        conversationId === "conv-background"
          ? storedConversation({
              hostId: "host-deploy",
              id: "conv-background",
              messageContent: "后台 tab 的排障消息已恢复",
              paneId: "pane-deploy",
              scopeRefJson: deployTargetRefJson(),
              tabId: "tab-deploy",
              targetKey: "pane:pane-deploy",
              title: "后台发布排障",
            })
          : storedConversation({
              id: "conv-active",
              messageContent: "当前后端会话",
              title: "当前会话",
            }),
    );

    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        onFocusTab={onFocusTab}
        selectedMachine={selectedMachine}
      />,
    );

    expect(await screen.findByText("当前后端会话")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    await user.click(screen.getByRole("button", { name: "继续会话 后台发布排障" }));

    await waitFor(() => {
      expect(conversationApiMock.getAiConversation).toHaveBeenCalledWith(
        "conv-background",
      );
      expect(onFocusTab).toHaveBeenCalledWith("tab-deploy");
      expect(conversationApiMock.setAiConversationSlotActive).not.toHaveBeenCalledWith(
        expect.objectContaining({
          activeConversationId: "conv-background",
          slotKey: "pane:pane-1",
        }),
      );
    });
    expect(await screen.findByText("后台 tab 的排障消息已恢复")).toBeInTheDocument();
  });

  it("blocks a same-tab other-pane history row before it becomes active", async () => {
    const user = userEvent.setup();
    conversationApiMock.listAiConversations.mockResolvedValue([
      storedSummary({
        id: "conv-side-pane",
        paneId: "pane-side",
        scopeRefJson: sidePaneTargetRefJson(),
        tabId: "tab-1",
        targetKey: "pane:pane-side",
        title: "旁路 pane 排障",
      }),
    ]);

    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        selectedMachine={selectedMachine}
      />,
    );

    expect(await screen.findByText("当前后端会话")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    await user.click(screen.getByRole("button", { name: "继续会话 旁路 pane 排障" }));

    await waitFor(() => {
      expect(screen.getByText("该历史会话绑定到其它主机或面板，请先切换到对应目标后继续。")).toBeInTheDocument();
      expect(conversationApiMock.getAiConversation).not.toHaveBeenCalledWith(
        "conv-side-pane",
      );
      expect(conversationApiMock.setAiConversationSlotActive).not.toHaveBeenCalledWith(
        expect.objectContaining({
          activeConversationId: "conv-side-pane",
          slotKey: "pane:pane-1",
        }),
      );
    });
  });

  it("blocks a legacy host-only history row when it cannot route to the original target", async () => {
    const user = userEvent.setup();
    conversationApiMock.listAiConversations.mockResolvedValue([
      {
        ...storedSummary({
          hostId: "host-deploy",
          id: "conv-legacy-host",
          title: "旧主机排障",
        }),
        paneId: null,
        scopeKind: "lockedHost",
        scopeRefJson: JSON.stringify({
          kind: "host",
          machineId: "host-deploy",
        }),
        tabId: null,
        targetKey: null,
      },
    ]);

    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        selectedMachine={selectedMachine}
      />,
    );

    expect(await screen.findByText("当前后端会话")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    await user.click(screen.getByRole("button", { name: "继续会话 旧主机排障" }));

    await waitFor(() => {
      expect(screen.getByText("该历史会话绑定到其它主机或面板，请先切换到对应目标后继续。")).toBeInTheDocument();
      expect(conversationApiMock.getAiConversation).not.toHaveBeenCalledWith(
        "conv-legacy-host",
      );
      expect(conversationApiMock.setAiConversationSlotActive).not.toHaveBeenCalledWith(
        expect.objectContaining({
          activeConversationId: "conv-legacy-host",
          slotKey: "pane:pane-1",
        }),
      );
    });
    expect(screen.queryByText("旧主机排障消息已恢复")).not.toBeInTheDocument();
  });
});

function storedConversation(input: {
  hostId?: string;
  id: string;
  messageContent: string;
  paneId?: string;
  scopeRefJson?: string;
  tabId?: string;
  targetKey?: string;
  title: string;
  withVisionUsage?: boolean;
}): AiConversation {
  return {
    archivedAt: null,
    attachments: [],
    createdAt: 800,
    hostId: input.hostId ?? "host-prod",
    id: input.id,
    lastMessageAt: 1_000,
    messages: [
      storedMessage({
        content: input.messageContent,
        conversationId: input.id,
        id: `${input.id}-message`,
      }),
      ...(input.withVisionUsage
        ? [
            storedMessage({
              content: "图片里的 SSH 信息已进入模型分析",
              conversationId: input.id,
              id: `${input.id}-assistant-message`,
              metadataJson: JSON.stringify({
                visionUsage: {
                  attachments: [
                    {
                      effectiveUsage: "visionInput",
                      id: "att-vision",
                      modelInput: "visionInput",
                      requestedUsage: "visionInput",
                    },
                  ],
                  providerSupportsVision: true,
                  visionAdapterEnabled: true,
                },
              }),
              model: "gpt-test",
              role: "assistant",
            }),
          ]
        : []),
    ],
    model: null,
    paneId: input.paneId ?? "pane-1",
    providerId: null,
    scopeKind: "lockedPane",
    scopeRefJson: input.scopeRefJson ?? targetRefJson(),
    status: "idle",
    summary: null,
    tabId: input.tabId ?? "tab-1",
    targetKey: input.targetKey ?? "pane:pane-1",
    title: input.title,
    updatedAt: 1_000,
  };
}

function storedMessage(
  overrides: Partial<AiConversationMessage>,
): AiConversationMessage {
  return {
    content: "",
    conversationId: "conv-active",
    createdAt: 1_000,
    id: "message",
    role: "user",
    status: "complete",
    ...overrides,
  };
}

function storedSummary(input: {
  hostId?: string;
  id: string;
  paneId?: string;
  scopeRefJson?: string;
  tabId?: string;
  targetKey?: string;
  title: string;
}): AiConversationSummary {
  return {
    archivedAt: null,
    attachmentCount: 0,
    createdAt: 800,
    hostId: input.hostId ?? "host-prod",
    id: input.id,
    lastMessageAt: 1_000,
    messageCount: 1,
    model: null,
    paneId: input.paneId ?? "pane-1",
    providerId: null,
    scopeKind: "lockedPane",
    scopeRefJson: input.scopeRefJson ?? targetRefJson(),
    status: "idle",
    summary: null,
    tabId: input.tabId ?? "tab-1",
    targetKey: input.targetKey ?? "pane:pane-1",
    title: input.title,
    updatedAt: 1_000,
  };
}

function targetRefJson() {
  return JSON.stringify({
    kind: "pane",
    machineId: "host-prod",
    machineName: "prod-api",
    paneId: "pane-1",
    paneTitle: "prod-api shell",
    tabId: "tab-1",
    tabTitle: "prod-api tab",
  });
}

function deployTargetRefJson() {
  return JSON.stringify({
    kind: "pane",
    machineId: "host-deploy",
    machineName: "deploy-box",
    paneId: "pane-deploy",
    paneTitle: "deploy shell",
    tabId: "tab-deploy",
    tabTitle: "deploy tab",
  });
}

function sidePaneTargetRefJson() {
  return JSON.stringify({
    kind: "pane",
    machineId: "host-prod",
    machineName: "prod-api",
    paneId: "pane-side",
    paneTitle: "side shell",
    tabId: "tab-1",
    tabTitle: "prod-api tab",
  });
}
