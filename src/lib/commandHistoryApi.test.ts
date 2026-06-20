import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("commandHistoryApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists command history through Tauri with normalized filters", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        command: "npm run check",
        createdAt: "now",
        id: "history-1",
        source: "user",
        target: "local",
      },
    ]);
    const { listCommandHistory } = await import("./commandHistoryApi");

    const history = await listCommandHistory({
      limit: 900,
      paneId: " pane-1 ",
      query: " npm ",
      target: "local",
    });

    expect(history[0].command).toBe("npm run check");
    expect(invokeMock).toHaveBeenCalledWith("command_history_list", {
      request: {
        limit: 500,
        paneId: "pane-1",
        query: "npm",
        target: "local",
      },
    });
  });

  it("records command history through Tauri with default source and target", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entry: null,
      recorded: false,
      skipReason: "skip",
    });
    const { recordCommandHistory } = await import("./commandHistoryApi");

    await recordCommandHistory({
      command: "git status",
      paneId: " pane-1 ",
      sessionId: " session-1 ",
    });

    expect(invokeMock).toHaveBeenCalledWith("command_history_record", {
      request: {
        command: "git status",
        paneId: "pane-1",
        sessionId: "session-1",
        source: "user",
        target: "local",
      },
    });
  });

  it("uses searchable browser preview history outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listCommandHistory } = await import("./commandHistoryApi");

    const history = await listCommandHistory({ query: "journalctl", target: "ssh" });

    expect(history).toEqual([
      expect.objectContaining({
        command: expect.stringContaining("journalctl"),
        target: "ssh",
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
