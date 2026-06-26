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
const activeOutputHistoryBuffers = new Set<TerminalOutputHistoryBuffer>();

const globalTimer: TerminalOutputHistoryTimer = {
  clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

interface TerminalOutputHistoryBuffer {
  append(data: string): void;
  dispose(): void;
  flush(): void;
  pendingFlush(): boolean;
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
  onOutputHistoryChangeRef,
  outputHistoryRef,
  timer = globalTimer,
}: TerminalOutputHistoryBufferOptions): TerminalOutputHistoryBuffer {
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

  const buffer: TerminalOutputHistoryBuffer = {
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
      activeOutputHistoryBuffers.delete(buffer);
    },
    flush,
    pendingFlush() {
      return flushTimer !== null;
    },
  };

  activeOutputHistoryBuffers.add(buffer);
  return buffer;
}
