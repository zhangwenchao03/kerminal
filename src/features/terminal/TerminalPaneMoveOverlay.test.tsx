import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  TerminalPaneMoveDragPreview,
  TerminalPaneMoveOverlay,
  terminalPaneMovePreviewLines,
} from "./TerminalPaneMoveOverlay";

describe("TerminalPaneMoveOverlay", () => {
  it("labels center drops as pane swaps", () => {
    render(
      <TerminalPaneMoveOverlay
        indicator={{ scope: "pane", targetTitle: "api logs", zone: "center" }}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "终端分屏移动目标：交换位置 · api logs",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("交换位置 · api logs")).not.toBeInTheDocument();
  });

  it("labels edge drops as directional moves", () => {
    render(
      <TerminalPaneMoveOverlay
        indicator={{ scope: "pane", targetTitle: "worker", zone: "right" }}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "终端分屏移动目标：停靠到右侧 · worker",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("停靠到右侧 · worker")).not.toBeInTheDocument();
  });

  it("labels workspace-edge docking as whole-column docking", () => {
    render(
      <TerminalPaneMoveOverlay indicator={{ scope: "workspace", zone: "right" }} />,
    );

    expect(
      screen.getByRole("status", {
        name: "终端分屏移动目标：停靠到右侧整列",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("停靠到右侧整列")).not.toBeInTheDocument();
  });

  it("renders only the active drop zone", () => {
    const { container } = render(
      <TerminalPaneMoveOverlay
        indicator={{ scope: "pane", targetTitle: "worker", zone: "right" }}
      />,
    );

    const zones = container.querySelectorAll(
      "[data-terminal-pane-move-drop-zone]",
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]).toHaveAttribute(
      "data-terminal-pane-move-drop-zone",
      "right",
    );
  });

  it("renders the drag preview as a pane thumbnail without a hint card", () => {
    render(
      <TerminalPaneMoveDragPreview
        hint="停靠到右侧 · worker"
        lines={["$ npm run dev", "", "ready in 200ms"]}
        title="worker"
        x={40}
        y={48}
      />,
    );

    const preview = screen.getByRole("status", {
      name: "正在拖动终端分屏：停靠到右侧 · worker",
    });
    expect(within(preview).getByText("worker")).toBeInTheDocument();
    expect(within(preview).getByText("$ npm run dev")).toBeInTheDocument();
    expect(within(preview).getByText("ready in 200ms")).toBeInTheDocument();
    expect(screen.queryByText("松开后：停靠到右侧 · worker")).not.toBeInTheDocument();
    expect(screen.queryByText("Dockable pane preview")).not.toBeInTheDocument();
  });

  it("keeps the latest non-empty preview lines", () => {
    expect(
      terminalPaneMovePreviewLines([
        "one",
        "",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
      ]),
    ).toEqual(["two", "three", "four", "five", "six", "seven", "eight", "nine"]);
  });
});
