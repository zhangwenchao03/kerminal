import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppTitleBar } from "./AppTitleBar";

const tauriMocks = vi.hoisted(() => ({
  close: vi.fn(),
  isTauri: vi.fn(),
  minimize: vi.fn(),
  shortcutPlatform: vi.fn(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriMocks.isTauri(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: tauriMocks.close,
    minimize: tauriMocks.minimize,
    startDragging: tauriMocks.startDragging,
    toggleMaximize: tauriMocks.toggleMaximize,
  }),
}));

vi.mock("../features/settings/keybindingUtils", () => ({
  shortcutPlatform: () => tauriMocks.shortcutPlatform(),
}));

describe("AppTitleBar", () => {
  beforeEach(() => {
    tauriMocks.close.mockReset();
    tauriMocks.isTauri.mockReset();
    tauriMocks.minimize.mockReset();
    tauriMocks.shortcutPlatform.mockReset();
    tauriMocks.shortcutPlatform.mockReturnValue("windows");
    tauriMocks.startDragging.mockReset();
    tauriMocks.toggleMaximize.mockReset();
  });

  it("does not render a settings shortcut in the custom title bar", () => {
    render(<AppTitleBar resolvedTheme="dark" />);

    expect(
      screen.queryByRole("button", { name: "打开设置" }),
    ).not.toBeInTheDocument();
  });

  it("marks the custom title bar as a native drag region", () => {
    render(<AppTitleBar resolvedTheme="light" />);

    expect(screen.getByRole("banner")).toHaveAttribute(
      "data-tauri-drag-region",
    );
  });

  it("can render as a transparent overlay without covering the tab bar", () => {
    render(<AppTitleBar resolvedTheme="dark" surface={false} />);

    const titleBar = screen.getByRole("banner");

    expect(titleBar).not.toHaveClass("kerminal-material-nav");
    expect(titleBar).not.toHaveClass("border-b");
    expect(titleBar).toHaveClass("text-zinc-100");
  });

  it("renders without descriptive Chinese title bar copy", () => {
    render(<AppTitleBar resolvedTheme="light" />);

    expect(screen.queryByText("开发终端工作台")).not.toBeInTheDocument();
    expect(screen.queryByText("本地终端 · SSH · SFTP · AI")).not.toBeInTheDocument();
  });

  it("renders without the Kerminal app logo and title", () => {
    render(<AppTitleBar resolvedTheme="light" />);

    expect(
      screen.queryByRole("img", { name: "Kerminal logo" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Kerminal")).not.toBeInTheDocument();
  });

  it("keeps Windows-style window controls on the right by default", () => {
    render(<AppTitleBar resolvedTheme="light" />);

    const titleBar = screen.getByRole("banner");
    const controls = screen.getByLabelText("窗口控制");

    expect(titleBar.lastElementChild).toBe(controls);
    expect(screen.getByRole("button", { name: "最小化窗口" })).toHaveClass(
      "h-7",
    );
    expect(screen.getByRole("button", { name: "关闭窗口" })).toHaveClass(
      "rounded-lg",
    );
  });

  it("moves macOS window controls to the left in traffic-light order", () => {
    tauriMocks.shortcutPlatform.mockReturnValue("mac");

    render(
      <AppTitleBar
        onLeftPanelCollapsedChange={vi.fn()}
        resolvedTheme="light"
      />,
    );

    const titleBar = screen.getByRole("banner");
    const leftCluster = titleBar.firstElementChild;
    const controls = screen.getByLabelText("窗口控制");
    const buttons = within(controls).getAllByRole("button");

    expect(leftCluster?.firstElementChild).toBe(controls);
    expect(titleBar.lastElementChild).not.toBe(controls);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "关闭窗口",
      "最小化窗口",
      "最大化或还原窗口",
    ]);
    expect(screen.getByRole("button", { name: "关闭窗口" })).toHaveClass(
      "rounded-full",
    );
    expect(
      screen.getByRole("button", { name: "折叠主机侧边栏" }),
    ).toBeInTheDocument();
  });

  it("toggles the left machine sidebar from the top-left control", async () => {
    const user = userEvent.setup();
    const onLeftPanelCollapsedChange = vi.fn();

    render(
      <AppTitleBar
        onLeftPanelCollapsedChange={onLeftPanelCollapsedChange}
        resolvedTheme="light"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "折叠主机侧边栏" }),
    );

    expect(onLeftPanelCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("starts native window dragging from the top-left control without toggling", () => {
    tauriMocks.isTauri.mockReturnValue(true);
    const onLeftPanelCollapsedChange = vi.fn();

    render(
      <AppTitleBar
        onLeftPanelCollapsedChange={onLeftPanelCollapsedChange}
        resolvedTheme="light"
      />,
    );

    const collapseButton = screen.getByRole("button", {
      name: "折叠主机侧边栏",
    });

    fireEvent.pointerDown(collapseButton, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(collapseButton, {
      clientX: 18,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.click(collapseButton);

    expect(tauriMocks.startDragging).toHaveBeenCalledTimes(1);
    expect(onLeftPanelCollapsedChange).not.toHaveBeenCalled();
  });

  it("routes window controls through Tauri when running in desktop", async () => {
    const user = userEvent.setup();
    tauriMocks.isTauri.mockReturnValue(true);

    render(<AppTitleBar resolvedTheme="light" />);

    await user.click(screen.getByRole("button", { name: "最小化窗口" }));
    await user.click(
      screen.getByRole("button", { name: "最大化或还原窗口" }),
    );
    await user.click(screen.getByRole("button", { name: "关闭窗口" }));

    expect(tauriMocks.minimize).toHaveBeenCalledTimes(1);
    expect(tauriMocks.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(tauriMocks.close).toHaveBeenCalledTimes(1);
  });

  it("keeps window controls harmless in browser preview", async () => {
    const user = userEvent.setup();
    tauriMocks.isTauri.mockReturnValue(false);

    render(<AppTitleBar resolvedTheme="light" />);

    await user.click(screen.getByRole("button", { name: "最小化窗口" }));

    expect(tauriMocks.minimize).not.toHaveBeenCalled();
  });
});
