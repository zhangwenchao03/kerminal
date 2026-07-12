import type { ServerInfoSnapshot } from "../../lib/serverInfoApi";
import { primaryNetworkTraffic } from "./serverInfoDashboardModel";
import type { NetworkTrafficSnapshot } from "./serverInfoMetricsModel";

export interface ServerInfoHistoryPoint {
  capturedAtMs: number;
  cpuPercent?: number;
  memoryPercent?: number;
  networkRxBytesPerSecond?: number;
  networkTxBytesPerSecond?: number;
}

const MAX_HISTORY_POINTS = 60;
const MAX_HISTORY_TARGETS = 8;
const targetHistoryStore = new Map<string, ServerInfoHistoryPoint[]>();

/** 返回目标最近一次保留的历史，并将其提升为最近使用项。 */
export function serverInfoHistoryForTarget(targetKey: string) {
  const history = targetHistoryStore.get(targetKey) ?? [];
  if (targetHistoryStore.has(targetKey)) {
    targetHistoryStore.delete(targetKey);
    targetHistoryStore.set(targetKey, history);
  }
  return history;
}

/** 追加目标历史并按 LRU 限制目标数量，切换服务器后仍可恢复趋势。 */
export function appendServerInfoTargetHistory(
  targetKey: string,
  snapshot: ServerInfoSnapshot,
  networkTraffic: NetworkTrafficSnapshot | null,
) {
  const history = appendServerInfoHistory(
    serverInfoHistoryForTarget(targetKey),
    snapshot,
    networkTraffic,
  );
  targetHistoryStore.delete(targetKey);
  targetHistoryStore.set(targetKey, history);
  while (targetHistoryStore.size > MAX_HISTORY_TARGETS) {
    const oldestKey = targetHistoryStore.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    targetHistoryStore.delete(oldestKey);
  }
  return history;
}

export function clearServerInfoHistoryStoreForTest() {
  targetHistoryStore.clear();
}

/**
 * 追加一条监控历史，并按采样时间去重，避免缓存快照制造重复趋势点。
 */
export function appendServerInfoHistory(
  history: ServerInfoHistoryPoint[],
  snapshot: ServerInfoSnapshot,
  networkTraffic: NetworkTrafficSnapshot | null,
  limit = MAX_HISTORY_POINTS,
): ServerInfoHistoryPoint[] {
  const capturedAtMs = Number(snapshot.capturedAt) * 1_000;
  if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) {
    return history;
  }
  const memoryPercent =
    snapshot.memoryUsedBytes != null &&
    snapshot.memoryTotalBytes != null &&
    snapshot.memoryTotalBytes > 0
      ? (snapshot.memoryUsedBytes / snapshot.memoryTotalBytes) * 100
      : undefined;
  const primaryTraffic = primaryNetworkTraffic(
    networkTraffic?.interfaces ?? [],
  );
  const point: ServerInfoHistoryPoint = {
    capturedAtMs,
    cpuPercent: finite(snapshot.cpuUsagePercent),
    memoryPercent: finite(memoryPercent),
    networkRxBytesPerSecond: finite(
      primaryTraffic.rxBytesPerSecond ??
        networkTraffic?.totalRxBytesPerSecond,
    ),
    networkTxBytesPerSecond: finite(
      primaryTraffic.txBytesPerSecond ??
        networkTraffic?.totalTxBytesPerSecond,
    ),
  };
  const withoutSameSample = history.filter(
    (item) => item.capturedAtMs !== capturedAtMs,
  );
  return [...withoutSameSample, point]
    .sort((left, right) => left.capturedAtMs - right.capturedAtMs)
    .slice(-Math.max(1, limit));
}

export function historySeries(
  history: ServerInfoHistoryPoint[],
  key: keyof Omit<ServerInfoHistoryPoint, "capturedAtMs">,
) {
  return history
    .map((point) => point[key])
    .filter((value): value is number => value !== undefined);
}

function finite(value?: number | null) {
  return value != null && Number.isFinite(value) ? value : undefined;
}
