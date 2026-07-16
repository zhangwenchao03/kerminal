import { describe, expect, it } from "vitest";
import { resolveTerminalSuggestionKeyDecision } from "../../../../src/features/terminal/terminalSuggestionKeyPolicy";
import { DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE } from "../../../../src/features/terminal/terminalSuggestionModel";

describe("terminalSuggestionKeyPolicy", () => {
  it("maps Right and Alt+Right only when a matching suggestion exists", () => {
    expect(decide({ key: "ArrowRight" })).toMatchObject({
      action: "accept-all",
      handled: true,
    });
    expect(decide({ altKey: true, key: "ArrowRight" })).toMatchObject({
      action: "accept-partial",
      handled: true,
    });
    expect(decide({ key: "ArrowRight" }, { hasSuggestion: false }).handled).toBe(false);
  });

  it("does not intercept menu and dismissal keys before TASK-010 is wired", () => {
    expect(decide({ key: " " }).handled).toBe(false);
    expect(decide({ key: "Escape" }).handled).toBe(false);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["hidden", { hidden: true }],
    ["session closed", { sessionOpen: false }],
    ["IME", { imeComposing: true }],
    ["paste", { pasting: true }],
    ["selection", { selectionActive: true }],
    ["search", { searchFocused: true }],
    ["Agent TUI", { inputCompatibilityMode: "agentTui" as const }],
    ["alternate screen", { alternateScreen: true }],
  ])("yields for %s", (_name, lifecycle) => {
    expect(
      decide(
        { key: "ArrowRight" },
        { lifecycle: { ...DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE, ...lifecycle } },
      ).handled,
    ).toBe(false);
  });
});

function decide(
  event: { altKey?: boolean; key: string },
  overrides: {
    hasPartialBoundary?: boolean;
    hasSuggestion?: boolean;
    lifecycle?: typeof DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE;
  } = {},
) {
  return resolveTerminalSuggestionKeyDecision({
    event,
    hasPartialBoundary: overrides.hasPartialBoundary ?? true,
    hasSuggestion: overrides.hasSuggestion ?? true,
    lifecycle: overrides.lifecycle ?? DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE,
  });
}
