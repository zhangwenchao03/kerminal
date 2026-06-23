import { useCallback, useEffect, useRef, useState } from "react";
import {
  getServerInfoSnapshot,
  type ServerInfoSnapshot,
} from "../../lib/serverInfoApi";
import {
  cachedNetworkTraffic,
  clearServerInfoMetricsCacheForTest,
  type NetworkTrafficSnapshot,
  updateNetworkTrafficCache,
} from "./serverInfoMetricsModel";
import type { ServerInfoTargetContext } from "./serverInfoTargetModel";

const serverInfoSnapshotCache = new Map<string, ServerInfoSnapshot>();
const serverInfoInFlight = new Map<string, Promise<ServerInfoSnapshot>>();

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

export function useServerInfoSnapshot(
  targetContext: ServerInfoTargetContext | undefined,
) {
  const selectedTargetKey = targetContext?.cacheKey;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(3_000);
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
          snapshotRequest = getServerInfoSnapshot({
            hostId: targetContext.hostId,
            target: targetContext.target,
          }).finally(() => {
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
          setError(errorMessage(nextError));
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

    const interval = window.setInterval(() => {
      void refresh({ force: true });
    }, refreshIntervalMs);

    return () => window.clearInterval(interval);
  }, [refresh, refreshIntervalMs, selectedTargetKey]);

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
