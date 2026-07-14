import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererController,
  type TerminalRendererState,
  type TerminalRendererTerminal,
} from "../../../../src/features/terminal/terminalRenderer";

class FakeTerminal implements TerminalRendererTerminal {
  element: HTMLElement | null = document.createElement("div");
  loadedAddons: ITerminalAddon[] = [];
  refresh = vi.fn();
  rows = 12;

  loadAddon(addon: ITerminalAddon): void {
    this.loadedAddons.push(addon);
    addon.activate(this as unknown as Terminal);
  }
}

class FakeWebglAddon implements ITerminalAddon {
  static instances: FakeWebglAddon[] = [];

  private atlasAddListeners: Array<(canvas: HTMLCanvasElement) => void> = [];
  private atlasChangeListeners: Array<(canvas: HTMLCanvasElement) => void> = [];
  private contextLossListeners: Array<() => void> = [];
  private atlasRemoveListeners: Array<(canvas: HTMLCanvasElement) => void> = [];
  activate = vi.fn();
  clearTextureAtlas = vi.fn();
  dispose = vi.fn();
  textureAtlas = document.createElement("canvas");
  _renderer = {
    _atlas: {},
    _canvas: document.createElement("canvas"),
    _charAtlas: {},
    _gl: {},
  };

  constructor() {
    FakeWebglAddon.instances.push(this);
  }

  onAddTextureAtlasCanvas(listener: (canvas: HTMLCanvasElement) => void) {
    this.atlasAddListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.atlasAddListeners = this.atlasAddListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  onChangeTextureAtlas(listener: (canvas: HTMLCanvasElement) => void) {
    this.atlasChangeListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.atlasChangeListeners = this.atlasChangeListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  onContextLoss(listener: () => void): IDisposable {
    this.contextLossListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.contextLossListeners = this.contextLossListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  onRemoveTextureAtlasCanvas(listener: (canvas: HTMLCanvasElement) => void) {
    this.atlasRemoveListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.atlasRemoveListeners = this.atlasRemoveListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  emitAddTextureAtlasCanvas(canvas: HTMLCanvasElement): void {
    for (const listener of [...this.atlasAddListeners]) {
      listener(canvas);
    }
  }

  emitChangeTextureAtlas(canvas: HTMLCanvasElement): void {
    for (const listener of [...this.atlasChangeListeners]) {
      listener(canvas);
    }
  }

  emitContextLoss(): void {
    for (const listener of [...this.contextLossListeners]) {
      listener();
    }
  }

  emitRemoveTextureAtlasCanvas(canvas: HTMLCanvasElement): void {
    for (const listener of [...this.atlasRemoveListeners]) {
      listener(canvas);
    }
  }
}

class TrackedCanvasWebglAddon implements ITerminalAddon {
  static instances: TrackedCanvasWebglAddon[] = [];

  rendererCanvas = document.createElement("canvas");
  textureAtlas = document.createElement("canvas");
  _renderer = {
    _atlas: {},
    _canvas: this.rendererCanvas,
    _charAtlas: {},
    _gl: {},
  };

  constructor() {
    TrackedCanvasWebglAddon.instances.push(this);
  }

  activate(terminal: Terminal): void {
    terminal.element?.append(this.rendererCanvas, this.textureAtlas);
  }

  dispose(): void {
    this.rendererCanvas.remove();
    this.textureAtlas.remove();
  }

  onContextLoss(): IDisposable {
    return { dispose: vi.fn() };
  }
}

describe("terminalRenderer", () => {
  beforeEach(() => {
    FakeWebglAddon.instances = [];
    TrackedCanvasWebglAddon.instances = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => null,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps CPU mode on the default xterm renderer without loading WebGL", () => {
    const loadWebglAddon = vi.fn();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon,
      paneId: "pane-1",
      rendererType: "cpu",
      terminal,
    });

    controller.attach();

    expect(loadWebglAddon).not.toHaveBeenCalled();
    expect(terminal.loadedAddons).toHaveLength(0);
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "cpu",
    });
  });

  it("keeps Auto on CPU when the platform is definitively software rendered", () => {
    const loadWebglAddon = vi.fn();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      gpuPlatformClass: "software",
      loadWebglAddon,
      paneId: "pane-software-gpu",
      rendererType: "auto",
      shouldUseAutoGpu: () => false,
      terminal,
    });

    controller.attach();
    controller.retryGpu();

    expect(loadWebglAddon).not.toHaveBeenCalled();
    expect(controller.canAttemptGpu()).toBe(false);
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "software-gpu",
      mode: "auto",
    });
    expect(controller.getDiagnostics().gpuPlatformClass).toBe(
      "software",
    );
  });

  it("still honors explicit GPU mode on a software-rendered platform", async () => {
    const loadWebglAddon = vi
      .fn()
      .mockResolvedValue({ WebglAddon: FakeWebglAddon });
    const controller = createTerminalRendererController({
      loadWebglAddon,
      paneId: "pane-forced-software-gpu",
      rendererType: "gpu",
      shouldUseAutoGpu: () => false,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await vi.waitFor(() => {
      expect(controller.getState().backend).toBe("gpu");
    });

    expect(controller.canAttemptGpu()).toBe(true);
    expect(loadWebglAddon).toHaveBeenCalledTimes(1);
  });

  it("clears software fallback before switching Auto to explicit GPU", async () => {
    const states: TerminalRendererState[] = [];
    const controller = createTerminalRendererController({
      loadWebglAddon: async () => ({ WebglAddon: FakeWebglAddon }),
      onStateChange: (state) => states.push(state),
      paneId: "pane-software-auto-to-gpu",
      rendererType: "auto",
      shouldUseAutoGpu: () => false,
      terminal: new FakeTerminal(),
    });

    expect(controller.getState().fallbackReason).toBe("software-gpu");
    controller.updateMode("gpu");
    await vi.waitFor(() => {
      expect(controller.getState().backend).toBe("gpu");
    });

    expect(
      states.some(
        (state) =>
          state.mode === "gpu" && state.fallbackReason === "software-gpu",
      ),
    ).toBe(false);
  });

  it("keeps a stable CPU rollback when lifecycle V2 is disabled", () => {
    const loadWebglAddon = vi.fn();
    const controller = createTerminalRendererController({
      lifecycleV2Enabled: false,
      loadWebglAddon,
      paneId: "pane-1",
      rendererType: "gpu",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    controller.retryGpu();

    expect(loadWebglAddon).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "gpu",
    });
    expect(controller.getDiagnostics().lifecycle.state).toBe("cpu-ready");
  });

  it("attaches the WebGL addon in auto mode", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();

    expect(terminal.loadedAddons).toHaveLength(1);
    expect(FakeWebglAddon.instances[0].activate).toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "gpu",
      canvasCount: 1,
      fallbackReason: undefined,
      mode: "auto",
    });
    expect(terminal.refresh).not.toHaveBeenCalled();
  });

  it("falls back to CPU when the WebGL chunk fails to load", async () => {
    const logger = { warn: vi.fn() };
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockRejectedValue(new Error("chunk failed")),
      logger,
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "import-failed",
      mode: "auto",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("WebGL renderer chunk failed"),
      expect.any(Error),
    );
  });

  it("falls back to CPU when xterm rejects the WebGL addon", async () => {
    const logger = { warn: vi.fn() };
    const terminal = new FakeTerminal();
    terminal.loadAddon = vi.fn(() => {
      throw new Error("load failed");
    });
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      logger,
      paneId: "pane-1",
      rendererType: "gpu",
      terminal,
    });

    controller.attach();
    await flushPromises();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "load-failed",
      mode: "gpu",
    });
    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("WebGL renderer unavailable"),
      expect.any(Error),
    );
  });

  it("disposes WebGL without clearing the atlas shared by sibling panes", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    controller.updateMode("cpu");

    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();
    expect(FakeWebglAddon.instances[0].clearTextureAtlas).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "cpu",
    });
  });

  it("releases a disposed controller without mutating the shared atlas", async () => {
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();
    controller.dispose();

    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(FakeWebglAddon.instances[0].clearTextureAtlas).not.toHaveBeenCalled();
  });

  it("falls back on context loss and retries while GPU remains enabled", async () => {
    const scheduler = new ManualTimerScheduler();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      recoveryJitterRatio: 0,
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      cancelRetry: scheduler.cancel,
      terminal,
    });

    controller.attach();
    await flushPromises();

    FakeWebglAddon.instances[0].emitContextLoss();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "context-lost",
      mode: "auto",
    });
    expect(scheduler.pendingCount()).toBe(1);
    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();

    scheduler.runNext();
    await flushPromises();

    expect(FakeWebglAddon.instances).toHaveLength(2);
    expect(controller.getState()).toEqual({
      backend: "gpu",
      canvasCount: 1,
      fallbackReason: undefined,
      mode: "auto",
    });
  });

  it("tracks texture atlas canvases from WebGL events", async () => {
    const onStateChange = vi.fn();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      onStateChange,
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    const addon = FakeWebglAddon.instances[0];
    const extraCanvas = document.createElement("canvas");
    const changedCanvas = document.createElement("canvas");

    addon.emitAddTextureAtlasCanvas(extraCanvas);
    addon.emitChangeTextureAtlas(changedCanvas);

    expect(controller.getState().canvasCount).toBe(3);

    addon.emitRemoveTextureAtlasCanvas(extraCanvas);

    expect(controller.getState().canvasCount).toBe(2);
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ backend: "gpu", canvasCount: 2 }),
    );
  });

  it("tracks only the primary WebGL canvas for health checks", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({
        WebglAddon: TrackedCanvasWebglAddon,
      }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    const addon = TrackedCanvasWebglAddon.instances[0];

    expect(controller.getState().canvasCount).toBe(2);
    expect(controller.getTrackedRendererCanvases()).toEqual([
      addon.rendererCanvas,
    ]);
    expect(controller.getTrackedRendererCanvases()).not.toContain(
      addon.textureAtlas,
    );
  });

  it("clears the texture atlas without throwing when WebGL is active", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    controller.clearTextureAtlas();

    expect(FakeWebglAddon.instances[0].clearTextureAtlas).toHaveBeenCalled();
    expect(terminal.refresh).toHaveBeenLastCalledWith(0, 11);
  });

  it("surfaces texture atlas clear failures to the recovery coordinator", async () => {
    const logger = { warn: vi.fn() };
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      logger,
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    FakeWebglAddon.instances[0].clearTextureAtlas.mockImplementation(() => {
      throw new Error("atlas failed");
    });

    expect(() => controller.clearTextureAtlas()).toThrow("atlas failed");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("texture atlas clear failed"),
      expect.any(Error),
    );
  });

  it("ignores stale async attach after switching to CPU", async () => {
    let resolveLoad:
      ((value: { WebglAddon: typeof FakeWebglAddon }) => void) | undefined;
    const loadWebglAddon = vi.fn(
      () =>
        new Promise<{ WebglAddon: typeof FakeWebglAddon }>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon,
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    controller.updateMode("cpu");
    resolveLoad?.({ WebglAddon: FakeWebglAddon });
    await flushPromises();

    expect(terminal.loadedAddons).toHaveLength(0);
    expect(FakeWebglAddon.instances).toHaveLength(0);
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "cpu",
    });
    expect(
      controller.getDiagnostics().telemetry.counters.staleCommitRejectedCount,
    ).toBe(1);
  });

  it("rejects duplicate attach while one generation is pending", () => {
    const scheduler = new ManualTimerScheduler();
    const loadWebglAddon = vi.fn(
      () => new Promise<{ WebglAddon: typeof FakeWebglAddon }>(() => undefined),
    );
    const controller = createTerminalRendererController({
      loadWebglAddon,
      paneId: "pane-1",
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      cancelRetry: scheduler.cancel,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    controller.attach();

    expect(loadWebglAddon).toHaveBeenCalledTimes(1);
    expect(controller.getDiagnostics().lifecycle).toEqual(
      expect.objectContaining({
        rejectedTransitionCount: 1,
        state: "gpu-attaching",
      }),
    );

    controller.dispose();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("times out a hanging attach and rejects its late result", async () => {
    const scheduler = new ManualTimerScheduler();
    let resolveLoad:
      ((value: { WebglAddon: typeof FakeWebglAddon }) => void) | undefined;
    const controller = createTerminalRendererController({
      attachTimeoutMs: 100,
      cancelRetry: scheduler.cancel,
      loadWebglAddon: vi.fn(
        () =>
          new Promise<{ WebglAddon: typeof FakeWebglAddon }>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
      logger: { warn: vi.fn() },
      paneId: "pane-1",
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    scheduler.runNext();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "retry-exhausted",
      mode: "auto",
    });
    expect(controller.getDiagnostics()).toEqual(
      expect.objectContaining({
        activeTimerCount: 0,
        lifecycle: expect.objectContaining({ state: "cpu-cooldown" }),
      }),
    );

    resolveLoad?.({ WebglAddon: FakeWebglAddon });
    await flushPromises();

    expect(FakeWebglAddon.instances).toHaveLength(0);
    expect(
      controller.getDiagnostics().telemetry.counters.staleCommitRejectedCount,
    ).toBe(1);
  });

  it("cancels a pending context-loss retry on dispose", async () => {
    const scheduler = new ManualTimerScheduler();
    const controller = createTerminalRendererController({
      cancelRetry: scheduler.cancel,
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      recoveryJitterRatio: 0,
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();
    FakeWebglAddon.instances[0].emitContextLoss();
    expect(scheduler.pendingCount()).toBe(1);

    controller.dispose();
    controller.dispose();
    scheduler.runAll();
    await flushPromises();

    expect(FakeWebglAddon.instances).toHaveLength(1);
    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(controller.getDiagnostics()).toEqual(
      expect.objectContaining({
        activeTimerCount: 0,
        lifecycle: expect.objectContaining({ state: "disposed" }),
      }),
    );
  });

  it("opens the circuit after repeated context loss and allows one manual retry", async () => {
    const scheduler = new ManualTimerScheduler();
    const controller = createTerminalRendererController({
      cancelRetry: scheduler.cancel,
      contextLossCircuitThreshold: 2,
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      recoveryJitterRatio: 0,
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();
    FakeWebglAddon.instances[0].emitContextLoss();
    scheduler.runNext();
    await flushPromises();
    expect(controller.getState().backend).toBe("gpu");

    FakeWebglAddon.instances[1].emitContextLoss();

    expect(scheduler.pendingCount()).toBe(0);
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "recovery-storm",
      mode: "auto",
    });
    expect(controller.getDiagnostics().circuitOpen).toBe(true);

    controller.retryGpu();
    await flushPromises();

    expect(FakeWebglAddon.instances).toHaveLength(3);
    expect(controller.getState().backend).toBe("gpu");
    expect(controller.getDiagnostics()).toEqual(
      expect.objectContaining({
        circuitOpen: false,
        contextLossCount: 0,
      }),
    );
  });

  it("bounds recovery attempts when every recovery attach hangs", async () => {
    const scheduler = new ManualTimerScheduler();
    const loadWebglAddon = vi
      .fn()
      .mockResolvedValueOnce({ WebglAddon: FakeWebglAddon })
      .mockImplementation(
        () =>
          new Promise<{ WebglAddon: typeof FakeWebglAddon }>(() => undefined),
      );
    const controller = createTerminalRendererController({
      attachTimeoutMs: 100,
      cancelRetry: scheduler.cancel,
      contextLossCircuitThreshold: 10,
      loadWebglAddon,
      logger: { warn: vi.fn() },
      maxRecoveryAttempts: 3,
      maxRecoveryElapsedMs: 60_000,
      paneId: "pane-1",
      recoveryJitterRatio: 0,
      rendererType: "auto",
      retryDelaysMs: [0, 0, 0],
      scheduleRetry: scheduler.schedule,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();
    FakeWebglAddon.instances[0].emitContextLoss();
    scheduler.runAll();

    expect(loadWebglAddon).toHaveBeenCalledTimes(4);
    expect(controller.getDiagnostics()).toEqual(
      expect.objectContaining({
        activeTimerCount: 0,
        circuitOpen: true,
        retryCount: 3,
      }),
    );
    expect(controller.getState().fallbackReason).toBe("retry-exhausted");
  });

  it("keeps a suspended renderer stable and reuses it on resume", async () => {
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();
    controller.suspend();
    controller.attach();

    expect(controller.getDiagnostics().lifecycle.state).toBe("suspended");
    expect(FakeWebglAddon.instances).toHaveLength(1);

    controller.resume();

    expect(controller.getDiagnostics().lifecycle.state).toBe("gpu-ready");
    expect(controller.getState().backend).toBe("gpu");
  });

  it("waits for a stable surface before acting on zero-size canvas health", async () => {
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();
    const decision = controller.reportHealth({
      now: 1_000,
      signal: "canvas-zero-sized",
      surfaceEpoch: 1,
      surfaceStable: false,
      visible: true,
    });

    expect(decision.action).toBe("wait-for-stable-surface");
    expect(controller.getState().backend).toBe("gpu");
    expect(FakeWebglAddon.instances[0].dispose).not.toHaveBeenCalled();
  });

  it("escalates repeated stale-frame health from refresh to pane rebuild", async () => {
    const scheduler = new ManualTimerScheduler();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      cancelRetry: scheduler.cancel,
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      recoveryJitterRatio: 0,
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      terminal,
    });

    controller.attach();
    await flushPromises();

    expect(
      controller.reportHealth({
        now: 1_000,
        signal: "frame-stale",
        surfaceEpoch: 1,
        surfaceStable: true,
        visible: true,
      }).action,
    ).toBe("refresh");
    expect(terminal.refresh).toHaveBeenCalledTimes(1);

    expect(
      controller.reportHealth({
        now: 1_100,
        signal: "frame-stale",
        surfaceEpoch: 1,
        surfaceStable: true,
        visible: true,
      }).action,
    ).toBe("rebuild-renderer");
    expect(controller.getState().backend).toBe("cpu");
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runNext();
    await flushPromises();

    expect(controller.getState().backend).toBe("gpu");
    expect(FakeWebglAddon.instances).toHaveLength(2);
  });

  it("exposes bounded lifecycle diagnostics without terminal content", async () => {
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();

    expect(controller.getDiagnostics()).toEqual(
      expect.objectContaining({
        activeTimerCount: 0,
        circuitOpen: false,
        lifecycle: expect.objectContaining({
          generation: 1,
          paneId: "pane-1",
          state: "gpu-ready",
        }),
        retryCount: 0,
      }),
    );
    expect(JSON.stringify(controller.getDiagnostics())).not.toContain(
      "terminal content",
    );
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

class ManualTimerScheduler {
  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  cancel = vi.fn((handle: number) => {
    this.callbacks.delete(handle);
  });

  schedule = vi.fn((callback: () => void) => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  });

  pendingCount() {
    return this.callbacks.size;
  }

  runNext() {
    const next = this.callbacks.entries().next().value as
      [number, () => void] | undefined;
    if (!next) {
      return;
    }
    const [handle, callback] = next;
    this.callbacks.delete(handle);
    callback();
  }

  runAll() {
    while (this.callbacks.size > 0) {
      this.runNext();
    }
  }
}
