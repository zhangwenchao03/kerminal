import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listAiConversations,
  type AiConversationListRequest,
  type AiConversationSummary,
  type AiConversationScopeKind,
} from "../../../lib/aiConversationApi";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import {
  conversationMatchesHistoryQuery,
  hasConversationHistoryContent,
  normalizeHistorySearchQuery,
  type AiConversation,
} from "./aiToolContentModel";

export const AI_HISTORY_PAGE_SIZE = 6;

export type AiConversationHistoryFilter =
  | "all"
  | "currentTarget"
  | "currentHost";

export interface AiConversationHistoryRow {
  attachmentCount: number;
  createdAt: number;
  hostId?: string | null;
  id: string;
  messageCount: number;
  model?: string | null;
  paneId?: string | null;
  providerId?: string | null;
  providerLabel?: string | null;
  scopeKind?: AiConversationScopeKind;
  scopeRefJson?: string | null;
  status?: string | null;
  summary?: string | null;
  tabId?: string | null;
  targetKey?: string | null;
  title: string;
  updatedAt: number;
}

interface TargetRef {
  kind?: string;
  machineId?: string;
  paneId?: string;
  tabId?: string;
}

export function useAiConversationHistoryList({
  conversationPersistenceEnabled,
  conversations,
  currentSlot,
  open,
  query,
}: {
  conversationPersistenceEnabled: boolean;
  conversations: AiConversation[];
  currentSlot: AiConversationSlotDescriptor;
  open: boolean;
  query: string;
}) {
  const [filter, setFilter] = useState<AiConversationHistoryFilter>("all");
  const [page, setPage] = useState(1);
  const [remoteRows, setRemoteRows] = useState<AiConversationHistoryRow[]>([]);
  const [remoteCanNextPage, setRemoteCanNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentTarget = useMemo(
    () => parseTargetRef(currentSlot.targetRefJson),
    [currentSlot.targetRefJson],
  );
  const normalizedQuery = normalizeHistorySearchQuery(query);
  const localRows = useMemo(
    () =>
      conversations
        .filter(hasConversationHistoryContent)
        .filter((conversation) =>
          normalizedQuery
            ? conversationMatchesHistoryQuery(conversation, normalizedQuery)
            : true,
        )
        .filter((conversation) =>
          conversationMatchesHistoryFilter(conversation, {
            currentSlot,
            currentTarget,
            filter,
          }),
        )
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(historyRowFromConversation),
    [conversations, currentSlot, currentTarget, filter, normalizedQuery],
  );
  const localPageRows = localRows.slice(
    (page - 1) * AI_HISTORY_PAGE_SIZE,
    page * AI_HISTORY_PAGE_SIZE,
  );
  const localCanNextPage = localRows.length > page * AI_HISTORY_PAGE_SIZE;
  const canFilterCurrentHost = Boolean(
    currentSlot.createRequest.hostId ?? currentTarget.machineId,
  );
  const usingRemoteRows = conversationPersistenceEnabled && !error;
  const rows = usingRemoteRows ? remoteRows : localPageRows;
  const canNextPage = usingRemoteRows ? remoteCanNextPage : localCanNextPage;

  useEffect(() => {
    setPage(1);
  }, [currentSlot.slotKey, filter, query]);

  useEffect(() => {
    if (!open || !conversationPersistenceEnabled) {
      return;
    }

    let cancelled = false;
    const request = buildServerHistoryRequest({
      currentSlot,
      currentTarget,
      filter,
      page,
      query,
    });
    if (filter === "currentHost" && !request.hostId) {
      setRemoteRows([]);
      setRemoteCanNextPage(false);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    listAiConversations(request)
      .then((summaries) => {
        if (cancelled) {
          return;
        }
        if (!Array.isArray(summaries)) {
          throw new Error("历史会话列表返回格式无效");
        }
        const visibleRows = summaries
          .map(historyRowFromSummary)
          .filter(historyRowHasContent);
        setRemoteRows(visibleRows.slice(0, AI_HISTORY_PAGE_SIZE));
        setRemoteCanNextPage(visibleRows.length > AI_HISTORY_PAGE_SIZE);
      })
      .catch((nextError: unknown) => {
        if (cancelled) {
          return;
        }
        setRemoteRows([]);
        setRemoteCanNextPage(false);
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    conversationPersistenceEnabled,
    currentSlot,
    currentTarget,
    filter,
    open,
    page,
    query,
  ]);

  const removeConversationFromHistory = useCallback((conversationId: string) => {
    setRemoteRows((current) => current.filter((row) => row.id !== conversationId));
  }, []);

  return {
    canFilterCurrentHost,
    canNextPage,
    canPreviousPage: page > 1,
    error,
    filter,
    loading,
    page,
    removeConversationFromHistory,
    rows,
    setFilter,
    setPage,
    usingRemoteRows,
  };
}

export function historyRowFromConversation(
  conversation: AiConversation,
): AiConversationHistoryRow {
  const modelMessage = latestMessageWithModel(conversation);
  return {
    attachmentCount: conversation.messages.reduce(
      (count, message) => count + (message.attachments?.length ?? 0),
      0,
    ),
    createdAt: conversation.createdAt,
    hostId: conversation.hostId,
    id: conversation.id,
    messageCount: conversation.messages.length,
    model: modelMessage?.model ?? null,
    paneId: conversation.paneId,
    providerLabel: modelMessage?.providerName ?? null,
    scopeKind: conversation.scopeKind,
    scopeRefJson: conversation.scopeRefJson,
    status: conversationStatusFromMessages(conversation),
    tabId: conversation.tabId,
    targetKey: conversation.targetKey,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

function historyRowFromSummary(
  summary: AiConversationSummary,
): AiConversationHistoryRow {
  return {
    attachmentCount: summary.attachmentCount,
    createdAt: summary.createdAt,
    hostId: summary.hostId,
    id: summary.id,
    messageCount: summary.messageCount,
    model: summary.model,
    paneId: summary.paneId,
    providerId: summary.providerId,
    providerLabel: summary.providerId,
    scopeKind: summary.scopeKind,
    scopeRefJson: summary.scopeRefJson,
    status: summary.status,
    summary: summary.summary,
    tabId: summary.tabId,
    targetKey: summary.targetKey,
    title: summary.title,
    updatedAt: summary.updatedAt,
  };
}

function historyRowHasContent(row: AiConversationHistoryRow) {
  return row.messageCount > 0 || row.attachmentCount > 0;
}

function latestMessageWithModel(conversation: AiConversation) {
  return [...conversation.messages]
    .reverse()
    .find((message) => message.model || message.providerName);
}

function conversationStatusFromMessages(conversation: AiConversation) {
  const messages = conversation.messages;
  if (
    messages.some((message) =>
      message.pendingInvocations?.some((invocation) => invocation.status === "pending"),
    )
  ) {
    return "waiting";
  }
  if (messages.some((message) => message.status === "streaming")) {
    return "running";
  }
  if (messages.some((message) => message.status === "error")) {
    return "failed";
  }
  return "idle";
}

function buildServerHistoryRequest({
  currentSlot,
  currentTarget,
  filter,
  page,
  query,
}: {
  currentSlot: AiConversationSlotDescriptor;
  currentTarget: TargetRef;
  filter: AiConversationHistoryFilter;
  page: number;
  query: string;
}): AiConversationListRequest {
  const request: AiConversationListRequest = {
    limit: AI_HISTORY_PAGE_SIZE + 1,
    offset: Math.max(0, page - 1) * AI_HISTORY_PAGE_SIZE,
    query,
  };
  if (filter === "currentTarget") {
    if (currentSlot.createRequest.targetKey) {
      request.targetKey = currentSlot.createRequest.targetKey;
    } else if (currentSlot.createRequest.paneId) {
      request.paneId = currentSlot.createRequest.paneId;
    } else if (currentSlot.createRequest.tabId ?? currentTarget.tabId) {
      request.tabId = currentSlot.createRequest.tabId ?? currentTarget.tabId;
    }
  }
  if (filter === "currentHost") {
    request.hostId = currentSlot.createRequest.hostId ?? currentTarget.machineId;
  }
  return request;
}

function conversationMatchesHistoryFilter(
  conversation: AiConversation,
  input: {
    currentSlot: AiConversationSlotDescriptor;
    currentTarget: TargetRef;
    filter: AiConversationHistoryFilter;
  },
) {
  if (input.filter === "currentTarget") {
    return conversationMatchesCurrentTarget(conversation, input);
  }
  if (input.filter === "currentHost") {
    return conversationMatchesCurrentHost(conversation, input.currentTarget);
  }
  return true;
}

function conversationMatchesCurrentTarget(
  conversation: AiConversation,
  current: { currentSlot: AiConversationSlotDescriptor; currentTarget: TargetRef },
) {
  const conversationTarget = parseTargetRef(conversation.scopeRefJson ?? "");
  if (current.currentSlot.slotKey === "no-context") {
    return (
      conversation.scopeKind === "noContext" ||
      conversationTarget.kind === "none" ||
      !conversation.targetKey
    );
  }
  if (
    current.currentSlot.createRequest.targetKey &&
    conversation.targetKey === current.currentSlot.createRequest.targetKey
  ) {
    return true;
  }
  if (
    current.currentTarget.paneId &&
    (conversation.paneId === current.currentTarget.paneId ||
      conversationTarget.paneId === current.currentTarget.paneId)
  ) {
    return true;
  }
  if (
    current.currentTarget.tabId &&
    (conversation.tabId === current.currentTarget.tabId ||
      conversationTarget.tabId === current.currentTarget.tabId)
  ) {
    return true;
  }
  return false;
}

function conversationMatchesCurrentHost(
  conversation: AiConversation,
  currentTarget: TargetRef,
) {
  if (!currentTarget.machineId) {
    return false;
  }
  const conversationTarget = parseTargetRef(conversation.scopeRefJson ?? "");
  return (
    conversation.hostId === currentTarget.machineId ||
    conversationTarget.machineId === currentTarget.machineId
  );
}

function parseTargetRef(value: string): TargetRef {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return {
      kind: textValue(parsed.kind),
      machineId: textValue(parsed.machineId),
      paneId: textValue(parsed.paneId),
      tabId: textValue(parsed.tabId),
    };
  } catch {
    return {};
  }
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
