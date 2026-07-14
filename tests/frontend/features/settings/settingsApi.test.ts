import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("settingsApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("keeps Tauri normalization at the settings feature boundary", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (_command, payload) => payload.request);
    const { updateSettings } = await import(
      "../../../../src/features/settings/settingsApi"
    );

    await expect(
      updateSettings({
        ...defaultAppSettings,
        terminal: { ...defaultAppSettings.terminal, fontSize: 999 },
      }),
    ).resolves.toMatchObject({
      terminal: { fontSize: 24 },
    });
    expect(invokeMock).toHaveBeenCalledWith("settings_update", {
      request: expect.objectContaining({
        terminal: expect.objectContaining({ fontSize: 24 }),
      }),
    });
  });

  it("keeps browser preview reads side-effect free", async () => {
    isTauriMock.mockReturnValue(false);
    const { getSettings } = await import(
      "../../../../src/features/settings/settingsApi"
    );

    await expect(getSettings()).resolves.toEqual(defaultAppSettings);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
