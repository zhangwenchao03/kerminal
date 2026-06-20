import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "../settings/settingsModel";
import type { TerminalOutputEvent } from "../../lib/terminalApi";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  installClipboardMock,
  mocks,
} from "./XtermPane.testSupport";
import { XtermPane } from "./XtermPane";

describe("XtermPane context menu search and logging", () => {
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
    await user.click(screen.getByRole("menuitem", { name: /复制/ }));

    expect(clipboard.writeText).toHaveBeenCalledWith("selected output");
    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
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

    expect(clipboard.writeText).toHaveBeenCalledWith("selected output");
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
      expect(clipboard.readText).toHaveBeenCalled();
      expect(mocks.terminalInstances[0].paste).toHaveBeenCalledWith(
        "echo pasted\r",
      );
    });
    expect(
      screen.queryByRole("menu", { name: "终端右键菜单" }),
    ).not.toBeInTheDocument();
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

  it("automatically reconnects after a session closes when enabled", async () => {
    let sequence = 0;
    mocks.api.createTerminalSession.mockImplementation(
      async (_request, onOutput) => {
        sequence += 1;
        const sessionId = `session-${sequence}`;
        mocks.setLatestOutputHandler(
          onOutput as (event: TerminalOutputEvent) => void,
        );
        return {
          cols: 80,
          id: sessionId,
          rows: 24,
          shell: "powershell.exe",
          status: "running",
        };
      },
    );

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

      vi.useFakeTimers();
      act(() => {
        mocks.getLatestOutputHandler()?.({
          data: "",
          kind: "closed",
          sessionId: "session-1",
        });
      });

      expect(screen.getByText("已结束")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
        await Promise.resolve();
      });

      expect(mocks.api.createTerminalSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pastes clipboard text and exposes local terminal actions from the context menu", async () => {
    const user = userEvent.setup();
    const clipboard = installClipboardMock();
    const onOpenLogs = vi.fn();
    const onSplitPane = vi.fn();

    render(
      <XtermPane
        focused
        onOpenLogs={onOpenLogs}
        onSplitPane={onSplitPane}
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
    expect(
      screen.queryByRole("menuitem", { name: "打开设置" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /粘贴/ }));
    expect(clipboard.readText).toHaveBeenCalled();
    expect(mocks.terminalInstances[0].paste).toHaveBeenCalledWith(
      "echo pasted\r",
    );

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "全选" }));
    expect(mocks.terminalInstances[0].selectAll).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "清屏" }));
    expect(mocks.terminalInstances[0].clear).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: /搜索/ }));
    expect(screen.getByRole("form", { name: "终端搜索" })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "打开日志" }));
    expect(onOpenLogs).toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    expect(
      screen.queryByRole("menuitem", { name: "新建本地终端" }),
    ).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "左右分屏" }));
    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "上下分屏" }));
    expect(onSplitPane).toHaveBeenNthCalledWith(1, "horizontal");
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "vertical");
  });

  it("searches the current terminal buffer with xterm search addon", async () => {
    const user = userEvent.setup();

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

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: /搜索/ }));
    await user.type(screen.getByLabelText("搜索终端缓冲区"), "hello");
    await user.click(screen.getByRole("button", { name: "下一个匹配" }));
    mocks.searchInstances[0].emitResults(2, 0);

    expect(mocks.searchInstances[0].findNext).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ caseSensitive: false }),
    );
    expect(await screen.findByText("1/2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上一个匹配" }));
    expect(mocks.searchInstances[0].findPrevious).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ caseSensitive: false }),
    );

    await user.click(screen.getByRole("button", { name: "区分大小写" }));
    await user.click(screen.getByRole("button", { name: "下一个匹配" }));
    expect(mocks.searchInstances[0].findNext).toHaveBeenLastCalledWith(
      "hello",
      expect.objectContaining({ caseSensitive: true }),
    );
  });

  it("clears search decorations when search closes or query is empty", async () => {
    const user = userEvent.setup();

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

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: /搜索/ }));
    const input = screen.getByLabelText("搜索终端缓冲区");
    await user.type(input, "hello");
    await user.clear(input);
    expect(mocks.searchInstances[0].clearDecorations).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "关闭搜索" }));
    expect(mocks.searchInstances[0].clearDecorations).toHaveBeenCalledTimes(2);
    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
  });

  it("starts and stops terminal session logging from the context menu", async () => {
    const user = userEvent.setup();

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

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "开始记录日志" }));

    await waitFor(() => {
      expect(mocks.api.startTerminalLog).toHaveBeenCalledWith("session-1");
    });
    expect(screen.getByLabelText("终端日志记录状态")).toHaveTextContent(
      "记录中",
    );
    expect(
      screen.getByRole("status", { name: "终端日志提示" }),
    ).toHaveTextContent("正在记录日志：session-1.log");

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "停止记录日志" }));

    await waitFor(() => {
      expect(mocks.api.stopTerminalLog).toHaveBeenCalledWith("session-1");
    });
    expect(screen.queryByLabelText("终端日志记录状态")).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "终端日志提示" }),
    ).toHaveTextContent("日志已停止：session-1.log");
  });

  it("disconnects and reconnects a local terminal session from the context menu", async () => {
    const user = userEvent.setup();
    let sequence = 0;
    mocks.api.createTerminalSession.mockImplementation(
      async (_request, onOutput) => {
        sequence += 1;
        const sessionId = `session-${sequence}`;
        mocks.setLatestOutputHandler(
          onOutput as (event: TerminalOutputEvent) => void,
        );
        mocks.getLatestOutputHandler()?.({
          data: `hello from ${sessionId}`,
          kind: "data",
          sessionId,
        });
        return {
          cols: 80,
          id: sessionId,
          rows: 24,
          shell: "powershell.exe",
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        cwd="C:/dev/rust/kerminal"
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        shell="powershell.exe"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "断开连接" }));

    await waitFor(() => {
      expect(mocks.api.closeTerminal).toHaveBeenCalledWith("session-1");
    });
    expect(await screen.findByText("已断开")).toBeInTheDocument();
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("连接已断开"),
    );

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "重新连接" }));

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalledTimes(2);
    });
    expect(mocks.api.createTerminalSession).toHaveBeenLastCalledWith(
      {
        cols: 80,
        cwd: "C:/dev/rust/kerminal",
        rows: 24,
        shell: "powershell.exe",
      },
      expect.any(Function),
    );
    expect(await screen.findByText("已连接")).toBeInTheDocument();
    expect(mocks.api.resizeTerminal).toHaveBeenLastCalledWith("session-2", {
      cols: 100,
      rows: 30,
    });

    mocks.terminalInstances[0].onDataCallback?.("pwd\r");
    expect(mocks.api.writeTerminal).toHaveBeenLastCalledWith(
      "session-2",
      "pwd\r",
    );
  });

  it("reconnects an SSH terminal with the original host id", async () => {
    const user = userEvent.setup();
    let sequence = 0;
    mocks.api.createSshTerminalSession.mockImplementation(
      async (_request, onOutput) => {
        sequence += 1;
        const sessionId = `ssh-session-${sequence}`;
        mocks.setLatestOutputHandler(
          onOutput as (event: TerminalOutputEvent) => void,
        );
        mocks.getLatestOutputHandler()?.({
          data: `hello from ${sessionId}`,
          kind: "data",
          sessionId,
        });
        return {
          cols: 80,
          id: sessionId,
          rows: 24,
          shell: "ssh",
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        focused
        paneId="pane-ssh"
        remoteHostId="host-lab"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="lab server"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByLabelText("lab server xterm 终端"));
    await user.click(screen.getByRole("menuitem", { name: "重新连接" }));

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(2);
    });
    expect(mocks.api.closeTerminal).toHaveBeenCalledWith("ssh-session-1");
    expect(mocks.api.createSshTerminalSession).toHaveBeenLastCalledWith(
      { cols: 80, hostId: "host-lab", rows: 24 },
      expect.any(Function),
    );
    expect(await screen.findByText("已连接")).toBeInTheDocument();
  });

  it("disables copy in the context menu when there is no selection", async () => {
    mocks.terminalInstances.length = 0;
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
    mocks.terminalInstances[0].getSelection.mockReturnValue("");

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"));

    expect(screen.getByRole("menuitem", { name: /复制/ })).toBeDisabled();
  });
});
