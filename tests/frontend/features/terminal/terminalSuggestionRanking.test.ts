import { describe, expect, it } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { rankTerminalSuggestions } from "../../../../src/features/terminal/terminalSuggestionRanking";

describe("terminalSuggestionRanking", () => {
  it("adapts cached ranges to longer input and keeps ordering stable", () => {
    const ranked = rankTerminalSuggestions(
      [
        { cachedAt: 1, candidate: candidate({ id: "z", score: 0.8 }), stale: false },
        { cachedAt: 1, candidate: candidate({ id: "a", score: 0.8 }), stale: false },
      ],
      {
        contextKey: "ctx",
        cursor: 5,
        input: "git s",
        mode: "inline",
      },
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.candidate).toMatchObject({
      replacementRange: { end: 5, start: 0 },
      suffix: "tatus --short",
    });
  });

  it("filters sensitive, dangerous inline, context-mismatched, and prefix-mismatched candidates", () => {
    const ranked = rankTerminalSuggestions(
      [
        { cachedAt: 1, candidate: candidate({ id: "s", sensitivity: "sensitive" }), stale: false },
        { cachedAt: 1, candidate: candidate({ id: "d", sensitivity: "dangerous" }), stale: false },
        { cachedAt: 1, candidate: candidate({ contextKey: "other", id: "c" }), stale: false },
        { cachedAt: 1, candidate: candidate({ id: "p", replacementText: "npm test" }), stale: false },
      ],
      { contextKey: "ctx", cursor: 3, input: "git", mode: "inline" },
    );
    expect(ranked).toEqual([]);
  });
});

function candidate(
  overrides: Partial<CommandSuggestionCandidate> = {},
): CommandSuggestionCandidate {
  return {
    acceptBoundaries: [10, 17],
    allowedPresentations: ["inline", "menu"],
    displayText: "git status --short",
    id: "history:git-status",
    provider: "history",
    replacementRange: { end: 3, start: 0 },
    replacementText: "git status --short",
    score: 0.9,
    sensitivity: "normal",
    suffix: " status --short",
    ...overrides,
  };
}
