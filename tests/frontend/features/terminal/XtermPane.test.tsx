import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  installClipboardMock,
  mocks,
  setTerminalBufferLines,
} from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane, collectSubmittedCommands } from "../../../../src/features/terminal/XtermPane";
import {
  buildTerminalCreateRequest,
  normalizeTerminalSessionSize,
} from "../../../../src/features/terminal/XtermPane.helpers.ts";
import { TerminalPaneLayout } from "../../../../src/features/terminal/TerminalPaneLayout";
import type { TerminalLayoutNode, TerminalPane } from "../../../../src/features/workspace/types";

describe("XtermPane sessions and command blocks", () => {
  it("normalizes transient one-row startup dimensions before creating a session", () => {
    expect(normalizeTerminalSessionSize({ cols: 132, rows: 1 })).toEqual({
      cols: 132,
      rows: 8,
    });
    expect(buildTerminalCreateRequest({ cols: 10, rows: 1 })).toMatchObject({
      cols: 20,
      rows: 8,
    });
  });

  it("starts a terminal session and writes channel output to xterm", async () => {
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
      expect(mocks.api.createTerminalSession).toHaveBeenCalledWith(
        { cols: 100, rows: 30 },
        expect.any(Function),
      );
    });

    expect(screen.getByText("已连接")).toBeInTheDocument();
    expect(mocks.terminalInstances[0].open).toHaveBeenCalled();
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在启动本地终端"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from pty",
      );
    });
    expect(mocks.terminalInstances[0].focus).toHaveBeenCalled();
    expect(mocks.api.resizeTerminal).toHaveBeenCalledWith("session-1", {
      cols: 100,
      rows: 30,
    });
    expect(screen.getByLabelText("本地 PowerShell xterm 终端")).toHaveClass(
      "min-h-0",
    );
    expect(screen.getByLabelText("本地 PowerShell xterm 终端")).not.toHaveClass(
      "py-2",
    );
    expect(
      screen.getByLabelText("本地 PowerShell xterm 终端").parentElement,
    ).toHaveClass("py-2");
    expect(screen.getByLabelText("本地 PowerShell xterm 终端")).not.toHaveClass(
      "min-h-[260px]",
    );
  });

  it("notifies when the active terminal session closes naturally", async () => {
    const onSessionFinished = vi.fn();

    render(
      <XtermPane
        focused
        onSessionFinished={onSessionFinished}
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    act(() => {
      mocks.getLatestOutputHandler()?.({
        data: "",
        kind: "closed",
        sessionId: "session-1",
      });
    });

    expect(onSessionFinished).toHaveBeenCalledWith({
      durationMs: expect.any(Number),
      reason: "closed",
      sessionId: "session-1",
    });
    expect(screen.getByText("已结束")).toBeInTheDocument();
  });

  it("marks the active terminal session closed when status polling sees it exited", async () => {
    vi.useFakeTimers();
    const onConnectionStateChange = vi.fn();
    const onSessionFinished = vi.fn();

    render(
      <XtermPane
        focused
        onConnectionStateChange={onConnectionStateChange}
        onSessionFinished={onSessionFinished}
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("已连接")).toBeInTheDocument();

    mocks.api.listTerminalSessions.mockResolvedValue([
      {
        cols: 80,
        id: "session-1",
        rows: 24,
        shell: "powershell.exe",
        status: "exited",
      },
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mocks.api.listTerminalSessions).toHaveBeenCalled();
    expect(onSessionFinished).toHaveBeenCalledWith({
      durationMs: expect.any(Number),
      reason: "closed",
      sessionId: "session-1",
    });
    expect(onConnectionStateChange).toHaveBeenLastCalledWith("closed");
    expect(screen.getByText("已结束")).toBeInTheDocument();
    expect(
      mocks.terminalInstances[0].write.mock.calls.some(([data]) =>
        String(data).includes("会话已退出"),
      ),
    ).toBe(true);
  });

  it("clears a transient agent startup message when real output arrives", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-agent-claude"
        resolvedTheme="dark"
        startupMessage={"正在加载 Claude...\r\n"}
        terminalAppearance={defaultAppSettings.terminal}
        title="Claude"
        transientStartupMessage
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "正在加载 Claude...\r\n",
    );
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "\x1b[1A\x1b[2K\r",
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from pty",
      );
    });
  });

  it("replays saved terminal output and persists new output chunks", async () => {
    const onOutputHistoryChange = vi.fn();

    render(
      <XtermPane
        focused
        onOutputHistoryChange={onOutputHistoryChange}
        outputHistory={"previous output\r\n"}
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "previous output\r\n",
    );
    await waitFor(() => {
      expect(onOutputHistoryChange).toHaveBeenCalledWith(
        "previous output\r\nhello from pty",
      );
    });
  });

  it("replays saved terminal output from a stable snapshot resolver", async () => {
    const onOutputHistoryChange = vi.fn();

    render(
      <XtermPane
        focused
        onOutputHistoryChange={onOutputHistoryChange}
        paneId="pane-local"
        resolveInitialOutputHistory={() => "resolver output\r\n"}
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "resolver output\r\n",
    );
    await waitFor(() => {
      expect(onOutputHistoryChange).toHaveBeenCalledWith(
        "resolver output\r\nhello from pty",
      );
    });
  });

  it("does not reconnect when equivalent launch options are recreated", async () => {
    const { rerender } = render(
      <XtermPane
        args={["-NoLogo"]}
        env={{ KERMINAL_TEST: "1" }}
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        shell="powershell.exe"
        target={{ kind: "local", profileId: "default" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalledTimes(1);
    });

    rerender(
      <XtermPane
        args={["-NoLogo"]}
        env={{ KERMINAL_TEST: "1" }}
        focused={false}
        paneId="pane-local"
        resolvedTheme="dark"
        shell="powershell.exe"
        target={{ kind: "local", profileId: "default" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    expect(mocks.api.closeTerminal).not.toHaveBeenCalledWith("session-1");
    expect(mocks.api.createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing pane session mounted when the layout becomes split", async () => {
    const sourcePane: TerminalPane = {
      currentCwd: "/dev",
      id: "pane-ssh-1",
      lines: [],
      machineId: "host-lab",
      mode: "ssh",
      prompt: "root@host:~#",
      remoteHostId: "host-lab",
      status: "online",
      title: "host-lab",
    };
    const splitPane: TerminalPane = {
      ...sourcePane,
      id: "pane-ssh-2",
      title: "右侧分屏",
    };
    const singleLayout: TerminalLayoutNode = {
      paneId: sourcePane.id,
      type: "pane",
    };
    const splitLayout: TerminalLayoutNode = {
      children: [
        { paneId: sourcePane.id, type: "pane" },
        { paneId: splitPane.id, type: "pane" },
      ],
      direction: "horizontal",
      id: "split-1",
      type: "split",
    };
    const props = {
      focusedPaneId: sourcePane.id,
      onClosePane: vi.fn(),
      onFocusPane: vi.fn(),
      onSplitPane: vi.fn(),
      panelGroupId: "tab-ssh-1",
      panesById: new Map([[sourcePane.id, sourcePane]]),
      resolvedTheme: "dark" as const,
      terminalAppearance: defaultAppSettings.terminal,
    };
    const { rerender } = render(
      <TerminalPaneLayout {...props} layout={singleLayout} />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TerminalPaneLayout
        {...props}
        focusedPaneId={splitPane.id}
        layout={splitLayout}
        panesById={
          new Map([
            [sourcePane.id, sourcePane],
            [splitPane.id, splitPane],
          ])
        }
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(2);
    });
    expect(mocks.api.closeTerminal).not.toHaveBeenCalledWith("ssh-session-1");
    expect(mocks.terminalInstances[0].dispose).not.toHaveBeenCalled();
    expect(mocks.api.createSshTerminalSession).toHaveBeenNthCalledWith(
      2,
      { cols: 100, cwd: "/dev", hostId: "host-lab", rows: 30 },
      expect.any(Function),
    );
  });

  it("sends user input to the active terminal session", async () => {
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

    mocks.terminalInstances[0].onDataCallback?.("pwd\r");

    expect(mocks.api.writeTerminal).toHaveBeenCalledWith("session-1", "pwd\r");
    expect(mocks.api.recordCommandHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "pwd",
        paneId: "pane-local",
        sessionId: "session-1",
        source: "user",
        target: "local",
      }),
    );
  });

  it("can run agent terminals without shell command assist chrome", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-agent-codex"
        resolvedTheme="dark"
        shellAssistEnabled={false}
        terminalAppearance={defaultAppSettings.terminal}
        title="Codex"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    mocks.terminalInstances[0].onDataCallback?.("服务器的服务\r");

    expect(mocks.api.writeTerminal).toHaveBeenCalledWith(
      "session-1",
      "服务器的服务\r",
    );
    expect(mocks.api.recordCommandHistory).not.toHaveBeenCalled();
    expect(mocks.api.listTerminalSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("命令块色条")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex xterm 终端").parentElement).toHaveClass(
      "pl-3",
    );
    expect(screen.getByLabelText("Codex xterm 终端").parentElement).not.toHaveClass(
      "pl-6",
    );
  });

  it("groups submitted input and output under a command block rail", async () => {
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

    mocks.terminalInstances[0].onDataCallback?.("pwd\r");
    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();

    act(() => {
      mocks.getLatestOutputHandler()?.({
        data: "C:/dev/rust/kerminal\r\n",
        kind: "data",
        sessionId: "session-1",
      });
    });

    expect(screen.queryByLabelText("复制文本块 pwd")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("复制图片 pwd")).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByLabelText("折叠命令块 pwd"), {
      clientX: 32,
      clientY: 48,
    });
    expect(
      screen.getByRole("menu", { name: "命令块 pwd 右键菜单" }),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("复制文本块 pwd"));
    await waitFor(() => {
      expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
        expect.stringContaining("$ pwd"),
      );
    });
    expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("C:/dev/rust/kerminal"),
    );
    expect(clipboard.writeText).not.toHaveBeenCalled();
    mocks.api.writeDesktopClipboardText.mockClear();

    await user.click(screen.getByLabelText("折叠命令块 pwd"));
    expect(screen.getByLabelText("展开命令块 pwd")).toBeInTheDocument();
    const terminalRows = screen
      .getByLabelText("本地 PowerShell xterm 终端")
      .querySelectorAll<HTMLElement>(".xterm-rows > div");
    await waitFor(() => {
      expect(terminalRows[1]).toHaveStyle({ visibility: "hidden" });
      expect(terminalRows[2].style.transform).toContain("translateY(-");
    });
    expect(
      screen.getByLabelText(/命令块 pwd 折叠摘要 \d+ 行/),
    ).toBeInTheDocument();
    expect(screen.getByText(/已折叠 \d+ 行/)).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "命令块操作提示" }),
    ).toHaveTextContent("命令块已折叠");

    fireEvent.contextMenu(screen.getByLabelText("展开命令块 pwd"), {
      clientX: 32,
      clientY: 48,
    });
    await user.click(screen.getByLabelText("复制图片 pwd"));
    await waitFor(() => {
      expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
        expect.stringContaining("$ pwd"),
      );
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(
      screen.getByRole("status", { name: "命令块操作提示" }),
    ).toHaveTextContent("已复制文本");

    await user.click(screen.getByLabelText("展开命令块 pwd"));
    await waitFor(() => {
      expect(terminalRows[1].style.visibility).toBe("");
      expect(terminalRows[2].style.transform).toBe("");
    });
    expect(
      screen.queryByLabelText(/命令块 pwd 折叠摘要 \d+ 行/),
    ).not.toBeInTheDocument();
  });

  it("keeps the first empty enter rail anchored after prompt redraw", async () => {
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

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052>",
      },
      0,
    );

    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    expect(
      await screen.findByLabelText("当前命令行色条 当前命令行"),
    ).toBeInTheDocument();
    expect(
      commandRailTop(
        screen.getByLabelText("当前命令行色条 当前命令行") as HTMLElement,
      ),
    ).toBe(0);

    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const pendingEmptyEnterRail =
      await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(pendingEmptyEnterRail as HTMLElement)).toBe(0);
    expect(
      screen.queryByLabelText("当前命令行色条 当前命令行"),
    ).not.toBeInTheDocument();

    act(() => {
      mocks.getLatestOutputHandler()?.({
        data: "\r\nPS C:\\Users\\24052>",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052>",
        1: "PS C:\\Users\\24052>",
      },
      1,
    );

    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const emptyEnterRail = await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(emptyEnterRail as HTMLElement)).toBe(0);
    expect(commandRailHeight(emptyEnterRail as HTMLElement)).toBeGreaterThan(
      17,
    );
    const currentPromptRail = screen.getByLabelText(
      "当前命令行色条 当前命令行",
    );
    expect(commandRailTop(currentPromptRail as HTMLElement)).toBeCloseTo(
      commandRailHeight(emptyEnterRail as HTMLElement),
    );
  });

  it("anchors an empty enter before synchronous terminal output redraws the prompt", async () => {
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

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$",
      },
      0,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const firstPromptRail = await screen.findByLabelText(
      "当前命令行色条 当前命令行",
    );
    const firstPromptTop = commandRailTop(firstPromptRail as HTMLElement);

    mocks.api.writeTerminal.mockImplementationOnce(() => {
      setTerminalBufferLines(
        terminal,
        {
          0: "ubuntu@ubuntu:~$",
          1: "ubuntu@ubuntu:~$",
        },
        1,
      );
      terminal.onWriteParsedCallback?.();
      return Promise.resolve();
    });

    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const emptyEnterRail = await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(emptyEnterRail as HTMLElement)).toBe(firstPromptTop);
  });

  it("anchors the first empty enter block to the previously detected prompt line", async () => {
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

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "Last login: Sat Jun 20 22:27:25",
        1: "(base) [root@shuziren ~]#",
      },
      1,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const firstPromptRail = await screen.findByLabelText(
      "当前命令行色条 当前命令行",
    );
    const firstPromptTop = commandRailTop(firstPromptRail as HTMLElement);

    setTerminalBufferLines(
      terminal,
      {
        0: "Last login: Sat Jun 20 22:27:25",
        1: "(base) [root@shuziren ~]#",
        2: "(base) [root@shuziren ~]#",
      },
      2,
    );
    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const emptyEnterRail = await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(emptyEnterRail as HTMLElement)).toBe(firstPromptTop);
    expect(commandRailHeight(emptyEnterRail as HTMLElement)).toBeGreaterThan(
      17,
    );
    const currentPromptRail = screen.getByLabelText(
      "当前命令行色条 当前命令行",
    );
    expect(commandRailTop(currentPromptRail as HTMLElement)).toBeCloseTo(
      firstPromptTop + commandRailHeight(emptyEnterRail as HTMLElement),
    );
  });

  it("keeps the first empty enter block and opens the next prompt rail", async () => {
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

    const terminal = mocks.terminalInstances[0];
    const registerMarker = vi.spyOn(terminal, "registerMarker");
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 07:02:58 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const firstPromptRail = await screen.findByLabelText(
      "当前命令行色条 当前命令行",
    );
    const firstPromptTop = commandRailTop(firstPromptRail as HTMLElement);
    expect(registerMarker.mock.calls.map(([offset]) => offset)).toEqual([0]);

    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 07:02:58 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
        3: "ubuntu@ubuntu:~$",
      },
      3,
    );
    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const emptyEnterRail = await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(emptyEnterRail as HTMLElement)).toBe(firstPromptTop);
    const currentPromptRail = screen.getByLabelText(
      "当前命令行色条 当前命令行",
    );
    expect(commandRailTop(currentPromptRail as HTMLElement)).toBeCloseTo(
      firstPromptTop + commandRailHeight(emptyEnterRail as HTMLElement),
    );
    expect(registerMarker.mock.calls.map(([offset]) => offset)).toEqual([
      0,
      -1,
      0,
    ]);
  });

  it("keeps each empty SSH enter rail when opening successive prompts", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="SSH ubuntu"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 08:49:48 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const firstPromptRail = await screen.findByLabelText(
      "当前命令行色条 当前命令行",
    );
    const rowHeight = commandRailHeight(firstPromptRail as HTMLElement);
    expect(commandRailTop(firstPromptRail as HTMLElement)).toBeCloseTo(
      rowHeight * 2,
    );

    act(() => {
      terminal.onDataCallback?.("\r");
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 08:49:48 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
        3: "ubuntu@ubuntu:~$",
      },
      3,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    let emptyRails = await screen.findAllByLabelText("折叠命令块 空命令");
    expect(
      emptyRails.map((rail) => commandRailTop(rail as HTMLElement)),
    ).toEqual([rowHeight * 2]);
    expect(
      commandRailTop(
        screen.getByLabelText("当前命令行色条 当前命令行") as HTMLElement,
      ),
    ).toBeCloseTo(rowHeight * 3);

    act(() => {
      terminal.onDataCallback?.("\r");
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 08:49:48 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
        3: "ubuntu@ubuntu:~$",
        4: "ubuntu@ubuntu:~$",
      },
      4,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    emptyRails = await screen.findAllByLabelText("折叠命令块 空命令");
    expect(
      emptyRails.map((rail) => commandRailTop(rail as HTMLElement)),
    ).toEqual([rowHeight * 2, rowHeight * 3]);
    expect(
      commandRailTop(
        screen.getByLabelText("当前命令行色条 当前命令行") as HTMLElement,
      ),
    ).toBeCloseTo(rowHeight * 4);
  });

  it("closes the previous command block before opening the next one", async () => {
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

    const terminal = mocks.terminalInstances[0];
    const registerMarker = vi.spyOn(terminal, "registerMarker");

    act(() => {
      terminal.onDataCallback?.("pwd\r");
      terminal.onDataCallback?.("ls\r");
    });

    expect(registerMarker.mock.calls.map(([offset]) => offset)).toEqual([
      0,
      -1,
      0,
    ]);
    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();
    expect(await screen.findByLabelText("折叠命令块 ls")).toBeInTheDocument();
  });

  it("clears command block rails when the terminal receives RIS reset", async () => {
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

    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("pwd\r");
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();

    act(() => {
      expect(terminal.triggerEsc("c")).toBe(false);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("折叠命令块 pwd")).not.toBeInTheDocument();
    });
  });

  it("clears command block rails when the terminal erases the display", async () => {
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

    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("pwd\r");
      terminal.onDataCallback?.("clear\r");
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();
    expect(await screen.findByLabelText("折叠命令块 clear")).toBeInTheDocument();

    act(() => {
      expect(terminal.triggerCsi("J", [2])).toBe(false);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("折叠命令块 pwd")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("折叠命令块 clear")).not.toBeInTheDocument();
    });

    act(() => {
      terminal.onDataCallback?.("ls\r");
    });

    expect(await screen.findByLabelText("折叠命令块 ls")).toBeInTheDocument();

    act(() => {
      expect(terminal.triggerCsi("J", [3])).toBe(false);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("折叠命令块 ls")).not.toBeInTheDocument();
    });
  });

  it("restores folded terminal rows when the terminal erases the display", async () => {
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

    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("pwd\r");
      mocks.getLatestOutputHandler()?.({
        data: "C:/dev/rust/kerminal\r\n",
        kind: "data",
        sessionId: "session-1",
      });
    });

    await user.click(await screen.findByLabelText("折叠命令块 pwd"));
    const terminalRows = screen
      .getByLabelText("本地 PowerShell xterm 终端")
      .querySelectorAll<HTMLElement>(".xterm-rows > div");
    await waitFor(() => {
      expect(terminalRows[1]).toHaveStyle({ visibility: "hidden" });
      expect(terminalRows[2].style.transform).toContain("translateY(-");
    });

    act(() => {
      expect(terminal.triggerCsi("J", [2])).toBe(false);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("展开命令块 pwd")).not.toBeInTheDocument();
      expect(terminalRows[1].style.visibility).toBe("");
      expect(terminalRows[2].style.transform).toBe("");
    });
  });

  it("collects submitted commands from terminal input chunks", () => {
    let state = collectSubmittedCommands("", "git statuz");
    expect(state).toEqual({ buffer: "git statuz", commands: [] });

    state = collectSubmittedCommands(state.buffer, "\u007fs\r");
    expect(state).toEqual({ buffer: "", commands: ["git status"] });

    state = collectSubmittedCommands("", "\r");
    expect(state).toEqual({ buffer: "", commands: [""] });

    state = collectSubmittedCommands("", "\u001b[A\r");
    expect(state).toEqual({ buffer: "", commands: [] });
  });
});

function commandRailTop(rail: HTMLElement) {
  const top = Number.parseFloat(rail.parentElement?.style.top ?? "");
  expect(Number.isFinite(top)).toBe(true);
  return top;
}

function commandRailHeight(rail: HTMLElement) {
  const height = Number.parseFloat(rail.parentElement?.style.height ?? "");
  expect(Number.isFinite(height)).toBe(true);
  return height;
}
