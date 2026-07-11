import { describe, expect, it } from "vitest";
import { resolveTerminalArtifactListKeyboardCommand } from "../../../../../../src/features/terminal/artifacts/public";

describe("terminal artifact list keyboard model", () => {
  it("wraps arrow navigation and supports boundaries", () => {
    expect(
      resolveTerminalArtifactListKeyboardCommand({
        currentIndex: 2,
        itemCount: 3,
        key: "ArrowDown",
      }),
    ).toEqual({ index: 0, type: "focus" });
    expect(
      resolveTerminalArtifactListKeyboardCommand({
        currentIndex: 0,
        itemCount: 3,
        key: "ArrowUp",
      }),
    ).toEqual({ index: 2, type: "focus" });
    expect(
      resolveTerminalArtifactListKeyboardCommand({
        currentIndex: 1,
        itemCount: 3,
        key: "End",
      }),
    ).toEqual({ index: 2, type: "focus" });
  });

  it("ignores keys when the list is empty", () => {
    expect(
      resolveTerminalArtifactListKeyboardCommand({
        currentIndex: 0,
        itemCount: 0,
        key: "Enter",
      }),
    ).toEqual({ type: "none" });
  });
});
