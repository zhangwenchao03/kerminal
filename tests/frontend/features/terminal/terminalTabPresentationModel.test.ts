import { describe, expect, it } from "vitest";
import {
  createTerminalPaneActivityState,
  type TerminalPaneActivityState,
} from "../../../../src/features/terminal/terminalPaneActivityModel";
import type { TerminalPaneChromeSnapshot } from "../../../../src/features/terminal/terminalChromeRuntimeStore";
import {
  resolveTerminalTabGroupPresentation,
  resolveTerminalTabPresentation,
  type TerminalTabPresentation,
} from "../../../../src/features/terminal/terminalTabPresentationModel";

describe("terminalTabPresentationModel", () => {
  it.each([
    ["error", { connectionState: "error" }, "error"],
    ["disconnected", { connectionState: "closed" }, "disconnected"],
    ["warning", { connectionState: "warning" }, "warning"],
    ["bell", { bell: true }, "bell"],
    ["follow paused", { atBottom: false, followPaused: true }, "followPaused"],
    ["unread", { applicationActive: false, unread: true }, "unread"],
    ["none", {}, "none"],
  ] as const)("resolves %s as the highest pane attention", (_, state, expected) => {
    expect(resolveTerminalTabPresentation([pane("a", state)])).toMatchObject({
      attention: expected,
      attentionCount: expected === "none" ? 0 : 1,
    });
  });

  it("keeps lower priorities from replacing the highest attention", () => {
    const presentation = resolveTerminalTabPresentation([
      pane("unread", { applicationActive: false, unread: true }),
      pane("follow", { atBottom: false, followPaused: true }),
      pane("warning", { connectionState: "warning" }),
      pane("error", { connectionState: "error" }),
      pane("bell", { bell: true }),
    ]);

    expect(presentation).toMatchObject({
      attention: "error",
      attentionCount: 1,
      progress: "none",
      progressCount: 0,
      statusLabel: "终端错误",
    });
  });

  it("counts panes sharing the highest attention only", () => {
    const presentation = resolveTerminalTabPresentation([
      pane("error-a", { connectionState: "error" }),
      pane("error-b", { connectionState: "error" }),
      pane("warning", { connectionState: "warning" }),
    ]);

    expect(presentation).toEqual({
      attention: "error",
      attentionCount: 2,
      progress: "none",
      progressCount: 0,
      statusLabel: "2 个窗格：终端错误",
    });
  });

  it("shows reconnecting or connecting only when attention is absent", () => {
    expect(
      resolveTerminalTabPresentation([
        pane("connecting", { connectionState: "connecting" }),
        pane("reconnecting-a", { connectionState: "reconnecting" }),
        pane("reconnecting-b", { connectionState: "reconnecting" }),
      ]),
    ).toEqual({
      attention: "none",
      attentionCount: 0,
      progress: "reconnecting",
      progressCount: 2,
      statusLabel: "2 个窗格：正在重新连接",
    });

    expect(
      resolveTerminalTabPresentation([
        pane("connecting", { connectionState: "connecting" }),
        pane("unread", { applicationActive: false, unread: true }),
      ]),
    ).toMatchObject({
      attention: "unread",
      progress: "none",
      progressCount: 0,
    });
  });

  it("keeps normal connected and empty tabs quiet", () => {
    expect(resolveTerminalTabPresentation([pane("connected")])).toEqual(
      emptyPresentation(),
    );
    expect(resolveTerminalTabPresentation([])).toEqual(
      emptyPresentation(),
    );
  });

  it("aggregates collapsed groups by affected tab count", () => {
    const group = resolveTerminalTabGroupPresentation(
      [
        presentation("error", 2),
        presentation("error", 1),
        presentation("warning", 3),
      ],
      false,
    );

    expect(group).toEqual({
      attention: "error",
      attentionCount: 2,
      progress: "none",
      progressCount: 0,
      statusLabel: "2 个标签页：终端错误",
    });
  });

  it("aggregates progress for collapsed groups without treating it as unread", () => {
    const group = resolveTerminalTabGroupPresentation(
      [
        presentation("none", 0, "connecting"),
        presentation("none", 0, "reconnecting"),
        presentation("none", 0, "reconnecting"),
      ],
      false,
    );

    expect(group).toEqual({
      attention: "none",
      attentionCount: 0,
      progress: "reconnecting",
      progressCount: 2,
      statusLabel: "2 个标签页：正在重新连接",
    });
  });

  it("suppresses the group header while expanded without acknowledging tabs", () => {
    const tabs = [presentation("warning", 1), presentation("unread", 2)];

    expect(resolveTerminalTabGroupPresentation(tabs, true)).toEqual(
      emptyPresentation(),
    );
    expect(tabs).toEqual([
      presentation("warning", 1),
      presentation("unread", 2),
    ]);
  });
});

function pane(
  paneId: string,
  overrides: Partial<TerminalPaneActivityState> = {},
): TerminalPaneChromeSnapshot {
  return {
    ...createTerminalPaneActivityState(overrides),
    paneId,
  };
}

function presentation(
  attention: TerminalTabPresentation["attention"],
  attentionCount: number,
  progress: TerminalTabPresentation["progress"] = "none",
): TerminalTabPresentation {
  return {
    attention,
    attentionCount,
    progress,
    progressCount: progress === "none" ? 0 : 1,
    statusLabel: "",
  };
}

function emptyPresentation(): TerminalTabPresentation {
  return {
    attention: "none",
    attentionCount: 0,
    progress: "none",
    progressCount: 0,
    statusLabel: "",
  };
}
