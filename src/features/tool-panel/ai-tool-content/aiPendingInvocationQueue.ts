import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";

export interface AiPendingInvocationQueueItem {
  conversationId: string;
  conversationSlot: AiConversationSlotDescriptor;
  invocation: AiToolPendingInvocation;
}

const PENDING_QUEUE_STORAGE_KEY = "kerminal.ai.pendingInvocationQueue.v1";

export function appendPendingInvocations(
  queue: AiPendingInvocationQueueItem[],
  input: {
    conversationId: string;
    conversationSlot: AiConversationSlotDescriptor;
    invocations: AiToolPendingInvocation[];
  },
) {
  if (input.invocations.length === 0) {
    return queue;
  }
  const nextIds = new Set(input.invocations.map((invocation) => invocation.id));
  return [
    ...queue.filter((item) => !nextIds.has(item.invocation.id)),
    ...input.invocations.map((invocation) => ({
      conversationId: input.conversationId,
      conversationSlot: input.conversationSlot,
      invocation: {
        ...invocation,
        conversationId: input.conversationId,
        conversationSlotJson: JSON.stringify(input.conversationSlot),
      },
    })),
  ];
}

export function selectActivePendingInvocation(
  queue: AiPendingInvocationQueueItem[],
  activeConversationId?: string,
  activeConversationSlot?: AiConversationSlotDescriptor,
) {
  if (!activeConversationId || !activeConversationSlot) {
    return null;
  }
  return (
    queue.find(
      (item) =>
        item.conversationId === activeConversationId &&
        conversationSlotsEqual(item.conversationSlot, activeConversationSlot),
    ) ?? null
  );
}

function conversationSlotsEqual(
  left: AiConversationSlotDescriptor,
  right: AiConversationSlotDescriptor,
) {
  return (
    left.slotKey === right.slotKey &&
    left.routeMode === right.routeMode &&
    left.targetRefJson === right.targetRefJson &&
    left.createRequest.scopeKind === right.createRequest.scopeKind &&
    left.createRequest.scopeRefJson === right.createRequest.scopeRefJson &&
    left.createRequest.targetKey === right.createRequest.targetKey
  );
}

export function removePendingInvocation(
  queue: AiPendingInvocationQueueItem[],
  invocationId: string,
) {
  return queue.filter((item) => item.invocation.id !== invocationId);
}

export function reconcilePendingInvocations(
  queue: AiPendingInvocationQueueItem[],
  backendInvocations: AiToolPendingInvocation[],
) {
  const backendById = new Map(
    backendInvocations.map((invocation) => [invocation.id, invocation]),
  );
  const remembered = queue
    .filter((item) => backendById.has(item.invocation.id))
    .map((item) => ({
      ...item,
      invocation: backendById.get(item.invocation.id) ?? item.invocation,
    }));
  const rememberedIds = new Set(remembered.map((item) => item.invocation.id));
  const recovered = backendInvocations
    .filter((invocation) => !rememberedIds.has(invocation.id))
    .map(queueItemFromBackendInvocation)
    .filter((item): item is AiPendingInvocationQueueItem => Boolean(item));
  return [...remembered, ...recovered];
}

export function loadPendingInvocationQueue(): AiPendingInvocationQueueItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PENDING_QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isPendingQueueItem);
  } catch {
    return [];
  }
}

export function persistPendingInvocationQueue(
  queue: AiPendingInvocationQueueItem[],
) {
  if (typeof window === "undefined") {
    return;
  }
  if (queue.length === 0) {
    window.localStorage.removeItem(PENDING_QUEUE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PENDING_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function isPendingQueueItem(value: unknown): value is AiPendingInvocationQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<AiPendingInvocationQueueItem>;
  return (
    typeof item.conversationId === "string" &&
    Boolean(item.conversationSlot) &&
    typeof item.invocation?.id === "string" &&
    typeof item.invocation?.toolId === "string"
  );
}

function queueItemFromBackendInvocation(
  invocation: AiToolPendingInvocation,
): AiPendingInvocationQueueItem | null {
  if (!invocation.conversationId || !invocation.conversationSlotJson) {
    return null;
  }
  const conversationSlot = parseConversationSlot(invocation.conversationSlotJson);
  if (!conversationSlot) {
    return null;
  }
  return {
    conversationId: invocation.conversationId,
    conversationSlot,
    invocation,
  };
}

function parseConversationSlot(value: string): AiConversationSlotDescriptor | null {
  try {
    const parsed = JSON.parse(value);
    if (!isConversationSlotDescriptor(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isConversationSlotDescriptor(
  value: unknown,
): value is AiConversationSlotDescriptor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const slot = value as Partial<AiConversationSlotDescriptor>;
  return (
    typeof slot.slotKey === "string" &&
    typeof slot.routeMode === "string" &&
    typeof slot.targetRefJson === "string" &&
    Boolean(slot.createRequest) &&
    typeof slot.createRequest?.scopeKind === "string" &&
    typeof slot.createRequest?.scopeRefJson === "string" &&
    typeof slot.createRequest?.targetKey === "string"
  );
}
