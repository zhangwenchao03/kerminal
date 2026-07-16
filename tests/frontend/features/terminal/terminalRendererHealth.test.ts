import { describe, expect, it } from "vitest";
import { createTerminalRendererHealthController } from "../../../../src/features/terminal/terminalRendererHealth";

function observation(
  overrides: Partial<
    Parameters<
      ReturnType<typeof createTerminalRendererHealthController>["observe"]
    >[0]
  > = {},
) {
  return {
    backend: "gpu" as const,
    now: 1_000,
    signal: "healthy" as const,
    surfaceEpoch: 1,
    surfaceStable: true,
    visible: true,
    ...overrides,
  };
}

describe("terminalRendererHealth", () => {
  it("keeps healthy and CPU observations side-effect free", () => {
    const controller = createTerminalRendererHealthController();

    expect(controller.observe(observation())).toEqual(
      expect.objectContaining({ action: "none", level: 0 }),
    );
    expect(
      controller.observe(
        observation({
          backend: "cpu",
          signal: "context-lost",
        }),
      ),
    ).toEqual(expect.objectContaining({ action: "none", level: 0 }));
  });

  it("waits for a visible stable surface before rebuilding", () => {
    const controller = createTerminalRendererHealthController();

    expect(
      controller.observe(
        observation({
          signal: "canvas-zero-sized",
          surfaceStable: false,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        action: "wait-for-stable-surface",
        level: 0,
      }),
    );
    expect(
      controller.observe(
        observation({
          signal: "canvas-detached",
          visible: false,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        action: "wait-for-stable-surface",
        level: 0,
      }),
    );
  });

  it("allows only one L1 refresh action in the same health epoch", () => {
    const controller = createTerminalRendererHealthController();

    expect(controller.observe(observation({ signal: "frame-stale" }))).toEqual(
      expect.objectContaining({ action: "refresh", level: 1 }),
    );
    expect(
      controller.observe(observation({ signal: "frame-stale", now: 1_100 })),
    ).toEqual(
      expect.objectContaining({ action: "rebuild-renderer", level: 2 }),
    );

    expect(
      controller.observe(
        observation({
          now: 1_200,
          signal: "frame-stale",
          surfaceEpoch: 2,
        }),
      ),
    ).toEqual(expect.objectContaining({ action: "refresh", level: 1 }));
  });

  it("escalates a repeated atlas fault from L1 to L2", () => {
    const controller = createTerminalRendererHealthController();

    expect(
      controller.observe(observation({ signal: "atlas-operation-failed" })),
    ).toEqual(
      expect.objectContaining({
        action: "clear-atlas-and-refresh",
        level: 1,
      }),
    );
    expect(
      controller.observe(
        observation({
          now: 1_100,
          signal: "atlas-operation-failed",
        }),
      ),
    ).toEqual(
      expect.objectContaining({ action: "rebuild-renderer", level: 2 }),
    );
  });

  it("opens a bounded L3 circuit for repeated L2 faults", () => {
    const controller = createTerminalRendererHealthController({
      l2CircuitThreshold: 3,
      l2FaultWindowMs: 10_000,
    });

    expect(
      controller.observe(observation({ signal: "canvas-detached" })),
    ).toEqual(
      expect.objectContaining({ action: "rebuild-renderer", level: 2 }),
    );
    expect(
      controller.observe(
        observation({
          now: 1_100,
          signal: "cell-metric-mismatch",
        }),
      ),
    ).toEqual(
      expect.objectContaining({ action: "rebuild-renderer", level: 2 }),
    );
    expect(
      controller.observe(
        observation({
          now: 1_200,
          signal: "context-lost",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        action: "fallback-cpu",
        circuitOpen: true,
        level: 3,
      }),
    );

    controller.resetCircuit();

    expect(controller.getSnapshot()).toEqual(
      expect.objectContaining({
        circuitOpen: false,
        l1ActionCount: 0,
        l2FaultCount: 0,
      }),
    );
  });

  it("expires old L2 faults outside the circuit window", () => {
    const controller = createTerminalRendererHealthController({
      l2CircuitThreshold: 2,
      l2FaultWindowMs: 100,
    });

    controller.observe(observation({ signal: "canvas-detached" }));

    expect(
      controller.observe(
        observation({
          now: 1_101,
          signal: "canvas-detached",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        action: "rebuild-renderer",
        circuitOpen: false,
      }),
    );
  });
});
