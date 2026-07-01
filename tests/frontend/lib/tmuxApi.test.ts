import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("tmuxApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    vi.resetModules();
  });

  it("calls tmux Tauri commands with typed request envelopes", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      available: true,
      target: { kind: "ssh", hostId: "prod-api" },
      targetRef: "ssh:prod-api",
      version: "tmux 3.4",
    });
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce({
      id: "$0",
      name: "api",
      status: "running",
      targetRef: "ssh:prod-api",
      windows: 1,
    });
    const { tmuxCreateSession, tmuxListSessions, tmuxProbe } = await import(
      "../../../src/lib/tmuxApi"
    );
    const target = { target: { kind: "ssh" as const, hostId: "prod-api" } };

    await tmuxProbe({ target });
    await tmuxListSessions({ target });
    await tmuxCreateSession({ cwd: "/srv/api", name: "api", target });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "tmux_probe", {
      request: { target },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "tmux_list_sessions", {
      request: { target },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "tmux_create_session", {
      request: { cwd: "/srv/api", name: "api", target },
    });
  });

  it("keeps Local and SSH browser preview sessions in memory", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      tmuxAttachSession,
      tmuxCreateSession,
      tmuxKillSession,
      tmuxListSessions,
      tmuxProbe,
    } = await import("../../../src/lib/tmuxApi");
    const target = { target: { kind: "ssh" as const, hostId: "prod-api" } };

    const capability = await tmuxProbe({ target });
    const created = await tmuxCreateSession({
      cwd: "/srv/api",
      name: "api",
      target,
    });
    const sessions = await tmuxListSessions({ target });
    const launch = await tmuxAttachSession({
      sessionId: created.id,
      sessionName: created.name,
      target,
    });
    const killed = await tmuxKillSession({
      sessionId: created.id,
      target,
    });

    expect(capability.available).toBe(true);
    expect(sessions.map((session) => session.name)).toEqual(["api"]);
    expect(launch.mode).toBe("ssh");
    expect(launch.binding.sessionId).toBe(created.id);
    expect(killed).toBe(true);
    expect(await tmuxListSessions({ target })).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
