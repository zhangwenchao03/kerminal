import { describe, expect, it } from "vitest";
import {
  buildAiAgentRunViewModel,
  completeAssistantMessage,
  conversationMatchesHistoryQuery,
  hasConversationHistoryContent,
  normalizeConversation,
  normalizeHistorySearchQuery,
  resolveAiConversationRouteSelection,
  serializeConversation,
  type AiConversation,
} from "./aiToolContentModel";
import { buildAiChatHistory } from "./aiConversationTranscript";
import {
  buildAiConversationSlotDescriptor,
  conversationFromStoredConversation,
} from "./aiConversationPersistence";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";

const activeTab: TerminalTab = {
  id: "tab-prod",
  layout: { paneId: "pane-prod", type: "pane" },
  machineId: "host-prod",
  title: "prod-api",
};

const focusedPane: TerminalPane = {
  id: "pane-prod",
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

function agentRunSnapshot(status: Parameters<typeof buildAiAgentRunViewModel>[0]["snapshot"]["run"]["status"]) {
  return {
    run: {
      conversationId: "conv-1",
      conversationSlotJson: null,
      createdAt: 1,
      goal: "添加主机",
      id: `run-${status}`,
      iteration: 1,
      maxIterations: 20,
      maxToolCalls: 5,
      status,
      updatedAt: 2,
    },
    steps: [],
  };
}

describe("aiToolContentModel", () => {
  it("builds an agent run timeline with final fallback and actions", () => {
    const view = buildAiAgentRunViewModel({
      finalMessage: null,
      snapshot: {
        run: {
          conversationId: "conv-1",
          conversationSlotJson: null,
          createdAt: 1,
          goal: "添加主机",
          id: "run-1",
          iteration: 3,
          maxIterations: 20,
          maxToolCalls: 5,
          status: "completed",
          updatedAt: 2,
        },
        steps: [
          {
            createdAt: 1,
            id: "step-plan",
            kind: "plan",
            runId: "run-1",
            status: "succeeded",
            summary: "先查分组",
            toolId: null,
            inputJson: null,
            observationJson: null,
            updatedAt: 1,
          },
          {
            createdAt: 2,
            id: "step-tool",
            kind: "toolCall",
            runId: "run-1",
            status: "running",
            summary: null,
            toolId: "remote_host.create",
            inputJson: null,
            observationJson: null,
            updatedAt: 2,
          },
          {
            createdAt: 3,
            id: "step-final",
            kind: "final",
            runId: "run-1",
            status: "succeeded",
            summary: "已经添加完成。",
            toolId: null,
            inputJson: null,
            observationJson: null,
            updatedAt: 3,
          },
        ],
      },
    });

    expect(view).toMatchObject({
      canCancel: false,
      canRetry: false,
      finalMessage: "已经添加完成。",
      statusLabel: "已完成",
    });
    expect(view.items.map((item) => [item.label, item.detail])).toEqual([
      ["计划", "先查分组"],
      ["工具调用", "remote_host.create"],
      ["最终回复", "已经添加完成。"],
    ]);
  });

  it("enables cancel or retry according to run status", () => {
    expect(
      buildAiAgentRunViewModel({
        snapshot: agentRunSnapshot("waitingApproval"),
      }).canCancel,
    ).toBe(true);
    expect(
      buildAiAgentRunViewModel({
        snapshot: agentRunSnapshot("blocked"),
      }).canRetry,
    ).toBe(true);
    expect(
      buildAiAgentRunViewModel({
        snapshot: agentRunSnapshot("cancelled"),
      }).canRetry,
    ).toBe(true);
    expect(
      buildAiAgentRunViewModel({
        snapshot: agentRunSnapshot("completed"),
      }).canCancel,
    ).toBe(false);
  });

  it("builds a pane-scoped slot descriptor before falling back to host scope", () => {
    const descriptor = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    expect(descriptor).toMatchObject({
      routeMode: "followWorkspaceTarget",
      slotKey: "pane:pane-prod",
      createRequest: expect.objectContaining({
        hostId: "host-prod",
        paneId: "pane-prod",
        scopeKind: "lockedPane",
        targetKey: "pane:pane-prod",
        title: "prod-api shell",
      }),
    });
    expect(JSON.parse(descriptor.targetRefJson)).toMatchObject({
      kind: "pane",
      machineId: "host-prod",
      paneId: "pane-prod",
      tabId: "tab-prod",
    });
  });

  it("builds a tab-only slot descriptor when there is no focused pane", () => {
    const descriptor = buildAiConversationSlotDescriptor({ activeTab });

    expect(descriptor).toMatchObject({
      routeMode: "followWorkspaceTarget",
      slotKey: "tab:tab-prod",
      createRequest: expect.objectContaining({
        paneId: undefined,
        scopeKind: "followFocus",
        tabId: "tab-prod",
        targetKey: "tab:tab-prod",
        title: "prod-api",
      }),
    });
    expect(JSON.parse(descriptor.targetRefJson)).toEqual({
      kind: "tab",
      machineId: "host-prod",
      tabId: "tab-prod",
      tabTitle: "prod-api",
    });
  });

  it("builds a host-only slot descriptor when only a machine is selected", () => {
    const descriptor = buildAiConversationSlotDescriptor({ selectedMachine });

    expect(descriptor).toMatchObject({
      routeMode: "followWorkspaceTarget",
      slotKey: "host:host-prod",
      createRequest: expect.objectContaining({
        hostId: "host-prod",
        paneId: undefined,
        scopeKind: "lockedHost",
        tabId: undefined,
        targetKey: "host:host-prod",
        title: "prod-api",
      }),
    });
    expect(JSON.parse(descriptor.targetRefJson)).toEqual({
      kind: "host",
      machineId: "host-prod",
      machineKind: "ssh",
      machineName: "prod-api",
    });
  });

  it("builds a no-context slot descriptor without workspace target", () => {
    const descriptor = buildAiConversationSlotDescriptor({});

    expect(descriptor).toMatchObject({
      routeMode: "noContextChat",
      slotKey: "no-context",
      createRequest: expect.objectContaining({
        hostId: undefined,
        paneId: undefined,
        scopeKind: "noContext",
        tabId: undefined,
        targetKey: undefined,
        title: "普通 AI 会话",
      }),
      targetRefJson: JSON.stringify({ kind: "none" }),
    });
  });

  it("keeps current slot activation when history selection matches current pane", () => {
    const descriptor = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    expect(
      resolveAiConversationRouteSelection(
        {
          id: "conv-prod",
          paneId: "pane-prod",
          scopeRefJson: JSON.stringify({
            kind: "pane",
            paneId: "pane-prod",
            tabId: "tab-prod",
          }),
          tabId: "tab-prod",
          targetKey: "pane:pane-prod",
        },
        descriptor,
      ),
    ).toEqual({
      focusTabId: undefined,
      shouldActivateCurrentSlot: true,
    });
  });

  it("keeps non-current tab history selections out of the current slot", () => {
    const descriptor = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    expect(
      resolveAiConversationRouteSelection(
        {
          id: "conv-deploy",
          paneId: "pane-deploy",
          scopeRefJson: JSON.stringify({
            kind: "pane",
            paneId: "pane-deploy",
            tabId: "tab-deploy",
          }),
          tabId: "tab-deploy",
          targetKey: "pane:pane-deploy",
        },
        descriptor,
      ),
    ).toEqual({
      focusTabId: "tab-deploy",
      shouldActivateCurrentSlot: false,
    });
  });

  it("keeps same-tab other-pane history selections out of the current pane slot", () => {
    const descriptor = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    expect(
      resolveAiConversationRouteSelection(
        {
          id: "conv-side-pane",
          paneId: "pane-side",
          scopeRefJson: JSON.stringify({
            kind: "pane",
            paneId: "pane-side",
            tabId: "tab-prod",
          }),
          tabId: "tab-prod",
          targetKey: "pane:pane-side",
        },
        descriptor,
      ),
    ).toEqual({
      focusTabId: undefined,
      shouldActivateCurrentSlot: false,
    });
  });

  it("keeps legacy host-only history selections out of another host slot", () => {
    const descriptor = buildAiConversationSlotDescriptor({
      selectedMachine,
    });

    expect(
      resolveAiConversationRouteSelection(
        {
          hostId: "host-deploy",
          id: "conv-deploy",
          scopeRefJson: JSON.stringify({
            kind: "host",
            machineId: "host-deploy",
          }),
          targetKey: null,
        },
        descriptor,
      ),
    ).toEqual({
      focusTabId: undefined,
      shouldActivateCurrentSlot: false,
    });
  });

  it("keeps no-context history selections out of a terminal slot", () => {
    const descriptor = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    expect(
      resolveAiConversationRouteSelection(
        {
          id: "conv-no-context",
          scopeRefJson: JSON.stringify({ kind: "none" }),
          targetKey: null,
        },
        descriptor,
      ),
    ).toEqual({
      focusTabId: undefined,
      shouldActivateCurrentSlot: false,
    });
  });

  it("preserves normalized attachments in legacy conversation history", () => {
    const conversation = normalizeConversation({
      createdAt: 1000,
      id: "conv-image",
      messages: [
        {
          attachments: [
            {
              assetPath: "C:/Kerminal/ai-attachments/ssh.png",
              height: 768,
              id: "att-image",
              kind: "image",
              mimeType: "image/png",
              ocrText: "ssh deploy@10.0.0.12 -p 2222",
              originalName: "ssh-login.png",
              redactionSummary: "已隐藏截图里的 token",
              sizeBytes: 2048,
              status: "available",
              width: 1024,
            },
            {
              id: "bad-attachment",
              kind: "video",
              mimeType: "video/mp4",
              originalName: "ignored.mp4",
            },
          ],
          content: "",
          createdAt: 1100,
          id: "msg-image",
          role: "user",
        },
      ],
      title: "截图配置主机",
      updatedAt: 1200,
    });

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "conv-image",
        messages: [
          expect.objectContaining({
            attachments: [
              expect.objectContaining({
                assetPath: "C:/Kerminal/ai-attachments/ssh.png",
                id: "att-image",
                kind: "image",
                ocrText: "ssh deploy@10.0.0.12 -p 2222",
                originalName: "ssh-login.png",
                redactionSummary: "已隐藏截图里的 token",
                status: "available",
              }),
            ],
            content: "",
          }),
        ],
      }),
    );
    expect(hasConversationHistoryContent(conversation!)).toBe(true);
    expect(
      conversationMatchesHistoryQuery(
        conversation!,
        normalizeHistorySearchQuery("ssh-login"),
      ),
    ).toBe(true);
    expect(
      conversationMatchesHistoryQuery(
        conversation!,
        normalizeHistorySearchQuery("deploy@10.0.0.12"),
      ),
    ).toBe(true);
  });

  it("keeps previous attachment OCR in structured multi-turn history", () => {
    const history = buildAiChatHistory([
      {
        attachments: [
          {
            id: "att-ssh",
            kind: "image",
            mimeType: "image/png",
            ocrText: "ssh deploy@10.0.0.12 -p 2222",
            originalName: "ssh-login.png",
            redactionSummary: "已隐藏截图里的密码",
            sizeBytes: 2048,
            status: "available",
            visionUsage: "ocrOnly",
          },
        ],
        content: "这张图里有 SSH 地址，帮我配置主机",
        createdAt: 1100,
        id: "msg-user",
        role: "user",
      },
    ]);

    expect(history).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("附件上下文"),
        role: "user",
      }),
    ]);
    expect(history[0].content).toContain("ssh-login.png");
    expect(history[0].content).toContain("ssh deploy@10.0.0.12 -p 2222");
  });

  it("keeps attachments when serializing while dropping runtime tool state", () => {
    const conversation: AiConversation = {
      createdAt: 1000,
      id: "conv-serialize",
      messages: [
        {
          attachments: [
            {
              assetPath: "C:/Kerminal/ai-attachments/error.png",
              id: "att-error",
              kind: "image",
              mimeType: "image/png",
              originalName: "error.png",
              sizeBytes: 4096,
              status: "available",
            },
          ],
          content: "看这个错误截图",
          createdAt: 1100,
          id: "msg-user",
          pendingInvocations: [],
          role: "user",
        },
      ],
      title: "错误截图",
      updatedAt: 1200,
    };

    const serialized = serializeConversation(conversation);

    expect(serialized.messages[0]).toEqual(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            id: "att-error",
            originalName: "error.png",
          }),
        ],
        content: "看这个错误截图",
      }),
    );
    expect(serialized.messages[0]).not.toHaveProperty("pendingInvocations");
  });

  it("preserves assistant vision usage reports in messages and history search", () => {
    const completed = completeAssistantMessage(
      {
        content: "",
        createdAt: 1100,
        id: "assistant-draft",
        role: "assistant",
        status: "streaming",
      },
      {
        contextUsed: true,
        conversationId: "conv-vision",
        generatedAt: "1",
        message: "我已经读取这张截图。",
        model: "gpt-vision",
        pendingInvocations: [],
        providerId: "llm-vision",
        providerName: "视觉 Provider",
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
      },
    );

    expect(completed.visionUsage).toEqual({
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
    });

    const conversation = normalizeConversation({
      createdAt: 1000,
      id: "conv-vision",
      messages: [
        completed,
        {
          content: "降级回复",
          createdAt: 1200,
          id: "assistant-degraded",
          role: "assistant",
          visionUsage: {
            attachments: [
              {
                effectiveUsage: "metadataOnly",
                id: "att-degraded",
                modelInput: "textContext",
                requestedUsage: "visionInput",
                warning: "Provider 不支持视觉，已降级为文本上下文。",
              },
              {
                effectiveUsage: "visionInput",
                id: "",
                modelInput: "visionInput",
                requestedUsage: "visionInput",
              },
            ],
            providerSupportsVision: false,
            visionAdapterEnabled: true,
          },
        },
      ],
      title: "视觉截图",
      updatedAt: 1200,
    });

    expect(conversation?.messages[0].visionUsage?.attachments[0]).toMatchObject({
      id: "att-image",
      modelInput: "visionInput",
    });
    expect(conversation?.messages[1].visionUsage?.attachments).toEqual([
      expect.objectContaining({
        effectiveUsage: "metadataOnly",
        id: "att-degraded",
        modelInput: "textContext",
        warning: "Provider 不支持视觉，已降级为文本上下文。",
      }),
    ]);

    const serialized = serializeConversation(conversation!);
    expect(serialized.messages[0]).toHaveProperty("visionUsage");
    expect(
      conversationMatchesHistoryQuery(
        conversation!,
        normalizeHistorySearchQuery("图片已进入模型"),
      ),
    ).toBe(true);
    expect(
      conversationMatchesHistoryQuery(
        conversation!,
        normalizeHistorySearchQuery("Provider 不支持视觉"),
      ),
    ).toBe(true);
  });

  it("maps stored backend conversations into current chat messages with attachments", () => {
    const conversation = conversationFromStoredConversation({
      archivedAt: null,
      attachments: [
        {
          assetPath: "C:/Kerminal/ai-attachments/ssh.png",
          conversationId: "conv-stored",
          createdAt: 900,
          height: 720,
          id: "att-stored",
          kind: "image",
          messageId: "msg-user",
          mimeType: "image/png",
          missingReason: null,
          ocrText: "ssh user@example.com -p 2222",
          originalName: "ssh.png",
          originalPath: null,
          redactionSummary: null,
          sha256: null,
          sizeBytes: 24000,
          sourceKind: "paste",
          status: "available",
          storageMode: "managedCopy",
          thumbnailPath: null,
          updatedAt: 900,
          visionUsage: "ocrOnly",
          width: 1280,
        },
      ],
      createdAt: 800,
      hostId: "host-prod",
      id: "conv-stored",
      lastMessageAt: 1000,
      messages: [
        {
          content: "识别这张 SSH 截图",
          conversationId: "conv-stored",
          createdAt: 1000,
          id: "msg-user",
          role: "user",
          status: "complete",
        },
        {
          content: "内部摘要",
          conversationId: "conv-stored",
          createdAt: 1001,
          id: "msg-system",
          role: "system",
          status: "complete",
        },
      ],
      model: null,
      paneId: "pane-prod",
      providerId: null,
      scopeKind: "lockedPane",
      scopeRefJson: "{}",
      status: "idle",
      summary: null,
      tabId: "tab-prod",
      targetKey: "pane:pane-prod",
      title: "prod-api shell",
      updatedAt: 1000,
    });

    expect(conversation.messages).toEqual([
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            id: "att-stored",
            ocrText: "ssh user@example.com -p 2222",
            originalName: "ssh.png",
            visionUsage: "ocrOnly",
          }),
        ],
        content: "识别这张 SSH 截图",
        role: "user",
      }),
    ]);
  });
});
