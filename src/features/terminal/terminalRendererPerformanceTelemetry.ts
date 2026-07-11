export type TerminalRendererDurationMetric =
  "drainMs" | "frameGapMs" | "inputEchoMs" | "writeCallbackMs";

export type TerminalRendererCounterMetric =
  | "atlasClearCount"
  | "fullRefreshCount"
  | "rendererRebuildCount"
  | "rendererSwapCount"
  | "staleCommitRejectedCount";

export interface TerminalRendererDurationSummary {
  count: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface TerminalRendererResourceSnapshot {
  activeCanvases: number;
  activeContexts: number;
  activeGpuPanes: number;
  pendingBytes: number;
  pendingChunks: number;
}

export interface TerminalRendererPerformanceSnapshot {
  counters: Record<TerminalRendererCounterMetric, number>;
  durations: Partial<
    Record<TerminalRendererDurationMetric, TerminalRendererDurationSummary>
  >;
  resources: TerminalRendererResourceSnapshot;
  sampleLimit: number;
}

export interface TerminalRendererPerformanceTelemetry {
  increment(metric: TerminalRendererCounterMetric, amount?: number): void;
  recordDuration(metric: TerminalRendererDurationMetric, valueMs: number): void;
  reset(): void;
  setResources(resources: Partial<TerminalRendererResourceSnapshot>): void;
  snapshot(): TerminalRendererPerformanceSnapshot;
}

export interface CreateTerminalRendererPerformanceTelemetryOptions {
  sampleLimit?: number;
}

const DEFAULT_SAMPLE_LIMIT = 256;

const COUNTER_METRICS: readonly TerminalRendererCounterMetric[] = [
  "atlasClearCount",
  "fullRefreshCount",
  "rendererRebuildCount",
  "rendererSwapCount",
  "staleCommitRejectedCount",
];

/**
 * 创建低泄漏、有界的 renderer 性能遥测。
 *
 * 这里只接受耗时、计数和资源数量，接口层面不允许传入终端正文、
 * 命令、路径或 canvas 像素，避免诊断能力演变成第二份输出缓存。
 */
export function createTerminalRendererPerformanceTelemetry({
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
}: CreateTerminalRendererPerformanceTelemetryOptions = {}): TerminalRendererPerformanceTelemetry {
  const resolvedSampleLimit = Math.max(1, Math.floor(sampleLimit));
  const counters = createEmptyCounters();
  const durations = new Map<TerminalRendererDurationMetric, number[]>();
  let resources = emptyResources();

  return {
    increment(metric, amount = 1) {
      if (!Number.isFinite(amount) || amount <= 0) {
        return;
      }
      counters[metric] += amount;
    },
    recordDuration(metric, valueMs) {
      if (!Number.isFinite(valueMs) || valueMs < 0) {
        return;
      }
      const samples = durations.get(metric) ?? [];
      samples.push(valueMs);
      if (samples.length > resolvedSampleLimit) {
        samples.splice(0, samples.length - resolvedSampleLimit);
      }
      durations.set(metric, samples);
    },
    reset() {
      for (const metric of COUNTER_METRICS) {
        counters[metric] = 0;
      }
      durations.clear();
      resources = emptyResources();
    },
    setResources(nextResources) {
      resources = {
        activeCanvases: nonNegativeInteger(
          nextResources.activeCanvases,
          resources.activeCanvases,
        ),
        activeContexts: nonNegativeInteger(
          nextResources.activeContexts,
          resources.activeContexts,
        ),
        activeGpuPanes: nonNegativeInteger(
          nextResources.activeGpuPanes,
          resources.activeGpuPanes,
        ),
        pendingBytes: nonNegativeInteger(
          nextResources.pendingBytes,
          resources.pendingBytes,
        ),
        pendingChunks: nonNegativeInteger(
          nextResources.pendingChunks,
          resources.pendingChunks,
        ),
      };
    },
    snapshot() {
      const durationSnapshot: TerminalRendererPerformanceSnapshot["durations"] =
        {};
      for (const [metric, samples] of durations) {
        if (samples.length > 0) {
          durationSnapshot[metric] = summarizeDurations(samples);
        }
      }
      return {
        counters: { ...counters },
        durations: durationSnapshot,
        resources: { ...resources },
        sampleLimit: resolvedSampleLimit,
      };
    },
  };
}

function summarizeDurations(
  samples: readonly number[],
): TerminalRendererDurationSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    count: sorted.length,
    max: sorted[sorted.length - 1] ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: readonly number[], ratio: number) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index] ?? 0;
}

function createEmptyCounters(): Record<TerminalRendererCounterMetric, number> {
  return {
    atlasClearCount: 0,
    fullRefreshCount: 0,
    rendererRebuildCount: 0,
    rendererSwapCount: 0,
    staleCommitRejectedCount: 0,
  };
}

function emptyResources(): TerminalRendererResourceSnapshot {
  return {
    activeCanvases: 0,
    activeContexts: 0,
    activeGpuPanes: 0,
    pendingBytes: 0,
    pendingChunks: 0,
  };
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}
