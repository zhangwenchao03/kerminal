import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppTitleBar } from "./AppTitleBar";

const tauriMocks = vi.hoisted(() => ({
  close: vi.fn(),
  isTauri: vi.fn(),
  minimize: vi.fn(),
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

describe("AppTitleBar", () => {
  beforeEach(() => {
    tauriMocks.close.mockReset();
    tauriMocks.isTauri.mockReset();
    tauriMocks.minimize.mockReset();
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
