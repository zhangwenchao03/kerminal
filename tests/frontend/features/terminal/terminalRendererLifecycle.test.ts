import { describe, expect, it } from "vitest";
import {
  TERMINAL_RENDERER_LIFECYCLE_TRANSITIONS,
  createTerminalRendererLifecycle,
  isTerminalRendererLifecycleTransitionAllowed,
  type TerminalRendererAcceptedTransition,
  type TerminalRendererTransitionReason,
  type TerminalRendererTransitionResult,
} from "../../../../src/features/terminal/terminalRendererLifecycle";

function expectAccepted(
  result: TerminalRendererTransitionResult,
): TerminalRendererAcceptedTransition {
  expect(result.accepted).toBe(true);
  if (!result.accepted) {
    throw new Error(`transition rejected: ${result.rejection}`);
  }
  return result;
}

function transitionReason(
  reason: TerminalRendererTransitionReason,
): TerminalRendererTransitionReason {
  return reason;
}

describe("terminalRendererLifecycle", () => {
  it("starts in cpu-ready with generation zero and an empty ledger", () => {
    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });

    expect(lifecycle.getSnapshot()).toEqual({
      generation: 0,
      paneId: "pane-1",
      rejectedTransitionCount: 0,
      state: "cpu-ready",
      transitionCount: 0,
    });
    expect(lifecycle.getLedger()).toEqual([]);
  });

  it("exposes the complete explicit legal transition table", () => {
    expect(TERMINAL_RENDERER_LIFECYCLE_TRANSITIONS).toEqual({
      "cpu-ready": ["gpu-attaching", "disposing"],
      "gpu-attaching": ["gpu-ready", "cpu-ready", "cpu-cooldown", "disposing"],
      "gpu-ready": ["suspended", "recovering", "cpu-ready", "disposing"],
      suspended: ["gpu-ready", "cpu-ready", "disposing"],
      recovering: ["gpu-ready", "cpu-ready", "cpu-cooldown", "disposing"],
      "cpu-cooldown": ["gpu-attaching", "cpu-ready", "disposing"],
      disposing: ["disposed"],
      disposed: [],
    });
    expect(
      isTerminalRendererLifecycleTransitionAllowed(
        "cpu-ready",
        "gpu-attaching",
      ),
    ).toBe(true);
    expect(
      isTerminalRendererLifecycleTransitionAllowed("cpu-ready", "gpu-ready"),
    ).toBe(false);
  });

  it("commits attach and recovery only with their active generation token", () => {
    let now = 1_000;
    const lifecycle = createTerminalRendererLifecycle({
      now: () => now,
      paneId: "pane-1",
    });

    const attaching = expectAccepted(
      lifecycle.transition({
        attempt: 1,
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    );
    const attachToken = attaching.generationToken;
    expect(attachToken).toEqual({
      generation: 1,
      operation: "gpu-attaching",
      paneId: "pane-1",
    });
    expect(attachToken && lifecycle.canCommitGeneration(attachToken)).toBe(
      true,
    );

    now += 25;
    const ready = expectAccepted(
      lifecycle.transition({
        attempt: 1,
        durationMs: 25,
        reason: "gpu-attached",
        to: "gpu-ready",
        token: attachToken,
      }),
    );
    expect(ready.snapshot).toEqual(
      expect.objectContaining({ generation: 1, state: "gpu-ready" }),
    );
    expect(attachToken && lifecycle.canCommitGeneration(attachToken)).toBe(
      false,
    );

    const recovering = expectAccepted(
      lifecycle.transition({
        attempt: 1,
        reason: "gpu-fault",
        to: "recovering",
      }),
    );
    const recoveryToken = recovering.generationToken;
    expect(recoveryToken).toEqual({
      generation: 2,
      operation: "recovering",
      paneId: "pane-1",
    });

    expectAccepted(
      lifecycle.transition({
        attempt: 1,
        reason: "recovery-succeeded",
        to: "gpu-ready",
        token: recoveryToken,
      }),
    );

    expect(lifecycle.getLedger()).toEqual([
      expect.objectContaining({
        attempt: 1,
        from: "cpu-ready",
        generation: 1,
        outcome: "committed",
        to: "gpu-attaching",
      }),
      expect.objectContaining({
        durationMs: 25,
        from: "gpu-attaching",
        generation: 1,
        outcome: "committed",
        requestedGeneration: 1,
        to: "gpu-ready",
      }),
      expect.objectContaining({
        from: "gpu-ready",
        generation: 2,
        outcome: "committed",
        to: "recovering",
      }),
      expect.objectContaining({
        from: "recovering",
        generation: 2,
        outcome: "committed",
        requestedGeneration: 2,
        to: "gpu-ready",
      }),
    ]);
  });

  it("rejects operation commits without a generation token", () => {
    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });
    expectAccepted(
      lifecycle.transition({
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    );

    const rejected = lifecycle.transition({
      reason: "gpu-attached",
      to: "gpu-ready",
    });

    expect(rejected).toEqual(
      expect.objectContaining({
        accepted: false,
        rejection: "generation-token-required",
      }),
    );
    expect(lifecycle.getSnapshot()).toEqual(
      expect.objectContaining({
        generation: 1,
        rejectedTransitionCount: 1,
        state: "gpu-attaching",
        transitionCount: 1,
      }),
    );
  });

  it("invalidates an attaching generation when mode switches to CPU", () => {
    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });
    const attaching = expectAccepted(
      lifecycle.transition({
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    );
    const staleToken = attaching.generationToken;

    expectAccepted(
      lifecycle.transition({
        reason: "mode-cpu",
        to: "cpu-ready",
      }),
    );
    expect(lifecycle.getSnapshot()).toEqual(
      expect.objectContaining({ generation: 2, state: "cpu-ready" }),
    );

    const staleCommit = lifecycle.transition({
      reason: "gpu-attached",
      to: "gpu-ready",
      token: staleToken,
    });

    expect(staleCommit).toEqual(
      expect.objectContaining({
        accepted: false,
        rejection: "stale-generation",
      }),
    );
    expect(staleCommit.transition).toEqual(
      expect.objectContaining({
        from: "cpu-ready",
        generation: 2,
        outcome: "rejected",
        requestedGeneration: 1,
        rejection: "stale-generation",
        to: "gpu-ready",
      }),
    );
  });

  it("rejects illegal and duplicate transitions without mutating state", () => {
    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });

    const illegal = lifecycle.transition({
      reason: "gpu-attached",
      to: "gpu-ready",
    });
    expect(illegal).toEqual(
      expect.objectContaining({
        accepted: false,
        rejection: "illegal-transition",
      }),
    );
    expect(lifecycle.getSnapshot()).toEqual(
      expect.objectContaining({
        generation: 0,
        state: "cpu-ready",
        transitionCount: 0,
      }),
    );

    expectAccepted(
      lifecycle.transition({
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    );
    const duplicate = lifecycle.transition({
      reason: "request-gpu",
      to: "gpu-attaching",
    });
    expect(duplicate).toEqual(
      expect.objectContaining({
        accepted: false,
        rejection: "illegal-transition",
      }),
    );
    expect(lifecycle.getSnapshot()).toEqual(
      expect.objectContaining({
        generation: 1,
        rejectedTransitionCount: 2,
        state: "gpu-attaching",
        transitionCount: 1,
      }),
    );
  });

  it("supports suspend, hidden reaping, cooldown, and manual retry paths", () => {
    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });
    const attaching = expectAccepted(
      lifecycle.transition({
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    );
    expectAccepted(
      lifecycle.transition({
        reason: "gpu-attached",
        to: "gpu-ready",
        token: attaching.generationToken,
      }),
    );
    expectAccepted(
      lifecycle.transition({ reason: "suspend", to: "suspended" }),
    );
    expectAccepted(lifecycle.transition({ reason: "resume", to: "gpu-ready" }));

    const recovering = expectAccepted(
      lifecycle.transition({ reason: "gpu-fault", to: "recovering" }),
    );
    expectAccepted(
      lifecycle.transition({
        fallbackReason: "retry-exhausted",
        reason: "recovery-failed",
        to: "cpu-cooldown",
        token: recovering.generationToken,
      }),
    );

    const retry = expectAccepted(
      lifecycle.transition({
        attempt: 2,
        reason: "manual-retry",
        to: "gpu-attaching",
      }),
    );
    expect(retry.generationToken?.generation).toBe(3);
    expectAccepted(
      lifecycle.transition({
        reason: "operation-cancelled",
        to: "cpu-ready",
        token: retry.generationToken,
      }),
    );
    expect(lifecycle.getSnapshot()).toEqual(
      expect.objectContaining({ generation: 3, state: "cpu-ready" }),
    );
  });

  it("makes dispose idempotent and invalidates an in-flight generation", () => {
    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });
    const attaching = expectAccepted(
      lifecycle.transition({
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    );
    const token = attaching.generationToken;

    const firstDispose = lifecycle.dispose();
    const ledgerAfterFirstDispose = lifecycle.getLedger();
    const secondDispose = lifecycle.dispose();

    expect(secondDispose).toBe(firstDispose);
    expect(lifecycle.getLedger()).toEqual(ledgerAfterFirstDispose);
    expect(firstDispose.snapshot).toEqual(
      expect.objectContaining({
        generation: 2,
        state: "disposed",
        transitionCount: 3,
      }),
    );
    expect(firstDispose.transitions).toEqual([
      expect.objectContaining({
        from: "gpu-attaching",
        generation: 2,
        reason: "dispose-requested",
        to: "disposing",
      }),
      expect.objectContaining({
        from: "disposing",
        generation: 2,
        reason: "dispose-completed",
        to: "disposed",
      }),
    ]);
    expect(token && lifecycle.canCommitGeneration(token)).toBe(false);

    const staleCommit = lifecycle.transition({
      reason: "gpu-attached",
      to: "gpu-ready",
      token,
    });
    expect(staleCommit).toEqual(
      expect.objectContaining({
        accepted: false,
        rejection: "stale-generation",
      }),
    );
  });

  it("keeps the transition ledger bounded and returns immutable copies", () => {
    const lifecycle = createTerminalRendererLifecycle({
      ledgerLimit: 2,
      paneId: "pane-1",
    });

    lifecycle.transition({
      reason: transitionReason("gpu-attached"),
      to: "gpu-ready",
    });
    lifecycle.transition({
      reason: transitionReason("resume"),
      to: "suspended",
    });
    lifecycle.transition({
      reason: transitionReason("recovery-succeeded"),
      to: "recovering",
    });

    const ledger = lifecycle.getLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger.map((entry) => entry.sequence)).toEqual([2, 3]);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger[0])).toBe(true);
  });

  it("validates ledger limits and transition metadata", () => {
    expect(() =>
      createTerminalRendererLifecycle({
        ledgerLimit: 0,
        paneId: "pane-1",
      }),
    ).toThrow(RangeError);

    const lifecycle = createTerminalRendererLifecycle({ paneId: "pane-1" });
    expect(() =>
      lifecycle.transition({
        attempt: -1,
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    ).toThrow(RangeError);
    expect(() =>
      lifecycle.transition({
        durationMs: Number.NaN,
        reason: "request-gpu",
        to: "gpu-attaching",
      }),
    ).toThrow(RangeError);
  });
});
