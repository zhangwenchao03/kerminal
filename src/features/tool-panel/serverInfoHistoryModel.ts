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

export interface ServerInfoHistoryStore {
  append(
    targetKey: string,
    snapshot: ServerInfoSnapshot,
    networkTraffic: NetworkTrafficSnapshot | null,
  ): ServerInfoHistoryPoint[];
  forTarget(targetKey: string): ServerInfoHistoryPoint[];
}

/** 创建实例级历史仓储，使窗口与测试按生命周期隔离趋势数据。 */
export function createServerInfoHistoryStore(): ServerInfoHistoryStore {
  const historyByTarget = new Map<string, ServerInfoHistoryPoint[]>();
  const forTarget = (targetKey: string) => {
    const history = historyByTarget.get(targetKey) ?? [];
    if (historyByTarget.has(targetKey)) {
      historyByTarget.delete(targetKey);
      historyByTarget.set(targetKey, history);
    }
    return history;
  };

  return {
    append(targetKey, snapshot, networkTraffic) {
      const history = appendServerInfoHistory(
        forTarget(targetKey),
        snapshot,
        networkTraffic,
      );
      historyByTarget.delete(targetKey);
      historyByTarget.set(targetKey, history);
      while (historyByTarget.size > MAX_HISTORY_TARGETS) {
        const oldestKey = historyByTarget.keys().next().value;
        if (oldestKey === undefined) break;
        historyByTarget.delete(oldestKey);
      }
      return history;
    },
    forTarget,
  };
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
