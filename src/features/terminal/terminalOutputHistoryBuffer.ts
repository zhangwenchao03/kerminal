// @author kongweiguang

import {
  createTerminalRuntimeOutputBuffer,
  type TerminalRuntimeOutputBuffer,
  type TerminalRuntimeOutputBufferStats,
} from "./terminalRuntimeOutputBuffer";

interface RefBox<T> {
  current: T;
}

type TimerId = ReturnType<typeof globalThis.setTimeout>;

export interface TerminalOutputHistoryTimer {
  clearTimeout(timerId: TimerId): void;
  setTimeout(callback: () => void, delayMs: number): TimerId;
}

interface TerminalOutputHistoryBufferOptions {
  flushDelayMs?: number | (() => number);
  now?: () => number;
  onOutputHistoryChangeRef: RefBox<
    ((outputHistory: string | undefined) => void) | undefined
  >;
  outputHistoryRef: RefBox<string | undefined>;
  runtimeBuffer?: TerminalRuntimeOutputBuffer;
  slowFlushMs?: number;
  timer?: TerminalOutputHistoryTimer;
}

const DEFAULT_OUTPUT_HISTORY_FLUSH_DELAY_MS = 100;
const DEFAULT_SLOW_HISTORY_FLUSH_MS = 16;
const activeOutputHistoryBuffers = new Set<TerminalOutputHistoryBuffer>();

const globalTimer: TerminalOutputHistoryTimer = {
  clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

export interface TerminalOutputHistoryBufferStats {
  appendCount: number;
  appendedChars: number;
  coldSnapshotChars: number;
  droppedTailChars: number;
  flushCount: number;
  lastFlushMs?: number;
  lastSlowFlushAt?: number;
  manualFlushCount: number;
  maxFlushMs: number;
  pendingFlush: boolean;
  pendingSnapshotChars: number;
  runtimeBufferStats: TerminalRuntimeOutputBufferStats;
  scheduledFlushCount: number;
  skippedUnchangedSnapshotCount: number;
  slowFlushCount: number;
  storeUpdateCount: number;
  tailChars: number;
  truncatedTail: boolean;
}

export interface TerminalOutputHistoryBuffer {
  append(data: string): void;
  dispose(): void;
  flush(): void;
  pendingFlush(): boolean;
  stats(): TerminalOutputHistoryBufferStats;
}

export function flushPendingTerminalOutputHistoryBuffers() {
  for (const buffer of Array.from(activeOutputHistoryBuffers)) {
    if (buffer.pendingFlush()) {
      buffer.flush();
    }
  }
}

export function createTerminalOutputHistoryBuffer({
  flushDelayMs = DEFAULT_OUTPUT_HISTORY_FLUSH_DELAY_MS,
  now = nowMs,
  onOutputHistoryChangeRef,
  outputHistoryRef,
  runtimeBuffer = createTerminalRuntimeOutputBuffer({
    initialOutput: outputHistoryRef.current,
  }),
  slowFlushMs = DEFAULT_SLOW_HISTORY_FLUSH_MS,
  timer = globalTimer,
}: TerminalOutputHistoryBufferOptions): TerminalOutputHistoryBuffer {
  let disposed = false;
  let flushTimer: TimerId | null = null;
  let lastFlushedSnapshot = outputHistoryRef.current;
  const resolvedSlowFlushMs = Math.max(0, slowFlushMs);
  const historyStats = {
    appendCount: 0,
    appendedChars: 0,
    flushCount: 0,
    lastFlushMs: undefined as number | undefined,
    lastSlowFlushAt: undefined as number | undefined,
    manualFlushCount: 0,
    maxFlushMs: 0,
    scheduledFlushCount: 0,
    skippedUnchangedSnapshotCount: 0,
    slowFlushCount: 0,
    storeUpdateCount: 0,
  };

  const cancelScheduledFlush = () => {
    if (flushTimer === null) {
      return;
    }
    timer.clearTimeout(flushTimer);
    flushTimer = null;
  };

  const recordFlushDuration = (start: number) => {
    const durationMs = Math.max(0, now() - start);
    historyStats.flushCount += 1;
    historyStats.lastFlushMs = durationMs;
    historyStats.maxFlushMs = Math.max(historyStats.maxFlushMs, durationMs);
    if (durationMs >= resolvedSlowFlushMs) {
      historyStats.slowFlushCount += 1;
      historyStats.lastSlowFlushAt = start + durationMs;
    }
  };

  const publishSnapshot = () => {
    const start = now();
    try {
      const nextHistory = runtimeBuffer.snapshot().text;
      outputHistoryRef.current = nextHistory;
      if (nextHistory === lastFlushedSnapshot) {
        historyStats.skippedUnchangedSnapshotCount += 1;
        return;
      }
      lastFlushedSnapshot = nextHistory;
      historyStats.storeUpdateCount += 1;
      onOutputHistoryChangeRef.current?.(nextHistory);
    } finally {
      recordFlushDuration(start);
    }
  };

  const flush = () => {
    historyStats.manualFlushCount += 1;
    cancelScheduledFlush();
    publishSnapshot();
  };

  const scheduleFlush = () => {
    if (disposed || flushTimer !== null) {
      return;
    }
    flushTimer = timer.setTimeout(() => {
      flushTimer = null;
      if (!disposed) {
        historyStats.scheduledFlushCount += 1;
        publishSnapshot();
      }
    }, resolveFlushDelayMs(flushDelayMs));
  };

  const buffer: TerminalOutputHistoryBuffer = {
    append(data: string) {
      if (disposed) {
        return;
      }
      if (!runtimeBuffer.append(data)) {
        return;
      }
      historyStats.appendCount += 1;
      historyStats.appendedChars += data.length;
      scheduleFlush();
    },
    dispose() {
      if (disposed) {
        return;
      }
      flush();
      disposed = true;
      activeOutputHistoryBuffers.delete(buffer);
    },
    flush,
    pendingFlush() {
      return flushTimer !== null;
    },
    stats() {
      const runtimeBufferStats = runtimeBuffer.stats();
      const snapshot: TerminalOutputHistoryBufferStats = {
        appendCount: historyStats.appendCount,
        appendedChars: historyStats.appendedChars,
        coldSnapshotChars: outputHistoryRef.current?.length ?? 0,
        droppedTailChars: runtimeBufferStats.truncatedChars,
        flushCount: historyStats.flushCount,
        manualFlushCount: historyStats.manualFlushCount,
        maxFlushMs: historyStats.maxFlushMs,
        pendingFlush: flushTimer !== null,
        pendingSnapshotChars:
          flushTimer !== null ? runtimeBufferStats.totalChars : 0,
        runtimeBufferStats,
        scheduledFlushCount: historyStats.scheduledFlushCount,
        skippedUnchangedSnapshotCount:
          historyStats.skippedUnchangedSnapshotCount,
        slowFlushCount: historyStats.slowFlushCount,
        storeUpdateCount: historyStats.storeUpdateCount,
        tailChars: runtimeBufferStats.totalChars,
        truncatedTail: runtimeBufferStats.truncatedChars > 0,
      };
      if (historyStats.lastFlushMs !== undefined) {
        snapshot.lastFlushMs = historyStats.lastFlushMs;
      }
      if (historyStats.lastSlowFlushAt !== undefined) {
        snapshot.lastSlowFlushAt = historyStats.lastSlowFlushAt;
      }
      return snapshot;
    },
  };

  activeOutputHistoryBuffers.add(buffer);
  return buffer;
}

function resolveFlushDelayMs(flushDelayMs: number | (() => number)) {
  const resolved =
    typeof flushDelayMs === "function" ? flushDelayMs() : flushDelayMs;
  return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
}

function nowMs() {
  if (
    typeof globalThis.performance !== "undefined" &&
    typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }
  return Date.now();
}
