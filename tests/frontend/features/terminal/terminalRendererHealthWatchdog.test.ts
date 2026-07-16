import { describe, expect, it, vi } from "vitest";
import { createTerminalRendererHealthWatchdog } from "../../../../src/features/terminal/terminalRendererHealthWatchdog";
import type { TerminalRendererSurfaceSnapshot } from "../../../../src/features/terminal/terminalRendererSurfaceCoordinator";

describe("terminalRendererHealthWatchdog", () => {
  it("reports a detached GPU canvas from the production DOM boundary", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
      rect(800, 600),
    );
    container.append(canvas);
    const renderer = createRenderer([canvas]);
    const scheduler = createManualScheduler();
    const watchdog = createTerminalRendererHealthWatchdog({
      container,
      renderer,
      scheduler: scheduler.scheduler,
      surfaceSnapshot: stableSurface,
    });

    watchdog.check();
    canvas.remove();
    watchdog.check();

    expect(renderer.reportHealth).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ signal: "healthy" }),
    );
    expect(renderer.reportHealth).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ signal: "canvas-detached" }),
    );
    watchdog.dispose();
  });

  it("reports zero-sized canvases and cancels its recurring timer", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect(0, 0));
    container.append(canvas);
    const renderer = createRenderer([canvas]);
    const scheduler = createManualScheduler();
    const watchdog = createTerminalRendererHealthWatchdog({
      container,
      renderer,
      scheduler: scheduler.scheduler,
      surfaceSnapshot: stableSurface,
    });

    scheduler.runNext();
    expect(renderer.reportHealth).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "canvas-zero-sized" }),
    );
    expect(scheduler.pendingCount()).toBe(1);

    watchdog.dispose();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("does not let a healthy texture atlas hide a zero-sized renderer canvas", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rendererCanvas = document.createElement("canvas");
    const textureAtlas = document.createElement("canvas");
    rendererCanvas.width = 800;
    rendererCanvas.height = 600;
    textureAtlas.width = 1024;
    textureAtlas.height = 1024;
    vi.spyOn(rendererCanvas, "getBoundingClientRect").mockReturnValue(
      rect(0, 0),
    );
    vi.spyOn(textureAtlas, "getBoundingClientRect").mockReturnValue(
      rect(1024, 1024),
    );
    container.append(rendererCanvas, textureAtlas);
    const renderer = createRenderer([rendererCanvas]);
    const watchdog = createTerminalRendererHealthWatchdog({
      container,
      renderer,
      scheduler: createManualScheduler().scheduler,
      surfaceSnapshot: stableSurface,
    });

    watchdog.check();

    expect(renderer.reportHealth).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "canvas-zero-sized" }),
    );
    watchdog.dispose();
  });
});

function createRenderer(rendererCanvases: readonly HTMLCanvasElement[]) {
  return {
    getTrackedRendererCanvases: vi.fn(() => rendererCanvases),
    getState: vi.fn(() => ({
      backend: "gpu" as const,
      canvasCount: 1,
      mode: "auto" as const,
    })),
    reportHealth: vi.fn(),
  };
}

function stableSurface(): TerminalRendererSurfaceSnapshot {
  return {
    cols: 100,
    dpr: 1,
    height: 600,
    minimized: false,
    rows: 30,
    stable: true,
    stableEpoch: 1,
    visible: true,
    width: 800,
  };
}

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
      cancel: vi.fn((handle: number) => {
        callbacks.delete(handle);
      }),
      schedule: vi.fn((callback: () => void) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      }),
    },
  };
}

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}
