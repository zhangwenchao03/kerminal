import { afterEach, describe, expect, it } from "vitest";
import {
  createTerminalOutputInstrumentation,
  runTerminalOutputInstrumentationStep,
  type TerminalOutputInstrumentationState,
} from "../../../../src/features/terminal/terminalOutputInstrumentation";

const GLOBAL_KEY = "__kerminalTerminalOutputInstrumentation";

function setGlobalInstrumentation(
  state: TerminalOutputInstrumentationState | undefined,
) {
  Object.defineProperty(globalThis, GLOBAL_KEY, {
    configurable: true,
    value: state,
  });
}

describe("terminalOutputInstrumentation", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, GLOBAL_KEY);
  });

  it("is disabled by default", () => {
    const instrumentation = createTerminalOutputInstrumentation({
      paneId: "pane-1",
    });

    expect(instrumentation).toBeNull();
    expect(
      runTerminalOutputInstrumentationStep(
        instrumentation,
        "writer",
        12,
        () => "written",
      ),
    ).toBe("written");
  });

  it("aggregates counts, chars, and durations when enabled", () => {
    const state: TerminalOutputInstrumentationState = { enabled: true };
    setGlobalInstrumentation(state);
    const instrumentation = createTerminalOutputInstrumentation({
      paneId: "pane-1",
    });

    runTerminalOutputInstrumentationStep(
      instrumentation,
      "commandBlock",
      5,
      () => undefined,
    );
    runTerminalOutputInstrumentationStep(
      instrumentation,
      "commandBlock",
      7,
      () => undefined,
    );

    expect(state.buckets?.commandBlock).toMatchObject({
      count: 2,
      totalChars: 12,
    });
    expect(state.buckets?.commandBlock?.totalMs).toBeGreaterThanOrEqual(0);
    expect(state.buckets?.commandBlock?.maxMs).toBeGreaterThanOrEqual(0);
  });
});
