import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiToolAuditRecord,
  AiToolPendingInvocation,
} from "../../lib/aiToolInvocationApi";
import { defaultAppSettings } from "../settings/settingsModel";
import { resetWorkspaceStore } from "../workspace/workspaceStore";
import {
  getKerminalShellTestMocks,
  remoteHostTree,
  testSshOptions,
} from "../../app/KerminalShell.testSupport";
import { KerminalShell } from "../../app/KerminalShell";

const aiMocks = vi.hoisted(() => ({
  agentApi: {
    streamAiChatMessage: vi.fn(),
  },
  contextApi: {
    getAiTerminalContextSnapshot: vi.fn(),
  },
  coreApi: {
    convertFileSrc: vi.fn((path: string) => `asset://${path}`),
    invoke: vi.fn(),
    isTauri: vi.fn(() => false),
  },
  invocationApi: {
    clearAiToolAudits: vi.fn(),
    confirmAiToolInvocation: vi.fn(),
    exportAiToolAudits: vi.fn(),
    listAiToolAudits: vi.fn(),
  },
  providerApi: {
    listLlmProviders: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => aiMocks.coreApi);
vi.mock("../../lib/aiAgentApi", () => aiMocks.agentApi);
vi.mock("../../lib/aiContextApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiContextApi")>(
    "../../lib/aiContextApi",
  );
  return {
    ...actual,
    getAiTerminalContextSnapshot:
      aiMocks.contextApi.getAiTerminalContextSnapshot,
  };
});
vi.mock("../../lib/aiToolInvocationApi", () => aiMocks.invocationApi);
vi.mock("../../lib/llmProviderApi", () => aiMocks.providerApi);

const mocks = getKerminalShellTestMocks();

const aiCreatedHost = {
  authType: "agent" as const,
  createdAt: "2026-06-21 11:20:00",
  credentialRef: undefined,
  groupId: "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
  host: "prod.example.com",
  id: "host-ai-prod",
  name: "AI prod.example.com",
  port: 2222,
  production: false,
  sshOptions: testSshOptions,
  sortOrder: 20,
  tags: ["ssh", "ai-created"],
  updatedAt: "2026-06-21 11:20:00",
  username: "deploy",
};

const remoteHostTreeAfterAiCreate = [
  {
    ...remoteHostTree[0],
    hosts: [...remoteHostTree[0].hosts, aiCreatedHost],
  },
];

const remoteHostPendingInvocation: AiToolPendingInvocation = {
  argumentsSummary:
    "name=AI prod.example.com, host=prod.example.com, port=2222, username=deploy, authType=agent",
  audit: "summary",
  confirmation: "always",
  createdAt: "5",
  id: "tool-call-remote-host",
  reason: "图片识别到 SSH 连接方式，建议保存为远程主机。",
  requestedBy: "kerminal-agent",
  requiresConfirmation: true,
  risk: "remote",
  status: "pending",
  toolId: "remote_host.create",
  toolTitle: "创建远程主机",
};

const remoteHostAuditRecord: AiToolAuditRecord = {
  argumentsSummary: remoteHostPendingInvocation.argumentsSummary,
  completedAt: "6",
  confirmation: "always",
  createdAt: "5",
  error: null,
  id: "tool-audit-remote-host",
  invocationId: remoteHostPendingInvocation.id,
  resultSummary:
    "已创建远程主机 AI prod.example.com (deploy@prod.example.com:2222)。",
  risk: "remote",
  status: "succeeded",
  toolId: "remote_host.create",
  toolTitle: "创建远程主机",
};

describe("KerminalShell AI tool integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-language");
    document.documentElement.removeAttribute("lang");
    window.localStorage.clear();
    resetWorkspaceStore();

    aiMocks.coreApi.isTauri.mockReturnValue(false);
    aiMocks.providerApi.listLlmProviders.mockResolvedValue([
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
    aiMocks.contextApi.getAiTerminalContextSnapshot.mockResolvedValue({
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
      redacted: true,
      session: {
        cols: 80,
        cwd: undefined,
        id: "browser-preview-session",
        rows: 24,
        shell: "browser-preview",
        status: "running",
      },
      source: {
        machineId: undefined,
        machineKind: undefined,
        machineName: undefined,
        paneId: undefined,
        paneTitle: undefined,
        tabId: undefined,
        tabTitle: undefined,
      },
    });
    aiMocks.invocationApi.listAiToolAudits.mockResolvedValue([]);
    aiMocks.invocationApi.confirmAiToolInvocation.mockResolvedValue(
      remoteHostAuditRecord,
    );
    aiMocks.agentApi.streamAiChatMessage.mockImplementation(
      async (_request, options) => {
        const response = {
          contextUsed: true,
          conversationId: "chat-shell-ai",
          generatedAt: "1",
          message: "已根据图片识别结果准备创建远程主机。",
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

    mocks.appTitleBar.renderCount = 0;
    mocks.nativeMenuApi.listenNativeMenuActions.mockResolvedValue(
      () => undefined,
    );
    mocks.profileApi.detectShells.mockResolvedValue([]);
    mocks.profileApi.listProfiles.mockResolvedValue([]);
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(remoteHostTree);
    mocks.settingsApi.getSettings.mockResolvedValue(defaultAppSettings);
    mocks.settingsApi.updateSettings.mockImplementation(
      async (settings) => settings,
    );
  });

  it(
    "refreshes the sidebar host tree after approving an AI remote host creation",
    async () => {
      const user = userEvent.setup();
      mocks.remoteHostApi.listRemoteHostTree
        .mockResolvedValueOnce(remoteHostTree)
        .mockResolvedValueOnce(remoteHostTreeAfterAiCreate);

      render(<KerminalShell />);

      expect(
        await screen.findByRole("button", { name: /172\.16\.41\.60/ }),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "打开 Kerminal Agent" }),
      );
      await user.type(
        await screen.findByLabelText("AI 对话输入", {}, { timeout: 10_000 }),
        "这张图里有 SSH 连接方式，帮我配置主机",
      );
      await user.click(screen.getByRole("button", { name: "发送 AI 消息" }));
      await user.click(await screen.findByRole("button", { name: "批准" }));

      await waitFor(() => {
        expect(
          aiMocks.invocationApi.confirmAiToolInvocation,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            approved: true,
            invocationId: remoteHostPendingInvocation.id,
          }),
        );
        expect(mocks.remoteHostApi.listRemoteHostTree).toHaveBeenCalledTimes(2);
      });
      expect(
        await screen.findByRole("button", { name: /AI prod\.example\.com/ }),
      ).toBeInTheDocument();
    },
    20_000,
  );
});
