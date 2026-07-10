import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOutputEvent } from "../../../src/lib/terminalApi";

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

vi.mock("../../../src/lib/desktopClipboardApi", () => ({
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
    const { createTerminalSession } = await import("../../../src/lib/terminalApi");
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

  it("keeps the Tauri output Channel alive when an output handler throws", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 80,
      id: "session-1",
      rows: 24,
      shell: "powershell.exe",
      status: "running",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createTerminalSession } = await import("../../../src/lib/terminalApi");
    const onOutput = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("xterm rejected binary output");
      })
      .mockImplementation(() => undefined);

    try {
      await createTerminalSession({ cols: 80, rows: 24 }, onOutput);

      expect(() =>
        channelMessageHandler?.({
          data: "\u0000\u001bbinary",
          kind: "data",
          sessionId: "session-1",
        }),
      ).not.toThrow();
      channelMessageHandler?.({
        data: "after-binary",
        kind: "data",
        sessionId: "session-1",
      });

      expect(onOutput).toHaveBeenCalledTimes(2);
      expect(onOutput).toHaveBeenLastCalledWith({
        data: "after-binary",
        kind: "data",
        sessionId: "session-1",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "terminal output handler failed",
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("passes typed agent signal events through the Tauri Channel", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 80,
      id: "session-1",
      rows: 24,
      shell: "codex",
      status: "running",
    });
    const { createTerminalSession } = await import("../../../src/lib/terminalApi");
    const onOutput = vi.fn();

    await createTerminalSession({ cols: 80, rows: 24 }, onOutput);
    channelMessageHandler?.({
      agentSignal: {
        agent: "codex",
        agentSessionId: "ags-codex",
        status: "attention",
        terminalSessionId: "session-1",
      },
      data: "",
      kind: "agentSignal",
      sessionId: "session-1",
    });

    expect(onOutput).toHaveBeenCalledWith({
      agentSignal: {
        agent: "codex",
        agentSessionId: "ags-codex",
        status: "attention",
        terminalSessionId: "session-1",
      },
      data: "",
      kind: "agentSignal",
      sessionId: "session-1",
    });
  });

  it("passes typed terminal error events through the Tauri Channel", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cols: 80,
      id: "session-1",
      rows: 24,
      shell: "powershell.exe",
      status: "running",
    });
    const { createTerminalSession } = await import("../../../src/lib/terminalApi");
    const onOutput = vi.fn();

    await createTerminalSession({ cols: 80, rows: 24 }, onOutput);
    channelMessageHandler?.({
      data: "read failed",
      error: {
        class: "ptyReadFailed",
        message: "read failed",
        operation: "readOutput",
        recovery: "retryable",
        retryable: true,
      },
      kind: "error",
      sessionId: "session-1",
    });

    expect(onOutput).toHaveBeenCalledWith({
      data: "read failed",
      error: {
        class: "ptyReadFailed",
        message: "read failed",
        operation: "readOutput",
        recovery: "retryable",
        retryable: true,
      },
      kind: "error",
      sessionId: "session-1",
    });
  });

  it("normalizes typed terminal command failures without losing the display message", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue({
      class: "sessionNotFound",
      message: "终端会话不存在: missing",
      operation: "write",
      recovery: "notRetryable",
      retryable: false,
    });
    const { TerminalApiError, getTerminalCommandError, writeTerminal } =
      await import("../../../src/lib/terminalApi");

    await expect(writeTerminal("missing", "pwd\r")).rejects.toMatchObject({
      message: "终端会话不存在: missing",
      terminalError: {
        class: "sessionNotFound",
        operation: "write",
        recovery: "notRetryable",
        retryable: false,
      },
    });
    try {
      await writeTerminal("missing", "pwd\r");
    } catch (error) {
      expect(error).toBeInstanceOf(TerminalApiError);
      expect(String(error)).toBe("终端会话不存在: missing");
      expect(getTerminalCommandError(error)).toMatchObject({
        class: "sessionNotFound",
        operation: "write",
      });
    }
  });

  it("uses a browser preview session outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createTerminalSession, writeTerminal } = await import(
      "../../../src/lib/terminalApi"
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
    const { createSshTerminalSession } = await import("../../../src/lib/terminalApi");
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
    const { createTelnetTerminalSession } = await import("../../../src/lib/terminalApi");
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
    const { createSerialTerminalSession } = await import("../../../src/lib/terminalApi");
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
    const { createDockerContainerTerminalSession } = await import("../../../src/lib/terminalApi");
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
      await import("../../../src/lib/terminalApi");

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

  it("reaps local orphan terminal sessions through the Tauri command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      elapsedMs: 5,
      reapedCount: 2,
      sessionIds: ["session-a", "session-b"],
    });
    const { reapOrphanTerminalSessions } = await import("../../../src/lib/terminalApi");

    await expect(reapOrphanTerminalSessions()).resolves.toEqual({
      elapsedMs: 5,
      reapedCount: 2,
      sessionIds: ["session-a", "session-b"],
    });

    expect(invokeMock).toHaveBeenCalledWith("terminal_reap_orphan_sessions");
  });

  it("reads non-sensitive PTY output pump stats through the Tauri command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bufferedChunks: 0,
      closedEvents: 1,
      coalescedChunks: 2,
      dataEvents: 1,
      droppedBytes: 0,
      errorEvents: 0,
      finalTailFlushCount: 1,
      finished: true,
      flushCount: 1,
      inputBytes: 24,
      inputChunks: 2,
      lastFlushIntervalMs: 3,
      lastFlushReason: "closed",
      maxPendingBytes: 24,
      maxPendingHitCount: 0,
      outputBytes: 24,
      overflowCount: 0,
      pendingBytes: 0,
      sessionId: "session-1",
    });
    const { getTerminalPtyOutputPumpStats } = await import(
      "../../../src/lib/terminalApi"
    );

    await expect(getTerminalPtyOutputPumpStats("session-1")).resolves.toEqual(
      expect.objectContaining({
        finished: true,
        lastFlushReason: "closed",
        sessionId: "session-1",
      }),
    );

    expect(invokeMock).toHaveBeenCalledWith("terminal_pty_output_pump_stats", {
      sessionId: "session-1",
    });
  });

  it("no-ops orphan terminal reaping outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { reapOrphanTerminalSessions } = await import("../../../src/lib/terminalApi");

    await expect(reapOrphanTerminalSessions()).resolves.toEqual({
      elapsedMs: 0,
      reapedCount: 0,
      sessionIds: [],
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns inactive PTY output pump stats outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { getTerminalPtyOutputPumpStats } = await import(
      "../../../src/lib/terminalApi"
    );

    await expect(getTerminalPtyOutputPumpStats("preview-1")).resolves.toEqual({
      bufferedChunks: 0,
      closedEvents: 0,
      coalescedChunks: 0,
      dataEvents: 0,
      droppedBytes: 0,
      errorEvents: 0,
      finalTailFlushCount: 0,
      finished: false,
      flushCount: 0,
      inputBytes: 0,
      inputChunks: 0,
      maxPendingBytes: 0,
      maxPendingHitCount: 0,
      outputBytes: 0,
      overflowCount: 0,
      pendingBytes: 0,
      sessionId: "preview-1",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps a browser preview log state without touching Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      closeTerminal,
      createTerminalSession,
      getTerminalLogState,
      startTerminalLog,
      stopTerminalLog,
    } = await import("../../../src/lib/terminalApi");
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
    const { readTerminalClipboardText } = await import("../../../src/lib/terminalApi");

    await expect(readTerminalClipboardText()).resolves.toBe("echo native\r");

    expect(readDesktopClipboardTextMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("terminal_read_clipboard_text");
  });

  it("returns an empty paste string when the desktop clipboard facade cannot read", async () => {
    isTauriMock.mockReturnValue(false);
    readDesktopClipboardTextMock.mockResolvedValue("");
    const { readTerminalClipboardText } = await import("../../../src/lib/terminalApi");

    await expect(readTerminalClipboardText()).resolves.toBe("");

    expect(readDesktopClipboardTextMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses a Chinese SSH browser preview outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createSshTerminalSession } = await import("../../../src/lib/terminalApi");
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
      await import("../../../src/lib/terminalApi");
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
