import { useSyncExternalStore } from "react";

export type AgentSendRequestSource =
  | "commandBlock"
  | "context"
  | "selection";

export interface AgentSendRequest {
  expiresAt: number;
  id: number;
  paneId: string;
  source: AgentSendRequestSource;
  tabId?: string;
}

interface AgentSendRequestSnapshot {
  request: AgentSendRequest | null;
  revision: number;
}

const REQUEST_TTL_MS = 60_000;
const listeners = new Set<() => void>();
let lastAutoOpenedRequestId: number | null = null;
let nextRequestId = 1;
let snapshot: AgentSendRequestSnapshot = {
  request: null,
  revision: 0,
};

function publish(request: AgentSendRequest | null) {
  snapshot = {
    request,
    revision: snapshot.revision + 1,
  };
  for (const listener of listeners) {
    listener();
  }
}

/** 记录一次不含正文的 Agent 发送意图，正文仍由目标终端运行时按 paneId 提供。 */
export function requestAgentSend(
  request: Pick<AgentSendRequest, "paneId" | "source" | "tabId">,
  now = Date.now(),
) {
  const nextRequest: AgentSendRequest = {
    ...request,
    expiresAt: now + REQUEST_TTL_MS,
    id: nextRequestId++,
  };
  publish(nextRequest);
  return nextRequest;
}

export function consumeAgentSendRequest(requestId: number) {
  if (snapshot.request?.id === requestId) {
    publish(null);
  }
}

export function subscribeAgentSendRequest(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAgentSendRequestSnapshot() {
  return snapshot;
}

/** 保证同一发送请求只自动打开一次 Agent；用户随后主动收起时不再反复弹回。 */
export function claimAgentSendRequestAutoOpen(requestId: number) {
  if (lastAutoOpenedRequestId === requestId) {
    return false;
  }
  lastAutoOpenedRequestId = requestId;
  return true;
}

export function useAgentSendRequestSnapshot() {
  return useSyncExternalStore(
    subscribeAgentSendRequest,
    getAgentSendRequestSnapshot,
    getAgentSendRequestSnapshot,
  );
}

export function resetAgentSendRequestStoreForTests() {
  lastAutoOpenedRequestId = null;
  nextRequestId = 1;
  snapshot = {
    request: null,
    revision: 0,
  };
  listeners.clear();
}
