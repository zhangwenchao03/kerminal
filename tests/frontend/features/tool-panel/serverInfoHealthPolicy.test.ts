import { describe, expect, it } from "vitest";
import { resolveServerInfoHealth } from "../../../../src/features/tool-panel/serverInfoHealthPolicy";

describe("serverInfoHealthPolicy", () => {
  it("distinguishes baseline, live, paused, stale and error states", () => {
    const base = {
      capturedAt: "100",
      error: false,
      hasRateSample: false,
      loading: false,
      nowMs: 101_000,
      refreshIntervalMs: 3_000,
    };

    expect(resolveServerInfoHealth({ ...base, capturedAt: undefined }).status).toBe(
      "baseline",
    );
    expect(resolveServerInfoHealth({ ...base, hasRateSample: true }).status).toBe(
      "live",
    );
    expect(resolveServerInfoHealth({ ...base, refreshIntervalMs: 0 }).status).toBe(
      "paused",
    );
    expect(resolveServerInfoHealth({ ...base, nowMs: 130_000 }).status).toBe(
      "stale",
    );
    expect(resolveServerInfoHealth({ ...base, error: true }).status).toBe(
      "error",
    );
  });
});
