import { describe, expect, it, vi } from "vitest";
import { TERMINAL_OUTPUT_HISTORY_MAX_CHARS } from "../../../../src/features/workspace/workspaceSession";
import {
  createTerminalOutputHistoryBuffer,
  flushPendingTerminalOutputHistoryBuffers,
  type TerminalOutputHistoryTimer,
} from "../../../../src/features/terminal/terminalOutputHistoryBuffer";

function createManualTimer() {
  const callbacks = new Map<
    ReturnType<typeof globalThis.setTimeout>,
    () => void
  >();
  let nextHandle = 1;
  const timer: TerminalOutputHistoryTimer = {
    clearTimeout: vi.fn((timerId) => {
      callbacks.delete(timerId);
    }),
    setTimeout: vi.fn((callback) => {
      const handle =
        nextHandle as unknown as ReturnType<typeof globalThis.setTimeout>;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    }),
  };

  return {
    pendingCount: () => callbacks.size,
    runNext() {
      const next = callbacks.entries().next();
      if (next.done) {
        return false;
      }
      const [handle, callback] = next.value;
      callbacks.delete(handle);
      callback();
      return true;
    },
    timer,
  };
}

describe("terminalOutputHistoryBuffer", () => {
  it("coalesces output history updates until the scheduled flush", () => {
    const manual = createManualTimer();
    const outputHistoryRef = { current: "previous " as string | undefined };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      flushDelayMs: 100,
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("hello");
    buffer.append(" world");

    expect(outputHistoryRef.current).toBe("previous ");
    expect(onOutputHistoryChange).not.toHaveBeenCalled();
    expect(manual.timer.setTimeout).toHaveBeenCalledTimes(1);
    expect(manual.timer.setTimeout).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      100,
    );
    expect(buffer.pendingFlush()).toBe(true);
    expect(buffer.stats()).toMatchObject({
      appendCount: 2,
      appendedChars: "hello world".length,
      pendingFlush: true,
      pendingSnapshotChars: "previous hello world".length,
      scheduledFlushCount: 0,
      storeUpdateCount: 0,
      tailChars: "previous hello world".length,
    });

    expect(manual.runNext()).toBe(true);

    expect(onOutputHistoryChange).toHaveBeenCalledTimes(1);
    expect(onOutputHistoryChange).toHaveBeenCalledWith("previous hello world");
    expect(outputHistoryRef.current).toBe("previous hello world");
    expect(buffer.pendingFlush()).toBe(false);
    expect(manual.pendingCount()).toBe(0);
    expect(buffer.stats()).toMatchObject({
      flushCount: 1,
      pendingFlush: false,
      scheduledFlushCount: 1,
      storeUpdateCount: 1,
    });
  });

  it("records flush duration, slow flushes, and unchanged snapshots", () => {
    let now = 1;
    const manual = createManualTimer();
    const outputHistoryRef = { current: undefined as string | undefined };
    const onOutputHistoryChange = vi.fn(() => {
      now += 20;
    });
    const buffer = createTerminalOutputHistoryBuffer({
      now: () => now,
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      slowFlushMs: 10,
      timer: manual.timer,
    });

    buffer.append("visible output");
    manual.runNext();
    buffer.flush();

    expect(buffer.stats()).toMatchObject({
      flushCount: 2,
      lastFlushMs: 0,
      lastSlowFlushAt: 21,
      manualFlushCount: 1,
      maxFlushMs: 20,
      scheduledFlushCount: 1,
      skippedUnchangedSnapshotCount: 1,
      slowFlushCount: 1,
      storeUpdateCount: 1,
    });
    expect(JSON.stringify(buffer.stats())).not.toContain("visible output");
  });

  it("uses the latest dynamic flush delay for each output batch", () => {
    const manual = createManualTimer();
    let flushDelayMs = 100;
    const outputHistoryRef = { current: undefined as string | undefined };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      flushDelayMs: () => flushDelayMs,
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("visible");
    expect(manual.timer.setTimeout).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      100,
    );
    manual.runNext();

    flushDelayMs = 2_000;
    buffer.append(" hidden");

    expect(manual.timer.setTimeout).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      2_000,
    );
    manual.runNext();
    expect(onOutputHistoryChange).toHaveBeenLastCalledWith("visible hidden");
    expect(outputHistoryRef.current).toBe("visible hidden");
  });

  it("does not schedule a flush for blank output", () => {
    const manual = createManualTimer();
    const outputHistoryRef = { current: "stable" as string | undefined };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("");

    expect(outputHistoryRef.current).toBe("stable");
    expect(manual.timer.setTimeout).not.toHaveBeenCalled();
    expect(onOutputHistoryChange).not.toHaveBeenCalled();
  });

  it("flushes pending history and cancels scheduled work on dispose", () => {
    const manual = createManualTimer();
    const outputHistoryRef = { current: undefined as string | undefined };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("last output");
    buffer.dispose();
    buffer.append(" ignored");
    manual.runNext();

    expect(manual.timer.clearTimeout).toHaveBeenCalledTimes(1);
    expect(onOutputHistoryChange).toHaveBeenCalledTimes(1);
    expect(onOutputHistoryChange).toHaveBeenCalledWith("last output");
    expect(outputHistoryRef.current).toBe("last output");
    expect(buffer.pendingFlush()).toBe(false);
  });

  it("keeps the shared terminal output history size limit", () => {
    const manual = createManualTimer();
    const outputHistoryRef = {
      current: "a".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2),
    };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("bcd");
    manual.runNext();

    expect(outputHistoryRef.current).toHaveLength(
      TERMINAL_OUTPUT_HISTORY_MAX_CHARS,
    );
    expect(outputHistoryRef.current?.endsWith("bcd")).toBe(true);
    expect(onOutputHistoryChange).toHaveBeenCalledWith(
      outputHistoryRef.current,
    );
    expect(buffer.stats()).toMatchObject({
      droppedTailChars: 1,
      truncatedTail: true,
    });
  });

  it("keeps hot output in the runtime buffer until a cold snapshot flush", () => {
    const manual = createManualTimer();
    const outputHistoryRef = { current: "saved " as string | undefined };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      flushDelayMs: 100,
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("chunk-1");
    buffer.append(" chunk-2");

    expect(outputHistoryRef.current).toBe("saved ");
    expect(onOutputHistoryChange).not.toHaveBeenCalled();

    flushPendingTerminalOutputHistoryBuffers();

    expect(outputHistoryRef.current).toBe("saved chunk-1 chunk-2");
    expect(onOutputHistoryChange).toHaveBeenCalledTimes(1);
    expect(onOutputHistoryChange).toHaveBeenCalledWith(
      "saved chunk-1 chunk-2",
    );
    expect(manual.pendingCount()).toBe(0);

    buffer.dispose();
  });

  it("flushes every active pending buffer before workspace session save", () => {
    const manual = createManualTimer();
    const firstHistoryRef = { current: undefined as string | undefined };
    const secondHistoryRef = { current: "stable" as string | undefined };
    const firstOutputHistoryChange = vi.fn();
    const secondOutputHistoryChange = vi.fn();
    const firstBuffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: { current: firstOutputHistoryChange },
      outputHistoryRef: firstHistoryRef,
      timer: manual.timer,
    });
    const secondBuffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: { current: secondOutputHistoryChange },
      outputHistoryRef: secondHistoryRef,
      timer: manual.timer,
    });

    firstBuffer.append("pending output");

    flushPendingTerminalOutputHistoryBuffers();

    expect(firstOutputHistoryChange).toHaveBeenCalledTimes(1);
    expect(firstOutputHistoryChange).toHaveBeenCalledWith("pending output");
    expect(secondOutputHistoryChange).not.toHaveBeenCalled();
    expect(firstBuffer.pendingFlush()).toBe(false);
    expect(manual.pendingCount()).toBe(0);

    firstBuffer.dispose();
    secondBuffer.dispose();
  });

  it("unregisters disposed buffers from the global pending flush", () => {
    const manual = createManualTimer();
    const outputHistoryRef = { current: undefined as string | undefined };
    const onOutputHistoryChange = vi.fn();
    const buffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: { current: onOutputHistoryChange },
      outputHistoryRef,
      timer: manual.timer,
    });

    buffer.append("saved on dispose");
    buffer.dispose();
    onOutputHistoryChange.mockClear();

    flushPendingTerminalOutputHistoryBuffers();

    expect(onOutputHistoryChange).not.toHaveBeenCalled();
  });
});
