import { describe, expect, it } from "vitest";
import {
  resolveTerminalGpuRenderRecovery,
  strongestTerminalGpuRenderRecoveryAction,
} from "../../../../src/features/terminal/terminalGpuRenderRecoveryPolicy";

const NOW = 1_000_000;

describe("terminalGpuRenderRecoveryPolicy", () => {
  it("does nothing when CPU mode is requested", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        rendererType: "cpu",
        trigger: "font-changed",
      }),
    ).toEqual({
      action: "none",
      advanceAtlasEpoch: false,
      reason: "cpu-mode",
    });
  });

  it.each([
    "buffer-changed",
    "device-pixel-ratio-changed",
    "font-changed",
    "renderer-attached",
    "renderer-disposed",
    "resize",
    "theme-changed",
    "write-parsed",
  ] as const)("keeps ordinary signal %s outside recovery", (trigger) => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        recoveryCount: 12,
        recoveryWindowStartedAt: NOW - 5_000,
        rendererType: "auto",
        trigger,
      }),
    ).toEqual({
      action: "none",
      advanceAtlasEpoch: false,
    });
  });

  it("uses atlas recovery only for an explicit manual request", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        rendererType: "gpu",
        trigger: "manual-recover",
      }),
    ).toEqual({
      action: "clearAtlasAndRefresh",
      advanceAtlasEpoch: true,
      reason: "manual-recover",
    });
  });

  it("downgrades manual recovery during atlas cooldown and throttles refresh", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        lastAtlasClearAt: NOW - 100,
        lastRefreshAt: NOW - 300,
        now: NOW,
        rendererType: "auto",
        trigger: "manual-recover",
      }),
    ).toEqual({
      action: "refresh",
      advanceAtlasEpoch: false,
      reason: "atlas-clear-cooldown",
    });

    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        lastAtlasClearAt: NOW - 100,
        lastRefreshAt: NOW - 100,
        now: NOW,
        rendererType: "auto",
        trigger: "manual-recover",
      }),
    ).toEqual({
      action: "none",
      advanceAtlasEpoch: false,
      reason: "refresh-cooldown",
      retryAfterMs: 150,
    });
  });

  it("refreshes for an explicit atlas failure before the fallback threshold", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        atlasClearFailureCount: 1,
        backend: "gpu",
        now: NOW,
        rendererType: "auto",
        trigger: "atlas-clear-failed",
      }),
    ).toEqual({
      action: "refresh",
      advanceAtlasEpoch: false,
      reason: "atlas-clear-failed",
    });
  });

  it("falls back to CPU after repeated atlas failures", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        atlasClearFailureCount: 2,
        backend: "gpu",
        now: NOW,
        rendererType: "auto",
        trigger: "atlas-clear-failed",
      }),
    ).toEqual({
      action: "fallbackCpu",
      advanceAtlasEpoch: false,
      reason: "atlas-clear-failed",
    });
  });

  it("falls back immediately after context loss", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        rendererType: "auto",
        trigger: "context-lost",
      }),
    ).toEqual({
      action: "fallbackCpu",
      advanceAtlasEpoch: false,
      reason: "context-lost",
    });
  });

  it("throttles explicit visible recovery", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        rendererType: "auto",
        trigger: "visible-recovered",
      }),
    ).toEqual({
      action: "refresh",
      advanceAtlasEpoch: false,
      reason: "renderer-recovered",
    });

    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        lastRefreshAt: NOW - 100,
        now: NOW,
        rendererType: "auto",
        trigger: "visible-recovered",
      }),
    ).toEqual({
      action: "none",
      advanceAtlasEpoch: false,
      reason: "refresh-cooldown",
      retryAfterMs: 150,
    });
  });

  it("falls back during an explicit recovery storm", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        recoveryCount: 12,
        recoveryWindowStartedAt: NOW - 5_000,
        rendererType: "auto",
        trigger: "visible-recovered",
      }),
    ).toEqual({
      action: "fallbackCpu",
      advanceAtlasEpoch: false,
      reason: "recovery-storm",
    });
  });

  it("keeps the strongest pending recovery action", () => {
    expect(
      strongestTerminalGpuRenderRecoveryAction(
        "refresh",
        "clearAtlasAndRefresh",
      ),
    ).toBe("clearAtlasAndRefresh");
    expect(
      strongestTerminalGpuRenderRecoveryAction(
        "fallbackCpu",
        "clearAtlasAndRefresh",
      ),
    ).toBe("fallbackCpu");
  });
});
