import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("settings runtime composition adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("uses the unchanged Tauri commands and request payload", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ stored: true });
    const { resolveSettingsRuntime } = await import(
      "../../../src/lib/settingsApi.tauri"
    );
    const runtime = resolveSettingsRuntime();

    await expect(runtime.load()).resolves.toEqual({ stored: true });
    await expect(runtime.save({ themeMode: "dark" })).resolves.toEqual({
      stored: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "settings_get");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "settings_update", {
      request: { themeMode: "dark" },
    });
  });

  it("selects the side-effect free browser preview runtime", async () => {
    isTauriMock.mockReturnValue(false);
    const { resolveSettingsRuntime } = await import(
      "../../../src/lib/settingsApi.tauri"
    );
    const runtime = resolveSettingsRuntime();

    await expect(runtime.load()).resolves.toBeNull();
    await expect(runtime.save({ themeMode: "light" })).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
