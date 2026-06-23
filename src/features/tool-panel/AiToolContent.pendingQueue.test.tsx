import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("../../lib/aiToolInvocationApi", () => invocationApiMock);
vi.mock("../../lib/aiContextApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiContextApi")>(
    "../../lib/aiContextApi",
  );
  return {
    ...actual,
    getAiTerminalContextSnapshot: contextApiMock.getAiTerminalContextSnapshot,
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
  description: "本地 PowerShell",
  id: "local-powershell",
  kind: "local",
  name: "PowerShell",
  status: "online",
  tags: [],
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

describe("AiToolContent pending invocation queue", () => {
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
    invocationApiMock.confirmAiToolInvocation.mockResolvedValue(splitAuditRecord);
    invocationApiMock.listAiToolAudits.mockResolvedValue([]);
    contextApiMock.getAiTerminalContextSnapshot.mockResolvedValue({
      generatedAt: "1",
      output: {
        capturedBytes: 32,
        data: "cargo test",
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

  it("keeps pending approvals scoped to their conversation", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();
    agentApiMock.streamAiChatMessage.mockImplementation(async (_request, options) => {
      const response = {
        contextUsed: true,
        conversationId: "chat-1",
        generatedAt: "1",
        message: "建议向右拆分一个终端，等待你确认。",
        model: "gpt-test",
        pendingInvocations: [splitPendingInvocation],
        providerId: "llm-test",
        providerName: "测试 Provider",
        responseRedacted: false,
        toolCount: 1,
      };
      options?.onDelta?.(response.message);
      return response;
    });

    render(
      <AiToolContent
        activeTab={activeTab}
        focusedPane={focusedPane}
        onSplitPane={onSplitPane}
        selectedMachine={selectedMachine}
      />,
    );

    await user.type(screen.getByLabelText("AI 对话输入"), "帮我拆分终端");
    await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));
    expect(await screen.findByRole("button", { name: "批准" })).toBeInTheDocument();
    const firstConversationId = agentApiMock.streamAiChatMessage.mock.calls[0][0].conversationId;

    await user.click(screen.getByRole("button", { name: "新建 AI 对话" }));
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    await user.click(
      screen.getByRole("button", { name: "继续会话 帮我拆分终端" }),
    );
    await user.click(await screen.findByRole("button", { name: "批准" }));

    await waitFor(() => {
      expect(invocationApiMock.confirmAiToolInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          approved: true,
          auditContext: expect.objectContaining({
            conversationId: firstConversationId,
            paneId: "pane-1",
            targetKey: "pane:pane-1",
          }),
          invocationId: "tool-call-split",
        }),
      );
      expect(onSplitPane).toHaveBeenCalledWith("horizontal");
    });
  });
});
