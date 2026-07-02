import { describe, expect, it } from "vitest";
import { resolveTerminalSuggestionProbePolicy } from "../../../../src/features/terminal/terminalSuggestionProbePolicy";

describe("terminalSuggestionProbePolicy", () => {
  it("keeps normal probes active with the base delay", () => {
    expect(
      resolveTerminalSuggestionProbePolicy({
        lifecycleEnabled: true,
        now: 1_000,
      }),
    ).toEqual({
      delayMs: 60,
      shouldSchedule: true,
      workMode: "active",
    });
  });

  it("pauses probes while lifecycle gates are closed", () => {
    expect(
      resolveTerminalSuggestionProbePolicy({
        lifecycleEnabled: false,
        lifecycleReason: "hidden-pane",
        now: 1_000,
      }),
    ).toEqual({
      delayMs: 60,
      disabledReason: "hidden-pane",
      shouldSchedule: false,
      workMode: "paused",
    });
  });

  it("defers probes during rapid input bursts", () => {
    expect(
      resolveTerminalSuggestionProbePolicy({
        inputBurstCount: 3,
        lastInputAt: 1_000,
        lifecycleEnabled: true,
        now: 1_120,
      }),
    ).toEqual({
      delayMs: 300,
      disabledReason: "rapid-input",
      shouldSchedule: true,
      workMode: "deferred",
    });
  });

  it("defers after slow probe telemetry", () => {
    expect(
      resolveTerminalSuggestionProbePolicy({
        lastProbeDurationMs: 1_500,
        lifecycleEnabled: true,
        now: 1_000,
      }),
    ).toEqual({
      delayMs: 750,
      disabledReason: "slow-probe",
      shouldSchedule: true,
      workMode: "deferred",
    });
  });

  it("pauses after consecutive probe failures", () => {
    expect(
      resolveTerminalSuggestionProbePolicy({
        consecutiveFailures: 3,
        lifecycleEnabled: true,
        now: 1_000,
      }),
    ).toEqual({
      delayMs: 60,
      disabledReason: "failure-backoff",
      retryAfterMs: 2_000,
      shouldSchedule: false,
      workMode: "paused",
    });
  });
});
