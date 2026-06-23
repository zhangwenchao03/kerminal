import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TerminalCommandBlockRail } from "./TerminalCommandBlockRail";
import type { TerminalCommandBlockView } from "./terminalCommandBlocks";

describe("TerminalCommandBlockRail", () => {
  it("renders command markers and fold summaries", () => {
    render(
      <TerminalCommandBlockRail
        blocks={[
          block({ collapsed: true, command: "npm run build", id: "build" }),
          block({ current: true, id: "current" }),
        ]}
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "展开命令块 npm run build" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "当前命令行色条 当前命令行" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("命令块 npm run build 折叠摘要 4 行"),
    ).toHaveTextContent("已折叠 4 行");
  });

  it("toggles only completed command blocks", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <TerminalCommandBlockRail
        blocks={[
          block({ command: "git status", id: "completed" }),
          block({ current: true, id: "current" }),
        ]}
        onAction={onAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "折叠命令块 git status" }));
    await user.click(
      screen.getByRole("button", { name: "当前命令行色条 当前命令行" }),
    );

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("completed", "toggle");
  });

  it("opens the context menu for completed blocks and executes copy actions", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <TerminalCommandBlockRail
        blocks={[block({ command: "cargo test", id: "cargo" })]}
        onAction={onAction}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "折叠命令块 cargo test" }),
      { clientX: 120, clientY: 80 },
    );

    const menu = screen.getByRole("menu", {
      name: "命令块 cargo test 右键菜单",
    });
    expect(menu).toHaveStyle({ left: "120px", top: "80px" });

    await user.click(screen.getByRole("menuitem", { name: "复制文本块 cargo test" }));

    expect(onAction).toHaveBeenCalledWith("cargo", "copyText");
    expect(
      screen.queryByRole("menu", { name: "命令块 cargo test 右键菜单" }),
    ).not.toBeInTheDocument();
  });

  it("closes the context menu from Escape", () => {
    render(
      <TerminalCommandBlockRail
        blocks={[block({ command: "pnpm test", id: "pnpm" })]}
        onAction={vi.fn()}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "折叠命令块 pnpm test" }),
      { clientX: 120, clientY: 80 },
    );

    expect(
      screen.getByRole("menu", { name: "命令块 pnpm test 右键菜单" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(
      screen.queryByRole("menu", { name: "命令块 pnpm test 右键菜单" }),
    ).not.toBeInTheDocument();
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
