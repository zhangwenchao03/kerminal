import { describe, expect, it, vi } from "vitest";
import {
  createTerminalOutputWriter,
  type TerminalOutputScheduler,
} from "./terminalOutputWriter";

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

    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("hello from pty");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
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

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("fghij");
    expect(writer.pendingLength()).toBe(2);

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("kl");
    expect(writer.pendingLength()).toBe(0);
    expect(terminal.write).toHaveBeenCalledTimes(3);
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
});
