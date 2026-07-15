type ServerInfoHealthStatus =
  | "baseline"
  | "error"
  | "idle"
  | "live"
  | "paused"
  | "stale";

export interface ServerInfoHealth {
  label: string;
  status: ServerInfoHealthStatus;
  tone: "danger" | "neutral" | "positive" | "warning";
}

/**
 * 将采集状态转换为稳定、可解释的用户语义。
 */
export function resolveServerInfoHealth({
  capturedAt,
  error,
  hasRateSample,
  loading,
  nowMs,
  refreshIntervalMs,
}: {
  capturedAt?: string | null;
  error: boolean;
  hasRateSample: boolean;
  loading: boolean;
  nowMs: number;
  refreshIntervalMs: number;
}): ServerInfoHealth {
  if (error) {
    return { label: "采集异常", status: "error", tone: "danger" };
  }
  if (!capturedAt || loading) {
    return { label: "正在建立基线", status: "baseline", tone: "neutral" };
  }
  if (refreshIntervalMs <= 0) {
    return { label: "自动采集已暂停", status: "paused", tone: "warning" };
  }
  const capturedAtMs = Number(capturedAt) * 1_000;
  const staleAfterMs = Math.max(refreshIntervalMs * 3, 15_000);
  if (!Number.isFinite(capturedAtMs) || nowMs - capturedAtMs > staleAfterMs) {
    return { label: "数据已过期", status: "stale", tone: "warning" };
  }
  if (!hasRateSample) {
    return { label: "等待第二次采样", status: "idle", tone: "neutral" };
  }
  return { label: "实时采集中", status: "live", tone: "positive" };
}
