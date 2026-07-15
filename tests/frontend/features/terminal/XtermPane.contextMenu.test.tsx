import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installClipboardMock, mocks } from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../src/features/terminal/XtermPane";
import { consumeAgentSendRequest, getAgentSendRequestSnapshot } from "../../../../src/features/agent-workflow/agentSendRequestStore";

describe("XtermPane context menu search and logging", () => {
  beforeEach(() => {
    const pendingRequest = getAgentSendRequestSnapshot().request;
    if (pendingRequest) consumeAgentSendRequest(pendingRequest.id);
  });

  it("opens a context menu and copies the current selection", async () => {
    const user = userEvent.setup();
    const clipboard = installClipboardMock();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
      clientX: 120,
      clientY: 80,
    });
    await user.click(screen.getByRole("menuitem", { name: "复制Ctrl+C" }));

    expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
      "selected output",
    );
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
  });

  it("copies the current pane session id from the context menu", async () => {
    const user = userEvent.setup();
    installClipboardMock();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
      clientX: 120,
      clientY: 80,
    });
    await user.click(screen.getByRole("menuitem", { name: "复制会话 ID" }));

    expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
      "session-1",
    );
    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
  });

  it("routes selection and context actions to the Agent request bridge", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(
      screen.getByRole("menuitem", { name: "发送选中内容到 Agent" }),
    );
    expect(getAgentSendRequestSnapshot().request).toMatchObject({
      paneId: "pane-local",
      source: "selection",
    });
    expect(
      screen.getByText("已将选中内容交给 Agent，等待发送预览"),
    ).toBeInTheDocument();

    const pendingRequest = getAgentSendRequestSnapshot().request;
    if (pendingRequest) consumeAgentSendRequest(pendingRequest.id);
    rerender(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );
    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(
      screen.getByRole("menuitem", {
        name: "发送当前终端上下文到 Agent",
      }),
    );
    expect(getAgentSendRequestSnapshot().request).toMatchObject({
      paneId: "pane-local",
      source: "context",
    });
    expect(
      screen.getByText("已将终端上下文交给 Agent，等待发送预览"),
    ).toBeInTheDocument();
  });

  it("keeps the context menu at the right-click point when the measured menu fits", async () => {
    const restoreViewport = stubWindowViewport({ height: 640, width: 800 });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("aria-label") === "终端右键菜单") {
          return domRect({ height: 304, width: 224 });
        }
        return domRect();
      });

    try {
      render(
        <XtermPane
          focused
          paneId="pane-local"
          resolvedTheme="dark"
          terminalAppearance={defaultAppSettings.terminal}
          title="本地 PowerShell"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("已连接")).toBeInTheDocument();
      });

      fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
        clientX: 420,
        clientY: 320,
      });

      await waitFor(() => {
        expect(screen.getByRole("menu", { name: "终端右键菜单" })).toHaveStyle({
          left: "420px",
          top: "320px",
        });
      });
    } finally {
      rectSpy.mockRestore();
      restoreViewport();
    }
  });

  it("portals the context menu outside clipped split pane containers", async () => {
    render(
      <div className="split-pane-host" style={{ overflow: "hidden" }}>
        <XtermPane
          focused
          paneId="pane-local"
          resolvedTheme="dark"
          terminalAppearance={defaultAppSettings.terminal}
          title="本地 PowerShell"
        />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
      clientX: 420,
      clientY: 320,
    });

    const menu = screen.getByRole("menu", { name: "终端右键菜单" });
    expect(menu.parentElement).toBe(document.body);
    expect(menu.closest(".split-pane-host")).toBeNull();
  });

  it("copies selected text when selection-copy is enabled", async () => {
    const clipboard = installClipboardMock();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          selectionCopy: true,
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    mocks.terminalInstances[0].emitSelectionChange();

    expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
      "selected output",
    );
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("pastes directly on right-click when configured", async () => {
    const clipboard = installClipboardMock();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          rightClickBehavior: "paste",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));

    await waitFor(() => {
      expect(mocks.api.readTerminalClipboardText).toHaveBeenCalled();
      expect(mocks.terminalInstances[0].paste).toHaveBeenCalledWith(
        "echo pasted\r",
      );
    });
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menu", { name: "终端右键菜单" }),
    ).not.toBeInTheDocument();
  });

  it("opens the terminal menu with Shift+right-click when paste is configured", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          rightClickBehavior: "paste",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });
    mocks.api.readTerminalClipboardText.mockClear();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
      shiftKey: true,
    });

    expect(
      screen.getByRole("menu", { name: "终端右键菜单" }),
    ).toBeInTheDocument();
    expect(mocks.api.readTerminalClipboardText).not.toHaveBeenCalled();
  });

  it("focuses only on right-click when terminal actions are disabled", async () => {
    const clipboard = installClipboardMock();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          rightClickBehavior: "none",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });
    mocks.terminalInstances[0].focus.mockClear();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));

    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menu", { name: "终端右键菜单" }),
    ).not.toBeInTheDocument();
  });

  it("opens the terminal menu with Shift+right-click when no action is configured", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          rightClickBehavior: "none",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
      shiftKey: true,
    });

    expect(
      screen.getByRole("menu", { name: "终端右键菜单" }),
    ).toBeInTheDocument();
  });


});

function stubWindowViewport({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  const previousHeight = window.innerHeight;
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  return () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: previousHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousWidth,
    });
  };
}

function domRect({
  height = 0,
  width = 0,
}: {
  height?: number;
  width?: number;
} = {}): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}
