import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAuditContextOpenRequest } from "../AiAuditManagement";
import type { AiConversation } from "./aiToolContentModel";
import {
  findAuditContextAttachment,
  resolveAuditContextConversationId,
  resolveAuditContextMessageId,
} from "./auditContextJump";

const conversationApiMock = vi.hoisted(() => ({
  getAiConversationAttachmentAssetInfo: vi.fn(),
}));
const snapshotApiMock = vi.hoisted(() => ({
  getAiContextSnapshot: vi.fn(),
}));

vi.mock("../../../lib/aiConversationApi", () => conversationApiMock);
vi.mock("../../../lib/aiConversationSnapshotApi", () => snapshotApiMock);

describe("auditContextJump", () => {
  beforeEach(() => {
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockReset();
    snapshotApiMock.getAiContextSnapshot.mockReset();
  });

  it("resolves conversation ids from direct, snapshot, and attachment context", async () => {
    await expect(
      resolveAuditContextConversationId(auditJumpRequest()),
    ).resolves.toBe("conv-prod");

    snapshotApiMock.getAiContextSnapshot.mockResolvedValue({
      conversationId: "conv-from-snapshot",
    });
    await expect(
      resolveAuditContextConversationId(
        auditJumpRequest({
          context: {
            contextSnapshotId: "snapshot-prod",
            conversationId: null,
          },
          target: "contextSnapshot",
        }),
      ),
    ).resolves.toBe("conv-from-snapshot");

    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue({
      attachment: { conversationId: "conv-from-attachment" },
    });
    await expect(
      resolveAuditContextConversationId(
        auditJumpRequest({
          attachmentIds: ["att-prod"],
          context: { conversationId: null, contextSnapshotId: null },
          target: "attachments",
        }),
      ),
    ).resolves.toBe("conv-from-attachment");
  });

  it("locates referenced messages and attachments inside a restored conversation", () => {
    const conversation = conversationFixture();

    expect(
      resolveAuditContextMessageId(
        conversation,
        auditJumpRequest({ target: "assistantMessage" }),
      ),
    ).toBe("assistant-prod");
    expect(
      resolveAuditContextMessageId(
        conversation,
        auditJumpRequest({
          context: { assistantMessageId: "missing", contextSnapshotId: "ctx-prod" },
          target: "contextSnapshot",
        }),
      ),
    ).toBe("user-prod");
    expect(
      findAuditContextAttachment(conversation, ["att-prod"])?.originalName,
    ).toBe("ssh.png");
  });
});

function auditJumpRequest(
  overrides: {
    attachmentIds?: string[];
    context?: Partial<AiAuditContextOpenRequest["context"]>;
    target?: AiAuditContextOpenRequest["target"];
  } = {},
): AiAuditContextOpenRequest {
  const context = {
    assistantMessageId: "assistant-prod",
    attachmentIds: ["att-prod"],
    contextSnapshotId: "ctx-prod",
    conversationId: "conv-prod",
    userMessageId: "user-prod",
    ...overrides.context,
  };
  return {
    attachmentIds: overrides.attachmentIds,
    audit: {
      argumentsSummary: "host=prod.example.com",
      auditContext: context,
      completedAt: "2",
      confirmation: "always",
      createdAt: "1",
      error: null,
      id: "audit-prod",
      invocationId: "invocation-prod",
      resultSummary: "done",
      risk: "remote",
      riskSummary: null,
      status: "succeeded",
      toolId: "remote_host.create",
      toolTitle: "创建远程主机",
    },
    context,
    target: overrides.target ?? "conversation",
  };
}

function conversationFixture(): AiConversation {
  return {
    createdAt: 1,
    id: "conv-prod",
    messages: [
      {
        attachments: [
          {
            id: "att-prod",
            kind: "image",
            mimeType: "image/png",
            originalName: "ssh.png",
            sizeBytes: 128,
            status: "available",
          },
        ],
        content: "configure this SSH screenshot",
        contextSnapshotId: "ctx-prod",
        createdAt: 1,
        id: "user-prod",
        role: "user",
      },
      {
        content: "I can create a pending remote host.",
        createdAt: 2,
        id: "assistant-prod",
        role: "assistant",
      },
    ],
    title: "SSH screenshot",
    updatedAt: 2,
  };
}
