import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalGpuRenderRecoveryRuntime } from "../../../../src/features/terminal/terminalGpuRenderRecoveryRuntime";
import type { TerminalRendererRegistry } from "../../../../src/features/terminal/terminalRendererRegistry";

function registry() {
  return {
    clearTextureAtlas: vi.fn(),
    recordPaneFailure: vi.fn(),
  } as unknown as TerminalRendererRegistry;
}

function renderer() {
  return {
    attach: vi.fn(),
    clearTextureAtlas: vi.fn(),
    dispose: vi.fn(),
    getDiagnostics: vi.fn(),
    getState: vi.fn(() => ({
      backend: "gpu" as const,
      canvasCount: 1,
      mode: "auto" as const,
    })),
    resume: vi.fn(),
    reportHealth: vi.fn(),
    retryGpu: vi.fn(),
    suspend: vi.fn(),
    updateMode: vi.fn(),
  };
}

describe("terminalGpuRenderRecoveryRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the atlas through the registry", () => {
    const fakeRegistry = registry();
    const terminal = { refresh: vi.fn(), rows: 10 };
    const controller = createTerminalGpuRenderRecoveryRuntime({
      paneId: "pane-1",
      registry: fakeRegistry,
      renderer: renderer(),
      terminal,
    });

    controller.trigger("manual-recover", 1_000);
    vi.advanceTimersByTime(16);

    expect(fakeRegistry.clearTextureAtlas).toHaveBeenCalledWith("pane-1");
  });

  it("records fallback reasons through the registry", () => {
    const fakeRegistry = registry();
    fakeRegistry.clearTextureAtlas = vi.fn(() => {
      throw new Error("atlas failed");
    });
    const controller = createTerminalGpuRenderRecoveryRuntime({
      paneId: "pane-1",
      registry: fakeRegistry,
      renderer: renderer(),
      terminal: { refresh: vi.fn(), rows: 10 },
    });

    controller.trigger("manual-recover", 1_000);
    vi.advanceTimersByTime(16);
    controller.trigger("manual-recover", 3_000);
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(16);

    expect(fakeRegistry.recordPaneFailure).toHaveBeenCalledWith(
      "pane-1",
      "atlas-clear-failed",
    );
  });
});
