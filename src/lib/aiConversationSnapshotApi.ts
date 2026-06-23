import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AiConversationRouteMode,
  AiConversationScopeKind,
} from "./aiConversationApi";

export interface AiContextSnapshot {
  id: string;
  conversationId: string;
  messageId?: string | null;
  generatedAt: number;
  scopeKind: AiConversationScopeKind;
  scopeRefJson: string;
  routeMode?: AiConversationRouteMode | null;
  targetRefJson?: string | null;
  terminalContextJson?: string | null;
  applicationContextJson?: string | null;
  attachmentRefsJson: string;
  policyJson: string;
  createdAt: number;
}

export interface AiContextSnapshotCreateRequest {
  conversationId: string;
  scopeKind: AiConversationScopeKind;
  scopeRefJson?: string;
  routeMode?: AiConversationRouteMode;
  targetRefJson?: string;
  terminalContextJson?: string;
  applicationContextJson?: string;
  attachmentRefsJson?: string;
  policyJson?: string;
}

const previewSnapshots = new Map<string, AiContextSnapshot>();

export async function createAiContextSnapshot(
  request: AiContextSnapshotCreateRequest,
): Promise<AiContextSnapshot> {
  const normalized = normalizeContextSnapshotCreateRequest(request);
  if (!isTauri()) {
    return previewCreateContextSnapshot(normalized);
  }

  return invoke<AiContextSnapshot>("ai_context_snapshot_create", {
    request: normalized,
  });
}

export async function getAiContextSnapshot(
  snapshotId: string,
): Promise<AiContextSnapshot> {
  const normalizedId = requiredText("上下文快照 ID", snapshotId);
  if (!isTauri()) {
    const snapshot = previewSnapshots.get(normalizedId);
    if (!snapshot) {
      throw new Error(`AI 上下文快照不存在: ${normalizedId}`);
    }
    return snapshot;
  }

  return invoke<AiContextSnapshot>("ai_context_snapshot_get", {
    snapshotId: normalizedId,
  });
}

function normalizeContextSnapshotCreateRequest(
  request: AiContextSnapshotCreateRequest,
): AiContextSnapshotCreateRequest {
  return {
    conversationId: requiredText("会话 ID", request.conversationId),
    scopeKind: normalizeScopeKind(request.scopeKind),
    scopeRefJson: normalizeJsonText(request.scopeRefJson ?? "{}"),
    routeMode: normalizeRouteMode(request.routeMode),
    targetRefJson: optionalJsonText(request.targetRefJson),
    terminalContextJson: optionalJsonText(request.terminalContextJson),
    applicationContextJson: optionalJsonText(request.applicationContextJson),
    attachmentRefsJson: normalizeJsonText(request.attachmentRefsJson ?? "[]"),
    policyJson: normalizeJsonText(request.policyJson ?? "{}"),
  };
}

function previewCreateContextSnapshot(
  request: AiContextSnapshotCreateRequest,
): AiContextSnapshot {
  const now = Date.now();
  const snapshot: AiContextSnapshot = {
    applicationContextJson: request.applicationContextJson ?? null,
    attachmentRefsJson: request.attachmentRefsJson ?? "[]",
    conversationId: request.conversationId,
    createdAt: now,
    generatedAt: now,
    id: `browser-ai-ctx-${now.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    messageId: null,
    policyJson: request.policyJson ?? "{}",
    routeMode: request.routeMode ?? null,
    scopeKind: request.scopeKind,
    scopeRefJson: request.scopeRefJson ?? "{}",
    targetRefJson: request.targetRefJson ?? null,
    terminalContextJson: request.terminalContextJson ?? null,
  };
  previewSnapshots.set(snapshot.id, snapshot);
  return snapshot;
}

function requiredText(field: string, value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field}不能为空`);
  }
  return normalized;
}

function optionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function optionalJsonText(value: string | undefined) {
  const normalized = optionalText(value);
  return normalized ? normalizeJsonText(normalized) : undefined;
}

function normalizeJsonText(value: string) {
  const normalized = requiredText("JSON", value);
  JSON.parse(normalized);
  return normalized;
}

function normalizeScopeKind(value: AiConversationScopeKind) {
  if (
    value === "noContext" ||
    value === "followFocus" ||
    value === "lockedPane" ||
    value === "lockedHost" ||
    value === "workspaceTask"
  ) {
    return value;
  }
  throw new Error("会话 scope 不受支持");
}

function normalizeRouteMode(value: AiConversationRouteMode | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "followWorkspaceTarget" ||
    value === "pinnedConversation" ||
    value === "noContextChat"
  ) {
    return value;
  }
  throw new Error("路由模式不受支持");
}
