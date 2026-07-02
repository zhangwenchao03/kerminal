import { describe, expect, it, vi } from "vitest";
import {
  runTerminalPaneVisibleRecovery,
  scheduleTerminalPaneVisibleRecovery,
  type TerminalPaneVisibleRecoveryScheduler,
} from "../../../../src/features/terminal/terminalPaneVisibleRecovery";
import type { TerminalPaneRuntimeLifecycleDecision } from "../../../../src/features/terminal/terminalPaneRuntimeLifecycle";

describe("terminalPaneVisibleRecovery", () => {
  it("cancels hidden resource reapers before scheduling a double RAF recovery", () => {
    const events: string[] = [];
    const scheduler = createManualFrameScheduler(events);
    const terminal = createTerminal(events);
    const fitAddon = { fit: vi.fn(() => events.push("fit")) };

    scheduleTerminalPaneVisibleRecovery({
      cancelHiddenResourceReaper: () => events.push("cancel-reaper"),
      fitAddon: () => fitAddon,
      scheduler,
      terminal: () => terminal,
    });

    expect(events).toEqual(["cancel-reaper", "schedule-frame-1"]);

    scheduler.runFrame(1);
    expect(events).toEqual([
      "cancel-reaper",
      "schedule-frame-1",
      "run-frame-1",
      "schedule-frame-2",
    ]);

    scheduler.runFrame(2);
    expect(events).toEqual([
      "cancel-reaper",
      "schedule-frame-1",
      "run-frame-1",
      "schedule-frame-2",
      "run-frame-2",
      "fit",
      "refresh:0:23",
    ]);
  });

  it("cancels both pending frames without running recovery", () => {
    const events: string[] = [];
    const scheduler = createManualFrameScheduler(events);
    const terminal = createTerminal();
    const fitAddon = { fit: vi.fn(() => events.push("fit")) };

    const cancel = scheduleTerminalPaneVisibleRecovery({
      fitAddon: () => fitAddon,
      scheduler,
      terminal: () => terminal,
    });
    scheduler.runFrame(1);
    cancel();
    scheduler.runFrame(2);

    expect(events).toEqual([
      "schedule-frame-1",
      "run-frame-1",
      "schedule-frame-2",
      "cancel-frame-2",
    ]);
    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(terminal.refresh).not.toHaveBeenCalled();
  });

  it("does not refresh or mark recovery complete when the terminal is missing", () => {
    const fitAddon = { fit: vi.fn() };
    const markVisibleRecoveryComplete = vi.fn();

    const result = runTerminalPaneVisibleRecovery({
      fitAddon: () => fitAddon,
      markVisibleRecoveryComplete,
      terminal: () => null,
    });

    expect(result).toEqual({ dimensionsChanged: false, recovered: false });
    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(markVisibleRecoveryComplete).not.toHaveBeenCalled();
  });

  it("fits, optionally resizes, refreshes, marks lifecycle complete, and restores suggestions", () => {
    const events: string[] = [];
    const terminal = createTerminal(events);
    const decision = {
      shouldRunSuggestionProbe: true,
    } as TerminalPaneRuntimeLifecycleDecision;
    const fitAddon = {
      fit: vi.fn(() => {
        events.push("fit");
        terminal.cols = 100;
        terminal.rows = 30;
      }),
    };
    const resizeTerminal = vi.fn(() => {
      events.push("resize");
      return Promise.resolve();
    });
    const markVisibleRecoveryComplete = vi.fn(() => {
      events.push("complete");
      return decision;
    });
    const onSuggestionsRestored = vi.fn((nextDecision) => {
      events.push(`restore:${String(nextDecision?.shouldRunSuggestionProbe)}`);
    });

    const result = runTerminalPaneVisibleRecovery({
      fitAddon: () => fitAddon,
      markVisibleRecoveryComplete,
      onDimensionsChange: (dimensions) =>
        events.push(`dimensions:${dimensions.cols}x${dimensions.rows}`),
      onSuggestionsRestored,
      resizeTerminal,
      sessionId: () => "session-1",
      terminal: () => terminal,
    });

    expect(result).toEqual({ dimensionsChanged: true, recovered: true });
    expect(resizeTerminal).toHaveBeenCalledWith("session-1", {
      cols: 100,
      rows: 30,
    });
    expect(onSuggestionsRestored).toHaveBeenCalledWith(decision);
    expect(events).toEqual([
      "fit",
      "dimensions:100x30",
      "resize",
      "refresh:0:29",
      "complete",
      "restore:true",
    ]);
  });

  it("skips backend resize when fit keeps dimensions stable", () => {
    const events: string[] = [];
    const terminal = createTerminal(events);
    const resizeTerminal = vi.fn();

    const result = runTerminalPaneVisibleRecovery({
      fitAddon: () => ({ fit: vi.fn(() => events.push("fit")) }),
      resizeTerminal,
      sessionId: () => "session-1",
      terminal: () => terminal,
    });

    expect(result).toEqual({ dimensionsChanged: false, recovered: true });
    expect(resizeTerminal).not.toHaveBeenCalled();
    expect(events).toEqual(["fit", "refresh:0:23"]);
  });
});

function createTerminal(events: string[] = []) {
  return {
    cols: 80,
    refresh: vi.fn((start: number, end: number) =>
      events.push(`refresh:${start}:${end}`),
    ),
    rows: 24,
  };
}

function createManualFrameScheduler(events: string[]) {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const scheduler: TerminalPaneVisibleRecoveryScheduler & {
    runFrame(id: number): void;
  } = {
    cancelFrame: vi.fn((id) => {
      events.push(`cancel-frame-${id}`);
      frames.delete(id);
    }),
    runFrame(id) {
      const callback = frames.get(id);
      if (!callback) {
        return;
      }
      frames.delete(id);
      events.push(`run-frame-${id}`);
      callback(performance.now());
    },
    scheduleFrame: vi.fn((callback) => {
      const id = nextId;
      nextId += 1;
      events.push(`schedule-frame-${id}`);
      frames.set(id, callback);
      return id;
    }),
  };
  return scheduler;
}
