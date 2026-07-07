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

  it("throttles high-frequency write refreshes", () => {
    const throttled = resolveTerminalGpuRenderRecovery({
      backend: "gpu",
      lastRefreshAt: NOW - 100,
      now: NOW,
      rendererType: "auto",
      trigger: "write-parsed",
    });

    expect(throttled).toEqual({
      action: "none",
      advanceAtlasEpoch: false,
      reason: "refresh-cooldown",
      retryAfterMs: 150,
    });

    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        lastRefreshAt: NOW - 300,
        now: NOW,
        rendererType: "auto",
        trigger: "write-parsed",
      }),
    ).toEqual({
      action: "refresh",
      advanceAtlasEpoch: false,
      reason: "write-parsed",
    });
  });

  it("invalidates the atlas for renderer and font changes", () => {
    expect(
      resolveTerminalGpuRenderRecovery({
        backend: "gpu",
        now: NOW,
        rendererType: "gpu",
        trigger: "font-changed",
      }),
    ).toEqual({
      action: "clearAtlasAndRefresh",
      advanceAtlasEpoch: true,
      reason: "renderer-invalidated",
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

  it("falls back during a recovery storm", () => {
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
