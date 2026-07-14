import { describe, expect, it, vi } from "vitest";
import {
  createTerminalSessionStatusPollController,
  type TerminalSessionStatusPollContext,
  type TerminalSessionStatusPollTimer,
} from "../../../../src/features/terminal/terminalSessionStatusPollController";

function createManualTimer() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const timer: TerminalSessionStatusPollTimer = {
    clear: vi.fn((timerId) => {
      callbacks.delete(timerId);
    }),
    schedule: vi.fn((callback) => {
      const timerId = nextId++;
      callbacks.set(timerId, callback);
      return timerId;
    }),
  };
  return {
    fire() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback();
      }
    },
    pendingCount: () => callbacks.size,
    timer,
  };
}

const context: TerminalSessionStatusPollContext = {
  currentRun: 3,
  sessionId: "session-1",
  sessionStartedAtMs: 1_000,
};

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminalSessionStatusPollController", () => {
  it("reschedules an active current session", async () => {
    const timer = createManualTimer();
    const controller = createTerminalSessionStatusPollController({
      intervalMs: 10,
      isCurrent: () => true,
      listSessions: async () => [
        {
          cols: 80,
          cwd: "/tmp",
          id: context.sessionId,
          rows: 24,
          shell: "pwsh",
          shellIntegration: { status: "disabled" },
          status: "running",
        },
      ],
      onSessionClosed: vi.fn(),
      timer: timer.timer,
    });

    controller.schedule(context);
    timer.fire();
    await flushPromises();

    expect(timer.pendingCount()).toBe(1);
    expect(timer.timer.schedule).toHaveBeenLastCalledWith(
      expect.any(Function),
      10,
    );
  });

  it("reports an exited session with the established recovery message", async () => {
    const timer = createManualTimer();
    const onSessionClosed = vi.fn();
    const controller = createTerminalSessionStatusPollController({
      isCurrent: () => true,
      listSessions: async () => [],
      onSessionClosed,
      timer: timer.timer,
    });

    controller.schedule(context);
    timer.fire();
    await flushPromises();

    expect(onSessionClosed).toHaveBeenCalledWith(
      context,
      "\r\n会话已退出，可通过右键菜单重新连接。\r\n",
    );
    expect(timer.pendingCount()).toBe(0);
  });

  it("does not query or reschedule a stale generation", async () => {
    const timer = createManualTimer();
    const listSessions = vi.fn(async () => []);
    const controller = createTerminalSessionStatusPollController({
      isCurrent: () => false,
      listSessions,
      onSessionClosed: vi.fn(),
      timer: timer.timer,
    });

    controller.schedule(context);
    timer.fire();
    await flushPromises();

    expect(listSessions).not.toHaveBeenCalled();
    expect(timer.pendingCount()).toBe(0);
  });
});
