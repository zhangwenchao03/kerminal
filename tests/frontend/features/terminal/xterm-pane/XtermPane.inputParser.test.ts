import { describe, expect, it } from "vitest";
import "../../../support/terminal/XtermPane.testSupport.tsx";
import { collectSubmittedCommands } from "../../../../../src/features/terminal/XtermPane";

describe("XtermPane sessions and command blocks", () => {
  it("collects submitted commands from terminal input chunks", () => {
    let state = collectSubmittedCommands("", "git statuz");
    expect(state).toEqual({ buffer: "git statuz", commands: [] });

    state = collectSubmittedCommands(state.buffer, "\u007fs\r");
    expect(state).toEqual({ buffer: "", commands: ["git status"] });

    state = collectSubmittedCommands("", "\r");
    expect(state).toEqual({ buffer: "", commands: [""] });

    state = collectSubmittedCommands("", "\u001b[A\r");
    expect(state).toEqual({ buffer: "", commands: [] });
  });
});
