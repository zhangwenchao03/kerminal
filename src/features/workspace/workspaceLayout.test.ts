import { describe, expect, it } from "vitest";
import type { TerminalLayoutNode } from "./types";
import {
  collectPaneIds,
  findFirstPaneId,
  removePaneFromLayout,
  splitPaneInLayout,
} from "./workspaceLayout";

describe("workspaceLayout", () => {
  const splitLayout: TerminalLayoutNode = {
    type: "split",
    id: "split-root",
    direction: "horizontal",
    children: [
      { type: "pane", paneId: "pane-a" },
      {
        type: "split",
        id: "split-nested",
        direction: "vertical",
        children: [
          { type: "pane", paneId: "pane-b" },
          { type: "pane", paneId: "pane-c" },
        ],
      },
    ],
  };

  it("collects pane ids in visual layout order", () => {
    expect(collectPaneIds(splitLayout)).toEqual([
      "pane-a",
      "pane-b",
      "pane-c",
    ]);
    expect(findFirstPaneId(splitLayout)).toBe("pane-a");
  });

  it("splits the target pane without changing unrelated panes", () => {
    const nextLayout = splitPaneInLayout(
      splitLayout,
      "pane-b",
      "pane-new",
      "vertical",
      "split-created",
    );

    expect(collectPaneIds(nextLayout)).toEqual([
      "pane-a",
      "pane-b",
      "pane-new",
      "pane-c",
    ]);
    expect(
      JSON.stringify(nextLayout),
    ).toContain("\"id\":\"split-created\"");
  });

  it("removes panes and collapses single-child split nodes", () => {
    const nextLayout = removePaneFromLayout(splitLayout, "pane-c");

    expect(nextLayout).toEqual({
      type: "split",
      id: "split-root",
      direction: "horizontal",
      children: [
        { type: "pane", paneId: "pane-a" },
        { type: "pane", paneId: "pane-b" },
      ],
    });
  });

  it("returns undefined when removing the only pane", () => {
    expect(
      removePaneFromLayout({ type: "pane", paneId: "pane-a" }, "pane-a"),
    ).toBeUndefined();
  });
});
