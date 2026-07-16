import { describe, expect, it } from "vitest";
import { createInitialRemoteOutputGate } from "../../../../src/features/terminal/terminalInitialRemoteOutputGate";

describe("terminalInitialRemoteOutputGate", () => {
  it("allows at most eight startup batches", () => {
    const gate = createInitialRemoteOutputGate(1_000);
    expect(
      Array.from({ length: 9 }, () => gate.shouldWriteNow("ok", 1_100)),
    ).toEqual([true, true, true, true, true, true, true, true, false]);
  });

  it("counts UTF-8 bytes and rejects a batch beyond 128 KiB", () => {
    const gate = createInitialRemoteOutputGate(1_000);
    expect(gate.shouldWriteNow("你".repeat(43_690), 1_100)).toBe(true);
    expect(gate.shouldWriteNow("你", 1_100)).toBe(false);
  });

  it("rejects output after the two-second startup window", () => {
    const gate = createInitialRemoteOutputGate(1_000);
    expect(gate.shouldWriteNow("ok", 3_000)).toBe(true);
    expect(gate.shouldWriteNow("late", 3_001)).toBe(false);
  });
});
