import { describe, expect, it } from "vitest";
import { createTerminalRendererPerformanceTelemetry } from "../../../../src/features/terminal/terminalRendererPerformanceTelemetry";

describe("terminalRendererPerformanceTelemetry", () => {
  it("summarizes bounded duration samples", () => {
    const telemetry = createTerminalRendererPerformanceTelemetry({
      sampleLimit: 4,
    });

    for (const value of [1, 2, 3, 4, 100]) {
      telemetry.recordDuration("writeCallbackMs", value);
    }

    expect(telemetry.snapshot().durations.writeCallbackMs).toEqual({
      count: 4,
      max: 100,
      p50: 3,
      p95: 100,
      p99: 100,
    });
  });

  it("records counters and resource high-level values without content", () => {
    const telemetry = createTerminalRendererPerformanceTelemetry();

    telemetry.increment("fullRefreshCount");
    telemetry.increment("atlasClearCount", 2);
    telemetry.setResources({
      activeCanvases: 3,
      activeContexts: 2,
      activeGpuPanes: 2,
      pendingBytes: 4096,
      pendingChunks: 4,
    });

    expect(telemetry.snapshot()).toMatchObject({
      counters: {
        atlasClearCount: 2,
        fullRefreshCount: 1,
      },
      resources: {
        activeCanvases: 3,
        activeContexts: 2,
        activeGpuPanes: 2,
        pendingBytes: 4096,
        pendingChunks: 4,
      },
    });
    expect(JSON.stringify(telemetry.snapshot())).not.toContain("output");
  });

  it("ignores invalid values and supports reset", () => {
    const telemetry = createTerminalRendererPerformanceTelemetry();

    telemetry.recordDuration("frameGapMs", -1);
    telemetry.recordDuration("frameGapMs", Number.NaN);
    telemetry.increment("rendererSwapCount", -1);
    telemetry.setResources({ activeContexts: -1 });

    expect(telemetry.snapshot().durations.frameGapMs).toBeUndefined();
    expect(telemetry.snapshot().counters.rendererSwapCount).toBe(0);
    expect(telemetry.snapshot().resources.activeContexts).toBe(0);

    telemetry.recordDuration("inputEchoMs", 12);
    telemetry.increment("staleCommitRejectedCount");
    telemetry.setResources({ activeContexts: 1 });
    telemetry.reset();

    expect(telemetry.snapshot()).toMatchObject({
      counters: {
        staleCommitRejectedCount: 0,
      },
      durations: {},
      resources: {
        activeContexts: 0,
      },
    });
  });
});
