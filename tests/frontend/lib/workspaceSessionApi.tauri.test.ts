import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("workspace session Tauri transport", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("uses the frozen Tauri command names and session payload", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(null);
    const { loadWorkspaceSessionPayload, saveWorkspaceSessionPayload } = await import(
      "../../../src/lib/workspaceSessionApi.tauri"
    );

    await expect(loadWorkspaceSessionPayload()).resolves.toBeNull();
    await saveWorkspaceSessionPayload({ version: 2 });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "workspace_session_load");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "workspace_session_save", {
      session: { version: 2 },
    });
  });

  it("fails closed outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { loadWorkspaceSessionPayload } = await import(
      "../../../src/lib/workspaceSessionApi.tauri"
    );
    await expect(loadWorkspaceSessionPayload()).rejects.toThrow(
      "only available in Tauri",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
