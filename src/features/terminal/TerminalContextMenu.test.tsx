import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  splitDirectionForMenuAction,
  TerminalContextMenu,
} from "./TerminalContextMenu";

describe("TerminalContextMenu", () => {
  it("renders terminal actions at the requested position", () => {
    render(
      <TerminalContextMenu
        canCopy
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 120, y: 80 }}
      />,
    );

    const menu = screen.getByRole("menu", { name: "终端右键菜单" });
    expect(menu).toHaveStyle({ left: "120px", top: "80px" });
    expect(screen.getByRole("menuitem", { name: /复制/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /粘贴/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "开始记录日志" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "打开日志" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "重新连接" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "断开连接" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "左右分屏" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "打开设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "新建本地终端" })).not.toBeInTheDocument();
  });

  it("renders stop log action while terminal logging is active", () => {
    render(
      <TerminalContextMenu
        canCopy
        isLogging
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 0, y: 0 }}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "停止记录日志" })).toBeEnabled();
  });

  it("disables copy without a terminal selection", () => {
    render(
      <TerminalContextMenu
        canCopy={false}
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 0, y: 0 }}
      />,
    );

    expect(screen.getByRole("menuitem", { name: /复制/ })).toBeDisabled();
  });

  it("can disable connection lifecycle actions", () => {
    render(
      <TerminalContextMenu
        canCopy
        canDisconnect={false}
        canReconnect={false}
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 0, y: 0 }}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "重新连接" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "断开连接" })).toBeDisabled();
  });

  it("calls the selected action and closes from Escape", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();

    render(
      <TerminalContextMenu
        canCopy
        onAction={onAction}
        onClose={onClose}
        position={{ x: 0, y: 0 }}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: "清屏" }));
    await user.click(screen.getByRole("menuitem", { name: "重新连接" }));
    await user.click(screen.getByRole("menuitem", { name: "断开连接" }));
    await user.click(screen.getByRole("menuitem", { name: "开始记录日志" }));
    await user.keyboard("{Escape}");

    expect(onAction).toHaveBeenCalledWith("clear");
    expect(onAction).toHaveBeenCalledWith("reconnect");
    expect(onAction).toHaveBeenCalledWith("disconnect");
    expect(onAction).toHaveBeenCalledWith("startLog");
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the compact app menu style without the extra close action", () => {
    render(
      <TerminalContextMenu
        canCopy
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 0, y: 0 }}
      />,
    );

    const menu = screen.getByRole("menu", { name: "终端右键菜单" });
    expect(menu).toHaveClass("rounded-xl");
    expect(menu).toHaveClass("shadow-xl");
    expect(
      screen.queryByRole("button", { name: "关闭菜单" }),
    ).not.toBeInTheDocument();
  });

  it("maps split menu actions to workspace split directions", () => {
    expect(splitDirectionForMenuAction("splitHorizontal")).toBe("horizontal");
    expect(splitDirectionForMenuAction("splitVertical")).toBe("vertical");
    expect(splitDirectionForMenuAction("copy")).toBeNull();
  });
});
