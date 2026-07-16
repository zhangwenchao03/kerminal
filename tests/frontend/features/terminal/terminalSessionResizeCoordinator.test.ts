import { describe, expect, it, vi } from "vitest";
import { createTerminalSessionResizeCoordinator } from "../../../../src/features/terminal/terminalSessionResizeCoordinator";

describe("terminalSessionResizeCoordinator", () => {
  it("acknowledges only successful resize and retries a transient failure", async () => {
    const scheduler = createManualScheduler();
    const resize = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(undefined);
    const coordinator = createTerminalSessionResizeCoordinator({
      resize,
      retryBaseDelayMs: 10,
      scheduler: scheduler.scheduler,
    });
    coordinator.bindSession("session-1", { cols: 100, rows: 30 });

    coordinator.request({ cols: 120, rows: 40 });
    await flushPromises();
    expect(resize).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runNext();
    await flushPromises();
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenLastCalledWith("session-1", {
      cols: 120,
      rows: 40,
    });

    coordinator.request({ cols: 120, rows: 40 });
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("keeps only the latest dimensions while one resize is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const resize = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const coordinator = createTerminalSessionResizeCoordinator({ resize });
    coordinator.bindSession("session-1", { cols: 100, rows: 30 });

    coordinator.request({ cols: 110, rows: 35 });
    coordinator.request({ cols: 120, rows: 40 });
    coordinator.request({ cols: 130, rows: 45 });
    expect(resize).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await flushPromises();

    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenLastCalledWith("session-1", {
      cols: 130,
      rows: 45,
    });
  });

  it("ignores a stale resize completion after the session changes", async () => {
    let resolveOld: (() => void) | undefined;
    const resize = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const coordinator = createTerminalSessionResizeCoordinator({ resize });
    coordinator.bindSession("old", { cols: 80, rows: 24 });
    coordinator.request({ cols: 90, rows: 28 });

    coordinator.bindSession("new", { cols: 100, rows: 30 });
    coordinator.request({ cols: 120, rows: 40 });
    resolveOld?.();
    await flushPromises();

    expect(resize).toHaveBeenLastCalledWith("new", {
      cols: 120,
      rows: 40,
    });
  });
});

function createManualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  return {
    pendingCount: () => callbacks.size,
    runNext() {
      const entry = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!entry) {
        return;
      }
      callbacks.delete(entry[0]);
      entry[1]();
    },
    scheduler: {
      cancel: vi.fn((handle: number) => callbacks.delete(handle)),
      schedule: vi.fn((callback: () => void) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      }),
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
