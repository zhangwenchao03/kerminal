import { useSyncExternalStore } from "react";

type AgentSendRequestSource =
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
export interface AgentSendRequestStore {
  claimAutoOpen(requestId: number): boolean;
  consume(requestId: number): void;
  getSnapshot(): AgentSendRequestSnapshot;
  request(
    request: Pick<AgentSendRequest, "paneId" | "source" | "tabId">,
    now?: number,
  ): AgentSendRequest;
  subscribe(listener: () => void): () => void;
}

/** 创建实例级发送请求状态，composition root 与测试可各自持有独立生命周期。 */
export function createAgentSendRequestStore(): AgentSendRequestStore {
  const listeners = new Set<() => void>();
  let lastAutoOpenedRequestId: number | null = null;
  let nextRequestId = 1;
  let snapshot: AgentSendRequestSnapshot = {
    request: null,
    revision: 0,
  };
  const publish = (request: AgentSendRequest | null) => {
    snapshot = {
      request,
      revision: snapshot.revision + 1,
    };
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    claimAutoOpen(requestId) {
      if (lastAutoOpenedRequestId === requestId) {
        return false;
      }
      lastAutoOpenedRequestId = requestId;
      return true;
    },
    consume(requestId) {
      if (snapshot.request?.id === requestId) {
        publish(null);
      }
    },
    getSnapshot: () => snapshot,
    request(request, now = Date.now()) {
      const nextRequest: AgentSendRequest = {
        ...request,
        expiresAt: now + REQUEST_TTL_MS,
        id: nextRequestId++,
      };
      publish(nextRequest);
      return nextRequest;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const defaultAgentSendRequestStore = createAgentSendRequestStore();

/** 记录一次不含正文的 Agent 发送意图，正文仍由目标终端运行时按 paneId 提供。 */
export function requestAgentSend(
  request: Pick<AgentSendRequest, "paneId" | "source" | "tabId">,
  now = Date.now(),
) {
  return defaultAgentSendRequestStore.request(request, now);
}

export function consumeAgentSendRequest(requestId: number) {
  defaultAgentSendRequestStore.consume(requestId);
}

export function getAgentSendRequestSnapshot() {
  return defaultAgentSendRequestStore.getSnapshot();
}

/** 保证同一发送请求只自动打开一次 Agent；用户随后主动收起时不再反复弹回。 */
export function claimAgentSendRequestAutoOpen(requestId: number) {
  return defaultAgentSendRequestStore.claimAutoOpen(requestId);
}

export function useAgentSendRequestSnapshot(
  store: AgentSendRequestStore = defaultAgentSendRequestStore,
) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
