import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { mocks } from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../src/features/terminal/XtermPane";
import {
  buildTerminalCreateRequest,
  normalizeTerminalSessionSize,
} from "../../../../src/features/terminal/XtermPane.helpers.ts";
import { terminalRendererRegistry } from "../../../../src/features/terminal/terminalRendererRegistry";

async function waitForTerminalSessionReady() {
  await waitFor(() => {
    const createCallCount =
      mocks.api.createTerminalSession.mock.calls.length +
      mocks.api.createSshTerminalSession.mock.calls.length;
    expect(createCallCount).toBeGreaterThan(0);
    expect(mocks.getLatestOutputHandler()).toBeTypeOf("function");
  });
  expect(screen.getByText("已连接")).not.toBeVisible();
}

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

    expect(screen.getByText("已连接")).not.toBeVisible();
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
    expect(mocks.fitInstances[0].fit).toHaveBeenCalledTimes(1);
    expect(mocks.api.resizeTerminal).not.toHaveBeenCalled();
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

  it("resizes a session when the surface changes while creation is pending", async () => {
    let resolveSession:
      | ((session: {
          cols: number;
          id: string;
          rows: number;
          shell: string;
          shellIntegration: { reason: string; status: "disabled" };
          status: "running";
        }) => void)
      | undefined;
    mocks.api.createTerminalSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );
    const { rerender } = render(
      <XtermPane
        focused
        paneId="pane-pending-resize"
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
    mocks.fitInstances[0].proposeDimensions.mockReturnValue({
      cols: 120,
      rows: 40,
    });
    vi.spyOn(
      screen.getByLabelText("本地 PowerShell xterm 终端"),
      "getBoundingClientRect",
    ).mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    rerender(
      <XtermPane
        focused
        paneId="pane-pending-resize"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          fontSize: defaultAppSettings.terminal.fontSize + 1,
        }}
        title="本地 PowerShell"
      />,
    );
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => {
      expect(mocks.fitInstances[0].fit).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSession?.({
        cols: 100,
        id: "session-pending-resize",
        rows: 30,
        shell: "powershell.exe",
        shellIntegration: { reason: "test", status: "disabled" },
        status: "running",
      });
    });

    await waitFor(() => {
      expect(mocks.api.resizeTerminal).toHaveBeenCalledWith(
        "session-pending-resize",
        { cols: 120, rows: 40 },
      );
    });
  });

  it("suspends registry visibility while the document is hidden", async () => {
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    const { unmount } = render(
      <XtermPane
        focused
        paneId="pane-document-visibility"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );
    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(
        terminalRendererRegistry
          .getSnapshot()
          .panes.find((pane) => pane.paneId === "pane-document-visibility")
          ?.visible,
      ).toBe(false);
    } finally {
      unmount();
      if (visibilityDescriptor) {
        Object.defineProperty(
          document,
          "visibilityState",
          visibilityDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
    }
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

    await waitForTerminalSessionReady();

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

    expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    expect(screen.getByText("已连接")).not.toBeVisible();

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

  it("stops SSH auto reconnect when OpenSSH reports an authentication failure", async () => {
    const terminalAppearance = {
      ...defaultAppSettings.terminal,
      autoReconnect: true,
    };
    mocks.api.createSshTerminalSession.mockImplementation(
      async (_request, onOutput) => {
        mocks.setLatestOutputHandler(
          onOutput as Parameters<typeof mocks.setLatestOutputHandler>[0],
        );
        mocks.getLatestOutputHandler()?.({
          data: "Permission denied (publickey,password).\r\n",
          kind: "data",
          sessionId: "ssh-auth-failed",
        });
        return {
          cols: 80,
          id: "ssh-auth-failed",
          rows: 24,
          shell: "ssh",
          shellIntegration: { reason: "auth failed", status: "disabled" },
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        focused
        paneId="pane-ssh-auth-failed"
        remoteHostId="host-prod"
        resolvedTheme="dark"
        terminalAppearance={terminalAppearance}
        title="生产 SSH"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(1);
    });
    vi.useFakeTimers();
    act(() => {
      mocks.getLatestOutputHandler()?.({
        data: "",
        kind: "closed",
        sessionId: "ssh-auth-failed",
      });
    });

    expect(screen.getByText("已结束")).toBeInTheDocument();
    expect(
      mocks.terminalInstances[0].write.mock.calls.some(([data]) =>
        String(data).includes("认证失败"),
      ),
    ).toBe(true);
    expect(
      mocks.terminalInstances[0].write.mock.calls.some(([data]) =>
        String(data).includes("已停止自动重连"),
      ),
    ).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(1);
  });

});
