import { describe, expect, it, vi } from "vitest";
import type {
  AiAttachment,
  AiConversation as StoredAiConversation,
  AiConversationMessage,
  AiConversationSlot,
} from "../../../lib/aiConversationApi";
import type { AiChatResponse } from "../../../lib/aiAgentApi";
import type { TerminalPane, TerminalTab } from "../../workspace/types";
import {
  buildAiConversationSlotDescriptor,
  conversationFromStoredConversation,
  ensureStoredConversationForSlot,
  mergeStoredConversationIntoState,
  persistAssistantErrorMessage,
  persistAssistantResponseMessage,
  persistMessageContextSnapshot,
  persistUserChatMessage,
  type AiConversationPersistenceApi,
} from "./aiConversationPersistence";
import { createInitialConversationState } from "./aiToolContentModel";

function storedMessage(
  overrides: Partial<AiConversationMessage>,
): AiConversationMessage {
  return {
    content: "",
    conversationId: "conv-stored",
    createdAt: 1000,
    id: "msg-default",
    role: "user",
    status: "complete",
    ...overrides,
  };
}

function storedConversation(
  overrides: Partial<StoredAiConversation> = {},
): StoredAiConversation {
  return {
    archivedAt: null,
    attachments: [],
    createdAt: 800,
    hostId: null,
    id: "conv-stored",
    lastMessageAt: 1000,
    messages: [],
    model: null,
    paneId: null,
    providerId: null,
    scopeKind: "noContext",
    scopeRefJson: "{}",
    status: "idle",
    summary: null,
    tabId: null,
    targetKey: null,
    title: "Stored conversation",
    updatedAt: 1000,
    ...overrides,
  };
}

function storedAttachment(overrides: Partial<AiAttachment>): AiAttachment {
  return {
    assetPath: null,
    conversationId: "conv-stored",
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
    sizeBytes: 1024,
    sourceKind: "paste",
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: null,
    updatedAt: 900,
    visionUsage: null,
    width: null,
    ...overrides,
  };
}

function slot(overrides: Partial<AiConversationSlot> = {}): AiConversationSlot {
  return {
    activeConversationId: "conv-stored",
    draftText: null,
    lastActiveAt: 1000,
    routeMode: "followWorkspaceTarget",
    slotKey: "pane:pane-1",
    targetRefJson: "{}",
    updatedAt: 1000,
    ...overrides,
  };
}

function persistenceApi(
  overrides: Partial<AiConversationPersistenceApi> = {},
): AiConversationPersistenceApi {
  return {
    appendMessage: vi.fn().mockResolvedValue(storedMessage({})),
    bindAttachmentToMessage: vi.fn().mockResolvedValue(storedAttachment({})),
    createConversation: vi
      .fn()
      .mockResolvedValue(storedConversation({ id: "conv-created" })),
    createContextSnapshot: vi.fn().mockResolvedValue({
      applicationContextJson: "{}",
      attachmentRefsJson: "[]",
      conversationId: "conv-stored",
      createdAt: 1000,
      generatedAt: 1000,
      id: "ctx-stored",
      messageId: null,
      policyJson: "{}",
      routeMode: "followWorkspaceTarget",
      scopeKind: "lockedPane",
      scopeRefJson: "{}",
      targetRefJson: "{}",
      terminalContextJson: null,
    }),
    deleteConversation: vi.fn().mockResolvedValue(true),
    getConversation: vi.fn().mockResolvedValue(storedConversation()),
    getSlot: vi.fn().mockResolvedValue(null),
    setSlotActive: vi.fn().mockResolvedValue(slot()),
    ...overrides,
  };
}

describe("aiConversationPersistence", () => {
  it("builds pane-scoped slot descriptors for backend persistence", () => {
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

    const descriptor = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine: {
        description: "生产 SSH 主机",
        id: "host-prod",
        kind: "ssh",
        name: "prod-api",
        production: true,
        status: "online",
        tags: ["prod"],
      },
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

  it("loads the active slot conversation without creating a replacement", async () => {
    const descriptor = buildAiConversationSlotDescriptor({});
    const existingConversation = storedConversation({ id: "conv-existing" });
    const api = persistenceApi({
      getConversation: vi.fn().mockResolvedValue(existingConversation),
      getSlot: vi
        .fn()
        .mockResolvedValue(slot({ activeConversationId: "conv-existing" })),
    });

    await expect(ensureStoredConversationForSlot(descriptor, api)).resolves.toBe(
      existingConversation,
    );
    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.setSlotActive).not.toHaveBeenCalled();
  });

  it("self-heals stale slot pointers by creating and activating a conversation", async () => {
    const descriptor = buildAiConversationSlotDescriptor({});
    const createdConversation = storedConversation({ id: "conv-created" });
    const api = persistenceApi({
      createConversation: vi.fn().mockResolvedValue(createdConversation),
      getConversation: vi.fn().mockRejectedValue(new Error("missing")),
      getSlot: vi
        .fn()
        .mockResolvedValue(slot({ activeConversationId: "conv-stale" })),
    });

    await expect(ensureStoredConversationForSlot(descriptor, api)).resolves.toBe(
      createdConversation,
    );
    expect(api.createConversation).toHaveBeenCalledWith(descriptor.createRequest);
    expect(api.setSlotActive).toHaveBeenCalledWith({
      activeConversationId: "conv-created",
      routeMode: descriptor.routeMode,
      slotKey: descriptor.slotKey,
      targetRefJson: descriptor.targetRefJson,
    });
  });

  it("maps stored conversations while hiding non-chat roles and unrelated attachments", () => {
    const conversation = conversationFromStoredConversation(
      storedConversation({
        attachments: [
          storedAttachment({
            id: "att-user",
            messageId: "msg-user",
            ocrText: "ssh deploy@10.0.0.12 -p 2222",
            originalName: "ssh.png",
            redactionSummary: "已隐藏截图里的密码",
            visionUsage: "ocrOnly",
          }),
          storedAttachment({ id: "att-unrelated", messageId: "msg-other" }),
          storedAttachment({ id: "att-unbound", messageId: null }),
        ],
        messages: [
          storedMessage({
            content: "识别这张 SSH 截图",
            id: "msg-user",
            role: "user",
          }),
          storedMessage({
            content: "还在生成",
            id: "msg-assistant-streaming",
            metadataJson:
              '{"visionUsage":{"providerSupportsVision":true,"visionAdapterEnabled":true,"attachments":[{"id":"att-user","requestedUsage":"visionInput","effectiveUsage":"visionInput","modelInput":"visionInput"}]}}',
            role: "assistant",
            status: "streaming",
          }),
          storedMessage({
            content: "未知状态",
            id: "msg-assistant-draft",
            role: "assistant",
            status: "draft",
          }),
          storedMessage({
            content: "内部摘要",
            id: "msg-system",
            role: "system",
          }),
          storedMessage({
            content: "工具结果",
            id: "msg-tool",
            role: "tool",
          }),
        ],
      }),
    );

    expect(conversation.messages).toEqual([
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            id: "att-user",
            ocrText: "ssh deploy@10.0.0.12 -p 2222",
            originalName: "ssh.png",
            redactionSummary: "已隐藏截图里的密码",
            visionUsage: "ocrOnly",
          }),
        ],
        content: "识别这张 SSH 截图",
        role: "user",
      }),
      expect.objectContaining({
        content: "还在生成",
        role: "assistant",
        status: "streaming",
        visionUsage: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: "att-user",
              modelInput: "visionInput",
            }),
          ],
        }),
      }),
      expect.objectContaining({
        content: "未知状态",
        role: "assistant",
        status: "complete",
      }),
    ]);
  });

  it("merges a stored conversation into local history without duplicating it", () => {
    const state = createInitialConversationState();
    const stored = storedConversation({
      id: "conv-stored",
      messages: [storedMessage({ content: "hello", id: "msg-user" })],
    });

    const firstMerge = mergeStoredConversationIntoState(state, stored);
    const secondMerge = mergeStoredConversationIntoState(firstMerge, {
      ...stored,
      updatedAt: 2000,
    });

    expect(secondMerge.activeConversationId).toBe("conv-stored");
    expect(
      secondMerge.conversations.filter((item) => item.id === "conv-stored"),
    ).toHaveLength(1);
  });

  it("keeps a blank stored slot conversation active over a local blank draft", () => {
    const state = createInitialConversationState();
    const merged = mergeStoredConversationIntoState(
      state,
      storedConversation({
        id: "conv-empty-slot",
        messages: [],
        updatedAt: 1000,
      }),
    );

    expect(merged.activeConversationId).toBe("conv-empty-slot");
    expect(merged.conversations).toHaveLength(1);
    expect(merged.conversations[0].id).toBe("conv-empty-slot");
  });

  it("persists chat messages as best-effort backend appends", async () => {
    const response: AiChatResponse = {
      contextUsed: true,
      conversationId: "conv-stored",
      generatedAt: "2026-06-21T00:00:00Z",
      message: "AI response",
      model: "gpt-test",
      providerId: "provider-test",
      providerName: "Provider",
      responseRedacted: false,
      toolCount: 0,
      pendingInvocations: [],
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
    };
    const api = persistenceApi({
      appendMessage: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await expect(
      persistUserChatMessage(
        { content: "user input", conversationId: "conv-stored" },
        api,
      ),
    ).resolves.toBeNull();
    await expect(
      persistAssistantResponseMessage(
        { conversationId: "conv-stored", response },
        api,
      ),
    ).resolves.toBeNull();
    await expect(
      persistAssistantErrorMessage(
        { content: "回复生成失败：offline", conversationId: "conv-stored" },
        api,
      ),
    ).resolves.toBeNull();
    expect(api.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "user input",
        role: "user",
        status: "complete",
      }),
    );
    expect(api.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "AI response",
        model: "gpt-test",
        metadataJson: expect.stringContaining("visionUsage"),
        providerId: "provider-test",
        role: "assistant",
        status: "complete",
      }),
    );
    expect(api.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "回复生成失败：offline",
        role: "assistant",
        status: "error",
      }),
    );
  });

  it("binds pending attachment ids after the user message is appended", async () => {
    const api = persistenceApi({
      appendMessage: vi.fn().mockResolvedValue(
        storedMessage({
          content: "识别截图",
          id: "msg-user-new",
        }),
      ),
      bindAttachmentToMessage: vi.fn().mockResolvedValue(
        storedAttachment({
          id: "att-image",
          messageId: "msg-user-new",
        }),
      ),
    });

    await expect(
      persistUserChatMessage(
        {
          attachmentIds: ["att-image"],
          content: "识别截图",
          contextSnapshotId: "ctx-user",
          conversationId: "conv-stored",
        },
        api,
      ),
    ).resolves.toMatchObject({ id: "msg-user-new" });
    expect(api.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contextSnapshotId: "ctx-user",
      }),
    );
    expect(api.bindAttachmentToMessage).toHaveBeenCalledWith({
      attachmentId: "att-image",
      messageId: "msg-user-new",
    });
  });

  it("persists a message context snapshot with route and attachment evidence", async () => {
    const descriptor = buildAiConversationSlotDescriptor({
      focusedPane: {
        id: "pane-prod",
        latencyMs: 1,
        lines: [],
        machineId: "host-prod",
        mode: "ssh",
        prompt: "$",
        status: "online",
        title: "prod shell",
      },
    });
    const api = persistenceApi();

    await expect(
      persistMessageContextSnapshot(
        {
          applicationContext: { focusedPane: { id: "pane-prod" } },
          attachments: [
            {
              id: "att-image",
              kind: "image",
              mimeType: "image/png",
              ocrText: "ssh deploy@10.0.0.12 -p 2222",
              originalName: "ssh.png",
              redactionSummary: "已隐藏截图里的密码",
              sizeBytes: 1024,
              status: "available",
              storageMode: "managedCopy",
              visionUsage: "notSent",
            },
          ],
          conversationId: "conv-stored",
          conversationSlot: descriptor,
          executionVisibility: "terminal",
          providerContextStrategy: "currentTerminal",
          providerId: "provider-main",
          providerModel: "gpt-test",
          providerName: "OpenAI",
          terminalContext: { sessionId: "session-prod" },
          terminalSnapshot: { output: { data: "journalctl failed" } },
        },
        api,
      ),
    ).resolves.toMatchObject({ id: "ctx-stored" });

    expect(api.createContextSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentRefsJson: expect.stringContaining("att-image"),
        conversationId: "conv-stored",
        policyJson: expect.stringContaining("provider-main"),
        routeMode: descriptor.routeMode,
        scopeKind: "lockedPane",
        targetRefJson: descriptor.targetRefJson,
        terminalContextJson: expect.stringContaining("journalctl failed"),
      }),
    );
    expect(api.createContextSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentRefsJson: expect.stringContaining(
          "ssh deploy@10.0.0.12 -p 2222",
        ),
      }),
    );
    expect(api.createContextSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentRefsJson: expect.stringContaining("已隐藏截图里的密码"),
      }),
    );
  });
});
