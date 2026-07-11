import { describe, expect, it } from "vitest";
import { resolveWorkspacePaletteKeyboardCommand } from "../../../../src/features/workspace-overlay/workspacePaletteKeyboardModel";

describe("workspacePaletteKeyboardModel", () => {
  it("wraps navigation and exposes selection and close commands", () => {
    expect(
      resolveWorkspacePaletteKeyboardCommand({
        activeIndex: 2,
        itemCount: 3,
        key: "ArrowDown",
      }),
    ).toEqual({ type: "activate", index: 0 });
    expect(
      resolveWorkspacePaletteKeyboardCommand({
        activeIndex: 0,
        itemCount: 3,
        key: "ArrowUp",
      }),
    ).toEqual({ type: "activate", index: 2 });
    expect(
      resolveWorkspacePaletteKeyboardCommand({
        activeIndex: 1,
        itemCount: 3,
        key: "Enter",
      }),
    ).toEqual({ type: "select", index: 1 });
    expect(
      resolveWorkspacePaletteKeyboardCommand({
        activeIndex: 1,
        itemCount: 3,
        key: "Escape",
      }),
    ).toEqual({ type: "close" });
  });

  it("does not select when there is no active result", () => {
    expect(
      resolveWorkspacePaletteKeyboardCommand({
        activeIndex: -1,
        itemCount: 0,
        key: "Enter",
      }),
    ).toEqual({ type: "none" });
  });
});
