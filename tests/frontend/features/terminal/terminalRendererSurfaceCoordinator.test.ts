import { describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererSurfaceCoordinator,
  type TerminalRendererSurfaceMeasurement,
  type TerminalRendererSurfaceScheduler,
} from "../../../../src/features/terminal/terminalRendererSurfaceCoordinator";

function createManualScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const scheduler: TerminalRendererSurfaceScheduler = {
    cancel: vi.fn((handle) => {
      callbacks.delete(handle);
    }),
    request: vi.fn((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
  };

  return {
    flush() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) {
        callback();
      }
    },
    pendingCount: () => callbacks.size,
    scheduler,
  };
}

function defaultMeasurement(): TerminalRendererSurfaceMeasurement {
  return {
    dpr: 1,
    height: 600,
    minimized: false,
    visible: true,
    width: 800,
  };
}

describe("terminalRendererSurfaceCoordinator", () => {
  it("coalesces repeated notifications into one fit per frame", () => {
    const scheduler = createManualScheduler();
    const fit = vi.fn(() => ({ cols: 100, rows: 30 }));
    const coordinator = createTerminalRendererSurfaceCoordinator({
      fit,
      measure: defaultMeasurement,
      scheduler: scheduler.scheduler,
    });

    for (let index = 0; index < 100; index += 1) {
      coordinator.notify();
    }

    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("does not refit or resize when the surface is unchanged", () => {
    const scheduler = createManualScheduler();
    const onDimensionsChange = vi.fn();
    const fit = vi.fn(() => ({ cols: 100, rows: 30 }));
    const coordinator = createTerminalRendererSurfaceCoordinator({
      fit,
      measure: defaultMeasurement,
      onDimensionsChange,
      scheduler: scheduler.scheduler,
    });

    coordinator.notify();
    scheduler.flush();
    coordinator.notify();
    scheduler.flush();

    expect(fit).toHaveBeenCalledTimes(1);
    expect(onDimensionsChange).toHaveBeenCalledTimes(1);
    expect(onDimensionsChange).toHaveBeenCalledWith({ cols: 100, rows: 30 });
  });

  it("waits for a second stable sample before announcing recovery", () => {
    const scheduler = createManualScheduler();
    const onStableSurface = vi.fn();
    const coordinator = createTerminalRendererSurfaceCoordinator({
      fit: () => ({ cols: 80, rows: 24 }),
      measure: defaultMeasurement,
      onStableSurface,
      scheduler: scheduler.scheduler,
      stableSamples: 2,
    });

    coordinator.notify();
    scheduler.flush();
    expect(onStableSurface).not.toHaveBeenCalled();

    coordinator.notify();
    scheduler.flush();
    expect(onStableSurface).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot()).toEqual(
      expect.objectContaining({
        cols: 80,
        rows: 24,
        stable: true,
        stableEpoch: 1,
      }),
    );
  });

  it("does not fit hidden, minimized, or zero-sized surfaces", () => {
    const scheduler = createManualScheduler();
    let measurement = {
      ...defaultMeasurement(),
      visible: false,
    };
    const fit = vi.fn(() => ({ cols: 80, rows: 24 }));
    const coordinator = createTerminalRendererSurfaceCoordinator({
      fit,
      measure: () => measurement,
      scheduler: scheduler.scheduler,
    });

    coordinator.notify();
    scheduler.flush();
    measurement = { ...measurement, visible: true, width: 0 };
    coordinator.notify();
    scheduler.flush();
    measurement = {
      ...measurement,
      minimized: true,
      width: 800,
    };
    coordinator.notify();
    scheduler.flush();

    expect(fit).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()?.stable).toBe(false);
  });

  it("refits once for DPR changes and only emits changed dimensions", () => {
    const scheduler = createManualScheduler();
    let measurement = defaultMeasurement();
    let dimensions = { cols: 100, rows: 30 };
    const onDimensionsChange = vi.fn();
    const fit = vi.fn(() => dimensions);
    const coordinator = createTerminalRendererSurfaceCoordinator({
      fit,
      measure: () => measurement,
      onDimensionsChange,
      scheduler: scheduler.scheduler,
    });

    coordinator.notify();
    scheduler.flush();
    measurement = { ...measurement, dpr: 2 };
    coordinator.notify();
    scheduler.flush();
    dimensions = { cols: 90, rows: 28 };
    measurement = { ...measurement, width: 720 };
    coordinator.notify();
    scheduler.flush();

    expect(fit).toHaveBeenCalledTimes(3);
    expect(onDimensionsChange).toHaveBeenCalledTimes(2);
    expect(onDimensionsChange).toHaveBeenLastCalledWith({
      cols: 90,
      rows: 28,
    });
  });

  it("cancels pending work and remains disposed", () => {
    const scheduler = createManualScheduler();
    const fit = vi.fn(() => ({ cols: 80, rows: 24 }));
    const coordinator = createTerminalRendererSurfaceCoordinator({
      fit,
      measure: defaultMeasurement,
      scheduler: scheduler.scheduler,
    });

    coordinator.notify();
    coordinator.dispose();
    coordinator.dispose();
    scheduler.flush();
    coordinator.notify();

    expect(scheduler.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(fit).not.toHaveBeenCalled();
  });
});
