import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeHealthSnapshot } from "../../lib/diagnosticsApi";
import {
  getServerInfoSnapshot,
  type ServerInfoSnapshot,
} from "../../lib/serverInfoApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import {
  cachedNetworkTraffic,
  clearServerInfoMetricsCacheForTest,
  type NetworkTrafficSnapshot,
  updateNetworkTrafficCache,
} from "./serverInfoMetricsModel";
import { localServerInfoSnapshot } from "./localServerInfoModel";
import type { ServerInfoTargetContext } from "./serverInfoTargetModel";
import { targetStableId, type RemoteTargetRef } from "../../lib/targetModel";

const serverInfoSnapshotCache = new Map<string, ServerInfoSnapshot>();
const serverInfoInFlight = new Map<string, Promise<ServerInfoSnapshot>>();
const DEFAULT_REFRESH_INTERVAL_MS = 3_000;
const DEFAULT_HIDDEN_REFRESH_INTERVAL_MS = 30_000;

export type VisibilityChangeSubscriber = (onChange: () => void) => () => void;

export const serverInfoRefreshOptions = [
  { label: "手动", value: 0 },
  { label: "1s", value: 1_000 },
  { label: "3s", value: 3_000 },
  { label: "5s", value: 5_000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
  { label: "5min", value: 300_000 },
];

export function clearServerInfoSnapshotCacheForTest() {
  serverInfoSnapshotCache.clear();
  serverInfoInFlight.clear();
  clearServerInfoMetricsCacheForTest();
}

export interface UseServerInfoSnapshotOptions {
  documentVisible?: () => boolean;
  hiddenRefreshIntervalMs?: number;
  subscribeToVisibilityChange?: VisibilityChangeSubscriber;
}

const defaultDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";
const defaultSubscribeToVisibilityChange: VisibilityChangeSubscriber = (
  onChange,
) => {
  if (typeof document === "undefined") {
    return () => {};
  }
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};

/** 管理本机、SSH 主机或容器的系统信息快照、缓存与定时刷新。 */
export function useServerInfoSnapshot(
  targetContext: ServerInfoTargetContext | undefined,
  {
    documentVisible = defaultDocumentVisible,
    hiddenRefreshIntervalMs = DEFAULT_HIDDEN_REFRESH_INTERVAL_MS,
    subscribeToVisibilityChange = defaultSubscribeToVisibilityChange,
  }: UseServerInfoSnapshotOptions = {},
) {
  const selectedTargetKey = targetContext?.cacheKey;
  const [error, setError] = useState<UserFacingMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(
    DEFAULT_REFRESH_INTERVAL_MS,
  );
  const [snapshot, setSnapshot] = useState<ServerInfoSnapshot | null>(() =>
    selectedTargetKey
      ? (serverInfoSnapshotCache.get(selectedTargetKey) ?? null)
      : null,
  );
  const [networkTraffic, setNetworkTraffic] =
    useState<NetworkTrafficSnapshot | null>(() =>
      selectedTargetKey
        ? cachedNetworkTraffic(
            selectedTargetKey,
            serverInfoSnapshotCache.get(selectedTargetKey),
          )
        : null,
    );
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!targetContext) {
        requestIdRef.current += 1;
        loadingRef.current = false;
        setLoading(false);
        return;
      }
      if (loadingRef.current) {
        return;
      }
      const cachedSnapshot = serverInfoSnapshotCache.get(targetContext.cacheKey);
      if (cachedSnapshot && !options?.force) {
        setSnapshot(cachedSnapshot);
        setNetworkTraffic(
          cachedNetworkTraffic(targetContext.cacheKey, cachedSnapshot),
        );
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        let snapshotRequest = serverInfoInFlight.get(targetContext.cacheKey);
        if (!snapshotRequest) {
          snapshotRequest = loadTargetSnapshot(targetContext).finally(() => {
            serverInfoInFlight.delete(targetContext.cacheKey);
          });
          serverInfoInFlight.set(targetContext.cacheKey, snapshotRequest);
        }
        const nextSnapshot = await snapshotRequest;
        if (requestIdRef.current === requestId) {
          const nextNetworkTraffic = updateNetworkTrafficCache(
            targetContext.cacheKey,
            nextSnapshot,
          );
          serverInfoSnapshotCache.set(targetContext.cacheKey, nextSnapshot);
          setSnapshot(nextSnapshot);
          setNetworkTraffic(nextNetworkTraffic);
        }
      } catch (nextError) {
        if (requestIdRef.current === requestId) {
          const localTarget = targetContext.target.kind === "local";
          setError(
            buildUserFacingError(nextError, {
              recoveryAction: localTarget
                ? "请稍后重试。"
                : "请检查连接后重试。",
              title: localTarget
                ? "无法读取本机系统信息"
                : "无法读取服务器信息",
            }),
          );
        }
      } finally {
        if (requestIdRef.current === requestId) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [targetContext],
  );

  useEffect(() => {
    setError(null);
    if (selectedTargetKey) {
      const cachedSnapshot = serverInfoSnapshotCache.get(selectedTargetKey) ?? null;
      setSnapshot(cachedSnapshot);
      setNetworkTraffic(
        cachedNetworkTraffic(selectedTargetKey, cachedSnapshot ?? undefined),
      );
      setLoading(false);
      if (!cachedSnapshot) {
        void refresh({ force: true });
      }
    } else {
      setLoading(false);
      setSnapshot(null);
      setNetworkTraffic(null);
    }
    return () => {
      requestIdRef.current += 1;
      loadingRef.current = false;
    };
  }, [refresh, selectedTargetKey]);

  useEffect(() => {
    if (!selectedTargetKey || refreshIntervalMs <= 0) {
      return undefined;
    }

    let disposed = false;
    let refreshInFlight = false;
    let timeoutId: number | undefined;
    const clearNextRefresh = () => {
      if (timeoutId === undefined) {
        return;
      }
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    };
    const scheduleNextRefresh = () => {
      if (disposed) {
        return;
      }
      clearNextRefresh();
      const delay = resolveServerInfoRefreshDelay({
        documentVisible: documentVisible(),
        hiddenRefreshIntervalMs,
        refreshIntervalMs,
      });
      if (delay === null) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = undefined;
        void runRefresh();
      }, delay);
    };
    const runRefresh = async () => {
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      try {
        await refresh({ force: true });
      } finally {
        refreshInFlight = false;
        scheduleNextRefresh();
      }
    };
    const handleVisibilityChange = () => {
      clearNextRefresh();
      if (documentVisible()) {
        void runRefresh();
      } else {
        scheduleNextRefresh();
      }
    };

    scheduleNextRefresh();
    const unsubscribeVisibility =
      subscribeToVisibilityChange(handleVisibilityChange);

    return () => {
      disposed = true;
      clearNextRefresh();
      unsubscribeVisibility();
    };
  }, [
    documentVisible,
    hiddenRefreshIntervalMs,
    refresh,
    refreshIntervalMs,
    selectedTargetKey,
    subscribeToVisibilityChange,
  ]);

  return {
    error,
    loading,
    networkTraffic,
    refresh,
    refreshIntervalMs,
    setRefreshIntervalMs,
    snapshot,
  };
}

/**
 * 只读查看其它工具已经采集的目标信息；不会创建请求或触发远程探测。
 */
export function peekServerInfoSnapshot(
  target: RemoteTargetRef | undefined,
): ServerInfoSnapshot | null {
  return target
    ? (serverInfoSnapshotCache.get(targetStableId(target)) ?? null)
    : null;
}

/** 按目标边界选择只读采集源，本机不经过只支持 SSH/容器的远程 IPC。 */
async function loadTargetSnapshot(targetContext: ServerInfoTargetContext) {
  if (targetContext.target.kind === "local") {
    const runtimeSnapshot = await getRuntimeHealthSnapshot();
    return localServerInfoSnapshot(runtimeSnapshot, targetContext.hostId);
  }

  return getServerInfoSnapshot({
    hostId: targetContext.hostId,
    target: targetContext.target,
  });
}

export function resolveServerInfoRefreshDelay({
  documentVisible,
  hiddenRefreshIntervalMs,
  refreshIntervalMs,
}: {
  documentVisible: boolean;
  hiddenRefreshIntervalMs: number;
  refreshIntervalMs: number;
}) {
  if (refreshIntervalMs <= 0) {
    return null;
  }
  const visibleDelay = Math.max(1, refreshIntervalMs);
  return documentVisible
    ? visibleDelay
    : Math.max(visibleDelay, hiddenRefreshIntervalMs);
}
