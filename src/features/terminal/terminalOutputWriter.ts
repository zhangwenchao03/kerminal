interface TerminalOutputSink {
  write(data: string): void;
}

export interface TerminalOutputScheduler {
  cancel(handle: number): void;
  request(callback: () => void): number;
}

interface TerminalOutputWriterOptions {
  maxCharsPerFlush?: number;
  scheduler?: TerminalOutputScheduler;
}

export interface TerminalOutputWriter {
  dispose(): void;
  flush(): void;
  pendingLength(): number;
  write(data: string): void;
  writeNow(data: string): void;
}

const DEFAULT_MAX_CHARS_PER_FLUSH = 64 * 1024;
const FRAME_FALLBACK_MS = 16;

export function createTerminalOutputWriter(
  terminal: TerminalOutputSink,
  options: TerminalOutputWriterOptions = {},
): TerminalOutputWriter {
  const scheduler = options.scheduler ?? browserFrameScheduler;
  const maxCharsPerFlush = Math.max(
    1,
    options.maxCharsPerFlush ?? DEFAULT_MAX_CHARS_PER_FLUSH,
  );
  const chunks: string[] = [];
  let chunkHead = 0;
  let disposed = false;
  let pendingChars = 0;
  let scheduledHandle: number | null = null;

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

  function flushFrame() {
    scheduledHandle = null;
    if (disposed) {
      return;
    }

    const batch = takeBatch(maxCharsPerFlush);
    if (batch) {
      terminal.write(batch);
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
    terminal.write(batch);
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
        terminal.write(data);
      }
    },
  };
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
