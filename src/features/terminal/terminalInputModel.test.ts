import { describe, expect, it } from "vitest";
import {
  applyTerminalInputData,
  createTerminalInputModelState,
  terminalSuggestionEligibility,
  updateTerminalInputBufferKind,
  updateTerminalInputComposition,
  type TerminalInputModelState,
} from "./terminalInputModel";

describe("terminalInputModel", () => {
  it("tracks submitted commands across chunks", () => {
    let update = applyTerminalInputData(
      createTerminalInputModelState(),
      "git statuz",
    );

    expect(update.commands).toEqual([]);
    expect(update.state.command).toBe("git statuz");

    update = applyTerminalInputData(update.state, "\u007fs\r");

    expect(update.commands).toEqual(["git status"]);
    expect(update.state.command).toBe("");
  });

  it("edits at the cursor with arrows, home, end, and delete", () => {
    let state = typeChars("abcd");

    state = applyTerminalInputData(state, "\u001b[D\u001b[D").state;
    expect(state.cursor).toBe(2);

    state = applyTerminalInputData(state, "X").state;
    expect(state.command).toBe("abXcd");
    expect(state.cursor).toBe(3);

    state = applyTerminalInputData(state, "\u001b[3~").state;
    expect(state.command).toBe("abXd");

    state = applyTerminalInputData(state, "\u001b[H").state;
    expect(state.cursor).toBe(0);

    state = applyTerminalInputData(state, "\u001b[F").state;
    expect(state.cursor).toBe(4);
  });

  it("handles readline-style cancellation and word deletion", () => {
    let state = typeChars("git checkout feature");

    state = applyTerminalInputData(state, "\u0017").state;
    expect(state.command).toBe("git checkout ");
    expect(state.cursor).toBe(13);

    state = applyTerminalInputData(state, "\u0015").state;
    expect(state.command).toBe("");
    expect(state.cursor).toBe(0);

    state = typeChars("rm -rf /");
    state = applyTerminalInputData(state, "\u0003").state;
    expect(state.command).toBe("");
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "empty",
    });
  });

  it("skips empty submits after shell history navigation", () => {
    const update = applyTerminalInputData(
      createTerminalInputModelState(),
      "\u001b[A\r",
    );

    expect(update.commands).toEqual([]);
    expect(update.state.command).toBe("");
  });

  it("hides suggestions in conservative terminal states", () => {
    let state = typeChars("git status");

    expect(terminalSuggestionEligibility(state)).toEqual({ eligible: true });

    state = applyTerminalInputData(state, "\u001b[D").state;
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "cursor-not-at-end",
    });

    state = applyTerminalInputData(state, "\t").state;
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "tab-completion",
    });

    state = updateTerminalInputBufferKind(state, "alternate");
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "alternate-buffer",
    });
  });

  it("resets and ignores command input while alternate buffer is active", () => {
    let state = typeChars("git");

    state = updateTerminalInputBufferKind(state, "alternate");
    expect(state.command).toBe("");
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "alternate-buffer",
    });

    const alternateUpdate = applyTerminalInputData(state, "xi\r");
    expect(alternateUpdate.commands).toEqual([]);
    expect(alternateUpdate.state.command).toBe("");

    state = updateTerminalInputBufferKind(alternateUpdate.state, "normal");
    expect(state.command).toBe("");
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "empty",
    });

    state = applyTerminalInputData(state, "l").state;
    state = applyTerminalInputData(state, "s").state;
    expect(state.command).toBe("ls");
    expect(terminalSuggestionEligibility(state)).toEqual({ eligible: true });
  });

  it("suppresses paste-like chunks and recovers on the next prompt", () => {
    let update = applyTerminalInputData(
      createTerminalInputModelState(),
      "\u001b[200~git status\u001b[201~",
    );

    expect(update.commands).toEqual([]);
    expect(update.state.command).toBe("git status");
    expect(terminalSuggestionEligibility(update.state).eligible).toBe(false);

    update = applyTerminalInputData(update.state, "\r");
    expect(update.commands).toEqual(["git status"]);
    expect(update.state.command).toBe("");
    expect(terminalSuggestionEligibility(update.state)).toEqual({
      eligible: false,
      reason: "empty",
    });

    let state = applyTerminalInputData(update.state, "g").state;
    state = applyTerminalInputData(state, "i").state;
    state = applyTerminalInputData(state, "t").state;
    expect(terminalSuggestionEligibility(state)).toEqual({ eligible: true });

    update = applyTerminalInputData(
      createTerminalInputModelState(),
      "echo one\necho two",
    );
    expect(update.commands).toEqual(["echo one"]);
    expect(update.state.command).toBe("echo two");
    expect(terminalSuggestionEligibility(update.state).eligible).toBe(false);
  });

  it("keeps IME and wide-character input safe", () => {
    let state = typeChars("echo 你好");

    expect(state.command).toBe("echo 你好");
    expect(state.cursor).toBe(7);

    state = applyTerminalInputData(state, "\u007f").state;
    expect(state.command).toBe("echo 你");
    expect(state.cursor).toBe(6);

    state = updateTerminalInputComposition(state, true);
    expect(terminalSuggestionEligibility(state)).toEqual({
      eligible: false,
      reason: "ime-composition",
    });
  });
});

function typeChars(value: string): TerminalInputModelState {
  let state = createTerminalInputModelState();
  for (const char of Array.from(value)) {
    state = applyTerminalInputData(state, char).state;
  }
  return state;
}
