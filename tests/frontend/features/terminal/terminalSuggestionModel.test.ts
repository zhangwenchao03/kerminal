import { describe, expect, it } from "vitest";
import {
  createTerminalSuggestionQuery,
  DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE,
  terminalSuggestionQueryIdentity,
} from "../../../../src/features/terminal/terminalSuggestionModel";

describe("terminalSuggestionModel", () => {
  it("builds a pane-local generation request with a stable identity", () => {
    const query = createTerminalSuggestionQuery("pane-a", 7, {
      contextKey: "ssh:host:/srv",
      cursor: 99,
      input: "服务",
      lifecycle: DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE,
      request: { providers: ["history", "spec"] },
    });

    expect(query).toMatchObject({
      cursor: 2,
      generation: 7,
      paneId: "pane-a",
      request: {
        contextKey: "ssh:host:/srv",
        cursor: 2,
        generation: 7,
        paneId: "pane-a",
      },
    });
    expect(terminalSuggestionQueryIdentity(query)).toContain("pane-a");
  });
});
