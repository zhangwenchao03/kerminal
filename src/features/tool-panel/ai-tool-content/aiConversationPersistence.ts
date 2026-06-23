import {
  appendAiConversationMessage,
  bindAiConversationAttachmentToMessage,
  createAiConversation,
  deleteAiConversation,
  getAiConversation,
  getAiConversationSlot,
  setAiConversationSlotActive,
  type AiAttachment,
  type AiConversationAttachmentBindMessageRequest,
  type AiConversation as StoredAiConversation,
  type AiConversationCreateRequest,
  type AiConversationMessage,
  type AiConversationMessageAppendRequest,
  type AiConversationRouteMode,
  type AiConversationSlot,
} from "../../../lib/aiConversationApi";
import {
  createAiContextSnapshot,
  type AiContextSnapshot,
  type AiContextSnapshotCreateRequest,
} from "../../../lib/aiConversationSnapshotApi";
import type {
  AiChatAttachmentModelInput,
  AiChatAttachmentVisionStatus,
  AiChatAttachmentVisionUsage,
  AiChatResponse,
  AiChatVisionUsageReport,
  AiCommandExecutionVisibility,
} from "../../../lib/aiAgentApi";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";
import {
  isBlankConversation,
  limitConversations,
  limitMessages,
  isRecord,
  type AiChatAttachment,
  type AiConversation,
  type ChatMessageRole,
  type ChatMessageStatus,
  type ConversationState,
} from "./aiToolContentModel";
import {
  buildAiConversationSlotDescriptorForTarget,
  type AiConversationSlotDescriptor,
} from "./aiTargetResolution";

export type { AiConversationSlotDescriptor };

export interface AiConversationPersistenceApi {
  appendMessage(
    request: AiConversationMessageAppendRequest,
  ): Promise<AiConversationMessage>;
  bindAttachmentToMessage(
    request: AiConversationAttachmentBindMessageRequest,
  ): Promise<AiAttachment>;
  createConversation(
    request: AiConversationCreateRequest,
  ): Promise<StoredAiConversation>;
  createContextSnapshot(
    request: AiContextSnapshotCreateRequest,
  ): Promise<AiContextSnapshot>;
  deleteConversation(conversationId: string): Promise<boolean>;
  getConversation(conversationId: string): Promise<StoredAiConversation>;
  getSlot(slotKey: string): Promise<AiConversationSlot | null>;
  setSlotActive(request: {
    activeConversationId: string;
    routeMode: AiConversationRouteMode;
    slotKey: string;
    targetRefJson: string;
  }): Promise<AiConversationSlot>;
}

const defaultPersistenceApi: AiConversationPersistenceApi = {
  appendMessage: appendAiConversationMessage,
  bindAttachmentToMessage: bindAiConversationAttachmentToMessage,
  createConversation: createAiConversation,
  createContextSnapshot: createAiContextSnapshot,
  deleteConversation: deleteAiConversation,
  getConversation: getAiConversation,
  getSlot: getAiConversationSlot,
  setSlotActive: setAiConversationSlotActive,
};

export function buildAiConversationSlotDescriptor(input: {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
}): AiConversationSlotDescriptor {
  return buildAiConversationSlotDescriptorForTarget(input);
}

export async function ensureStoredConversationForSlot(
  descriptor: AiConversationSlotDescriptor,
  api: AiConversationPersistenceApi = defaultPersistenceApi,
): Promise<StoredAiConversation> {
  const slot = await api.getSlot(descriptor.slotKey);
  if (slot?.activeConversationId) {
    try {
      return await api.getConversation(slot.activeConversationId);
    } catch {
      // Stale slot pointers should self-heal by creating a fresh conversation.
    }
  }
  return createAndActivateStoredConversation(descriptor, api);
}

export async function createAndActivateStoredConversation(
  descriptor: AiConversationSlotDescriptor,
  api: AiConversationPersistenceApi = defaultPersistenceApi,
): Promise<StoredAiConversation> {
  const conversation = await api.createConversation(descriptor.createRequest);
  await activateStoredConversationSlot(conversation.id, descriptor, api);
  return conversation;
}

export function activateStoredConversationSlot(
  conversationId: string,
  descriptor: AiConversationSlotDescriptor,
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  return api.setSlotActive({
    activeConversationId: conversationId,
    routeMode: descriptor.routeMode,
    slotKey: descriptor.slotKey,
    targetRefJson: descriptor.targetRefJson,
  });
}

export function deleteStoredConversationRecord(
  conversationId: string,
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  return api.deleteConversation(conversationId);
}

export function getStoredConversationRecord(
  conversationId: string,
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  return api.getConversation(conversationId);
}

export function mergeStoredConversationIntoState(
  current: ConversationState,
  storedConversation: StoredAiConversation,
): ConversationState {
  const conversation = conversationFromStoredConversation(storedConversation);
  const remainingConversations = current.conversations.filter(
    (item) => item.id !== conversation.id,
  );
  const compatibleConversations = isBlankConversation(conversation)
    ? remainingConversations.filter((item) => !isBlankConversation(item))
    : remainingConversations;
  return {
    activeConversationId: conversation.id,
    conversations: limitConversations([
      conversation,
      ...compatibleConversations,
    ]),
  };
}

export function persistUserChatMessage(
  request: {
    attachmentIds?: string[];
    content: string;
    contextSnapshotId?: string | null;
    conversationId: string;
  },
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  return api
    .appendMessage({
      content: request.content,
      contextSnapshotId: request.contextSnapshotId ?? undefined,
      conversationId: request.conversationId,
      role: "user",
      status: "complete",
    })
    .then(async (message) => {
      await Promise.all(
        (request.attachmentIds ?? []).map((attachmentId) =>
          api
            .bindAttachmentToMessage({
              attachmentId,
              messageId: message.id,
            })
            .catch(() => null),
        ),
      );
      return message;
    })
    .catch(() => null);
}

export function persistMessageContextSnapshot(
  request: {
    applicationContext?: unknown;
    attachments?: AiChatAttachment[];
    conversationId: string;
    conversationSlot: AiConversationSlotDescriptor;
    executionVisibility: AiCommandExecutionVisibility;
    providerContextStrategy?: string;
    providerId?: string;
    providerModel?: string;
    providerName?: string;
    terminalContext?: unknown;
    terminalSnapshot?: unknown;
    terminalSnapshotError?: string | null;
  },
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  const terminalContextJson = hasSnapshotTerminalPayload(request)
    ? jsonText({
        error: request.terminalSnapshotError ?? null,
        request: request.terminalContext ?? null,
        snapshot: request.terminalSnapshot ?? null,
      })
    : undefined;

  return api
    .createContextSnapshot({
      applicationContextJson: request.applicationContext
        ? jsonText(request.applicationContext)
        : undefined,
      attachmentRefsJson: jsonText(
        (request.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          ocrText: attachment.ocrText ?? null,
          originalName: attachment.originalName,
          redactionSummary: attachment.redactionSummary ?? null,
          status: attachment.status,
          storageMode: attachment.storageMode,
          visionUsage: attachment.visionUsage,
        })),
      ),
      conversationId: request.conversationId,
      policyJson: jsonText({
        executionVisibility: request.executionVisibility,
        providerContextStrategy: request.providerContextStrategy ?? null,
        providerId: request.providerId ?? null,
        providerModel: request.providerModel ?? null,
        providerName: request.providerName ?? null,
        source: "AiToolContent.submit",
        terminalContextRequested: Boolean(request.terminalContext),
        terminalSnapshotCaptured: Boolean(request.terminalSnapshot),
      }),
      routeMode: request.conversationSlot.routeMode,
      scopeKind: request.conversationSlot.createRequest.scopeKind,
      scopeRefJson: request.conversationSlot.createRequest.scopeRefJson,
      targetRefJson: request.conversationSlot.targetRefJson,
      terminalContextJson,
    })
    .catch(() => null);
}

export function persistAssistantResponseMessage(
  request: {
    conversationId: string;
    response: AiChatResponse;
  },
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  return api
    .appendMessage({
      content: request.response.message,
      conversationId: request.conversationId,
      model: request.response.model,
      metadataJson: assistantResponseMetadataJson(request.response),
      providerId: request.response.providerId,
      role: "assistant",
      status: "complete",
    })
    .catch(() => null);
}

export function persistAssistantErrorMessage(
  request: {
    content: string;
    conversationId: string;
  },
  api: AiConversationPersistenceApi = defaultPersistenceApi,
) {
  return api
    .appendMessage({
      content: request.content,
      conversationId: request.conversationId,
      role: "assistant",
      status: "error",
    })
    .catch(() => null);
}

export function conversationFromStoredConversation(
  conversation: StoredAiConversation,
): AiConversation {
  return {
    createdAt: conversation.createdAt,
    hostId: conversation.hostId ?? null,
    id: conversation.id,
    messages: limitMessages(
      conversation.messages.flatMap((message) => {
        if (!isChatConversationMessage(message)) {
          return [];
        }
        const visionUsage =
          message.role === "assistant"
            ? visionUsageFromMessageMetadata(message.metadataJson)
            : undefined;
        return [
          {
            attachments: attachmentsForMessage(conversation.attachments, message.id),
            content: message.content,
            contextSnapshotId: message.contextSnapshotId ?? null,
            createdAt: message.createdAt,
            id: message.id,
            model: message.model ?? undefined,
            role: message.role,
            status:
              message.role === "assistant"
                ? normalizeStoredMessageStatus(message.status)
                : undefined,
            ...(visionUsage ? { visionUsage } : {}),
          },
        ];
      }),
    ),
    paneId: conversation.paneId ?? null,
    scopeKind: conversation.scopeKind,
    scopeRefJson: conversation.scopeRefJson ?? null,
    tabId: conversation.tabId ?? null,
    targetKey: conversation.targetKey ?? null,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

function hasSnapshotTerminalPayload(request: {
  terminalContext?: unknown;
  terminalSnapshot?: unknown;
  terminalSnapshotError?: string | null;
}) {
  return Boolean(
    request.terminalContext ||
      request.terminalSnapshot ||
      request.terminalSnapshotError,
  );
}

function jsonText(value: unknown) {
  return JSON.stringify(value);
}

function assistantResponseMetadataJson(response: AiChatResponse) {
  if (!response.visionUsage?.attachments.length) {
    return undefined;
  }
  return jsonText({ visionUsage: response.visionUsage });
}

function visionUsageFromMessageMetadata(metadataJson?: string | null) {
  const metadata = parseMessageMetadata(metadataJson);
  return normalizeVisionUsageReport(metadata?.visionUsage);
}

function parseMessageMetadata(metadataJson?: string | null) {
  if (!metadataJson?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeVisionUsageReport(
  value: unknown,
): AiChatVisionUsageReport | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .map(normalizeVisionAttachmentStatus)
        .filter((status): status is AiChatAttachmentVisionStatus =>
          Boolean(status),
        )
    : [];
  if (attachments.length === 0) {
    return undefined;
  }
  return {
    attachments,
    providerSupportsVision: value.providerSupportsVision === true,
    visionAdapterEnabled: value.visionAdapterEnabled === true,
  };
}

function normalizeVisionAttachmentStatus(
  value: unknown,
): AiChatAttachmentVisionStatus | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  return {
    effectiveUsage:
      normalizeAttachmentVisionUsage(value.effectiveUsage) ?? "notSent",
    id: value.id,
    modelInput: normalizeAttachmentModelInput(value.modelInput),
    requestedUsage:
      normalizeAttachmentVisionUsage(value.requestedUsage) ?? "notSent",
    warning: normalizeNullableText(value.warning),
  };
}

function normalizeAttachmentVisionUsage(
  value: unknown,
): AiChatAttachmentVisionUsage | null {
  if (
    value === "visionInput" ||
    value === "ocrOnly" ||
    value === "metadataOnly" ||
    value === "blocked" ||
    value === "notSent"
  ) {
    return value;
  }
  return null;
}

function normalizeAttachmentModelInput(
  value: unknown,
): AiChatAttachmentModelInput {
  if (
    value === "visionInput" ||
    value === "textContext" ||
    value === "notSent"
  ) {
    return value;
  }
  return "notSent";
}

function normalizeNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isChatConversationMessage(
  message: AiConversationMessage,
): message is AiConversationMessage & { role: ChatMessageRole } {
  return message.role === "assistant" || message.role === "user";
}

function attachmentsForMessage(attachments: AiAttachment[], messageId: string) {
  const messageAttachments = attachments
    .filter((attachment) => attachment.messageId === messageId)
    .map(chatAttachmentFromStoredAttachment);
  return messageAttachments.length > 0 ? messageAttachments : undefined;
}

export function chatAttachmentFromStoredAttachment(
  attachment: AiAttachment,
): AiChatAttachment {
  return {
    assetPath: attachment.assetPath ?? null,
    height: attachment.height ?? null,
    id: attachment.id,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    missingReason: attachment.missingReason ?? null,
    ocrText: attachment.ocrText ?? null,
    originalName: attachment.originalName,
    originalPath: attachment.originalPath ?? null,
    redactionSummary: attachment.redactionSummary ?? null,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    storageMode: attachment.storageMode,
    thumbnailPath: attachment.thumbnailPath ?? null,
    visionUsage: attachment.visionUsage ?? null,
    width: attachment.width ?? null,
  };
}

function normalizeStoredMessageStatus(
  status: string,
): ChatMessageStatus | undefined {
  if (status === "streaming" || status === "error") {
    return status;
  }
  return "complete";
}
