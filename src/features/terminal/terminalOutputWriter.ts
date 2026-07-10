interface TerminalOutputSink {
  write(data: string): void;
}

export interface TerminalOutputScheduler {
  cancel(handle: number): void;
  request(callback: () => void): number;
}

interface TerminalOutputWriterOptions {
  maxCharsPerFlush?: number;
  now?: () => number;
  onWriteError?: (error: unknown, data: string) => void;
  scheduler?: TerminalOutputScheduler;
  slowFlushMs?: number;
}

export interface TerminalOutputWriterStats {
  flushCount: number;
  lastFlushChars: number;
  lastFlushMs?: number;
  lastSlowFlushAt?: number;
  maxFlushMs: number;
  pendingBytes: number;
  pendingChars: number;
  pendingChunks: number;
  slowFlushCount: number;
  splitFrameCount: number;
  totalFlushChars: number;
  writeErrorCount: number;
  writeNowCount: number;
}

export interface TerminalOutputWriter {
  dispose(): void;
  flush(): void;
  pendingLength(): number;
  stats(): TerminalOutputWriterStats;
  write(data: string): void;
  writeNow(data: string): void;
}

const DEFAULT_MAX_CHARS_PER_FLUSH = 64 * 1024;
const FRAME_FALLBACK_MS = 16;
const DEFAULT_SLOW_FLUSH_MS = 16;

export function createTerminalOutputWriter(
  terminal: TerminalOutputSink,
  options: TerminalOutputWriterOptions = {},
): TerminalOutputWriter {
  const scheduler = options.scheduler ?? browserFrameScheduler;
  const now = options.now ?? nowMs;
  const slowFlushMs = Math.max(
    0,
    options.slowFlushMs ?? DEFAULT_SLOW_FLUSH_MS,
  );
  const maxCharsPerFlush = Math.max(
    1,
    options.maxCharsPerFlush ?? DEFAULT_MAX_CHARS_PER_FLUSH,
  );
  const chunks: string[] = [];
  let chunkHead = 0;
  let disposed = false;
  let pendingChars = 0;
  let scheduledHandle: number | null = null;
  const flushStats = {
    flushCount: 0,
    lastFlushChars: 0,
    lastFlushMs: undefined as number | undefined,
    lastSlowFlushAt: undefined as number | undefined,
    maxFlushMs: 0,
    slowFlushCount: 0,
    splitFrameCount: 0,
    totalFlushChars: 0,
    writeErrorCount: 0,
    writeNowCount: 0,
  };

  const cancelScheduledFlush = () => {
    if (scheduledHandle === null) {
      return;
    }
    scheduler.cancel(scheduledHandle);
    scheduledHandle = null;
  };

  const scheduleFlush = () => {
    if (disposed || scheduledHandle !== null || pendingChars === 0) {
      return;
    }
    scheduledHandle = scheduler.request(flushFrame);
  };

  const takeBatch = (maxChars: number) => {
    let remaining = maxChars;
    let batch = "";

    while (chunkHead < chunks.length && remaining > 0) {
      const current = chunks[chunkHead];
      if (current.length <= remaining) {
        batch += current;
        chunkHead += 1;
        pendingChars -= current.length;
        remaining -= current.length;
        continue;
      }

      const splitRemaining = remaining;
      const splitAt = safeSplitIndex(current, splitRemaining);
      batch += current.slice(0, splitAt);
      chunks[chunkHead] = current.slice(splitAt);
      pendingChars -= splitAt;
      remaining -= splitAt;
      if (splitAt < current.length) {
        flushStats.splitFrameCount += 1;
      }
      if (splitAt < splitRemaining) {
        break;
      }
    }

    compactQueue();
    return batch;
  };

  const compactQueue = () => {
    if (chunkHead === 0) {
      return;
    }
    if (chunkHead >= chunks.length) {
      chunks.length = 0;
      chunkHead = 0;
      return;
    }
    if (chunkHead >= 1024 && chunkHead * 2 >= chunks.length) {
      chunks.splice(0, chunkHead);
      chunkHead = 0;
    }
  };

  const clearQueue = () => {
    chunks.length = 0;
    chunkHead = 0;
    pendingChars = 0;
  };

  const pendingChunkCount = () => Math.max(0, chunks.length - chunkHead);

  const recordTerminalWrite = (batch: string) => {
    const start = now();
    try {
      terminal.write(batch);
    } catch (error: unknown) {
      // 终端输出可能包含二进制垃圾或坏控制序列；渲染失败不能反向断开会话。
      flushStats.writeErrorCount += 1;
      options.onWriteError?.(error, batch);
      return;
    }
    const durationMs = Math.max(0, now() - start);
    flushStats.flushCount += 1;
    flushStats.lastFlushChars = batch.length;
    flushStats.lastFlushMs = durationMs;
    flushStats.maxFlushMs = Math.max(flushStats.maxFlushMs, durationMs);
    flushStats.totalFlushChars += batch.length;
    if (durationMs >= slowFlushMs) {
      flushStats.slowFlushCount += 1;
      flushStats.lastSlowFlushAt = start + durationMs;
    }
  };

  function flushFrame() {
    scheduledHandle = null;
    if (disposed) {
      return;
    }

    const batch = takeBatch(maxCharsPerFlush);
    if (batch) {
      recordTerminalWrite(batch);
    }
    scheduleFlush();
  }

  const flush = () => {
    if (disposed || pendingChars === 0) {
      cancelScheduledFlush();
      return;
    }

    cancelScheduledFlush();
    const batch = chunks.slice(chunkHead).join("");
    clearQueue();
    recordTerminalWrite(batch);
  };

  return {
    dispose() {
      disposed = true;
      cancelScheduledFlush();
      clearQueue();
    },
    flush,
    pendingLength() {
      return pendingChars;
    },
    stats() {
      const snapshot: TerminalOutputWriterStats = {
        flushCount: flushStats.flushCount,
        lastFlushChars: flushStats.lastFlushChars,
        maxFlushMs: flushStats.maxFlushMs,
        pendingBytes: pendingChars,
        pendingChars,
        pendingChunks: pendingChunkCount(),
        slowFlushCount: flushStats.slowFlushCount,
        splitFrameCount: flushStats.splitFrameCount,
        totalFlushChars: flushStats.totalFlushChars,
        writeErrorCount: flushStats.writeErrorCount,
        writeNowCount: flushStats.writeNowCount,
      };
      if (flushStats.lastFlushMs !== undefined) {
        snapshot.lastFlushMs = flushStats.lastFlushMs;
      }
      if (flushStats.lastSlowFlushAt !== undefined) {
        snapshot.lastSlowFlushAt = flushStats.lastSlowFlushAt;
      }
      return snapshot;
    },
    write(data: string) {
      if (disposed || !data) {
        return;
      }
      chunks.push(data);
      pendingChars += data.length;
      scheduleFlush();
    },
    writeNow(data: string) {
      if (disposed) {
        return;
      }
      flush();
      if (data) {
        flushStats.writeNowCount += 1;
        recordTerminalWrite(data);
      }
    },
  };
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

function safeSplitIndex(text: string, maxChars: number) {
  const capped = Math.min(text.length, maxChars);
  if (capped <= 0) {
    return 0;
  }

  const previousCodeUnit = text.charCodeAt(capped - 1);
  const nextCodeUnit = text.charCodeAt(capped);
  const splitAfterHighSurrogate =
    previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff;
  const splitBeforeLowSurrogate =
    nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
  if (
    capped > 1 &&
    capped < text.length &&
    (splitAfterHighSurrogate || splitBeforeLowSurrogate)
  ) {
    return capped - 1;
  }
  return capped;
}

const browserFrameScheduler: TerminalOutputScheduler = {
  cancel(handle) {
    if (canUseAnimationFrame()) {
      window.cancelAnimationFrame(handle);
      return;
    }
    window.clearTimeout(handle);
  },
  request(callback) {
    if (canUseAnimationFrame()) {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(callback, FRAME_FALLBACK_MS);
  },
};

function canUseAnimationFrame() {
  return (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    typeof window.cancelAnimationFrame === "function"
  );
}
