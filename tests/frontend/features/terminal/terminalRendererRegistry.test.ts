import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererController,
  type TerminalRendererTerminal,
} from "../../../../src/features/terminal/terminalRenderer";
import {
  createTerminalRendererRegistry,
  type TerminalRendererControllerState,
  type TerminalRendererRegistryController,
} from "../../../../src/features/terminal/terminalRendererRegistry";

class FakeRendererController implements TerminalRendererRegistryController {
  attach = vi.fn(() => {
    if (this.mode !== "cpu" && this.completeAttachImmediately) {
      this.backend = "gpu";
      this.canvasCount = 1;
    }
  });
  clearTextureAtlas = vi.fn();
  canAttemptGpu = vi.fn(() => true);
  dispose = vi.fn();
  retryGpu = vi.fn(() => this.attach());
  updateMode = vi.fn((mode) => {
    const previousMode = this.mode;
    this.mode = mode;
    if (mode === "cpu") {
      this.backend = "cpu";
      this.canvasCount = 0;
    } else if (previousMode !== mode) {
      this.attach();
    }
  });

  private backend: "cpu" | "gpu";
  private canvasCount: number;
  private readonly completeAttachImmediately: boolean;
  private mode: "auto" | "cpu" | "gpu";

  constructor(
    state: Partial<TerminalRendererControllerState> = {},
    options: { completeAttachImmediately?: boolean } = {},
  ) {
    this.backend = state.backend ?? "cpu";
    this.canvasCount = state.canvasCount ?? 0;
    this.completeAttachImmediately = options.completeAttachImmediately ?? true;
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
  it("keeps the existing visible GPU owner when a new pane receives focus", () => {
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

    expect(first.attach).toHaveBeenCalledTimes(1);
    expect(first.updateMode).not.toHaveBeenCalledWith("cpu");
    expect(focused.attach).not.toHaveBeenCalled();
    expect(registry.getSnapshot()).toEqual(
      expect.objectContaining({
        activeControllers: 2,
        effectiveGpuPanes: 1,
      }),
    );
    expect(registry.getSnapshot().panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: "gpu",
          gpuOwnerSince: 1_000,
          paneId: "first",
        }),
        expect.objectContaining({
          backend: "cpu",
          gpuOwnerSince: undefined,
          paneId: "focused",
        }),
      ]),
    );
  });

  it("does not reserve a pending GPU lease when lifecycle is disabled", () => {
    const registry = createTerminalRendererRegistry({ rendererType: "auto" });
    const controller = new FakeRendererController();
    controller.canAttemptGpu.mockReturnValue(false);

    registry.registerPane({
      controller,
      paneId: "lifecycle-disabled",
    });

    expect(controller.attach).not.toHaveBeenCalled();
    expect(registry.getSnapshot().panes[0]).toEqual(
      expect.objectContaining({
        backend: "cpu",
        gpuAttachPending: false,
        gpuOwnerSince: undefined,
      }),
    );
  });

  it("does not repeat a pending attach during focus churn", () => {
    let now = 2_000;
    const registry = createTerminalRendererRegistry({
      config: { maxActiveGpuPanes: 1 },
      now: () => now,
      rendererType: "auto",
    });
    const pending = new FakeRendererController(
      {},
      { completeAttachImmediately: false },
    );
    const newcomer = new FakeRendererController();

    registry.registerPane({ controller: pending, paneId: "pending" });
    now += 1;
    registry.registerPane({
      controller: newcomer,
      focused: true,
      paneId: "newcomer",
    });

    for (let index = 0; index < 4; index += 1) {
      now += 1;
      registry.updatePaneFocus("newcomer", index % 2 === 0);
      registry.updatePaneFocus("pending", index % 2 !== 0);
      registry.reconcile();
    }

    expect(pending.attach).toHaveBeenCalledTimes(1);
    expect(newcomer.attach).not.toHaveBeenCalled();
    expect(registry.getSnapshot().panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: "cpu",
          gpuAttachPending: true,
          gpuOwnerSince: 2_000,
          paneId: "pending",
        }),
        expect.objectContaining({
          backend: "cpu",
          gpuOwnerSince: undefined,
          paneId: "newcomer",
        }),
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
        gpuAttachPending: false,
        gpuOwnerSince: undefined,
        paneId: "pane-1",
        visible: false,
      }),
    );
  });

  it("assigns a released GPU lease after unmount", () => {
    const registry = createTerminalRendererRegistry({
      config: { maxActiveGpuPanes: 1 },
      rendererType: "auto",
    });
    const owner = new FakeRendererController();
    const waiting = new FakeRendererController();

    const unregisterOwner = registry.registerPane({
      controller: owner,
      paneId: "owner",
    });
    registry.registerPane({
      controller: waiting,
      focused: true,
      paneId: "waiting",
    });

    expect(waiting.attach).not.toHaveBeenCalled();

    unregisterOwner();

    expect(owner.dispose).toHaveBeenCalledTimes(1);
    expect(waiting.attach).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().panes).toEqual([
      expect.objectContaining({
        backend: "gpu",
        paneId: "waiting",
      }),
    ]);
  });

  it("assigns a released GPU lease after owner failure", () => {
    const registry = createTerminalRendererRegistry({
      config: {
        autoFailureCooldownMs: 60_000,
        maxActiveGpuPanes: 1,
      },
      now: () => 35_000,
      rendererType: "auto",
    });
    const owner = new FakeRendererController();
    const waiting = new FakeRendererController();

    registry.registerPane({ controller: owner, paneId: "owner" });
    registry.registerPane({
      controller: waiting,
      focused: true,
      paneId: "waiting",
    });

    registry.recordPaneFailure("owner", "load-failed");

    expect(owner.updateMode).toHaveBeenLastCalledWith("cpu");
    expect(waiting.attach).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backend: "cpu",
          gpuOwnerSince: undefined,
          paneId: "owner",
        }),
        expect.objectContaining({
          backend: "gpu",
          paneId: "waiting",
        }),
      ]),
    );
  });

  it("clears cooldown and restores the requested mode for one failed pane", () => {
    const registry = createTerminalRendererRegistry({ rendererType: "auto" });
    const first = new FakeRendererController();
    const second = new FakeRendererController();

    registry.registerPane({ controller: first, paneId: "first" });
    registry.registerPane({ controller: second, paneId: "second" });
    registry.recordPaneFailure("second", "load-failed");
    expect(second.getState().mode).toBe("cpu");
    first.attach.mockClear();
    first.updateMode.mockClear();
    second.attach.mockClear();
    second.updateMode.mockClear();

    registry.retryGpu("second");

    expect(first.attach).not.toHaveBeenCalled();
    expect(first.updateMode).not.toHaveBeenCalled();
    expect(second.updateMode).toHaveBeenCalledWith("auto");
    expect(second.attach).toHaveBeenCalledTimes(1);
    expect(second.getState()).toEqual(
      expect.objectContaining({ backend: "gpu", mode: "auto" }),
    );
    expect(
      registry
        .getSnapshot()
        .panes.find((pane) => pane.paneId === "second")?.fallbackReason,
    ).toBeUndefined();
  });

  it("falls back to attach when a controller has no dedicated retry API", () => {
    const registry = createTerminalRendererRegistry({ rendererType: "auto" });
    let backend: "cpu" | "gpu" = "cpu";
    const attach = vi.fn(() => {
      backend = "gpu";
    });
    registry.registerPane({
      controller: {
        attach,
        canAttemptGpu: () => true,
        dispose: vi.fn(),
        getState: () => ({
          backend,
          mode: "auto",
        }),
        updateMode: vi.fn(),
      },
      paneId: "legacy-retry",
    });
    backend = "cpu";
    attach.mockClear();
    registry.recordPaneFailure("legacy-retry", "load-failed");

    registry.retryGpu("legacy-retry");

    expect(attach).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().panes[0]).toEqual(
      expect.objectContaining({
        backend: "gpu",
        gpuAttachPending: false,
      }),
    );
  });

  it("retries a real controller after registry fallback changed it to CPU", async () => {
    const terminal = new RegistryIntegrationTerminal();
    const registry = createTerminalRendererRegistry({
      rendererType: "auto",
    });
    const controller = createTerminalRendererController({
      loadWebglAddon: async () => ({
        WebglAddon: RegistryIntegrationWebglAddon,
      }),
      onStateChange: (state) =>
        registry.updatePaneState("real-retry", state),
      paneId: "real-retry",
      rendererType: "auto",
      terminal,
    });
    const unregister = registry.registerPane({
      controller,
      paneId: "real-retry",
    });
    await flushPromises();
    expect(controller.getState().backend).toBe("gpu");

    registry.recordPaneFailure("real-retry", "load-failed");
    expect(controller.getState().mode).toBe("cpu");

    registry.retryGpu("real-retry");
    await flushPromises();

    expect(controller.getState()).toEqual(
      expect.objectContaining({ backend: "gpu", mode: "auto" }),
    );
    unregister();
  });

  it("clears only the requested pane texture atlas", () => {
    const registry = createTerminalRendererRegistry({ rendererType: "auto" });
    const first = new FakeRendererController();
    const second = new FakeRendererController();

    registry.registerPane({ controller: first, paneId: "first" });
    registry.registerPane({ controller: second, paneId: "second" });

    registry.clearTextureAtlas("second");

    expect(first.clearTextureAtlas).not.toHaveBeenCalled();
    expect(second.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toEqual(
      expect.objectContaining({
        atlasEpoch: 1,
        recoveryCount: 1,
      }),
    );
    expect(registry.getSnapshot().panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paneId: "first", recoveryCount: 0 }),
        expect.objectContaining({ paneId: "second", recoveryCount: 1 }),
      ]),
    );
  });

  it("keeps the no-argument global texture atlas clear API", () => {
    const registry = createTerminalRendererRegistry({ rendererType: "auto" });
    const first = new FakeRendererController();
    const second = new FakeRendererController();

    registry.registerPane({ controller: first, paneId: "first" });
    registry.registerPane({ controller: second, paneId: "second" });

    registry.clearTextureAtlas();

    expect(first.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(second.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paneId: "first", recoveryCount: 1 }),
        expect.objectContaining({ paneId: "second", recoveryCount: 1 }),
      ]),
    );
  });

  it("records atlas clear failures and lets the recovery coordinator fall back", () => {
    let now = 40_000;
    const registry = createTerminalRendererRegistry({
      config: { autoFailureCooldownMs: 60_000 },
      now: () => now,
      rendererType: "gpu",
    });
    const first = new FakeRendererController();
    const second = new FakeRendererController();
    second.clearTextureAtlas.mockImplementation(() => {
      throw new Error("atlas failed");
    });

    registry.registerPane({ controller: first, paneId: "first" });
    registry.registerPane({ controller: second, paneId: "second" });

    expect(() => registry.clearTextureAtlas("second")).toThrow("atlas failed");
    const failedPane = registry
      .getSnapshot()
      .panes.find((pane) => pane.paneId === "second");

    expect(failedPane).toEqual(
      expect.objectContaining({
        backend: "cpu",
        failureCount: 1,
        fallbackReason: "atlas-clear-failed",
        gpuAttachPending: false,
        gpuOwnerSince: undefined,
      }),
    );
    expect(second.updateMode).toHaveBeenLastCalledWith("cpu");
    expect(first.clearTextureAtlas).not.toHaveBeenCalled();
    expect(first.updateMode).not.toHaveBeenCalledWith("cpu");
    expect(
      registry.getSnapshot().panes.find((pane) => pane.paneId === "first"),
    ).toEqual(
      expect.objectContaining({
        backend: "gpu",
        failureCount: 0,
      }),
    );

    now += 30_000;
    registry.reconcile();

    expect(second.updateMode).toHaveBeenLastCalledWith("cpu");
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

class RegistryIntegrationTerminal implements TerminalRendererTerminal {
  element: HTMLElement | null = document.createElement("div");
  rows = 24;

  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this as unknown as Terminal);
  }
}

class RegistryIntegrationWebglAddon implements ITerminalAddon {
  private canvas: HTMLCanvasElement | null = null;

  activate(terminal: Terminal): void {
    this.canvas = document.createElement("canvas");
    terminal.element?.append(this.canvas);
  }

  dispose(): void {
    this.canvas?.remove();
    this.canvas = null;
  }

  onContextLoss(): IDisposable {
    return { dispose: () => undefined };
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
