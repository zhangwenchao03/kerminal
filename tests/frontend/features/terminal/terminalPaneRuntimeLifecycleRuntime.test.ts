import { describe, expect, it } from "vitest";
import { createTerminalPaneRuntimeLifecycleRuntime } from "../../../../src/features/terminal/terminalPaneRuntimeLifecycleRuntime";

describe("terminalPaneRuntimeLifecycleRuntime", () => {
  it("moves hidden panes to tail-only mode without closing tail capture", () => {
    let now = 10_000;
    const runtime = createTerminalPaneRuntimeLifecycleRuntime({
      activeTab: true,
      focused: true,
      now: () => now,
      rendererType: "auto",
      visible: true,
    });

    const hidden = runtime.markVisible(false);

    expect(hidden).toEqual(
      expect.objectContaining({
        captureOutputTail: true,
        hiddenAgeMs: 0,
        outputHistoryFlushIntervalMs: 2_000,
        outputHistoryWorkMode: "tail-only",
        shouldRunSuggestionProbe: false,
        suggestionWorkMode: "paused",
        workMode: "hidden-tail-only",
      }),
    );

    now += 35_000;

    expect(runtime.read()).toEqual(
      expect.objectContaining({
        hiddenAgeMs: 35_000,
        releaseGpuRenderer: true,
        rendererResourceMode: "release-webgl",
        workMode: "suspended-renderer",
      }),
    );
  });

  it("keeps recovery state until visible refresh completes", () => {
    let now = 20_000;
    const runtime = createTerminalPaneRuntimeLifecycleRuntime({
      activeTab: false,
      focused: false,
      now: () => now,
      rendererType: "auto",
      visible: false,
    });

    now += 1_000;
    const visible = runtime.markVisible(true);

    expect(visible.needsVisibleRecovery).toBe(true);
    expect(visible.hiddenAgeMs).toBe(1_000);

    const recovered = runtime.markVisibleRecoveryComplete();

    expect(recovered.needsVisibleRecovery).toBe(false);
    expect(recovered.hiddenAgeMs).toBe(0);
    expect(recovered.workMode).toBe("visible-degraded");
  });

  it("updates renderer and interaction inputs without rebuilding the runtime", () => {
    let now = 30_000;
    const runtime = createTerminalPaneRuntimeLifecycleRuntime({
      activeTab: true,
      focused: true,
      now: () => now,
      rendererType: "auto",
      visible: true,
    });

    expect(runtime.markRendererType("cpu")).toEqual(
      expect.objectContaining({
        allowGpuRenderer: false,
        releaseGpuRenderer: true,
        rendererResourceMode: "cpu-only",
      }),
    );

    now += 100;
    expect(runtime.markUserInteraction()).toEqual(
      expect.objectContaining({
        reason: "focused-visible",
        shouldRunSuggestionProbe: true,
        workMode: "full",
      }),
    );
  });
});
