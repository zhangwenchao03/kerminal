import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppTitleBar } from "../../../src/app/AppTitleBar";

const windowActionMocks = vi.hoisted(() => ({
  runWindowAction: vi.fn(),
  startWindowDragging: vi.fn(),
}));

vi.mock("../../../src/lib/windowActions", () => ({
  runWindowAction: (...args: unknown[]) =>
    windowActionMocks.runWindowAction(...args),
  startWindowDragging: (...args: unknown[]) =>
    windowActionMocks.startWindowDragging(...args),
}));

describe("AppTitleBar", () => {
  beforeEach(() => {
    windowActionMocks.runWindowAction.mockReset();
    windowActionMocks.startWindowDragging.mockReset();
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
    expect(titleBar).toHaveClass("text-[var(--text-primary)]");
    expect(titleBar).toHaveAttribute("data-resolved-theme", "dark");
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

  it("keeps custom desktop window controls on the right", () => {
    render(
      <AppTitleBar desktopPlatform="windows" resolvedTheme="light" />,
    );

    const titleBar = screen.getByRole("banner");
    const controls = screen.getByLabelText("窗口控制");

    expect(titleBar.lastElementChild).toBe(controls);
    expect(screen.getByRole("button", { name: "最小化窗口" })).toHaveClass(
      "h-7",
    );
    expect(screen.getByRole("button", { name: "关闭窗口" })).toHaveClass(
      "rounded-[var(--radius-control)]",
    );
    expect(screen.getByRole("button", { name: "最大化窗口" })).toHaveAttribute(
      "title",
      "最大化窗口",
    );
  });

  it("reserves the macOS traffic-light inset without rendering fake controls", () => {
    render(
      <AppTitleBar
        desktopPlatform="macos"
        onLeftPanelCollapsedChange={vi.fn()}
        resolvedTheme="light"
      />,
    );

    const titleBar = screen.getByRole("banner");
    expect(titleBar).toHaveAttribute("data-traffic-light-inset", "true");
    expect(titleBar).toHaveStyle({ paddingLeft: "72px" });
    expect(screen.queryByLabelText("窗口控制")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "折叠主机侧边栏" }),
    ).toBeInTheDocument();
  });

  it("renders the restore icon and matching accessible copy when maximized", () => {
    render(
      <AppTitleBar
        desktopPlatform="linux"
        resolvedTheme="dark"
        windowFrameState="maximized"
      />,
    );

    const restoreButton = screen.getByRole("button", { name: "还原窗口" });
    expect(restoreButton).toHaveAttribute("title", "还原窗口");
    expect(
      restoreButton.querySelector('[data-window-control-icon="restore"]'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "最大化窗口" }),
    ).not.toBeInTheDocument();
  });

  it("removes the ineffective maximize action in fullscreen without shifting controls", () => {
    render(
      <AppTitleBar
        desktopPlatform="windows"
        resolvedTheme="dark"
        windowFrameState="fullscreen"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "最大化窗口" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "还原窗口" }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-window-control-placeholder="maximize"]'),
    ).toHaveClass("h-7", "w-7");
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
    const onLeftPanelCollapsedChange = vi.fn();

    render(
      <AppTitleBar
        desktopPlatform="windows"
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

    expect(windowActionMocks.startWindowDragging).toHaveBeenCalledTimes(1);
    expect(onLeftPanelCollapsedChange).not.toHaveBeenCalled();
  });

  it("routes custom window controls through the shared window action facade", async () => {
    const user = userEvent.setup();

    render(
      <AppTitleBar desktopPlatform="windows" resolvedTheme="light" />,
    );

    await user.click(screen.getByRole("button", { name: "最小化窗口" }));
    await user.click(screen.getByRole("button", { name: "最大化窗口" }));
    await user.click(screen.getByRole("button", { name: "关闭窗口" }));

    expect(windowActionMocks.runWindowAction.mock.calls).toEqual([
      ["minimize"],
      ["toggleMaximize"],
      ["close"],
    ]);
  });

  it("delegates blank-region double-click handling to Tauri without a duplicate action", () => {
    render(
      <AppTitleBar desktopPlatform="windows" resolvedTheme="light" />,
    );

    const titleBar = screen.getByRole("banner");
    expect(titleBar).toHaveAttribute("data-tauri-drag-region");
    fireEvent.doubleClick(titleBar, { button: 0 });

    expect(windowActionMocks.runWindowAction).not.toHaveBeenCalled();
  });

  it("does not render desktop controls or customize double-click in browser", () => {
    render(<AppTitleBar desktopPlatform="browser" resolvedTheme="light" />);

    const titleBar = screen.getByRole("banner");
    fireEvent.doubleClick(titleBar, { button: 0 });

    expect(screen.queryByLabelText("窗口控制")).not.toBeInTheDocument();
    expect(windowActionMocks.runWindowAction).not.toHaveBeenCalled();
  });
});
