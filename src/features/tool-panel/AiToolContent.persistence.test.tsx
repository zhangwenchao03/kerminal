import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiAttachment,
  AiConversation,
  AiConversationMessage,
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
}));
const sessionRegistryMock = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
}));
const conversationApiMock = vi.hoisted(() => ({
  appendAiConversationMessage: vi.fn(),
  bindAiConversationAttachmentToMessage: vi.fn(),
  createAiConversation: vi.fn(),
  deleteAiConversation: vi.fn(),
  getAiConversationAttachmentAssetInfo: vi.fn(),
  getAiConversation: vi.fn(),
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
const fileDialogApiMock = vi.hoisted(() => ({
  selectLocalImage: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (...args: unknown[]) =>
      webviewMock.onDragDropEvent(...args),
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
    getAiConversationAttachmentAssetInfo:
      conversationApiMock.getAiConversationAttachmentAssetInfo,
    getAiConversation: conversationApiMock.getAiConversation,
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
vi.mock("../../lib/fileDialogApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/fileDialogApi")>(
    "../../lib/fileDialogApi",
  );
  return {
    ...actual,
    selectLocalImage: fileDialogApiMock.selectLocalImage,
  };
});

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

function storedMessage(
  overrides: Partial<AiConversationMessage>,
): AiConversationMessage {
  return {
    content: "",
    conversationId: "conv-backend",
    createdAt: 1000,
    id: "msg-default",
    role: "user",
    status: "complete",
    ...overrides,
  };
}

function storedConversation(
  overrides: Partial<AiConversation> = {},
): AiConversation {
  return {
    archivedAt: null,
    attachments: [],
    createdAt: 800,
    hostId: null,
    id: "conv-backend",
    lastMessageAt: 1000,
    messages: [],
    model: null,
    paneId: "pane-1",
    providerId: null,
    scopeKind: "lockedPane",
    scopeRefJson: "{}",
    status: "idle",
    summary: null,
    tabId: "tab-1",
    targetKey: "pane:pane-1",
    title: "Backend conversation",
    updatedAt: 1000,
    ...overrides,
  };
}

function storedAttachment(overrides: Partial<AiAttachment>): AiAttachment {
  return {
    assetPath: null,
    conversationId: "conv-backend",
    createdAt: 900,
    height: null,
    id: "att-default",
    kind: "image",
    messageId: "msg-user",
    mimeType: "image/png",
    missingReason: null,
    ocrText: null,
    originalName: "image.png",
    originalPath: null,
    redactionSummary: null,
    sha256: null,
    sizeBytes: 2048,
    sourceKind: "paste",
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: null,
    updatedAt: 900,
    visionUsage: "ocrOnly",
    width: null,
    ...overrides,
  };
}

function localImageFile(name: string, path: string, type = "image/png") {
  const file = new File(["image"], name, { type });
  Object.defineProperty(file, "path", {
    configurable: true,
    value: path,
  });
  return file;
}

function fileTransfer(files: File[]) {
  return {
    dropEffect: "none",
    files,
  } as unknown as DataTransfer;
}

describe("AiToolContent persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tauriCoreMock.invoke.mockReset();
    tauriCoreMock.isTauri.mockReset();
    webviewMock.onDragDropEvent.mockReset();
    contextApiMock.getAiTerminalContextSnapshot.mockReset();
    agentApiMock.streamAiChatMessage.mockReset();
    providerApiMock.listLlmProviders.mockReset();
    invocationApiMock.clearAiToolAudits.mockReset();
    invocationApiMock.confirmAiToolInvocation.mockReset();
    invocationApiMock.exportAiToolAudits.mockReset();
    invocationApiMock.listAiToolAudits.mockReset();
    sessionRegistryMock.getTerminalPaneSession.mockReset();
    conversationApiMock.appendAiConversationMessage.mockReset();
    conversationApiMock.bindAiConversationAttachmentToMessage.mockReset();
    conversationApiMock.createAiConversation.mockReset();
    conversationApiMock.deleteAiConversation.mockReset();
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockReset();
    conversationApiMock.getAiConversation.mockReset();
    conversationApiMock.getAiConversationSlot.mockReset();
    conversationApiMock.importAiConversationAttachment.mockReset();
    conversationApiMock.importAiConversationAttachmentBytes.mockReset();
    conversationApiMock.listAiConversations.mockReset();
    conversationApiMock.openAiConversationAttachment.mockReset();
    conversationApiMock.setAiConversationSlotActive.mockReset();
    conversationSnapshotApiMock.createAiContextSnapshot.mockReset();
    fileDialogApiMock.selectLocalImage.mockReset();

    tauriCoreMock.isTauri.mockReturnValue(true);
    webviewMock.onDragDropEvent.mockResolvedValue(() => undefined);
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
    conversationApiMock.appendAiConversationMessage.mockResolvedValue(
      storedMessage({}),
    );
    conversationApiMock.bindAiConversationAttachmentToMessage.mockResolvedValue(
      storedAttachment({}),
    );
    conversationApiMock.createAiConversation.mockResolvedValue(
      storedConversation(),
    );
    conversationApiMock.deleteAiConversation.mockResolvedValue(true);
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue({
      attachment: storedAttachment({}),
      exists: true,
      previewPath: "C:/Users/kerminal/.kerminal/ai-attachments/image.png",
      resolvedPath: "C:/Users/kerminal/.kerminal/ai-attachments/image.png",
    });
    conversationApiMock.getAiConversation.mockResolvedValue(storedConversation());
    conversationApiMock.getAiConversationSlot.mockResolvedValue(null);
    conversationApiMock.importAiConversationAttachment.mockResolvedValue(
      storedAttachment({ messageId: null }),
    );
    conversationApiMock.importAiConversationAttachmentBytes.mockResolvedValue(
      storedAttachment({ messageId: null }),
    );
    conversationApiMock.listAiConversations.mockResolvedValue([]);
    conversationApiMock.openAiConversationAttachment.mockResolvedValue(true);
    conversationApiMock.setAiConversationSlotActive.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationSnapshotApiMock.createAiContextSnapshot.mockResolvedValue({
      id: "ctx-backend",
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

  it("hydrates the active Tauri slot conversation while hiding non-chat roles", async () => {
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({
        attachments: [
          storedAttachment({
            id: "att-user",
            messageId: "msg-user",
            originalName: "ssh.png",
          }),
        ],
        messages: [
          storedMessage({
            content: "识别这张 SSH 截图",
            id: "msg-user",
            role: "user",
          }),
          storedMessage({
            content: "这是后端 AI 回复。",
            id: "msg-assistant",
            model: "gpt-test",
            role: "assistant",
          }),
          storedMessage({
            content: "内部摘要不展示",
            id: "msg-system",
            role: "system",
          }),
          storedMessage({
            content: "工具结果不展示",
            id: "msg-tool",
            role: "tool",
          }),
        ],
      }),
    );

    renderAiToolContent();

    expect(await screen.findByText("识别这张 SSH 截图")).toBeInTheDocument();
    expect(screen.getByText("这是后端 AI 回复。")).toBeInTheDocument();
    expect(screen.queryByText("内部摘要不展示")).not.toBeInTheDocument();
    expect(screen.queryByText("工具结果不展示")).not.toBeInTheDocument();
    expect(conversationApiMock.createAiConversation).not.toHaveBeenCalled();
  });

  it("creates and activates a stored conversation when the Tauri slot is empty", async () => {
    conversationApiMock.getAiConversationSlot.mockResolvedValue(null);
    conversationApiMock.createAiConversation.mockResolvedValue(
      storedConversation({ id: "conv-created" }),
    );

    renderAiToolContent();

    await waitFor(() => {
      expect(conversationApiMock.createAiConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          paneId: "pane-1",
          scopeKind: "lockedPane",
          targetKey: "pane:pane-1",
        }),
      );
      expect(conversationApiMock.setAiConversationSlotActive).toHaveBeenCalledWith(
        expect.objectContaining({
          activeConversationId: "conv-created",
          slotKey: "pane:pane-1",
        }),
      );
    });
  });

  it("switches the visible route and stored conversation with the focused pane", async () => {
    const tabTwo: TerminalTab = {
      id: "tab-2",
      layout: { paneId: "pane-2", type: "pane" },
      machineId: "host-prod",
      title: "prod-db tab",
    };
    const paneTwo: TerminalPane = {
      id: "pane-2",
      latencyMs: 3,
      lines: [],
      machineId: "host-prod",
      mode: "ssh",
      prompt: "$",
      status: "online",
      title: "prod-db shell",
    };
    const machineTwo: Machine = {
      description: "生产数据库",
      id: "host-prod",
      kind: "ssh",
      name: "prod-db",
      production: true,
      status: "online",
      tags: ["prod"],
    };

    conversationApiMock.getAiConversationSlot.mockImplementation(
      async (slotKey: string) => ({
        activeConversationId:
          slotKey === "pane:pane-2" ? "conv-pane-2" : "conv-pane-1",
        draftText: null,
        lastActiveAt: 1000,
        routeMode: "followWorkspaceTarget",
        slotKey,
        targetRefJson: "{}",
        updatedAt: 1000,
      }),
    );
    conversationApiMock.getAiConversation.mockImplementation(
      async (conversationId: string) => {
        const secondPane = conversationId === "conv-pane-2";
        return storedConversation({
          id: conversationId,
          messages: [
            storedMessage({
              content: secondPane ? "pane 2 后端会话" : "pane 1 后端会话",
              conversationId,
              id: secondPane ? "msg-pane-2" : "msg-pane-1",
              role: "user",
            }),
          ],
          paneId: secondPane ? "pane-2" : "pane-1",
          tabId: secondPane ? "tab-2" : "tab-1",
          targetKey: secondPane ? "pane:pane-2" : "pane:pane-1",
          title: secondPane ? "Pane 2 conversation" : "Pane 1 conversation",
        });
      },
    );

    const { rerender } = renderAiToolContent();

    expect(await screen.findByText("pane 1 后端会话")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "AI 会话绑定目标" }),
    ).toHaveTextContent("本地 PowerShell");
    expect(screen.getByTitle("槽位 pane:pane-1")).toBeInTheDocument();

    rerender(
      <AiToolContent
        activeTab={tabTwo}
        focusedPane={paneTwo}
        selectedMachine={machineTwo}
      />,
    );

    expect(await screen.findByText("pane 2 后端会话")).toBeInTheDocument();
    expect(screen.queryByText("pane 1 后端会话")).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "AI 会话绑定目标" }),
    ).toHaveTextContent("prod-db shell");
    expect(
      screen.getByRole("status", { name: "AI 会话绑定目标" }),
    ).toHaveTextContent("主机 prod-db");
    expect(screen.getByTitle("槽位 pane:pane-2")).toBeInTheDocument();
    await waitFor(() => {
      expect(conversationApiMock.getAiConversationSlot).toHaveBeenCalledWith(
        "pane:pane-2",
      );
    });
  });

  it("keeps local history usable when passive Tauri slot loading fails", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    conversationApiMock.getAiConversationSlot.mockRejectedValue(
      new Error("storage unavailable"),
    );
    window.localStorage.setItem(
      "kerminal.ai.conversations.v1",
      JSON.stringify({
        activeConversationId: "conv-local",
        conversations: [
          {
            createdAt: now - 1000,
            id: "conv-local",
            messages: [
              {
                content: "继续使用本地历史",
                createdAt: now - 900,
                id: "msg-local",
                role: "user",
              },
            ],
            title: "本地兜底历史",
            updatedAt: now - 800,
          },
        ],
      }),
    );

    renderAiToolContent();

    await waitFor(() => {
      expect(conversationApiMock.getAiConversationSlot).toHaveBeenCalled();
    });
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    expect(screen.getByText("本地兜底历史")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("persists user and assistant messages for Tauri conversations", async () => {
    const user = userEvent.setup();
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({
        messages: [
          storedMessage({
            content: "后端会话已加载",
            id: "msg-existing-user",
            role: "user",
          }),
        ],
      }),
    );

    renderAiToolContent();

    expect(await screen.findByText("后端会话已加载")).toBeInTheDocument();
    await user.type(screen.getByLabelText("AI 对话输入"), "保存这轮对话");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      expect(conversationApiMock.appendAiConversationMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "保存这轮对话",
          conversationId: "conv-backend",
          role: "user",
          status: "complete",
        }),
      );
      expect(conversationApiMock.appendAiConversationMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "这是 AI 回复。",
          conversationId: "conv-backend",
          model: "gpt-test",
          providerId: "llm-test",
          role: "assistant",
          status: "complete",
        }),
      );
    });
  });

  it("imports a selected image and binds it to the persisted user message", async () => {
    const user = userEvent.setup();
    const importedAttachment = storedAttachment({
      assetPath: "ai-attachments/conv-backend/att-ssh/original.png",
      height: 480,
      id: "att-ssh",
      messageId: null,
      originalName: "ssh.png",
      sizeBytes: 2048,
      sourceKind: "picker",
      visionUsage: "ocrOnly",
      width: 640,
    });
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({ messages: [] }),
    );
    fileDialogApiMock.selectLocalImage.mockResolvedValue("C:/tmp/ssh.png");
    conversationApiMock.importAiConversationAttachment.mockResolvedValue(
      importedAttachment,
    );
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue({
      attachment: importedAttachment,
      exists: true,
      previewPath: "C:/Users/kerminal/.kerminal/ai-attachments/ssh.png",
      resolvedPath: "C:/Users/kerminal/.kerminal/ai-attachments/ssh.png",
    });
    conversationApiMock.appendAiConversationMessage.mockImplementation(
      async (request) =>
        storedMessage({
          content: request.content,
          id: request.role === "user" ? "msg-user-new" : "msg-ai-new",
          model: request.model,
          providerId: request.providerId,
          role: request.role,
          status: request.status ?? "complete",
        }),
    );
    conversationApiMock.bindAiConversationAttachmentToMessage.mockResolvedValue(
      storedAttachment({
        ...importedAttachment,
        messageId: "msg-user-new",
      }),
    );

    renderAiToolContent();

    await screen.findByRole("heading", { name: "Kerminal Agent" });
    await waitFor(() => {
      expect(conversationApiMock.getAiConversation).toHaveBeenCalled();
    });
    await user.click(screen.getByRole("button", { name: "添加图片附件" }));

    expect(await screen.findByText("ssh.png")).toBeInTheDocument();
    expect(conversationApiMock.importAiConversationAttachment).toHaveBeenCalledWith({
      conversationId: "conv-backend",
      sourceKind: "picker",
      sourcePath: "C:/tmp/ssh.png",
      visionUsage: "visionInput",
    });

    await user.type(screen.getByLabelText("AI 对话输入"), "识别 SSH 配置");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      expect(conversationApiMock.appendAiConversationMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "识别 SSH 配置",
          conversationId: "conv-backend",
          role: "user",
        }),
      );
      expect(
        conversationApiMock.bindAiConversationAttachmentToMessage,
      ).toHaveBeenCalledWith({
        attachmentId: "att-ssh",
        messageId: "msg-user-new",
      });
    });
    expect(screen.getAllByText("ssh.png").length).toBeGreaterThan(0);
    expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-backend",
        attachments: [expect.objectContaining({ visionUsage: "visionInput" })],
        message: "识别 SSH 配置",
      }),
      expect.anything(),
    );
  });

  it("imports dropped local image paths as pending attachments", async () => {
    const droppedAttachment = storedAttachment({
      assetPath: "ai-attachments/conv-backend/att-drop/original.png",
      height: 720,
      id: "att-drop",
      messageId: null,
      originalName: "drop.png",
      sizeBytes: 4096,
      sourceKind: "drag",
      visionUsage: "ocrOnly",
      width: 1280,
    });
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({ messages: [] }),
    );
    conversationApiMock.importAiConversationAttachment.mockResolvedValue(
      droppedAttachment,
    );

    renderAiToolContent();

    await waitFor(() => {
      expect(conversationApiMock.getAiConversation).toHaveBeenCalled();
    });
    const dropZone = screen.getByTestId("ai-attachment-drop-zone");
    const dataTransfer = fileTransfer([
      localImageFile("drop.png", "C:/tmp/drop.png"),
    ]);

    fireEvent.dragOver(dropZone, { dataTransfer });
    fireEvent.drop(dropZone, { dataTransfer });

    expect(await screen.findByText("drop.png")).toBeInTheDocument();
    expect(conversationApiMock.importAiConversationAttachment).toHaveBeenCalledWith({
      conversationId: "conv-backend",
      sourceKind: "drag",
      sourcePath: "C:/tmp/drop.png",
      visionUsage: "visionInput",
    });
  });

  it("imports pasted local image paths as pending attachments", async () => {
    const pastedAttachment = storedAttachment({
      assetPath: "ai-attachments/conv-backend/att-paste/original.png",
      id: "att-paste",
      messageId: null,
      originalName: "paste.png",
      sourceKind: "paste",
      visionUsage: "ocrOnly",
    });
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({ messages: [] }),
    );
    conversationApiMock.importAiConversationAttachment.mockResolvedValue(
      pastedAttachment,
    );

    renderAiToolContent();

    await waitFor(() => {
      expect(conversationApiMock.getAiConversation).toHaveBeenCalled();
    });
    fireEvent.paste(screen.getByTestId("ai-attachment-drop-zone"), {
      clipboardData: fileTransfer([
        localImageFile("paste.png", "C:/tmp/paste.png"),
      ]),
    });

    expect(await screen.findByText("paste.png")).toBeInTheDocument();
    expect(conversationApiMock.importAiConversationAttachment).toHaveBeenCalledWith({
      conversationId: "conv-backend",
      sourceKind: "paste",
      sourcePath: "C:/tmp/paste.png",
      visionUsage: "visionInput",
    });
  });

  it("imports pasted clipboard image bytes when no local file path exists", async () => {
    const pastedAttachment = storedAttachment({
      assetPath: "ai-attachments/conv-backend/att-clipboard/original.png",
      id: "att-clipboard",
      messageId: null,
      originalName: "clipboard.png",
      sourceKind: "paste",
      visionUsage: "ocrOnly",
    });
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({ messages: [] }),
    );
    conversationApiMock.importAiConversationAttachmentBytes.mockResolvedValue(
      pastedAttachment,
    );

    renderAiToolContent();

    await waitFor(() => {
      expect(conversationApiMock.getAiConversation).toHaveBeenCalled();
    });
    fireEvent.paste(screen.getByTestId("ai-attachment-drop-zone"), {
      clipboardData: fileTransfer([
        new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
          type: "image/png",
        }),
      ]),
    });

    expect(await screen.findByText("clipboard.png")).toBeInTheDocument();
    expect(
      conversationApiMock.importAiConversationAttachmentBytes,
    ).toHaveBeenCalledWith({
      bytes: [137, 80, 78, 71],
      conversationId: "conv-backend",
      originalName: "clipboard.png",
      sourceKind: "paste",
      visionUsage: "visionInput",
    });
    expect(conversationApiMock.importAiConversationAttachment).not.toHaveBeenCalled();
  });

  it("opens an image attachment preview and can delegate to the system opener", async () => {
    const user = userEvent.setup();
    const imageAttachment = storedAttachment({
      assetPath: "ai-attachments/conv-backend/att-preview/original.png",
      height: 480,
      id: "att-preview",
      messageId: "msg-user",
      originalName: "preview.png",
      sizeBytes: 2048,
      width: 640,
    });
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({
        attachments: [imageAttachment],
        messages: [
          storedMessage({
            content: "看这张图",
            id: "msg-user",
            role: "user",
          }),
        ],
      }),
    );
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue({
      attachment: imageAttachment,
      exists: true,
      previewPath: "C:/Users/kerminal/.kerminal/ai-attachments/preview.png",
      resolvedPath: "C:/Users/kerminal/.kerminal/ai-attachments/preview.png",
    });

    renderAiToolContent();

    expect(await screen.findByText("看这张图")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /preview\.png/i }));

    expect(
      await screen.findByRole("dialog", { name: "preview.png" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "preview.png" }),
    ).toHaveAttribute(
      "src",
      "asset://C:/Users/kerminal/.kerminal/ai-attachments/preview.png",
    );

    await user.click(screen.getByRole("button", { name: "系统打开" }));
    expect(conversationApiMock.openAiConversationAttachment).toHaveBeenCalledWith(
      "att-preview",
    );
  });

  it("persists assistant error messages after a Tauri send failure", async () => {
    const user = userEvent.setup();
    conversationApiMock.getAiConversationSlot.mockResolvedValue({
      activeConversationId: "conv-backend",
      draftText: null,
      lastActiveAt: 1000,
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-1",
      targetRefJson: "{}",
      updatedAt: 1000,
    });
    conversationApiMock.getAiConversation.mockResolvedValue(
      storedConversation({
        messages: [
          storedMessage({
            content: "后端错误会话已加载",
            id: "msg-existing-error-user",
            role: "user",
          }),
        ],
      }),
    );
    agentApiMock.streamAiChatMessage.mockRejectedValue(new Error("model down"));

    renderAiToolContent();

    expect(await screen.findByText("后端错误会话已加载")).toBeInTheDocument();
    await user.type(screen.getByLabelText("AI 对话输入"), "触发失败");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("model down");
    expect(screen.getAllByText("回复生成失败：model down").length).toBeGreaterThan(
      0,
    );
    await waitFor(() => {
      expect(conversationApiMock.appendAiConversationMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "回复生成失败：model down",
          conversationId: "conv-backend",
          role: "assistant",
          status: "error",
        }),
      );
    });
  });
});
