import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOutputEvent } from "./terminalApi";

let channelMessageHandler: ((event: TerminalOutputEvent) => void) | undefined;
const invokeMock = vi.fn();
const isTauriMock = vi.fn();
const readDesktopClipboardTextMock = vi.fn();

class MockChannel {
  constructor(onmessage?: (event: TerminalOutputEvent) => void) {
    channelMessageHandler = onmessage;
  }
}

vi.mock("@tauri-apps/api/core", () => ({
  Channel: MockChannel,
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

vi.mock("./desktopClipboardApi", () => ({
  readDesktopClipboardText: () => readDesktopClipboardTextMock(),
}));

describe("terminalApi", () => {
  beforeEach(() => {
    channelMessageHandler = undefined;
    invokeMock.mockReset();
    isTauriMock.mockReset();
    readDesktopClipboardTextMock.mockReset();
  });

  it("creates a Tauri terminal session through a Channel", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 80,
      id: "session-1",
      rows: 24,
      shell: "powershell.exe",
      status: "running",
    });
    const { createTerminalSession } = await import("./terminalApi");
    const onOutput = vi.fn();

    const session = await createTerminalSession(
      { cols: 80, rows: 24 },
      onOutput,
    );
    channelMessageHandler?.({
      data: "output",
      kind: "data",
      sessionId: "session-1",
    });

    expect(session.id).toBe("session-1");
    expect(invokeMock).toHaveBeenCalledWith("terminal_create_session", {
      output: expect.any(MockChannel),
      request: { args: [], cols: 80, env: {}, rows: 24 },
    });
    expect(onOutput).toHaveBeenCalledWith({
      data: "output",
      kind: "data",
      sessionId: "session-1",
    });
  });

  it("uses a browser preview session outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createTerminalSession, writeTerminal } = await import(
      "./terminalApi"
    );
    const onOutput = vi.fn();

    const session = await createTerminalSession(
      { cols: 80, rows: 24 },
      onOutput,
    );
    await writeTerminal(session.id, "pwd\r");

    expect(session.shell).toBe("browser-preview");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining("浏览器预览模式不会执行本地命令"),
        kind: "data",
      }),
    );
  });

  it("creates a Tauri SSH terminal session through the SSH command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 100,
      id: "ssh-session-1",
      rows: 30,
      shell: "ssh",
      status: "running",
    });
    const { createSshTerminalSession } = await import("./terminalApi");
    const onOutput = vi.fn();

    const session = await createSshTerminalSession(
      { cols: 100, hostId: "host-lab", rows: 30 },
      onOutput,
    );
    channelMessageHandler?.({
      data: "remote output",
      kind: "data",
      sessionId: "ssh-session-1",
    });

    expect(session.id).toBe("ssh-session-1");
    expect(invokeMock).toHaveBeenCalledWith("ssh_create_session", {
      output: expect.any(MockChannel),
      request: { cols: 100, hostId: "host-lab", rows: 30 },
    });
    expect(onOutput).toHaveBeenCalledWith({
      data: "remote output",
      kind: "data",
      sessionId: "ssh-session-1",
    });
  });

  it("creates a Tauri Telnet terminal session through the Telnet command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 100,
      id: "telnet-session-1",
      rows: 30,
      shell: "telnet",
      status: "running",
    });
    const { createTelnetTerminalSession } = await import("./terminalApi");
    const onOutput = vi.fn();

    const session = await createTelnetTerminalSession(
      { cols: 100, hostId: "telnet-lab", rows: 30 },
      onOutput,
    );
    channelMessageHandler?.({
      data: "lab output",
      kind: "data",
      sessionId: "telnet-session-1",
    });

    expect(session.id).toBe("telnet-session-1");
    expect(invokeMock).toHaveBeenCalledWith("telnet_create_session", {
      output: expect.any(MockChannel),
      request: { cols: 100, hostId: "telnet-lab", rows: 30 },
    });
    expect(onOutput).toHaveBeenCalledWith({
      data: "lab output",
      kind: "data",
      sessionId: "telnet-session-1",
    });
  });

  it("creates a Tauri Serial terminal session through the Serial command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 100,
      id: "serial-session-1",
      rows: 30,
      shell: "plink",
      status: "running",
    });
    const { createSerialTerminalSession } = await import("./terminalApi");
    const onOutput = vi.fn();

    const session = await createSerialTerminalSession(
      { cols: 100, hostId: "serial-console", rows: 30 },
      onOutput,
    );
    channelMessageHandler?.({
      data: "console output",
      kind: "data",
      sessionId: "serial-session-1",
    });

    expect(session.id).toBe("serial-session-1");
    expect(invokeMock).toHaveBeenCalledWith("serial_create_session", {
      output: expect.any(MockChannel),
      request: { cols: 100, hostId: "serial-console", rows: 30 },
    });
    expect(onOutput).toHaveBeenCalledWith({
      data: "console output",
      kind: "data",
      sessionId: "serial-session-1",
    });
  });

  it("creates a Tauri container terminal session through the Docker command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 100,
      id: "container-session-1",
      rows: 30,
      shell: "ssh",
      status: "running",
    });
    const { createDockerContainerTerminalSession } = await import("./terminalApi");
    const onOutput = vi.fn();

    const session = await createDockerContainerTerminalSession(
      {
        cols: 100,
        containerId: " container-1 ",
        hostId: " host-lab ",
        rows: 30,
      },
      onOutput,
    );

    expect(session.id).toBe("container-session-1");
    expect(invokeMock).toHaveBeenCalledWith("docker_create_container_session", {
      output: expect.any(MockChannel),
      request: {
        cols: 100,
        containerId: "container-1",
        hostId: "host-lab",
        rows: 30,
        runtime: "docker",
      },
    });
  });

  it("starts and stops a Tauri terminal log through terminal commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        active: true,
        bytesWritten: 42,
        path: "C:/Users/dev/.kerminal/logs/sessions/session.log",
        startedAt: "1760000000",
      })
      .mockResolvedValueOnce({
        active: false,
        bytesWritten: 84,
        path: "C:/Users/dev/.kerminal/logs/sessions/session.log",
        startedAt: "1760000000",
      })
      .mockResolvedValueOnce({
        active: false,
        bytesWritten: 0,
      });
    const { getTerminalLogState, startTerminalLog, stopTerminalLog } =
      await import("./terminalApi");

    await expect(startTerminalLog("session-1")).resolves.toMatchObject({
      active: true,
      bytesWritten: 42,
    });
    await expect(stopTerminalLog("session-1")).resolves.toMatchObject({
      active: false,
      bytesWritten: 84,
    });
    await expect(getTerminalLogState("session-1")).resolves.toMatchObject({
      active: false,
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "terminal_start_log", {
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "terminal_stop_log", {
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "terminal_log_state", {
      sessionId: "session-1",
    });
  });

  it("keeps a browser preview log state without touching Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      closeTerminal,
      createTerminalSession,
      getTerminalLogState,
      startTerminalLog,
      stopTerminalLog,
    } = await import("./terminalApi");
    const session = await createTerminalSession(
      { cols: 80, rows: 24 },
      vi.fn(),
    );

    await expect(startTerminalLog(session.id)).resolves.toMatchObject({
      active: true,
      path: expect.stringContaining("browser-preview://"),
    });
    await expect(stopTerminalLog(session.id)).resolves.toMatchObject({
      active: false,
      path: expect.stringContaining("browser-preview://"),
    });
    await closeTerminal(session.id);
    await expect(getTerminalLogState(session.id)).resolves.toEqual({
      active: false,
      bytesWritten: 0,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reads terminal paste text through the desktop clipboard facade", async () => {
    isTauriMock.mockReturnValue(true);
    readDesktopClipboardTextMock.mockResolvedValue("echo native\r");
    const { readTerminalClipboardText } = await import("./terminalApi");

    await expect(readTerminalClipboardText()).resolves.toBe("echo native\r");

    expect(readDesktopClipboardTextMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("terminal_read_clipboard_text");
  });

  it("returns an empty paste string when the desktop clipboard facade cannot read", async () => {
    isTauriMock.mockReturnValue(false);
    readDesktopClipboardTextMock.mockResolvedValue("");
    const { readTerminalClipboardText } = await import("./terminalApi");

    await expect(readTerminalClipboardText()).resolves.toBe("");

    expect(readDesktopClipboardTextMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses a Chinese SSH browser preview outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createSshTerminalSession } = await import("./terminalApi");
    const onOutput = vi.fn();

    const session = await createSshTerminalSession(
      { cols: 80, hostId: "host-lab", rows: 24 },
      onOutput,
    );
    await Promise.resolve();

    expect(session.shell).toBe("ssh-preview");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining("请在桌面应用中连接真实 SSH 主机"),
        kind: "data",
      }),
    );
  });

  it("uses Chinese Telnet and Serial browser previews outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createSerialTerminalSession, createTelnetTerminalSession } =
      await import("./terminalApi");
    const onTelnetOutput = vi.fn();
    const onSerialOutput = vi.fn();

    const telnetSession = await createTelnetTerminalSession(
      { cols: 80, hostId: "telnet-lab", rows: 24 },
      onTelnetOutput,
    );
    const serialSession = await createSerialTerminalSession(
      { cols: 80, hostId: "serial-console", rows: 24 },
      onSerialOutput,
    );
    await Promise.resolve();

    expect(telnetSession.shell).toBe("telnet-preview");
    expect(serialSession.shell).toBe("serial-preview");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onTelnetOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining("请在桌面应用中连接真实 Telnet 主机"),
        kind: "data",
      }),
    );
    expect(onSerialOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining("请在桌面应用中连接真实 Serial 设备"),
        kind: "data",
      }),
    );
  });
});
