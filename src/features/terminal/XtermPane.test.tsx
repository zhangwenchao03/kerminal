import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "../settings/settingsModel";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  installClipboardMock,
  mocks,
  setTerminalBufferLines,
} from "./XtermPane.testSupport";
import { XtermPane, collectSubmittedCommands } from "./XtermPane";

describe("XtermPane sessions and command blocks", () => {
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
        { cols: 80, rows: 24 },
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
      "min-h-[260px]",
    );
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
      expect(clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("$ pwd"),
      );
    });
    expect(
      clipboard.writeText.mock.calls[
        clipboard.writeText.mock.calls.length - 1
      ]?.[0],
    ).toContain("C:/dev/rust/kerminal");

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
      expect(clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("$ pwd"),
      );
    });
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

  it("keeps the current command line rail color while typing before enter", async () => {
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
        0: "ubuntu@ubuntu:~$ ls",
        1: "geo-guard kong plugin_config.json",
        2: "ubuntu@ubuntu:~$",
      },
      2,
    );

    act(() => {
      terminal.onDataCallback?.("ls\r");
    });

    const lsRail = await screen.findByLabelText("折叠命令块 ls");
    const currentRail =
      await screen.findByLabelText("当前命令行色条 当前命令行");
    const lsColor = (lsRail as HTMLElement).style.backgroundColor;
    const currentColor = (currentRail as HTMLElement).style.backgroundColor;
    expect(currentColor).not.toBe(lsColor);

    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$ ls",
        1: "geo-guard kong plugin_config.json",
        2: "ubuntu@ubuntu:~$ g",
      },
      2,
    );
    act(() => {
      terminal.onDataCallback?.("g");
    });

    await waitFor(() => {
      const typingRail = screen.getByLabelText(
        "当前命令行色条 当前命令行",
      ) as HTMLElement;
      expect(typingRail.style.backgroundColor).toBe(currentColor);
      expect(typingRail.style.backgroundColor).not.toBe(lsColor);
    });
    expect(screen.queryByLabelText("折叠命令块 g")).not.toBeInTheDocument();

    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const submittedRail = await screen.findByLabelText("折叠命令块 g");
    expect((submittedRail as HTMLElement).style.backgroundColor).toBe(
      currentColor,
    );
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
