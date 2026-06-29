import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("agentLauncherApi", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("archives an agent session through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      session: {
        agentSessionId: "ags-1",
        launch: { args: [], cwd: "C:/sessions/ags-1", shell: "codex" },
        status: "archived",
        title: "Codex",
      },
    });
    const { archiveAgentSession } = await import("./agentLauncherApi");

    await expect(archiveAgentSession("ags-1")).resolves.toMatchObject({
      session: { agentSessionId: "ags-1", status: "archived" },
    });
    expect(invokeMock).toHaveBeenCalledWith("agent_session_archive", {
      agentSessionId: "ags-1",
    });
  });

  it("returns an archived browser preview record outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { archiveAgentSession, agentSessionRecordStatus } = await import(
      "./agentLauncherApi"
    );

    const record = await archiveAgentSession("ags-preview");

    expect(record.session).toMatchObject({
      agentSessionId: "ags-preview",
      status: "archived",
      title: "Archived Agent Session",
    });
    expect(agentSessionRecordStatus(record)).toBe("archived");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("normalizes missing record status as active for legacy records", async () => {
    const { agentSessionRecordStatus } = await import("./agentLauncherApi");

    expect(
      agentSessionRecordStatus({
        session: {
          agentSessionId: "ags-legacy",
          launch: { args: [], cwd: "C:/sessions/ags-legacy", shell: "codex" },
          title: "Codex",
        },
      }),
    ).toBe("active");
  });
});
