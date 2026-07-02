import { describe, expect, it } from "vitest";
import {
  resolveTerminalPaneRuntimeLifecycle,
  resolveTerminalPaneRuntimeLifecycleConfig,
  type TerminalPaneRuntimeLifecycleInput,
} from "../../../../src/features/terminal/terminalPaneRuntimeLifecycle";

const NOW = 1_000_000;

function input(
  overrides: Partial<TerminalPaneRuntimeLifecycleInput> = {},
): TerminalPaneRuntimeLifecycleInput {
  return {
    activeTab: true,
    focused: true,
    now: NOW,
    rendererType: "auto",
    visible: true,
    ...overrides,
  };
}

describe("terminalPaneRuntimeLifecycle", () => {
  it("keeps a focused visible pane in full mode", () => {
    const decision = resolveTerminalPaneRuntimeLifecycle(input());

    expect(decision).toEqual(
      expect.objectContaining({
        allowGpuRenderer: true,
        outputHistoryWorkMode: "live",
        reason: "focused-visible",
        rendererResourceMode: "active",
        shouldRunSuggestionProbe: true,
        suggestionWorkMode: "active",
        workMode: "full",
      }),
    );
    expect(decision.captureOutputTail).toBe(true);
    expect(decision.releaseGpuRenderer).toBe(false);
  });

  it("degrades visible but unfocused split panes", () => {
    const decision = resolveTerminalPaneRuntimeLifecycle(
      input({ focused: false }),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        outputHistoryWorkMode: "throttled",
        reason: "visible-unfocused",
        rendererResourceMode: "active",
        shouldRunSuggestionProbe: false,
        suggestionWorkMode: "deferred",
        workMode: "visible-degraded",
      }),
    );
  });

  it("degrades high-output focused panes unless there was recent input", () => {
    const config = {
      highOutputBytesPerSecond: 1024,
      recentInteractionGraceMs: 2_000,
    };
    const degraded = resolveTerminalPaneRuntimeLifecycle(
      input({
        config,
        outputRateBytesPerSecond: 2_048,
      }),
    );
    const interactive = resolveTerminalPaneRuntimeLifecycle(
      input({
        config,
        lastUserInteractionAt: NOW - 500,
        outputRateBytesPerSecond: 2_048,
      }),
    );

    expect(degraded).toEqual(
      expect.objectContaining({
        reason: "high-output",
        workMode: "visible-degraded",
      }),
    );
    expect(interactive).toEqual(
      expect.objectContaining({
        reason: "focused-visible",
        workMode: "full",
      }),
    );
  });

  it("keeps hidden panes in tail-only mode before the suspend window", () => {
    const decision = resolveTerminalPaneRuntimeLifecycle(
      input({
        hiddenSince: NOW - 10_000,
        visible: false,
      }),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        allowGpuRenderer: false,
        hiddenAgeMs: 10_000,
        outputHistoryWorkMode: "tail-only",
        reason: "hidden",
        releaseGpuRenderer: false,
        rendererResourceMode: "parked",
        shouldRunSuggestionProbe: false,
        suggestionWorkMode: "paused",
        workMode: "hidden-tail-only",
      }),
    );
  });

  it("suspends renderer work for stale hidden panes", () => {
    const decision = resolveTerminalPaneRuntimeLifecycle(
      input({
        config: { hiddenSuspendAfterMs: 30_000 },
        hiddenSince: NOW - 40_000,
        visible: false,
      }),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        outputHistoryWorkMode: "tail-only",
        reason: "hidden-stale",
        releaseGpuRenderer: true,
        rendererResourceMode: "release-webgl",
        workMode: "suspended-renderer",
      }),
    );
  });

  it("treats inactive tabs as hidden tail capture", () => {
    const decision = resolveTerminalPaneRuntimeLifecycle(
      input({
        activeTab: false,
        hiddenSince: NOW - 1_000,
        visible: true,
      }),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        reason: "inactive-tab",
        rendererResourceMode: "parked",
        workMode: "hidden-tail-only",
      }),
    );
  });

  it("marks visible recovery after a hidden interval", () => {
    const recovered = resolveTerminalPaneRuntimeLifecycle(
      input({
        config: { visibleRecoveryAfterMs: 250 },
        hiddenSince: NOW - 1_000,
      }),
    );
    const fresh = resolveTerminalPaneRuntimeLifecycle(
      input({
        config: { visibleRecoveryAfterMs: 250 },
        hiddenSince: NOW - 100,
      }),
    );

    expect(recovered.needsVisibleRecovery).toBe(true);
    expect(fresh.needsVisibleRecovery).toBe(false);
  });

  it("respects forced CPU and GPU renderer settings", () => {
    const cpu = resolveTerminalPaneRuntimeLifecycle(
      input({ rendererType: "cpu" }),
    );
    const gpu = resolveTerminalPaneRuntimeLifecycle(
      input({
        focused: false,
        rendererType: "gpu",
      }),
    );

    expect(cpu).toEqual(
      expect.objectContaining({
        allowGpuRenderer: false,
        releaseGpuRenderer: true,
        rendererResourceMode: "cpu-only",
        workMode: "full",
      }),
    );
    expect(gpu).toEqual(
      expect.objectContaining({
        allowGpuRenderer: true,
        releaseGpuRenderer: false,
        rendererResourceMode: "active",
        workMode: "visible-degraded",
      }),
    );
  });

  it("uses safe defaults for invalid config values", () => {
    const config = resolveTerminalPaneRuntimeLifecycleConfig({
      fullOutputHistoryFlushMs: -1,
      hiddenSuspendAfterMs: Number.NaN,
      hiddenTailFlushMs: 10,
    });

    expect(config.fullOutputHistoryFlushMs).toBe(100);
    expect(config.hiddenSuspendAfterMs).toBe(30_000);
    expect(config.hiddenTailFlushMs).toBe(10);
  });
});
