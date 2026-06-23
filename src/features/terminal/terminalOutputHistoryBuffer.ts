// @author kongweiguang

import { appendTerminalOutputHistory } from "../workspace/workspaceSession";

interface RefBox<T> {
  current: T;
}

type TimerId = ReturnType<typeof globalThis.setTimeout>;

export interface TerminalOutputHistoryTimer {
  clearTimeout(timerId: TimerId): void;
  setTimeout(callback: () => void, delayMs: number): TimerId;
}

interface TerminalOutputHistoryBufferOptions {
  flushDelayMs?: number;
  onOutputHistoryChangeRef: RefBox<
    ((outputHistory: string | undefined) => void) | undefined
  >;
  outputHistoryRef: RefBox<string | undefined>;
  timer?: TerminalOutputHistoryTimer;
}

const DEFAULT_OUTPUT_HISTORY_FLUSH_DELAY_MS = 100;

const globalTimer: TerminalOutputHistoryTimer = {
  clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

export function createTerminalOutputHistoryBuffer({
  flushDelayMs = DEFAULT_OUTPUT_HISTORY_FLUSH_DELAY_MS,
  onOutputHistoryChangeRef,
  outputHistoryRef,
  timer = globalTimer,
}: TerminalOutputHistoryBufferOptions) {
  let disposed = false;
  let flushTimer: TimerId | null = null;

  const cancelScheduledFlush = () => {
    if (flushTimer === null) {
      return;
    }
    timer.clearTimeout(flushTimer);
    flushTimer = null;
  };

  const flush = () => {
    cancelScheduledFlush();
    onOutputHistoryChangeRef.current?.(outputHistoryRef.current);
  };

  const scheduleFlush = () => {
    if (disposed || flushTimer !== null) {
      return;
    }
    flushTimer = timer.setTimeout(() => {
      flushTimer = null;
      if (!disposed) {
        onOutputHistoryChangeRef.current?.(outputHistoryRef.current);
      }
    }, Math.max(0, flushDelayMs));
  };

  return {
    append(data: string) {
      if (disposed) {
        return;
      }
      const nextHistory = appendTerminalOutputHistory(
        outputHistoryRef.current,
        data,
      );
      if (nextHistory === outputHistoryRef.current) {
        return;
      }
      outputHistoryRef.current = nextHistory;
      scheduleFlush();
    },
    dispose() {
      if (disposed) {
        return;
      }
      flush();
      disposed = true;
    },
    flush,
    pendingFlush() {
      return flushTimer !== null;
    },
  };
}
