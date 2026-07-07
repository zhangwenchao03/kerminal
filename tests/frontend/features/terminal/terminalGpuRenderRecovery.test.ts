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
  it("coalesces refreshes into one frame", () => {
    const scheduler = new ManualFrameScheduler();
    const fakeRenderer = renderer({});
    const terminal = { refresh: vi.fn(), rows: 10 };
    const controller = createTerminalGpuRenderRecoveryController({
      now: () => 1_000,
      renderer: fakeRenderer,
      scheduler,
      terminal,
    });

    controller.trigger("write-parsed");
    controller.trigger("buffer-changed");
    scheduler.flush();

    expect(terminal.refresh).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledWith(0, 9);
    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it("clears the atlas before refreshing for invalidating triggers", () => {
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

    controller.trigger("font-changed");
    scheduler.flush();

    expect(fakeRenderer.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(terminal.refresh).toHaveBeenCalledWith(0, 7);
    expect(events).toEqual([
      {
        action: "clearAtlasAndRefresh",
        atlasEpoch: 1,
        reason: "renderer-invalidated",
      },
    ]);
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

    controller.trigger("font-changed");
    scheduler.flush();

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.clearTextureAtlas).not.toHaveBeenCalled();
    expect(terminal.refresh).toHaveBeenCalledWith(0, 7);
  });

  it("falls back after repeated atlas clear failures", () => {
    const scheduler = new ManualFrameScheduler();
    const clearTextureAtlas = vi.fn(() => {
      throw new Error("atlas failed");
    });
    const fallback = vi.fn();
    const controller = createTerminalGpuRenderRecoveryController({
      clearTextureAtlas,
      config: { maxAtlasClearFailuresBeforeFallback: 1 },
      now: () => 3_000,
      onFallbackCpu: fallback,
      renderer: renderer({}),
      scheduler,
      terminal: { refresh: vi.fn(), rows: 8 },
    });

    controller.trigger("font-changed");
    scheduler.flush();
    scheduler.flush();

    expect(fallback).toHaveBeenCalledWith("atlas-clear-failed");
  });

  it("cancels pending recovery on dispose", () => {
    const scheduler = new ManualFrameScheduler();
    const terminal = { refresh: vi.fn(), rows: 8 };
    const controller = createTerminalGpuRenderRecoveryController({
      renderer: renderer({}),
      scheduler,
      terminal,
    });

    controller.trigger("write-parsed", 1_000);
    controller.dispose();
    scheduler.flush();

    expect(terminal.refresh).not.toHaveBeenCalled();
  });
});
