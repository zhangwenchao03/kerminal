import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAttachment } from "../../lib/aiConversationApi";
import type { Machine, TerminalPane, TerminalTab } from "../workspace/types";
import { AiToolContent } from "./AiToolContent";

const tauriCoreMock = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  isTauri: vi.fn(),
}));
const webviewMock = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
}));
const agentApiMock = vi.hoisted(() => ({
  streamAiChatMessage: vi.fn(),
}));
const contextApiMock = vi.hoisted(() => ({
  getAiTerminalContextSnapshot: vi.fn(),
}));
const conversationApiMock = vi.hoisted(() => ({
  importAiConversationAttachmentBytes: vi.fn(),
}));
const invocationApiMock = vi.hoisted(() => ({
  clearAiToolAudits: vi.fn(),
  confirmAiToolInvocation: vi.fn(),
  exportAiToolAudits: vi.fn(),
  listAiToolAudits: vi.fn(),
}));
const providerApiMock = vi.hoisted(() => ({
  listLlmProviders: vi.fn(),
}));
const sessionRegistryMock = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (...args: unknown[]) => webviewMock.onDragDropEvent(...args),
  }),
}));
vi.mock("../../lib/aiAgentApi", () => agentApiMock);
vi.mock("../../lib/aiContextApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiContextApi")>(
    "../../lib/aiContextApi",
  );
  return {
    ...actual,
    getAiTerminalContextSnapshot: contextApiMock.getAiTerminalContextSnapshot,
  };
});
vi.mock("../../lib/aiConversationApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/aiConversationApi")
  >("../../lib/aiConversationApi");
  return {
    ...actual,
    importAiConversationAttachmentBytes:
      conversationApiMock.importAiConversationAttachmentBytes,
  };
});
vi.mock("../../lib/aiToolInvocationApi", () => invocationApiMock);
vi.mock("../../lib/llmProviderApi", () => providerApiMock);
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
  description: "本地 PowerShell",
  id: "local-powershell",
  kind: "local",
  name: "PowerShell",
  status: "online",
  tags: [],
};

describe("AiToolContent image-only messages", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tauriCoreMock.isTauri.mockReturnValue(false);
    webviewMock.onDragDropEvent.mockReset();
    agentApiMock.streamAiChatMessage.mockReset();
    contextApiMock.getAiTerminalContextSnapshot.mockReset();
    conversationApiMock.importAiConversationAttachmentBytes.mockReset();
    invocationApiMock.clearAiToolAudits.mockReset();
    invocationApiMock.confirmAiToolInvocation.mockReset();
    invocationApiMock.exportAiToolAudits.mockReset();
    invocationApiMock.listAiToolAudits.mockReset();
    providerApiMock.listLlmProviders.mockReset();
    sessionRegistryMock.getTerminalPaneSession.mockReset();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:kerminal-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
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
    conversationApiMock.importAiConversationAttachmentBytes.mockResolvedValue(
      storedAttachment(),
    );
    agentApiMock.streamAiChatMessage.mockImplementation(async (_request, options) => {
      const response = {
        contextUsed: false,
        conversationId: "chat-1",
        generatedAt: "1",
        message: "图片里有一条 SSH 连接信息。",
        model: "gpt-test",
        pendingInvocations: [],
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 0,
      };
      options?.onDelta?.(response.message);
      return response;
    });
  });

  it("sends a pasted image without requiring extra text", async () => {
    const user = userEvent.setup();
    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        selectedMachine={selectedMachine}
      />,
    );

    fireEvent.paste(await screen.findByTestId("ai-attachment-drop-zone"), {
      clipboardData: fileTransfer([
        new File([new Uint8Array([137, 80, 78, 71])], "ssh-login.png", {
          type: "image/png",
        }),
      ]),
    });
    expect(await screen.findByText("ssh-login.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));

    await waitFor(() => {
      expect(agentApiMock.streamAiChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [expect.objectContaining({ id: "att-image-only" })],
          message: "请分析我发送的图片，提取其中可操作的信息。",
        }),
        expect.any(Object),
      );
    });
    expect(await screen.findByText("图片里有一条 SSH 连接信息。")).toBeInTheDocument();
  });

  it("opens a preview dialog when a pasted pending image is clicked", async () => {
    const user = userEvent.setup();
    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        selectedMachine={selectedMachine}
      />,
    );

    fireEvent.paste(await screen.findByTestId("ai-attachment-drop-zone"), {
      clipboardData: fileTransfer([
        new File([new Uint8Array([137, 80, 78, 71])], "ssh-login.png", {
          type: "image/png",
        }),
      ]),
    });

    await user.click(
      await screen.findByRole("button", { name: "预览附件 ssh-login.png" }),
    );

    expect(
      screen.getByRole("img", { name: "ssh-login.png" }),
    ).toHaveAttribute("src", "blob:kerminal-preview");
  });
});

function storedAttachment(): AiAttachment {
  return {
    assetPath: "ai-attachments/conv-1/att-image-only/original.png",
    conversationId: "chat-1",
    createdAt: 1_765_000_000_000,
    height: 320,
    id: "att-image-only",
    kind: "image",
    messageId: null,
    mimeType: "image/png",
    missingReason: null,
    ocrText: "ssh root@example.com",
    originalName: "ssh-login.png",
    originalPath: null,
    redactionSummary: null,
    sha256: null,
    sizeBytes: 4096,
    sourceKind: "paste",
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: null,
    updatedAt: 1_765_000_000_000,
    visionUsage: "visionInput",
    width: 640,
  };
}

function fileTransfer(files: File[]) {
  return {
    files,
    items: files.map((file) => ({
      getAsFile: () => file,
      kind: "file",
    })),
  };
}
