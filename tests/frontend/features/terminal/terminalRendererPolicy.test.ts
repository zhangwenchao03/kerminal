import { describe, expect, it } from "vitest";
import {
  resolveContextLossRetryDelay,
  resolveTerminalRendererPolicy,
  type TerminalRendererPanePolicyInput,
} from "../../../../src/features/terminal/terminalRendererPolicy";

const NOW = 1_000_000;

function pane(
  paneId: string,
  overrides: Partial<TerminalRendererPanePolicyInput> = {},
): TerminalRendererPanePolicyInput {
  return {
    currentBackend: "cpu",
    focused: false,
    paneId,
    visible: true,
    ...overrides,
  };
}

describe("terminalRendererPolicy", () => {
  it("keeps CPU mode on the default renderer and never imports WebGL", () => {
    const result = resolveTerminalRendererPolicy({
      now: NOW,
      panes: [
        pane("pane-1", { currentBackend: "gpu", focused: true }),
        pane("pane-2"),
      ],
      requestedMode: "cpu",
    });

    expect(result.effectiveGpuPanes).toBe(0);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        fallbackReason: "mode-cpu",
        paneId: "pane-1",
        shouldAttemptImport: false,
        shouldReapWebgl: true,
        targetBackend: "cpu",
      }),
      expect.objectContaining({
        fallbackReason: "mode-cpu",
        paneId: "pane-2",
        shouldAttemptImport: false,
        targetBackend: "cpu",
      }),
    ]);
  });

  it("holds an auto-mode pane in CPU during load failure cooldown", () => {
    const result = resolveTerminalRendererPolicy({
      config: { autoFailureCooldownMs: 60_000 },
      now: NOW,
      panes: [
        pane("pane-1", {
          failureCount: 1,
          lastFailureAt: NOW - 10_000,
          lastFailureReason: "load-failed",
        }),
      ],
      requestedMode: "auto",
    });

    expect(result.decisions[0]).toEqual(
      expect.objectContaining({
        fallbackReason: "cooldown",
        retryDelayMs: 50_000,
        shouldAttemptImport: false,
        targetBackend: "cpu",
      }),
    );
  });

  it("allows gpu mode to retry after context-loss backoff expires", () => {
    const duringBackoff = resolveTerminalRendererPolicy({
      now: NOW,
      panes: [
        pane("pane-1", {
          lastFailureAt: NOW - 100,
          lastFailureReason: "context-lost",
          retryCount: 0,
        }),
      ],
      requestedMode: "gpu",
    });

    expect(duringBackoff.decisions[0]).toEqual(
      expect.objectContaining({
        fallbackReason: "cooldown",
        retryDelayMs: 150,
        shouldAttemptImport: false,
        targetBackend: "cpu",
      }),
    );

    const afterBackoff = resolveTerminalRendererPolicy({
      now: NOW,
      panes: [
        pane("pane-1", {
          lastFailureAt: NOW - 300,
          lastFailureReason: "context-lost",
          retryCount: 0,
        }),
      ],
      requestedMode: "gpu",
    });

    expect(afterBackoff.decisions[0].fallbackReason).toBeUndefined();
    expect(afterBackoff.decisions[0]).toEqual(
      expect.objectContaining({
        shouldAttemptImport: true,
        targetBackend: "gpu",
      }),
    );
  });

  it("holds a GPU-mode pane in CPU after an atlas recovery failure", () => {
    const result = resolveTerminalRendererPolicy({
      config: { autoFailureCooldownMs: 60_000 },
      now: NOW,
      panes: [
        pane("pane-1", {
          lastFailureAt: NOW - 10_000,
          lastFailureReason: "atlas-clear-failed",
        }),
      ],
      requestedMode: "gpu",
    });

    expect(result.decisions[0]).toEqual(
      expect.objectContaining({
        fallbackReason: "cooldown",
        retryDelayMs: 50_000,
        shouldAttemptImport: false,
        targetBackend: "cpu",
      }),
    );
  });

  it("keeps healthy visible GPU owners when focus changes", () => {
    const result = resolveTerminalRendererPolicy({
      config: { maxActiveGpuPanes: 1 },
      now: NOW,
      panes: [
        pane("resident", {
          currentBackend: "gpu",
          gpuOwnerSince: NOW - 30_000,
          lastUsedAt: 1,
        }),
        pane("focused-newcomer", {
          focused: true,
          lastUsedAt: NOW,
        }),
      ],
      requestedMode: "auto",
    });

    const decisionsByPane = new Map(
      result.decisions.map((decision) => [decision.paneId, decision]),
    );

    expect(result.effectiveGpuPanes).toBe(1);
    expect(decisionsByPane.get("resident")).toEqual(
      expect.objectContaining({
        shouldReapWebgl: false,
        targetBackend: "gpu",
      }),
    );
    expect(decisionsByPane.get("focused-newcomer")).toEqual(
      expect.objectContaining({
        fallbackReason: "budget-limited",
        shouldReapWebgl: false,
        targetBackend: "cpu",
      }),
    );
  });

  it("reserves a granted GPU owner while its attach is pending", () => {
    const result = resolveTerminalRendererPolicy({
      config: { maxActiveGpuPanes: 1 },
      now: NOW,
      panes: [
        pane("pending-owner", {
          gpuAttachPending: true,
          gpuOwnerSince: NOW - 100,
        }),
        pane("focused-newcomer", {
          focused: true,
          lastUsedAt: NOW,
        }),
      ],
      requestedMode: "auto",
    });

    const decisionsByPane = new Map(
      result.decisions.map((decision) => [decision.paneId, decision]),
    );

    expect(decisionsByPane.get("pending-owner")).toEqual(
      expect.objectContaining({
        shouldAttemptImport: false,
        targetBackend: "gpu",
      }),
    );
    expect(decisionsByPane.get("focused-newcomer")).toEqual(
      expect.objectContaining({
        fallbackReason: "budget-limited",
        targetBackend: "cpu",
      }),
    );
  });

  it("reaps hidden WebGL panes after the grace window", () => {
    const result = resolveTerminalRendererPolicy({
      config: { webglReapGraceMs: 30_000 },
      now: NOW,
      panes: [
        pane("warm-hidden", {
          currentBackend: "gpu",
          hiddenSince: NOW - 10_000,
          visible: false,
        }),
        pane("stale-hidden", {
          currentBackend: "gpu",
          hiddenSince: NOW - 40_000,
          visible: false,
        }),
      ],
      requestedMode: "auto",
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({
        fallbackReason: "not-visible",
        paneId: "warm-hidden",
        shouldReapWebgl: false,
        targetBackend: "gpu",
      }),
      expect.objectContaining({
        fallbackReason: "hidden-reaped",
        paneId: "stale-hidden",
        shouldReapWebgl: true,
        targetBackend: "cpu",
      }),
    ]);
  });

  it("suggests global CPU fallback after repeated auto load failures", () => {
    const result = resolveTerminalRendererPolicy({
      now: NOW,
      failureEvents: [
        { at: NOW - 1_000, reason: "load-failed" },
        { at: NOW - 2_000, reason: "import-failed" },
        { at: NOW - 3_000, reason: "load-failed" },
      ],
      panes: [pane("pane-1", { focused: true })],
      requestedMode: "auto",
    });

    expect(result.suggestedFallback).toBe("cpu");
    expect(result.decisions[0]).toEqual(
      expect.objectContaining({
        fallbackReason: "auto-suggested-cpu",
        shouldAttemptImport: false,
        targetBackend: "cpu",
      }),
    );
  });

  it("caps context-loss retry delays", () => {
    expect(resolveContextLossRetryDelay(0)).toBe(250);
    expect(resolveContextLossRetryDelay(3)).toBe(30_000);
    expect(resolveContextLossRetryDelay(99)).toBeUndefined();
  });
});
