import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("aiConversationApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("calls AI conversation Tauri commands with normalized payloads", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        id: "conv-1",
        title: "终端排错",
        scopeKind: "lockedPane",
        scopeRefJson: "{}",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        attachments: [],
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ id: "conv-1" })
      .mockResolvedValueOnce({
        id: "msg-1",
        conversationId: "conv-1",
        role: "user",
        content: "图片里是什么连接方式？",
        status: "complete",
        createdAt: 2,
      })
      .mockResolvedValueOnce({ id: "att-1" })
      .mockResolvedValueOnce({ id: "att-1", messageId: "msg-1" })
      .mockResolvedValueOnce({ slotKey: "pane:pane-1", draftText: null })
      .mockResolvedValueOnce({ slotKey: "pane:pane-1", draftText: "继续分析" })
      .mockResolvedValueOnce({ slotKey: "pane:pane-1", draftText: "继续分析" })
      .mockResolvedValueOnce(true);
    const {
      addAiConversationAttachment,
      appendAiConversationMessage,
      bindAiConversationAttachmentToMessage,
      createAiConversation,
      deleteAiConversation,
      getAiConversation,
      getAiConversationSlot,
      listAiConversations,
      saveAiConversationSlotDraft,
      setAiConversationSlotActive,
    } = await import("./aiConversationApi");

    await createAiConversation({
      hostId: " ",
      paneId: " pane-1 ",
      scopeKind: "lockedPane",
      scopeRefJson: ' { "paneId": "pane-1" } ',
      targetKey: " pane:pane-1 ",
      title: " 终端排错 ",
    });
    await listAiConversations({
      hostId: " host-prod ",
      includeArchived: false,
      limit: 999,
      offset: -10,
      paneId: " pane-1 ",
      query: " ssh ",
      tabId: " tab-prod ",
      targetKey: " pane:pane-1 ",
    });
    await getAiConversation(" conv-1 ");
    await appendAiConversationMessage({
      attachments: [
        {
          assetPath: " C:/Kerminal/ai-attachments/ssh.png ",
          height: 800.9,
          kind: "image",
          mimeType: " image/png ",
          originalName: " ssh.png ",
          sizeBytes: 42.7,
          sourceKind: "drag",
          storageMode: "managedCopy",
          width: 1200.2,
        },
      ],
      content: " 图片里是什么连接方式？ ",
      conversationId: " conv-1 ",
      metadataJson:
        ' { "visionUsage": { "providerSupportsVision": true, "visionAdapterEnabled": true, "attachments": [] } } ',
      role: "user",
      tokenEstimate: 12.9,
    });
    await addAiConversationAttachment({
      attachment: {
        kind: "image",
        mimeType: "image/png",
        originalName: "ssh.png",
        originalPath: " C:/tmp/ssh.png ",
        sizeBytes: 42,
        storageMode: "linkedFile",
      },
      conversationId: " conv-1 ",
    });
    await bindAiConversationAttachmentToMessage({
      attachmentId: " att-1 ",
      messageId: " msg-1 ",
    });
    await setAiConversationSlotActive({
      activeConversationId: " conv-1 ",
      routeMode: "followWorkspaceTarget",
      slotKey: " pane:pane-1 ",
      targetRefJson: '{"paneId":"pane-1"}',
    });
    await saveAiConversationSlotDraft({
      draftText: " 继续分析 ",
      routeMode: "followWorkspaceTarget",
      slotKey: " pane:pane-1 ",
      targetRefJson: '{"paneId":"pane-1"}',
    });
    await getAiConversationSlot(" pane:pane-1 ");
    await deleteAiConversation(" conv-1 ");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "ai_conversation_create", {
      request: expect.objectContaining({
        hostId: undefined,
        paneId: "pane-1",
        scopeKind: "lockedPane",
        scopeRefJson: '{ "paneId": "pane-1" }',
        targetKey: "pane:pane-1",
        title: "终端排错",
      }),
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "ai_conversation_list", {
      request: {
        includeArchived: false,
        hostId: "host-prod",
        limit: 200,
        offset: 0,
        paneId: "pane-1",
        query: "ssh",
        tabId: "tab-prod",
        targetKey: "pane:pane-1",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "ai_conversation_get", {
      conversationId: "conv-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "ai_conversation_message_append",
      {
        request: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              assetPath: "C:/Kerminal/ai-attachments/ssh.png",
              height: 800,
              mimeType: "image/png",
              originalName: "ssh.png",
              sizeBytes: 42,
              width: 1200,
            }),
          ],
          content: "图片里是什么连接方式？",
          conversationId: "conv-1",
          metadataJson:
            '{ "visionUsage": { "providerSupportsVision": true, "visionAdapterEnabled": true, "attachments": [] } }',
          role: "user",
          tokenEstimate: 12,
        }),
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      5,
      "ai_conversation_attachment_add",
      {
        request: expect.objectContaining({
          attachment: expect.objectContaining({
            originalPath: "C:/tmp/ssh.png",
            storageMode: "linkedFile",
          }),
          conversationId: "conv-1",
        }),
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      6,
      "ai_conversation_attachment_bind_message",
      {
        request: {
          attachmentId: "att-1",
          messageId: "msg-1",
        },
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      7,
      "ai_conversation_slot_set_active",
      {
        request: {
          activeConversationId: "conv-1",
          routeMode: "followWorkspaceTarget",
          slotKey: "pane:pane-1",
          targetRefJson: '{"paneId":"pane-1"}',
        },
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      8,
      "ai_conversation_slot_save_draft",
      {
        request: {
          activeConversationId: undefined,
          draftText: "继续分析",
          routeMode: "followWorkspaceTarget",
          slotKey: "pane:pane-1",
          targetRefJson: '{"paneId":"pane-1"}',
        },
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(9, "ai_conversation_slot_get", {
      slotKey: "pane:pane-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(10, "ai_conversation_delete", {
      conversationId: "conv-1",
    });
  });

  it("rejects invalid requests before invoking Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    const {
      appendAiConversationMessage,
      createAiConversation,
      setAiConversationSlotActive,
    } = await import("./aiConversationApi");

    await expect(
      createAiConversation({
        scopeKind: "lockedPane",
        scopeRefJson: "{not-json",
      }),
    ).rejects.toThrow();
    await expect(
      appendAiConversationMessage({
        content: " ",
        conversationId: "conv-1",
        role: "user",
      }),
    ).rejects.toThrow("消息内容不能为空");
    await expect(
      appendAiConversationMessage({
        content: "看图",
        conversationId: "conv-1",
        role: "user",
        attachments: [
          {
            kind: "image",
            mimeType: "image/png",
            originalName: "ssh.png",
            sizeBytes: -1,
            storageMode: "managedCopy",
          },
        ],
      }),
    ).rejects.toThrow("附件大小不能为负数");
    await expect(
      appendAiConversationMessage({
        content: "metadata",
        conversationId: "conv-1",
        metadataJson: "{not-json",
        role: "assistant",
      }),
    ).rejects.toThrow();
    await expect(
      setAiConversationSlotActive({
        routeMode: "followWorkspaceTarget",
        slotKey: "",
        targetRefJson: "{}",
      }),
    ).rejects.toThrow("槽位 key不能为空");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls AI attachment lifecycle Tauri commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({ id: "att-import", status: "available" })
      .mockResolvedValueOnce({ id: "att-bytes", status: "available" })
      .mockResolvedValueOnce({ id: "att-import", status: "available" })
      .mockResolvedValueOnce({
        attachment: { id: "att-import" },
        exists: true,
        previewPath: "C:/Kerminal/ai-attachments/original.png",
        resolvedPath: "C:/Kerminal/ai-attachments/original.png",
      })
      .mockResolvedValueOnce(true);
    const {
      getAiConversationAttachmentAssetInfo,
      importAiConversationAttachment,
      importAiConversationAttachmentBytes,
      openAiConversationAttachment,
      refreshAiConversationAttachmentStatus,
    } = await import("./aiConversationApi");

    await importAiConversationAttachment({
      conversationId: " conv-1 ",
      sourceKind: "drag",
      sourcePath: " C:/tmp/ssh.png ",
      visionUsage: "notSent",
    });
    await importAiConversationAttachmentBytes({
      bytes: [137.9, 80, 78, 71],
      conversationId: " conv-1 ",
      originalName: " clipboard.png ",
      sourceKind: "paste",
      visionUsage: "notSent",
    });
    await refreshAiConversationAttachmentStatus(" att-import ");
    await getAiConversationAttachmentAssetInfo(" att-import ");
    await openAiConversationAttachment(" att-import ");

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "ai_conversation_attachment_import",
      {
        request: {
          conversationId: "conv-1",
          sourceKind: "drag",
          sourcePath: "C:/tmp/ssh.png",
          visionUsage: "notSent",
        },
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "ai_conversation_attachment_import_bytes",
      {
        request: {
          bytes: [137, 80, 78, 71],
          conversationId: "conv-1",
          originalName: "clipboard.png",
          sourceKind: "paste",
          visionUsage: "notSent",
        },
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "ai_conversation_attachment_status_refresh",
      {
        attachmentId: "att-import",
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "ai_conversation_attachment_asset_info",
      {
        attachmentId: "att-import",
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      5,
      "ai_conversation_attachment_open",
      {
        attachmentId: "att-import",
      },
    );
  });

  it("keeps browser preview conversations, slots and attachments in memory", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      addAiConversationAttachment,
      appendAiConversationMessage,
      createAiConversation,
      getAiConversationAttachmentAssetInfo,
      getAiConversation,
      getAiConversationSlot,
      importAiConversationAttachment,
      importAiConversationAttachmentBytes,
      listAiConversations,
      openAiConversationAttachment,
      refreshAiConversationAttachmentStatus,
      saveAiConversationSlotDraft,
      setAiConversationSlotActive,
    } = await import("./aiConversationApi");

    const conversation = await createAiConversation({
      hostId: "host-prod",
      model: "gpt-vision",
      providerId: "openai-prod",
      scopeKind: "lockedHost",
      targetKey: "host:host-prod",
      title: "prod 截图配置",
    });
    const attachment = await addAiConversationAttachment({
      attachment: {
        assetPath: "C:/Kerminal/ai-attachments/ssh.png",
        kind: "image",
        mimeType: "image/png",
        originalName: "ssh.png",
        sizeBytes: 1024,
        storageMode: "managedCopy",
      },
      conversationId: conversation.id,
    });
    const importedAttachment = await importAiConversationAttachment({
      conversationId: conversation.id,
      sourcePath: "C:/tmp/from-screenshot.webp",
    });
    await importAiConversationAttachmentBytes({
      bytes: [137, 80, 78, 71],
      conversationId: conversation.id,
      originalName: "clipboard.png",
      sourceKind: "paste",
    });
    const refreshed = await refreshAiConversationAttachmentStatus(
      importedAttachment.id,
    );
    const assetInfo = await getAiConversationAttachmentAssetInfo(
      importedAttachment.id,
    );
    await expect(
      openAiConversationAttachment(importedAttachment.id),
    ).resolves.toBe(true);
    const message = await appendAiConversationMessage({
      content: "帮我识别 SSH 连接信息",
      conversationId: conversation.id,
      metadataJson:
        '{"visionUsage":{"providerSupportsVision":true,"visionAdapterEnabled":true,"attachments":[{"id":"att-vision","requestedUsage":"visionInput","effectiveUsage":"visionInput","modelInput":"visionInput"}]}}',
      role: "user",
    });
    await setAiConversationSlotActive({
      activeConversationId: conversation.id,
      routeMode: "followWorkspaceTarget",
      slotKey: "host:host-prod",
      targetRefJson: '{"hostId":"host-prod"}',
    });
    const slot = await saveAiConversationSlotDraft({
      draftText: "下一步创建主机",
      routeMode: "followWorkspaceTarget",
      slotKey: "host:host-prod",
      targetRefJson: '{"hostId":"host-prod"}',
    });
    const loadedSlot = await getAiConversationSlot("host:host-prod");

    const history = await listAiConversations({
      hostId: "host-prod",
      query: "SSH",
      targetKey: "host:host-prod",
    });
    const modelHistory = await listAiConversations({
      hostId: "host-prod",
      query: "gpt-vision",
      targetKey: "host:host-prod",
    });
    const providerHistory = await listAiConversations({
      hostId: "host-prod",
      query: "openai-prod",
      targetKey: "host:host-prod",
    });
    const statusHistory = await listAiConversations({
      hostId: "host-prod",
      query: "idle",
      targetKey: "host:host-prod",
    });
    const loaded = await getAiConversation(conversation.id);

    expect(history).toEqual([
      expect.objectContaining({
        attachmentCount: 3,
        hostId: "host-prod",
        id: conversation.id,
        messageCount: 1,
        model: "gpt-vision",
        providerId: "openai-prod",
      }),
    ]);
    expect(modelHistory).toEqual([
      expect.objectContaining({ id: conversation.id }),
    ]);
    expect(providerHistory).toEqual([
      expect.objectContaining({ id: conversation.id }),
    ]);
    expect(statusHistory).toEqual([
      expect.objectContaining({ id: conversation.id }),
    ]);
    expect(loaded.attachments[0]).toMatchObject({
      assetPath: "C:/Kerminal/ai-attachments/ssh.png",
      id: attachment.id,
      messageId: null,
    });
    expect(refreshed).toMatchObject({
      id: importedAttachment.id,
      status: "available",
    });
    expect(assetInfo).toMatchObject({
      exists: true,
      previewPath: "C:/tmp/from-screenshot.webp",
    });
    expect(loaded.messages[0]).toMatchObject({
      content: "帮我识别 SSH 连接信息",
      id: message.id,
      metadataJson: expect.stringContaining("visionUsage"),
    });
    expect(slot).toMatchObject({
      activeConversationId: conversation.id,
      draftText: "下一步创建主机",
    });
    expect(loadedSlot).toMatchObject({
      activeConversationId: conversation.id,
      draftText: "下一步创建主机",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("filters browser preview history by tab id without mixing same-host tabs", async () => {
    isTauriMock.mockReturnValue(false);
    const { createAiConversation, listAiConversations } = await import(
      "./aiConversationApi"
    );

    const prodTab = await createAiConversation({
      hostId: "host-prod",
      scopeKind: "lockedPane",
      tabId: "tab-prod",
      title: "prod tab",
    });
    await createAiConversation({
      hostId: "host-prod",
      scopeKind: "lockedPane",
      tabId: "tab-other",
      title: "same host other tab",
    });

    const history = await listAiConversations({
      hostId: "host-prod",
      tabId: "tab-prod",
    });

    expect(history).toEqual([
      expect.objectContaining({
        hostId: "host-prod",
        id: prodTab.id,
        tabId: "tab-prod",
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
