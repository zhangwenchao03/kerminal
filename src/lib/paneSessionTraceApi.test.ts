import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("paneSessionTraceApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("invokes fixed terminal session binding IPC commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);
    const {
      closeTerminalSessionBinding,
      listTerminalSessionBindingEvents,
      markTerminalSessionBindingDisconnected,
      markTerminalSessionBindingReady,
      registerTerminalSessionBinding,
    } = await import("./paneSessionTraceApi");

    await registerTerminalSessionBinding({
      cwd: " /srv/app ",
      paneId: " pane-a ",
      profileId: " profile-a ",
      remoteHostId: " host-a ",
      sessionId: " session-a ",
      shell: " bash ",
      tabId: " tab-a ",
      targetRef: " ssh:host:host-a:tab:tab-a:pane:pane-a ",
      targetKind: " ssh ",
      targetToken: " cap-token-1 ",
    });
    await markTerminalSessionBindingReady({
      paneId: "pane-a",
      sessionId: "session-a",
    });
    await markTerminalSessionBindingDisconnected({
      paneId: "pane-a",
      sessionId: "session-a",
    });
    await closeTerminalSessionBinding({
      paneId: "pane-a",
      sessionId: "session-a",
    });
    await listTerminalSessionBindingEvents();

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "terminal_session_binding_register",
      {
        metadata: {
          cwd: "/srv/app",
          profileId: "profile-a",
          remoteHostId: "host-a",
          shell: "bash",
          tabId: "tab-a",
          targetRef: "ssh:host:host-a:tab:tab-a:pane:pane-a",
          targetKind: "ssh",
        },
        paneId: "pane-a",
        sessionId: "session-a",
        targetToken: "cap-token-1",
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "terminal_session_binding_ready",
      { paneId: "pane-a", sessionId: "session-a" },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "terminal_session_binding_disconnected",
      { paneId: "pane-a", sessionId: "session-a" },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "terminal_session_binding_closed",
      { paneId: "pane-a", sessionId: "session-a" },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      5,
      "terminal_session_binding_events",
    );
  });

  it("is a safe no-op outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      closeTerminalSessionBinding,
      listTerminalSessionBindingEvents,
      markTerminalSessionBindingDisconnected,
      markTerminalSessionBindingReady,
      registerTerminalSessionBinding,
    } = await import("./paneSessionTraceApi");

    await expect(
      registerTerminalSessionBinding({ paneId: "pane-a", sessionId: "session-a" }),
    ).resolves.toBeUndefined();
    await expect(
      markTerminalSessionBindingReady({
        paneId: "pane-a",
        sessionId: "session-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      markTerminalSessionBindingDisconnected({
        paneId: "pane-a",
        sessionId: "session-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      closeTerminalSessionBinding({ paneId: "pane-a", sessionId: "session-a" }),
    ).resolves.toBeUndefined();
    await expect(listTerminalSessionBindingEvents()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("omits empty metadata fields from IPC payloads", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);
    const { registerTerminalSessionBinding } = await import(
      "./paneSessionTraceApi"
    );

    await registerTerminalSessionBinding({
      cwd: "  ",
      metadata: {
        profileId: " profile-a ",
        remoteHostId: "",
        shell: undefined,
        targetRef: " ",
      },
      paneId: "pane-a",
      sessionId: "session-a",
      targetToken: " ",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "terminal_session_binding_register",
      {
        metadata: {
          cwd: undefined,
          profileId: "profile-a",
          remoteHostId: undefined,
          shell: undefined,
          tabId: undefined,
          targetRef: undefined,
          targetKind: undefined,
        },
        paneId: "pane-a",
        sessionId: "session-a",
      },
    );
  });

  it("exposes backend binding generation on returned snapshots", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      generation: 7,
      paneId: "pane-a",
      sessionId: "session-a",
      status: "registered",
    });
    const { registerTerminalSessionBinding } = await import(
      "./paneSessionTraceApi"
    );

    await expect(
      registerTerminalSessionBinding({
        paneId: "pane-a",
        sessionId: "session-a",
      }),
    ).resolves.toMatchObject({ generation: 7 });
  });
});
