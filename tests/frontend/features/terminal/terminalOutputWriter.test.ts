import { describe, expect, it, vi } from "vitest";
import {
  createTerminalOutputWriter,
  type TerminalOutputScheduler,
} from "../../../../src/features/terminal/terminalOutputWriter";

function createManualScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const scheduler: TerminalOutputScheduler = {
    cancel: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
    request: vi.fn((callback: () => void) => {
      const handle = nextHandle;
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
    scheduler,
  };
}

describe("terminalOutputWriter", () => {
  it("coalesces small output chunks into one xterm write per frame", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 100,
      scheduler: manual.scheduler,
    });

    writer.write("hello ");
    writer.write("from ");
    writer.write("pty");

    expect(terminal.write).not.toHaveBeenCalled();
    expect(manual.scheduler.request).toHaveBeenCalledTimes(1);
    expect(writer.pendingLength()).toBe("hello from pty".length);
    expect(writer.stats()).toMatchObject({
      flushCount: 0,
      pendingBytes: "hello from pty".length,
      pendingChars: "hello from pty".length,
      pendingChunks: 3,
    });

    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("hello from pty");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      lastFlushChars: "hello from pty".length,
      pendingBytes: 0,
      pendingChars: 0,
      pendingChunks: 0,
      totalFlushChars: "hello from pty".length,
    });
  });

  it("splits large output across frames", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 5,
      scheduler: manual.scheduler,
    });

    writer.write("abcdefghijkl");

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("abcde");
    expect(writer.pendingLength()).toBe(7);
    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      pendingChunks: 1,
      splitFrameCount: 1,
    });

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("fghij");
    expect(writer.pendingLength()).toBe(2);

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("kl");
    expect(writer.pendingLength()).toBe(0);
    expect(terminal.write).toHaveBeenCalledTimes(3);
  });

  it("records flush duration and slow flush metrics without output text", () => {
    let now = 10;
    const terminal = {
      write: vi.fn(() => {
        now += 12;
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      now: () => now,
      scheduler: manual.scheduler,
      slowFlushMs: 8,
    });

    writer.write("diagnostic output");
    manual.runNext();

    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      lastFlushChars: "diagnostic output".length,
      lastFlushMs: 12,
      lastSlowFlushAt: 22,
      maxFlushMs: 12,
      slowFlushCount: 1,
      totalFlushChars: "diagnostic output".length,
    });
    expect(JSON.stringify(writer.stats())).not.toContain("diagnostic output");
  });

  it("preserves order while draining many queued chunks across frames", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 100,
      scheduler: manual.scheduler,
    });
    const chunks = Array.from({ length: 250 }, (_, index) =>
      `${index.toString().padStart(3, "0")}|`,
    );

    for (const chunk of chunks) {
      writer.write(chunk);
    }

    while (manual.runNext()) {
      // Run all scheduled frames.
    }

    expect(terminal.write.mock.calls.map(([data]) => data).join("")).toBe(
      chunks.join(""),
    );
    expect(terminal.write).toHaveBeenCalledTimes(10);
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
  });

  it("flushes only the pending tail after a frame partially drains chunks", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 5,
      scheduler: manual.scheduler,
    });

    writer.write("ab");
    writer.write("cd");
    writer.write("efgh");

    manual.runNext();
    writer.flush();

    expect(terminal.write).toHaveBeenNthCalledWith(1, "abcde");
    expect(terminal.write).toHaveBeenNthCalledWith(2, "fgh");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
  });

  it("avoids splitting immediately after a high surrogate when batching", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 3,
      scheduler: manual.scheduler,
    });

    writer.write("ab\uD83D\uDE00cd");

    manual.runNext();
    manual.runNext();
    manual.runNext();

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      "ab",
      "\uD83D\uDE00c",
      "d",
    ]);
    expect(writer.pendingLength()).toBe(0);
  });

  it("flushes queued data before immediate status output", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });

    writer.write("queued output");
    writer.writeNow("\r\n会话已结束。\r\n");

    expect(manual.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenNthCalledWith(1, "queued output");
    expect(terminal.write).toHaveBeenNthCalledWith(2, "\r\n会话已结束。\r\n");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
    expect(writer.stats()).toMatchObject({
      flushCount: 2,
      writeNowCount: 1,
    });
  });

  it("drops queued output and cancels scheduled work on dispose", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });

    writer.write("queued output");
    writer.dispose();
    writer.write("late output");
    writer.writeNow("late status");
    manual.runNext();

    expect(manual.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(terminal.write).not.toHaveBeenCalled();
    expect(writer.pendingLength()).toBe(0);
  });

  it("keeps the writer alive when terminal.write rejects a batch synchronously", () => {
    const writeErrors: unknown[] = [];
    const terminal = {
      write: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("terminal write rejected");
        })
        .mockImplementation(() => undefined),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      onWriteError: (error) => writeErrors.push(error),
      scheduler: manual.scheduler,
    });

    writer.write("\u0000\u001b]bad-binary");
    manual.runNext();
    writer.write("after-binary");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(2);
    expect(terminal.write).toHaveBeenNthCalledWith(2, "after-binary");
    expect(writer.pendingLength()).toBe(0);
    expect(writeErrors).toHaveLength(1);
    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      totalFlushChars: "after-binary".length,
      writeErrorCount: 1,
    });
  });
});
