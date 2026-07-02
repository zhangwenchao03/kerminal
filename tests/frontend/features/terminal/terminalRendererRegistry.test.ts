import { describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererRegistry,
  type TerminalRendererControllerState,
  type TerminalRendererRegistryController,
} from "../../../../src/features/terminal/terminalRendererRegistry";

class FakeRendererController implements TerminalRendererRegistryController {
  attach = vi.fn(() => {
    if (this.mode !== "cpu") {
      this.backend = "gpu";
      this.canvasCount = 1;
    }
  });
  clearTextureAtlas = vi.fn();
  dispose = vi.fn();
  updateMode = vi.fn((mode) => {
    this.mode = mode;
    if (mode === "cpu") {
      this.backend = "cpu";
      this.canvasCount = 0;
    }
  });

  private backend: "cpu" | "gpu";
  private canvasCount: number;
  private mode: "auto" | "cpu" | "gpu";

  constructor(
    state: Partial<TerminalRendererControllerState> = {},
  ) {
    this.backend = state.backend ?? "cpu";
    this.canvasCount = state.canvasCount ?? 0;
    this.mode = state.mode ?? "auto";
  }

  getState(): TerminalRendererControllerState {
    return {
      backend: this.backend,
      canvasCount: this.canvasCount,
      mode: this.mode,
    };
  }
}

describe("terminalRendererRegistry", () => {
  it("registers panes and applies the WebGL budget by focused priority", () => {
    let now = 1_000;
    const registry = createTerminalRendererRegistry({
      config: { maxActiveGpuPanes: 1 },
      now: () => now,
      rendererType: "auto",
    });
    const first = new FakeRendererController();
    const focused = new FakeRendererController();

    registry.registerPane({ controller: first, paneId: "first" });
    now += 1;
    registry.registerPane({
      controller: focused,
      focused: true,
      paneId: "focused",
    });

    expect(focused.attach).toHaveBeenCalled();
    expect(first.updateMode).toHaveBeenLastCalledWith("cpu");
    expect(registry.getSnapshot()).toEqual(
      expect.objectContaining({
        activeControllers: 2,
        effectiveGpuPanes: 1,
      }),
    );
    expect(registry.getSnapshot().panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backend: "gpu", paneId: "focused" }),
        expect.objectContaining({ backend: "cpu", paneId: "first" }),
      ]),
    );
  });

  it("enters global CPU fallback after repeated auto load failures", () => {
    let now = 10_000;
    const registry = createTerminalRendererRegistry({
      now: () => now,
      rendererType: "auto",
    });
    const controllers = ["a", "b", "c"].map(() => new FakeRendererController());

    controllers.forEach((controller, index) => {
      registry.registerPane({ controller, paneId: `pane-${index}` });
    });
    controllers.forEach((_, index) => {
      now += 1_000;
      registry.recordPaneFailure(`pane-${index}`, "load-failed");
    });

    expect(registry.getSnapshot().suggestedFallback).toBe("cpu");
    for (const controller of controllers) {
      expect(controller.updateMode).toHaveBeenLastCalledWith("cpu");
    }
  });

  it("schedules and cancels hidden pane reapers", () => {
    const cancelTimer = vi.fn();
    const callbacks: Array<() => void> = [];
    let now = 20_000;
    const registry = createTerminalRendererRegistry({
      cancelTimer,
      now: () => now,
      rendererType: "auto",
      scheduleTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });
    const controller = new FakeRendererController({
      backend: "gpu",
      canvasCount: 1,
    });

    const unregister = registry.registerPane({ controller, paneId: "pane-1" });
    registry.updatePaneVisibility("pane-1", false);

    expect(callbacks).toHaveLength(1);
    expect(registry.getSnapshot().hiddenControllers).toBe(1);

    unregister();

    expect(cancelTimer).toHaveBeenCalledWith(1);
    expect(controller.dispose).toHaveBeenCalled();
    expect(registry.getSnapshot().activeControllers).toBe(0);
  });

  it("reconciles a hidden pane to CPU when its reaper fires", () => {
    let now = 30_000;
    const callbacks: Array<() => void> = [];
    const registry = createTerminalRendererRegistry({
      config: { webglReapGraceMs: 30_000 },
      now: () => now,
      rendererType: "auto",
      scheduleTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });
    const controller = new FakeRendererController({
      backend: "gpu",
      canvasCount: 1,
    });

    registry.registerPane({ controller, paneId: "pane-1" });
    registry.updatePaneVisibility("pane-1", false);
    now += 30_000;
    callbacks[0]();

    expect(controller.updateMode).toHaveBeenLastCalledWith("cpu");
    expect(registry.getSnapshot().panes[0]).toEqual(
      expect.objectContaining({
        backend: "cpu",
        paneId: "pane-1",
        visible: false,
      }),
    );
  });

  it("clears texture atlases through registered controllers", () => {
    const registry = createTerminalRendererRegistry({ rendererType: "auto" });
    const first = new FakeRendererController();
    const second = new FakeRendererController();

    registry.registerPane({ controller: first, paneId: "first" });
    registry.registerPane({ controller: second, paneId: "second" });

    registry.clearTextureAtlas("second");

    expect(first.clearTextureAtlas).not.toHaveBeenCalled();
    expect(second.clearTextureAtlas).toHaveBeenCalled();
  });

  it("disposes every controller and clears timers on registry dispose", () => {
    const cancelTimer = vi.fn();
    const registry = createTerminalRendererRegistry({
      cancelTimer,
      rendererType: "auto",
      scheduleTimer: (callback) => {
        void callback;
        return 42;
      },
    });
    const controller = new FakeRendererController({ backend: "gpu" });

    registry.registerPane({
      controller,
      paneId: "pane-1",
      visible: false,
    });
    registry.dispose();

    expect(cancelTimer).toHaveBeenCalledWith(42);
    expect(controller.dispose).toHaveBeenCalled();
    expect(registry.getSnapshot().activeControllers).toBe(0);
  });
});
