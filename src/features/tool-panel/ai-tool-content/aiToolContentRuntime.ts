import {
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AiChatAttachmentContext,
  AiChatAttachmentVisionUsage,
  AiApplicationContextRequest,
  AiCommandExecutionVisibility,
} from "../../../lib/aiAgentApi";
import {
  getAiTerminalContextSnapshot,
  type AiTerminalContextRequest,
  type AiTerminalContextSnapshot,
} from "../../../lib/aiContextApi";
import type { AiToolAuditContext } from "../../../lib/aiToolInvocationApi";
import type { LlmProvider } from "../../settings/llmProviderModel";
import type { AppSettings } from "../../settings/settingsModel";
import { getTerminalPaneSession } from "../../terminal/terminalSessionRegistry";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";
import {
  ensureStoredConversationForSlot,
  mergeStoredConversationIntoState,
  type AiConversationSlotDescriptor,
} from "./aiConversationPersistence";
import type {
  AiChatAttachment,
  AiChatMessage,
  AiConversation,
  ConversationState,
} from "./aiToolContentModel";
import {
  resolveAiWorkspaceTarget,
  type AiResolvedWorkspaceTarget,
} from "./aiTargetResolution";

export type AiConversationSlotHydrationState =
  | "idle"
  | "loading"
  | "ready"
  | "failed";

const MAX_PROVIDER_VISION_IMAGE_BYTES = 25 * 1024 * 1024;
const PROVIDER_VISION_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface AiToolContentTarget {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  settings?: AppSettings;
}

export function buildCurrentAiTerminalContext({
  activeTab,
  focusedPane,
  selectedMachine,
  settings,
}: AiToolContentTarget): AiTerminalContextRequest | undefined {
  return resolveCurrentAiWorkspaceTarget({
    activeTab,
    focusedPane,
    selectedMachine,
    settings,
  }).terminalContext;
}

export function buildCurrentAiTerminalSnapshotRequest({
  activeTab,
  focusedPane,
  selectedMachine,
  settings,
}: AiToolContentTarget): AiTerminalContextRequest {
  return resolveCurrentAiWorkspaceTarget({
    activeTab,
    focusedPane,
    selectedMachine,
    settings,
  }).terminalSnapshotRequest;
}

export function buildCurrentAiApplicationContext({
  activeTab,
  focusedPane,
  selectedMachine,
}: AiToolContentTarget): AiApplicationContextRequest {
  return resolveCurrentAiWorkspaceTarget({
    activeTab,
    focusedPane,
    selectedMachine,
  }).applicationContext;
}

function resolveCurrentAiWorkspaceTarget({
  activeTab,
  focusedPane,
  selectedMachine,
  settings,
}: AiToolContentTarget): AiResolvedWorkspaceTarget {
  const sessionId = focusedPane?.id
    ? getTerminalPaneSession(focusedPane.id)
    : undefined;

  return resolveAiWorkspaceTarget({
    activeTab,
    focusedPane,
    selectedMachine,
    sessionId,
    settings,
  });
}

export function buildAiChatAttachmentContexts(
  attachments: AiChatAttachment[],
): AiChatAttachmentContext[] {
  return attachments.map((attachment) => ({
    height: attachment.height,
    id: attachment.id,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    missingReason: attachment.missingReason,
    ocrText: attachment.ocrText,
    originalName: attachment.originalName,
    redactionSummary: attachment.redactionSummary,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    visionUsage: resolveAttachmentVisionUsage(attachment),
    width: attachment.width,
  }));
}

export function buildAiToolAuditContext({
  conversation,
  conversationSlot,
  invocationId,
}: {
  conversation?: AiConversation;
  conversationSlot: AiConversationSlotDescriptor;
  invocationId: string;
}): AiToolAuditContext | undefined {
  if (!conversation) {
    return undefined;
  }

  const assistantMessageIndex = findAssistantMessageIndex(
    conversation,
    invocationId,
  );
  const assistantMessage =
    assistantMessageIndex >= 0
      ? conversation.messages[assistantMessageIndex]
      : undefined;
  const userMessage =
    findLatestUserMessageBefore(conversation, assistantMessageIndex) ??
    findLatestUserMessageBefore(conversation, conversation.messages.length);
  const attachmentIds =
    userMessage?.attachments
      ?.map((attachment) => attachment.id)
      .filter((id) => id.trim().length > 0) ?? [];

  return {
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    assistantMessageId: assistantMessage?.id ?? null,
    contextSnapshotId: userMessage?.contextSnapshotId ?? null,
    conversationId: conversation.id,
    hostId: conversation.hostId ?? conversationSlot.createRequest.hostId ?? null,
    paneId: conversation.paneId ?? conversationSlot.createRequest.paneId ?? null,
    routeMode: conversationSlot.routeMode,
    scopeKind: conversation.scopeKind ?? conversationSlot.createRequest.scopeKind,
    scopeRefJson:
      conversation.scopeRefJson ?? conversationSlot.createRequest.scopeRefJson ?? null,
    tabId: conversation.tabId ?? conversationSlot.createRequest.tabId ?? null,
    targetKey: conversation.targetKey ?? conversationSlot.createRequest.targetKey ?? null,
    targetRefJson: conversationSlot.targetRefJson,
    userMessageId: userMessage?.id ?? null,
  };
}

function normalizeAttachmentVisionUsage(
  value: string | null | undefined,
): AiChatAttachmentVisionUsage | null | undefined {
  if (
    value === "visionInput" ||
    value === "ocrOnly" ||
    value === "metadataOnly" ||
    value === "blocked" ||
    value === "notSent"
  ) {
    return value;
  }
  return undefined;
}

function resolveAttachmentVisionUsage(
  attachment: AiChatAttachment,
): AiChatAttachmentVisionUsage {
  const normalized = normalizeAttachmentVisionUsage(attachment.visionUsage);
  if (normalized !== "blocked" && shouldRequestProviderVisionInput(attachment)) {
    return "visionInput";
  }
  if (normalized === "visionInput") {
    return attachment.kind === "image" && attachment.status === "available"
      ? "metadataOnly"
      : "notSent";
  }
  if (normalized && normalized !== "notSent") {
    return normalized;
  }
  if (attachment.kind === "image" && attachment.status === "available") {
    return "metadataOnly";
  }
  return normalized ?? "notSent";
}

function shouldRequestProviderVisionInput(attachment: AiChatAttachment) {
  return (
    attachment.kind === "image" &&
    attachment.status === "available" &&
    attachment.storageMode === "managedCopy" &&
    attachment.sizeBytes > 0 &&
    attachment.sizeBytes <= MAX_PROVIDER_VISION_IMAGE_BYTES &&
    PROVIDER_VISION_IMAGE_MIME_TYPES.has(attachment.mimeType.trim().toLowerCase())
  );
}

function findLatestUserMessageBefore(
  conversation: AiConversation,
  beforeIndex: number,
): AiChatMessage | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message?.role === "user") {
      return message;
    }
  }
  return undefined;
}

function findAssistantMessageIndex(
  conversation: AiConversation,
  invocationId: string,
) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (
      message?.pendingInvocations?.some(
        (invocation) => invocation.id === invocationId,
      )
    ) {
      return index;
    }
  }
  return -1;
}

export async function captureAiTerminalSnapshotForPersistence(
  terminalContext: AiTerminalContextRequest | undefined,
): Promise<{
  terminalSnapshot: AiTerminalContextSnapshot | null;
  terminalSnapshotError?: string;
}> {
  if (!terminalContext) {
    return { terminalSnapshot: null };
  }

  try {
    return {
      terminalSnapshot: await getAiTerminalContextSnapshot(terminalContext),
    };
  } catch (error) {
    return {
      terminalSnapshot: null,
      terminalSnapshotError:
        error instanceof Error ? error.message : String(error),
    };
  }
}

export function useAiToolContentLatestRefs({
  activeConversation,
  commandVisibility,
  pendingAttachments,
  selectedProvider,
}: {
  activeConversation?: AiConversation;
  commandVisibility: AiCommandExecutionVisibility;
  pendingAttachments: AiChatAttachment[];
  selectedProvider?: LlmProvider;
}) {
  const activeConversationRef = useRef(activeConversation);
  const commandVisibilityRef = useRef(commandVisibility);
  const pendingAttachmentsRef = useRef(pendingAttachments);
  const selectedProviderRef = useRef(selectedProvider);

  activeConversationRef.current = activeConversation;
  commandVisibilityRef.current = commandVisibility;
  pendingAttachmentsRef.current = pendingAttachments;
  selectedProviderRef.current = selectedProvider;

  return {
    activeConversationRef,
    commandVisibilityRef,
    pendingAttachmentsRef,
    selectedProviderRef,
  };
}

export function useStoredConversationSlotHydration({
  conversationPersistenceEnabled,
  conversationSlot,
  onHydrationStateChange,
  setConversationState,
}: {
  conversationPersistenceEnabled: boolean;
  conversationSlot: AiConversationSlotDescriptor;
  onHydrationStateChange?: (state: AiConversationSlotHydrationState) => void;
  setConversationState: Dispatch<SetStateAction<ConversationState>>;
}) {
  useEffect(() => {
    if (!conversationPersistenceEnabled) {
      onHydrationStateChange?.("ready");
      return;
    }

    let cancelled = false;
    onHydrationStateChange?.("loading");

    const loadConversationSlot = async () => {
      try {
        const storedConversation =
          await ensureStoredConversationForSlot(conversationSlot);
        if (cancelled) {
          return;
        }

        setConversationState((current) =>
          mergeStoredConversationIntoState(current, storedConversation),
        );
        onHydrationStateChange?.("ready");
      } catch {
        // 后端会话持久化不可用时继续使用 localStorage 历史，不阻断聊天。
        if (!cancelled) {
          onHydrationStateChange?.("failed");
        }
      }
    };

    void loadConversationSlot();

    return () => {
      cancelled = true;
    };
  }, [
    conversationPersistenceEnabled,
    conversationSlot.createRequest,
    conversationSlot.routeMode,
    conversationSlot.slotKey,
    conversationSlot.targetRefJson,
    onHydrationStateChange,
    setConversationState,
  ]);
}
