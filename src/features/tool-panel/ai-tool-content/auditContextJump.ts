import {
  getAiConversationAttachmentAssetInfo,
  type AiAttachmentAssetInfo,
} from "../../../lib/aiConversationApi";
import { getAiContextSnapshot } from "../../../lib/aiConversationSnapshotApi";
import type { AiAuditContextOpenRequest } from "../AiAuditManagement";
import type {
  AiChatAttachment,
  AiChatMessage,
  AiConversation,
} from "./aiToolContentModel";

export async function resolveAuditContextConversationId(
  request: AiAuditContextOpenRequest,
): Promise<string> {
  const directConversationId = normalizedText(request.context.conversationId);
  if (directConversationId) {
    return directConversationId;
  }

  const snapshotConversationId = await resolveConversationIdFromSnapshot(
    request.context.contextSnapshotId,
  );
  if (snapshotConversationId) {
    return snapshotConversationId;
  }

  const attachmentConversationId = await resolveConversationIdFromAttachment(
    request.attachmentIds ?? request.context.attachmentIds,
  );
  if (attachmentConversationId) {
    return attachmentConversationId;
  }

  throw new Error("审计上下文已失效，无法定位 AI 会话。");
}

export function resolveAuditContextMessageId(
  conversation: AiConversation,
  request: AiAuditContextOpenRequest,
): string | null {
  const preferredMessageId = preferredMessageIdForTarget(conversation, request);
  if (preferredMessageId) {
    return preferredMessageId;
  }

  return (
    existingMessageId(conversation, request.context.userMessageId) ??
    existingMessageId(conversation, request.context.assistantMessageId) ??
    messageIdForContextSnapshot(conversation, request.context.contextSnapshotId) ??
    messageIdForAttachment(conversation, request.attachmentIds) ??
    messageIdForAttachment(conversation, request.context.attachmentIds)
  );
}

export function findAuditContextAttachment(
  conversation: AiConversation,
  attachmentIds: string[] | undefined,
): AiChatAttachment | null {
  const wantedIds = normalizedIdSet(attachmentIds);
  if (wantedIds.size === 0) {
    return null;
  }

  for (const message of conversation.messages) {
    for (const attachment of message.attachments ?? []) {
      if (wantedIds.has(attachment.id)) {
        return attachment;
      }
    }
  }
  return null;
}

async function resolveConversationIdFromSnapshot(
  snapshotId: string | null | undefined,
) {
  const normalizedSnapshotId = normalizedText(snapshotId);
  if (!normalizedSnapshotId) {
    return null;
  }
  try {
    const snapshot = await getAiContextSnapshot(normalizedSnapshotId);
    return normalizedText(snapshot.conversationId);
  } catch {
    return null;
  }
}

async function resolveConversationIdFromAttachment(
  attachmentIds: string[] | undefined,
) {
  for (const attachmentId of normalizedIdSet(attachmentIds)) {
    const assetInfo = await safeGetAttachmentAssetInfo(attachmentId);
    const conversationId = normalizedText(assetInfo?.attachment.conversationId);
    if (conversationId) {
      return conversationId;
    }
  }
  return null;
}

async function safeGetAttachmentAssetInfo(
  attachmentId: string,
): Promise<AiAttachmentAssetInfo | null> {
  try {
    return await getAiConversationAttachmentAssetInfo(attachmentId);
  } catch {
    return null;
  }
}

function preferredMessageIdForTarget(
  conversation: AiConversation,
  request: AiAuditContextOpenRequest,
) {
  if (request.target === "userMessage") {
    return existingMessageId(conversation, request.context.userMessageId);
  }
  if (request.target === "assistantMessage") {
    return existingMessageId(conversation, request.context.assistantMessageId);
  }
  if (request.target === "contextSnapshot") {
    return messageIdForContextSnapshot(
      conversation,
      request.context.contextSnapshotId,
    );
  }
  if (request.target === "attachments") {
    return (
      messageIdForAttachment(conversation, request.attachmentIds) ??
      messageIdForAttachment(conversation, request.context.attachmentIds)
    );
  }
  return null;
}

function existingMessageId(
  conversation: AiConversation,
  messageId: string | null | undefined,
) {
  const normalizedMessageId = normalizedText(messageId);
  if (!normalizedMessageId) {
    return null;
  }
  return conversation.messages.some((message) => message.id === normalizedMessageId)
    ? normalizedMessageId
    : null;
}

function messageIdForContextSnapshot(
  conversation: AiConversation,
  contextSnapshotId: string | null | undefined,
) {
  const normalizedSnapshotId = normalizedText(contextSnapshotId);
  if (!normalizedSnapshotId) {
    return null;
  }
  return (
    conversation.messages.find(
      (message) => message.contextSnapshotId === normalizedSnapshotId,
    )?.id ?? null
  );
}

function messageIdForAttachment(
  conversation: AiConversation,
  attachmentIds: string[] | undefined,
) {
  const wantedIds = normalizedIdSet(attachmentIds);
  if (wantedIds.size === 0) {
    return null;
  }
  return (
    conversation.messages.find((message) => messageHasAttachment(message, wantedIds))
      ?.id ?? null
  );
}

function messageHasAttachment(
  message: AiChatMessage,
  attachmentIds: ReadonlySet<string>,
) {
  return (message.attachments ?? []).some((attachment) =>
    attachmentIds.has(attachment.id),
  );
}

function normalizedIdSet(values: string[] | undefined) {
  return new Set((values ?? []).map(normalizedText).filter(Boolean) as string[]);
}

function normalizedText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
