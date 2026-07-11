import { describe, expect, it, vi } from "vitest";
import {
  createTerminalGpuRenderRecoveryController,
  type TerminalGpuRenderRecoveryScheduler,
} from "../../../../src/features/terminal/terminalGpuRenderRecovery";
import type { TerminalRendererBackend } from "../../../../src/features/terminal/terminalRendererPolicy";
import type { TerminalRendererType } from "../../../../src/features/settings/settingsModel";

class ManualFrameScheduler implements TerminalGpuRenderRecoveryScheduler {
  callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  cancelFrame(handle: number): void {
    this.callbacks.delete(handle);
  }

  requestFrame(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback();
    }
  }
}

function renderer(state: {
  backend?: TerminalRendererBackend;
  mode?: TerminalRendererType;
}) {
  return {
    clearTextureAtlas: vi.fn(),
    getState: vi.fn(() => ({
      backend: state.backend ?? "gpu",
      mode: state.mode ?? "auto",
    })),
  };
}

describe("terminalGpuRenderRecovery", () => {
  it("keeps ordinary renderer signals free of recovery side effects", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    const terminal = { refresh: vi.fn(), rows: 10 };
    const events: unknown[] = [];
    const controller = createTerminalGpuRenderRecoveryController({
      now: () => 1_000,
      onRecovery: (event) => events.push(event),
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("write-parsed");
    controller.trigger("buffer-changed");
    controller.trigger("resize");
    controller.trigger("theme-changed");
    controller.trigger("font-changed");
    controller.trigger("renderer-attached");
    scheduler.flush();

    expect(scheduler.callbacks.size).toBe(0);
    expect(terminal.refresh).not.toHaveBeenCalled();
    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("coalesces manual recovery and advances the atlas epoch once", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    const terminal = { refresh: vi.fn(), rows: 8 };
    const events: unknown[] = [];
    const controller = createTerminalGpuRenderRecoveryController({
      now: () => 2_000,
      onRecovery: (event) => events.push(event),
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("manual-recover");
    controller.trigger("manual-recover");
    scheduler.flush();

    expect(fakeRenderer.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledWith(0, 7);
    expect(events).toEqual([
      {
        action: "clearAtlasAndRefresh",
        atlasEpoch: 1,
        reason: "manual-recover",
      },
    ]);
  });

  it("keeps the atlas epoch stable during cooldown and advances it afterwards", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    let timestamp = 1_000;
    const clearTextureAtlas = vi.fn();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const events: unknown[] = [];
    const controller = createTerminalGpuRenderRecoveryController({
      clearTextureAtlas,
      now: () => timestamp,
      onRecovery: (event) => events.push(event),
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("manual-recover");
    scheduler.flush();

    timestamp = 1_100;
    controller.trigger("manual-recover");
    scheduler.flush();

    timestamp = 1_300;
    controller.trigger("manual-recover");
    scheduler.flush();

    timestamp = 3_100;
    controller.trigger("manual-recover");
    scheduler.flush();

    expect(clearTextureAtlas).toHaveBeenCalledTimes(2);
    expect(terminal.refresh).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      {
        action: "clearAtlasAndRefresh",
        atlasEpoch: 1,
        reason: "manual-recover",
      },
      {
        action: "refresh",
        atlasEpoch: 1,
        reason: "atlas-clear-cooldown",
      },
      {
        action: "clearAtlasAndRefresh",
        atlasEpoch: 2,
        reason: "manual-recover",
      },
    ]);
    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it("refreshes visible explicit recovery without clearing the atlas", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    let timestamp = 2_000;
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      now: () => timestamp,
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("visible-recovered");
    scheduler.flush();

    timestamp = 2_100;
    controller.trigger("visible-recovered");
    scheduler.flush();

    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
    expect(terminal.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes an explicit atlas failure without another atlas clear", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("atlas-clear-failed", 2_000);
    scheduler.flush();

    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
    expect(terminal.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the strongest pending exceptional action and its reason", () => {
    const scheduler = new ManualFrameScheduler();
    const fallback = vi.fn();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      onFallbackCpu: fallback,
      renderer: renderer({}),
      scheduler,
      terminal,
    });

    controller.trigger("manual-recover", 2_000);
    controller.trigger("context-lost", 2_000);
    scheduler.flush();

    expect(fallback).toHaveBeenCalledWith("context-lost");
    expect(terminal.refresh).not.toHaveBeenCalled();
  });

  it("uses the injected atlas clear operation when provided", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    const clearTextureAtlas = vi.fn();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      clearTextureAtlas,
      now: () => 2_500,
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("manual-recover");
    scheduler.flush();

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
    expect(terminal.refresh).toHaveBeenCalledWith(0, 7);
  });

  it("refreshes once on the first atlas clear failure and then falls back", () => {
    const scheduler = new ManualFrameScheduler();
    let timestamp = 3_000;
    const clearTextureAtlas = vi.fn(() => {
      throw new Error("atlas failed");
    });
    const fallback = vi.fn();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      clearTextureAtlas,
      config: { maxAtlasClearFailuresBeforeFallback: 2 },
      now: () => timestamp,
      onFallbackCpu: fallback,
      renderer: renderer({}),
      scheduler,
      terminal,
    });

    controller.trigger("manual-recover");
    scheduler.flush();
    scheduler.flush();

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();

    timestamp = 5_000;
    controller.trigger("manual-recover");
    scheduler.flush();
    scheduler.flush();

    expect(clearTextureAtlas).toHaveBeenCalledTimes(2);
    expect(terminal.refresh).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledWith("atlas-clear-failed");
  });

  it("bounds repeated explicit recovery but ignores ordinary traffic", () => {
    const scheduler = new ManualFrameScheduler();
    let timestamp = 1_000;
    const fallback = vi.fn();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      config: {
        maxRecoveriesBeforeFallback: 2,
        refreshThrottleMs: 0,
      },
      now: () => timestamp,
      onFallbackCpu: fallback,
      renderer: renderer({}),
      scheduler,
      terminal,
    });

    controller.trigger("visible-recovered");
    scheduler.flush();
    timestamp = 1_100;
    controller.trigger("visible-recovered");
    scheduler.flush();

    timestamp = 1_200;
    controller.trigger("write-parsed");
    scheduler.flush();
    expect(fallback).not.toHaveBeenCalled();

    controller.trigger("visible-recovered");
    scheduler.flush();

    expect(terminal.refresh).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith("recovery-storm");
  });

  it("cancels pending recovery on dispose", () => {
    const scheduler = new ManualFrameScheduler();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      renderer: renderer({}),
      scheduler,
      terminal,
    });

    controller.trigger("visible-recovered", 1_000);
    controller.dispose();
    scheduler.flush();

    expect(terminal.refresh).not.toHaveBeenCalled();
  });
});
