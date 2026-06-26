import { describe, expect, it } from "vitest";
import type { TerminalLayoutNode } from "./types";
import {
  collectPaneIds,
  findFirstPaneId,
  movePaneInLayout,
  removePaneFromLayout,
  splitPaneInLayout,
  swapPanePositionsInLayout,
  updateSplitLayoutSizes,
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

  it("can split before the target pane when requested", () => {
    const nextLayout = splitPaneInLayout(
      splitLayout,
      "pane-b",
      "pane-new",
      "vertical",
      "split-created",
      "before",
    );

    expect(collectPaneIds(nextLayout)).toEqual([
      "pane-a",
      "pane-new",
      "pane-b",
      "pane-c",
    ]);
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

  it("updates split layout sizes by child keys", () => {
    const nextLayout = updateSplitLayoutSizes(splitLayout, "split-root", {
      "pane-a": 36.12345,
      "split-nested": 63.87654,
    });

    expect(nextLayout).toEqual({
      ...splitLayout,
      sizes: {
        "pane-a": 36.123,
        "split-nested": 63.877,
      },
    });
  });

  it("drops stale split sizes when children change", () => {
    const layoutWithSizes: TerminalLayoutNode = {
      ...splitLayout,
      sizes: {
        "pane-a": 40,
        "split-nested": 60,
      },
    };

    expect(removePaneFromLayout(layoutWithSizes, "pane-c")).toEqual({
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

  it("moves a pane as a sibling when the target split direction matches", () => {
    const nextLayout = movePaneInLayout(splitLayout, {
      placement: "top",
      sourcePaneId: "pane-a",
      splitId: "split-move-1",
      targetPaneId: "pane-c",
    });

    expect(nextLayout).toEqual({
      type: "split",
      id: "split-nested",
      direction: "vertical",
      children: [
        { type: "pane", paneId: "pane-b" },
        { type: "pane", paneId: "pane-a" },
        { type: "pane", paneId: "pane-c" },
      ],
    });
  });

  it("wraps the target pane when moving across split directions", () => {
    const nextLayout = movePaneInLayout(splitLayout, {
      placement: "right",
      sourcePaneId: "pane-a",
      splitId: "split-move-1",
      targetPaneId: "pane-b",
    });

    expect(nextLayout).toEqual({
      type: "split",
      id: "split-nested",
      direction: "vertical",
      children: [
        {
          type: "split",
          id: "split-move-1",
          direction: "horizontal",
          children: [
            { type: "pane", paneId: "pane-b" },
            { type: "pane", paneId: "pane-a" },
          ],
        },
        { type: "pane", paneId: "pane-c" },
      ],
    });
  });

  it("swaps pane positions without changing split structure", () => {
    const nextLayout = swapPanePositionsInLayout(
      splitLayout,
      "pane-a",
      "pane-c",
    );

    expect(nextLayout).toEqual({
      ...splitLayout,
      children: [
        { type: "pane", paneId: "pane-c" },
        {
          type: "split",
          id: "split-nested",
          direction: "vertical",
          children: [
            { type: "pane", paneId: "pane-b" },
            { type: "pane", paneId: "pane-a" },
          ],
        },
      ],
    });
  });

  it("returns the original layout for invalid pane moves", () => {
    expect(
      movePaneInLayout(splitLayout, {
        placement: "left",
        sourcePaneId: "pane-a",
        splitId: "split-move-1",
        targetPaneId: "pane-a",
      }),
    ).toBe(splitLayout);
    expect(
      movePaneInLayout(splitLayout, {
        placement: "right",
        sourcePaneId: "pane-missing",
        splitId: "split-move-1",
        targetPaneId: "pane-b",
      }),
    ).toBe(splitLayout);
    expect(
      movePaneInLayout(splitLayout, {
        placement: "center",
        sourcePaneId: "pane-a",
        splitId: "split-move-1",
        targetPaneId: "pane-missing",
      }),
    ).toBe(splitLayout);
  });
});
