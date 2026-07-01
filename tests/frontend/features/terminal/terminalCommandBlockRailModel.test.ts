import { describe, expect, it } from "vitest";
import {
  clampCommandBlockMenuPosition,
  resolveTerminalCommandBlockFoldSummaries,
  resolveTerminalCommandBlockMarkerModel,
} from "../../../../src/features/terminal/terminalCommandBlockRailModel";
import type { TerminalCommandBlockView } from "../../../../src/features/terminal/terminalCommandBlocks";

describe("terminalCommandBlockRailModel", () => {
  it("resolves marker accessibility and action state", () => {
    const expanded = block({ collapsed: false, command: "npm test" });
    const collapsed = block({ collapsed: true, command: "cargo test" });
    const current = block({ command: "ignored", current: true });

    expect(resolveTerminalCommandBlockMarkerModel(expanded)).toMatchObject({
      ariaLabel: "折叠命令块 npm test",
      canOpenMenu: true,
      canToggle: true,
      commandLabel: "npm test",
      icon: "expanded",
      isCurrent: false,
      title: "折叠命令块：npm test；右键复制",
    });
    expect(resolveTerminalCommandBlockMarkerModel(collapsed)).toMatchObject({
      ariaLabel: "展开命令块 cargo test",
      icon: "collapsed",
      title: "展开命令块：cargo test；右键复制",
    });
    expect(resolveTerminalCommandBlockMarkerModel(current)).toMatchObject({
      ariaLabel: "当前命令行色条 当前命令行",
      canOpenMenu: false,
      canToggle: false,
      commandLabel: "当前命令行",
      icon: null,
      isCurrent: true,
      title: "当前等待输入的命令行",
    });
  });

  it("returns only visible collapsed fold summaries", () => {
    expect(
      resolveTerminalCommandBlockFoldSummaries([
        block({ collapsed: true, command: "git status", id: "visible" }),
        block({ collapsed: true, id: "muted", muted: true }),
        block({ collapsed: false, id: "expanded" }),
      ]),
    ).toEqual([
      {
        ariaLabel: "命令块 git status 折叠摘要 4 行",
        height: 64,
        id: "visible",
        lineCount: 4,
        top: 20,
      },
    ]);
  });

  it("clamps menu position to the viewport inset", () => {
    expect(
      clampCommandBlockMenuPosition(500, 500, {
        viewportHeight: 100,
        viewportWidth: 200,
      }),
    ).toEqual({ x: 32, y: 16 });
    expect(
      clampCommandBlockMenuPosition(-20, -40, {
        viewportHeight: 100,
        viewportWidth: 200,
      }),
    ).toEqual({ x: 8, y: 8 });
  });

  it("keeps raw coordinates when viewport dimensions are unavailable", () => {
    expect(clampCommandBlockMenuPosition(120, 80)).toEqual({ x: 120, y: 80 });
  });
});

function block(
  overrides: Partial<TerminalCommandBlockView> = {},
): TerminalCommandBlockView {
  return {
    collapsed: false,
    color: "rgb(14 165 233)",
    command: "echo ok",
    endLine: 5,
    height: 64,
    hiddenLineCount: 0,
    id: "block-1",
    lineCount: 4,
    muted: false,
    originalTop: 20,
    rowHeight: 16,
    startLine: 1,
    top: 20,
    viewportY: 0,
    visibleEndLine: 5,
    visibleStartLine: 1,
    ...overrides,
  };
}
