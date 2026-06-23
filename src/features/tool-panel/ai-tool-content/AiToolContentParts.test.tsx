import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiAttachment,
  AiAttachmentAssetInfo,
} from "../../../lib/aiConversationApi";
import type { AiTerminalContextSnapshot } from "../../../lib/aiContextApi";
import type { AiAgentRunSnapshot } from "../../../lib/aiAgentRunApi";
import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";
import type { LlmProvider } from "../../settings/llmProviderModel";
import { normalizeAppSettings } from "../../settings/settingsModel";
import {
  ChatMessageBubble,
  ContextUsageIndicator,
  ExecutionModeSelector,
  PendingInvocationPanel,
  ProviderSelector,
} from "./AiToolContentParts";
import { AiRunTimeline } from "./AiRunTimeline";
import type { AiChatAttachment, AiChatMessage } from "./aiToolContentModel";

const conversationApiMock = vi.hoisted(() => ({
  getAiConversationAttachmentAssetInfo: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
  MessagePartPrimitive: {
    Text: () => null,
  },
  MessagePrimitive: {
    Content: () => null,
    Root: ({ children }: { children?: ReactNode }) => <>{children}</>,
  },
}));

vi.mock("@assistant-ui/react-streamdown", () => ({
  StreamdownTextPrimitive: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  isTauri: () => true,
}));

vi.mock("../../../lib/aiConversationApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/aiConversationApi")
  >("../../../lib/aiConversationApi");
  return {
    ...actual,
    getAiConversationAttachmentAssetInfo:
      conversationApiMock.getAiConversationAttachmentAssetInfo,
  };
});

describe("ChatMessageBubble attachments", () => {
  beforeEach(() => {
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockReset();
  });

  it("shows a restored image thumbnail from attachment asset info", async () => {
    const attachment = chatImageAttachment({
      assetPath: "ai-attachments/conv-1/att-history-image/original.png",
      storageMode: "managedCopy",
    });
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue(
      assetInfo({
        attachment: storedAttachment({
          assetPath: attachment.assetPath,
          storageMode: "managedCopy",
        }),
        exists: true,
        previewPath: "C:/Kerminal/ai-attachments/conv-1/att-history-image/original.png",
        resolvedPath:
          "C:/Kerminal/ai-attachments/conv-1/att-history-image/original.png",
      }),
    );

    const { container } = render(
      <ChatMessageBubble
        message={messageWithAttachment(attachment)}
        onOpenAttachment={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          'img[src="asset://C:/Kerminal/ai-attachments/conv-1/att-history-image/original.png"]',
        ),
      ).toBeInTheDocument();
    });
    expect(await screen.findByText("Kerminal 受管副本")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ssh-login.png/ })).toBeEnabled();
    expect(
      conversationApiMock.getAiConversationAttachmentAssetInfo,
    ).toHaveBeenCalledWith("att-history-image");
  });

  it("syncs a historical image card to missing when the linked file was deleted", async () => {
    const attachment = chatImageAttachment({
      originalPath: "C:/tmp/ssh-login.png",
      storageMode: "linkedFile",
    });
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue(
      assetInfo({
        attachment: storedAttachment({
          missingReason: "deleted",
          originalPath: attachment.originalPath,
          status: "missing",
          storageMode: "linkedFile",
        }),
        exists: false,
        previewPath: null,
        resolvedPath: null,
      }),
    );

    render(
      <ChatMessageBubble
        message={messageWithAttachment(attachment)}
        onOpenAttachment={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("文件不可用：已删除"),
    ).toBeInTheDocument();
    expect(screen.getByText("引用原文件")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /ssh-login.png/ })).toBeDisabled();
    });
  });
});

describe("PendingInvocationPanel", () => {
  it("does not show manual approval controls for auto-resolved invocations", () => {
    const { container } = render(
      <PendingInvocationPanel
        error={null}
        invocation={pendingInvocation({ requiresConfirmation: false })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        state="idle"
      />,
    );

    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("terminal.write");
  });

  it("keeps approval controls for invocations that require confirmation", () => {
    const { container } = render(
      <PendingInvocationPanel
        error={null}
        invocation={pendingInvocation({ requiresConfirmation: true })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        state="idle"
      />,
    );

    expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(container).toHaveTextContent("terminal.write");
  });

  it("still displays auto-resolution errors without manual invocation controls", () => {
    render(
      <PendingInvocationPanel
        error="自动执行失败：终端不存在"
        invocation={pendingInvocation({ requiresConfirmation: false })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        state="idle"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("自动执行失败：终端不存在");
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
  });
});

describe("AiRunTimeline", () => {
  it("renders timeline, final message, and cancel action for waiting runs", () => {
    const onCancel = vi.fn();

    const { container } = render(
      <AiRunTimeline
        actionState="idle"
        error={null}
        finalMessage="等待你批准后继续。"
        snapshot={agentRunSnapshot("waitingApproval")}
        onCancel={onCancel}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Agent run 状态")).toBeInTheDocument();
    expect(screen.getAllByText("等待确认").length).toBeGreaterThan(0);
    expect(screen.getByText("模型判断")).toBeInTheDocument();
    expect(screen.getByText("工具调用")).toBeInTheDocument();
    expect(screen.getByText("等待你批准后继续。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消 run" })).toBeEnabled();
    expect(container.querySelector(".kerminal-muted-surface")).toBeInTheDocument();
  });

  it("renders retry action for blocked runs without cancel", () => {
    render(
      <AiRunTimeline
        actionState="idle"
        error={null}
        finalMessage={null}
        snapshot={agentRunSnapshot("blocked")}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getAllByText("已阻塞").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重试上一步" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "取消 run" }),
    ).not.toBeInTheDocument();
  });
});

describe("AI composer selectors", () => {
  it("shows all compact execution mode options above the composer", async () => {
    const user = userEvent.setup();

    render(
      <ExecutionModeSelector
        compact
        onChange={vi.fn()}
        settings={appSettingsWithApprovalPolicy("relaxed")}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "AI 执行模式" }));

    expect(screen.getByRole("combobox", { name: "AI 执行模式" }).parentElement).toHaveClass(
      "w-[4.25rem]",
    );
    expect(screen.getByRole("listbox")).toHaveAttribute("data-side", "top");
    expect(screen.getByRole("listbox")).toHaveClass("w-[4.25rem]");
    expect(screen.getByRole("listbox")).toHaveClass(
      "[&_button[role=option]>svg]:hidden",
    );
    expect(screen.getByRole("option", { name: /确认/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /安全/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /自动/ })).toBeInTheDocument();
  });

  it("uses a compact provider menu in the composer toolbar", async () => {
    const user = userEvent.setup();

    render(
      <ProviderSelector
        compact
        error={null}
        onChange={vi.fn()}
        providers={[
          llmProvider({
            model: "gpt-5.5-latest",
            name: "5.5 openai",
            reasoningEffort: "high",
          }),
        ]}
        selectedProviderId="provider-openai"
        state="idle"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "AI 模型" }));

    expect(screen.getByRole("combobox", { name: "AI 模型" }).parentElement).toHaveClass(
      "w-[5rem]",
    );
    expect(screen.getByRole("listbox")).toHaveClass("w-[5rem]");
    expect(screen.getByRole("combobox", { name: "AI 模型" })).toHaveAttribute(
      "aria-valuetext",
      "gpt-5.5-latest",
    );
    expect(
      screen.getByRole("option", { name: /gpt-5\.5-latest/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^5\.5$/ })).not.toBeInTheDocument();
    expect(screen.getByText("5.5 openai · 高")).toBeInTheDocument();
  });

  it("shows context usage as a compact hollow ring", () => {
    render(
      <ContextUsageIndicator
        error={null}
        snapshot={terminalContextSnapshot({
          capturedBytes: 512,
          maxBytes: 2048,
        })}
        state="idle"
      />,
    );

    const indicator = screen.getByRole("status", {
      name: "使用量 25%",
    });
    expect(indicator).toHaveClass("h-5", "w-5", "shrink-0");
    expect(indicator.firstElementChild).toHaveClass("h-4", "w-4");
    expect(indicator).toHaveAttribute(
      "title",
      "25% · 0.5K/2K",
    );
  });

  it("keeps the empty context usage tooltip minimal", () => {
    render(
      <ContextUsageIndicator error={null} snapshot={null} state="idle" />,
    );

    const indicator = screen.getByRole("status", {
      name: "使用量 0%",
    });
    expect(indicator).toHaveAttribute("title", "0% · 0K/0K");
  });
});

function messageWithAttachment(attachment: AiChatAttachment): AiChatMessage {
  return {
    attachments: [attachment],
    content: "这张图里有 SSH 登录方式",
    createdAt: 1_765_000_000_000,
    id: "msg-history-image",
    role: "user",
  };
}

function chatImageAttachment(
  overrides: Partial<AiChatAttachment> = {},
): AiChatAttachment {
  return {
    assetPath: null,
    height: 320,
    id: "att-history-image",
    kind: "image",
    mimeType: "image/png",
    missingReason: null,
    ocrText: null,
    originalName: "ssh-login.png",
    originalPath: null,
    redactionSummary: null,
    sizeBytes: 4096,
    status: "available",
    storageMode: null,
    thumbnailPath: null,
    visionUsage: "visionInput",
    width: 640,
    ...overrides,
  };
}

function assetInfo(input: AiAttachmentAssetInfo): AiAttachmentAssetInfo {
  return input;
}

function storedAttachment(overrides: Partial<AiAttachment> = {}): AiAttachment {
  return {
    assetPath: null,
    conversationId: "conv-1",
    createdAt: 1_765_000_000_000,
    height: 320,
    id: "att-history-image",
    kind: "image",
    messageId: "msg-history-image",
    mimeType: "image/png",
    missingReason: null,
    ocrText: null,
    originalName: "ssh-login.png",
    originalPath: null,
    redactionSummary: null,
    sha256: null,
    sizeBytes: 4096,
    sourceKind: "picker",
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: null,
    updatedAt: 1_765_000_000_000,
    visionUsage: "visionInput",
    width: 640,
    ...overrides,
  };
}

function pendingInvocation(
  overrides: Partial<AiToolPendingInvocation> = {},
): AiToolPendingInvocation {
  return {
    argumentsSummary: "data=docker stats --no-stream, sessionId=session-1",
    audit: "summary",
    confirmation: "auto",
    createdAt: "3",
    id: "tool-call-terminal-write",
    reason: "Kerminal Agent 请求写入终端。",
    requestedBy: "kerminal-agent",
    requiresConfirmation: false,
    risk: "write",
    status: "pending",
    toolId: "terminal.write",
    toolTitle: "写入终端",
    ...overrides,
  };
}

function agentRunSnapshot(
  status: "blocked" | "waitingApproval",
): AiAgentRunSnapshot {
  return {
    run: {
      conversationId: "conv-1",
      conversationSlotJson: null,
      createdAt: 1,
      goal: "添加主机后连接",
      id: `run-${status}`,
      iteration: 3,
      maxIterations: 20,
      maxToolCalls: 5,
      status,
      updatedAt: 2,
    },
    steps: [
      {
        createdAt: 1,
        id: "step-model",
        inputJson: null,
        kind: "model",
        observationJson: null,
        runId: `run-${status}`,
        status: "succeeded",
        summary: "需要先创建主机。",
        toolId: null,
        updatedAt: 1,
      },
      {
        createdAt: 2,
        id: "step-tool",
        inputJson: null,
        kind: "toolCall",
        observationJson: null,
        runId: `run-${status}`,
        status: status === "blocked" ? "blocked" : "waitingApproval",
        summary: "创建远程主机",
        toolId: "remote_host.create",
        updatedAt: 2,
      },
    ],
  };
}

function appSettingsWithApprovalPolicy(
  commandApprovalPolicy: "always" | "risky" | "relaxed",
) {
  const settings = normalizeAppSettings();
  return {
    ...settings,
    ai: {
      ...settings.ai,
      commandApprovalPolicy,
    },
  };
}

function llmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    apiKeyConfigured: true,
    apiKeyCredentialRef: "credential:llm/openai/api-key",
    baseUrl: "https://api.openai.com/v1",
    contextStrategy: "currentTerminal",
    contextWindowTokens: 128000,
    createdAt: "1",
    enabled: true,
    id: "provider-openai",
    isDefault: true,
    kind: "openAiChat",
    maxRetries: 3,
    model: "gpt-5.5",
    modelList: ["gpt-5.5"],
    name: "openai",
    reasoningEffort: "modelDefault",
    temperature: 0.2,
    updatedAt: "1",
    ...overrides,
  };
}

function terminalContextSnapshot({
  capturedBytes,
  maxBytes,
}: {
  capturedBytes: number;
  maxBytes: number;
}): AiTerminalContextSnapshot {
  return {
    generatedAt: "2026-06-21T14:00:00Z",
    output: {
      capturedBytes,
      data: "terminal output",
      maxBytes,
      truncated: false,
    },
    policy: {
      includesFullHistory: false,
      includesRecentOutput: true,
      maxOutputBytes: maxBytes,
      mode: "currentTerminal",
      secretRedaction: true,
    },
    redacted: false,
    session: {
      cols: 120,
      cwd: "C:/dev/rust/kerminal",
      id: "session-context-1",
      rows: 32,
      shell: "powershell",
      status: "running",
    },
    source: {
      paneId: "pane-1",
      paneTitle: "Pane 1",
      tabId: "tab-1",
      tabTitle: "Terminal",
    },
  };
}
