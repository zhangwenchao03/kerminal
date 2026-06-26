import { render, screen, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "../settings/settingsModel";
import { describe, expect, it, vi } from "vitest";
import {
  mocks,
} from "./__tests__/support/XtermPane.testSupport";
import { XtermPane, collectCurrentDirOscSequences } from "./XtermPane";

describe("XtermPane session targets and appearance", () => {
  it("creates a command block for an empty enter without recording history", async () => {
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

    mocks.terminalInstances[0].onDataCallback?.("\r");

    expect(
      await screen.findByLabelText("折叠命令块 空命令"),
    ).toBeInTheDocument();
    expect(mocks.api.writeTerminal).toHaveBeenCalledWith("session-1", "\r");
    expect(mocks.api.recordCommandHistory).not.toHaveBeenCalled();
  });

  it("collects current directory OSC 1337 sequences from terminal output", () => {
    expect(collectCurrentDirOscSequences("", "plain output")).toEqual({
      buffer: "",
      paths: [],
    });

    let state = collectCurrentDirOscSequences(
      "",
      "prompt \u001b]1337;CurrentDir=/srv/app\u0007$ ",
    );
    expect(state).toEqual({ buffer: "", paths: ["/srv/app"] });

    state = collectCurrentDirOscSequences(
      "",
      "\u001b]1337;CurrentDir=/opt/app\u001b\\",
    );
    expect(state).toEqual({ buffer: "", paths: ["/opt/app"] });

    state = collectCurrentDirOscSequences("", "\u001b]1337;Curr");
    expect(state.paths).toEqual([]);
    state = collectCurrentDirOscSequences(
      state.buffer,
      "entDir=/var/www/site\u001b\\",
    );
    expect(state).toEqual({ buffer: "", paths: ["/var/www/site"] });

    state = collectCurrentDirOscSequences(
      "",
      "\u001b]1337;CurrentDir=relative/path\u0007",
    );
    expect(state).toEqual({ buffer: "", paths: [] });

    state = collectCurrentDirOscSequences("", "\r\nroot@pkuai01:/dev# ");
    expect(state).toEqual({ buffer: "", paths: ["/dev"] });

    state = collectCurrentDirOscSequences("", "\r\nroot@pkuai01:/de");
    expect(state.paths).toEqual([]);
    state = collectCurrentDirOscSequences(state.buffer, "v# ");
    expect(state).toEqual({ buffer: "", paths: ["/dev"] });

    state = collectCurrentDirOscSequences("", "\r\nroot@pkuai01:~# ");
    expect(state).toEqual({ buffer: "", paths: [] });
  });

  it("reports SSH cwd changes from OSC output sequences and shell prompts", async () => {
    const onCurrentCwdChange = vi.fn();

    render(
      <XtermPane
        focused
        onCurrentCwdChange={onCurrentCwdChange}
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

    mocks.getLatestOutputHandler()?.({
      data: "\u001b]1337;CurrentDir=/var/log\u0007",
      kind: "data",
      sessionId: "ssh-session-1",
    });
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("/var/log");

    mocks.getLatestOutputHandler()?.({
      data: "\u001b]1337;CurrentDir=/srv/app\u001b\\",
      kind: "data",
      sessionId: "ssh-session-1",
    });
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("/srv/app");

    mocks.getLatestOutputHandler()?.({
      data: "\r\nroot@pkuai01:/dev# ",
      kind: "data",
      sessionId: "ssh-session-1",
    });
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("/dev");
  });

  it("starts an SSH terminal session when a remote host id is provided", async () => {
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
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledWith(
        { cols: 80, hostId: "host-lab", rows: 24 },
        expect.any(Function),
      );
    });

    expect(mocks.api.createTerminalSession).not.toHaveBeenCalled();
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在连接 SSH 主机"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from ssh",
      );
    });
  });

  it("passes the tracked cwd when starting an SSH split terminal", async () => {
    render(
      <XtermPane
        currentCwd="/dev"
        focused
        paneId="pane-ssh"
        remoteHostId="host-lab"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="lab server"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledWith(
        { cols: 80, cwd: "/dev", hostId: "host-lab", rows: 24 },
        expect.any(Function),
      );
    });
  });

  it("starts Telnet and Serial terminal sessions from target refs", async () => {
    const telnetRender = render(
      <XtermPane
        focused
        paneId="pane-telnet"
        resolvedTheme="dark"
        target={{ hostId: "telnet-legacy", kind: "telnet" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="legacy telnet"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTelnetTerminalSession).toHaveBeenCalledWith(
        { cols: 80, hostId: "telnet-legacy", rows: 24 },
        expect.any(Function),
      );
    });
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在连接 Telnet 主机"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from telnet",
      );
    });
    telnetRender.unmount();
    mocks.terminalInstances.length = 0;

    render(
      <XtermPane
        focused
        paneId="pane-serial"
        resolvedTheme="dark"
        target={{ hostId: "serial-console", kind: "serial" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="console serial"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSerialTerminalSession).toHaveBeenCalledWith(
        { cols: 80, hostId: "serial-console", rows: 24 },
        expect.any(Function),
      );
    });
    expect(mocks.api.createSshTerminalSession).not.toHaveBeenCalled();
    expect(mocks.api.createTerminalSession).not.toHaveBeenCalled();
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在连接 Serial 设备"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from serial",
      );
    });
  });

  it("closes the terminal session when unmounted", async () => {
    const { unmount } = render(
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

    unmount();

    expect(mocks.api.closeTerminal).toHaveBeenCalledWith("session-1");
    expect(mocks.terminalInstances[0].dispose).toHaveBeenCalled();
  });

  it("passes terminal appearance and theme options to xterm", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="light"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          colorScheme: "github",
          cursorBlink: false,
          cursorStyle: "bar",
          darkColorScheme: "github",
          fontFamily: "Consolas, monospace",
          fontSize: 16,
          fontWeight: "bold",
          lightColorScheme: "github",
          lineHeight: 1.5,
          macOptionIsMeta: true,
          scrollback: 12000,
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].options).toMatchObject({
      cursorBlink: false,
      cursorStyle: "bar",
      fontFamily: "Consolas, monospace",
      fontSize: 16,
      fontWeight: 600,
      fontWeightBold: 700,
      lineHeight: 1.5,
      macOptionIsMeta: true,
      scrollback: 12000,
    });
    expect(mocks.terminalInstances[0].options.theme).toMatchObject({
      background: "#ffffff",
      foreground: "#24292f",
    });
  });

  it("updates an existing xterm instance when terminal font settings change", async () => {
    const { rerender } = render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          fontFamily: "Cascadia Mono, monospace",
          fontSize: 14,
          fontWeight: "normal",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    const terminal = mocks.terminalInstances[0];
    const terminalElement = screen.getByLabelText("本地 PowerShell xterm 终端");
    expect(terminal.options).toMatchObject({
      fontFamily: "Cascadia Mono, monospace",
      fontSize: 14,
      fontWeight: 400,
    });
    expect(terminalElement).toHaveStyle({
      fontFamily: "Cascadia Mono, monospace",
    });

    rerender(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 18,
          fontWeight: "bold",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(terminal.options).toMatchObject({
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 18,
        fontWeight: 600,
      });
    });
    expect(terminalElement).toHaveStyle({
      fontFamily: "JetBrains Mono, monospace",
    });
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
    expect(mocks.terminalInstances).toHaveLength(1);
  });

});
