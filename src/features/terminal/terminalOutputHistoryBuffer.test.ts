import { describe, expect, it, vi } from "vitest";
import { TERMINAL_OUTPUT_HISTORY_MAX_CHARS } from "../workspace/workspaceSession";
import {
  createTerminalOutputHistoryBuffer,
  flushPendingTerminalOutputHistoryBuffers,
  type TerminalOutputHistoryTimer,
} from "./terminalOutputHistoryBuffer";

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

    expect(outputHistoryRef.current).toBe("previous hello world");
    expect(onOutputHistoryChange).not.toHaveBeenCalled();
    expect(manual.timer.setTimeout).toHaveBeenCalledTimes(1);
    expect(buffer.pendingFlush()).toBe(true);

    expect(manual.runNext()).toBe(true);

    expect(onOutputHistoryChange).toHaveBeenCalledTimes(1);
    expect(onOutputHistoryChange).toHaveBeenCalledWith("previous hello world");
    expect(buffer.pendingFlush()).toBe(false);
    expect(manual.pendingCount()).toBe(0);
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
