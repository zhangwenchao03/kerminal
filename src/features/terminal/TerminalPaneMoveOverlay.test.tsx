import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalPaneMoveOverlay } from "./TerminalPaneMoveOverlay";

describe("TerminalPaneMoveOverlay", () => {
  it("labels center drops as pane swaps", () => {
    render(
      <TerminalPaneMoveOverlay
        indicator={{ targetTitle: "api logs", zone: "center" }}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "终端分屏移动目标：交换位置 · api logs",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("交换位置 · api logs")).toBeInTheDocument();
  });

  it("labels edge drops as directional moves", () => {
    render(
      <TerminalPaneMoveOverlay
        indicator={{ targetTitle: "worker", zone: "right" }}
      />,
    );

    expect(screen.getByText("移动到右侧 · worker")).toBeInTheDocument();
  });
});
