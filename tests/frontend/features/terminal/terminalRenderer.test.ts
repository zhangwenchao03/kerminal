import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererController,
  releaseWebglAddonInternals,
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

describe("terminalRenderer", () => {
  beforeEach(() => {
    FakeWebglAddon.instances = [];
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

  it("attaches the WebGL addon in auto mode", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
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
    expect(terminal.refresh).toHaveBeenCalledWith(0, 11);
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
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
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

  it("disposes the active WebGL renderer when switching to CPU", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    controller.updateMode("cpu");

    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "cpu",
    });
  });

  it("falls back on context loss and retries while GPU remains enabled", async () => {
    const retryCallbacks: Array<() => void> = [];
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      scheduleRetry: (callback) => {
        retryCallbacks.push(callback);
        return retryCallbacks.length;
      },
      cancelRetry: vi.fn(),
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
    expect(retryCallbacks).toHaveLength(1);
    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();

    retryCallbacks[0]();
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
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
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

  it("clears the texture atlas without throwing when WebGL is active", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
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
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: FakeWebglAddon }),
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
      | ((value: { WebglAddon: typeof FakeWebglAddon }) => void)
      | undefined;
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
  });

  it("cleans known private WebGL renderer references best-effort", () => {
    const logger = { warn: vi.fn() };
    const addon = {
      _renderer: {
        _atlas: {},
        _canvas: document.createElement("canvas"),
        _charAtlas: {},
        _gl: {},
      },
    };

    releaseWebglAddonInternals(addon, logger);

    expect(addon._renderer).toEqual({
      _atlas: undefined,
      _canvas: undefined,
      _charAtlas: undefined,
      _gl: undefined,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
