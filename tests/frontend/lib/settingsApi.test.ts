import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../src/features/settings/settingsModel";

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

  it("loads app settings through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      ...defaultAppSettings,
      themeMode: "light",
    });
    const { getSettings } = await import("../../../src/lib/settingsApi");

    const settings = await getSettings();

    expect(settings.themeMode).toBe("light");
    expect(invokeMock).toHaveBeenCalledWith("settings_get");
  });

  it("normalizes and updates settings through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (_command, payload) => payload.request);
    const { updateSettings } = await import("../../../src/lib/settingsApi");

    const settings = await updateSettings({
      ...defaultAppSettings,
      terminal: {
        ...defaultAppSettings.terminal,
        fontSize: 999,
        inlineSuggestion: {
          ...defaultAppSettings.terminal.inlineSuggestion,
          auditRetentionDays: -10,
          feedbackRetentionDays: 99999,
        },
      },
      themeMode: "dark",
    });

    expect(settings.terminal.fontSize).toBe(24);
    expect(settings.terminal.inlineSuggestion.auditRetentionDays).toBe(1);
    expect(settings.terminal.inlineSuggestion.feedbackRetentionDays).toBe(3650);
    expect(invokeMock).toHaveBeenCalledWith("settings_update", {
      request: {
        ...defaultAppSettings,
        terminal: {
          ...defaultAppSettings.terminal,
          fontSize: 24,
          inlineSuggestion: {
            ...defaultAppSettings.terminal.inlineSuggestion,
            auditRetentionDays: 1,
            feedbackRetentionDays: 3650,
          },
        },
        themeMode: "dark",
      },
    });
  });

  it("uses default settings outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { getSettings, updateSettings } = await import("../../../src/lib/settingsApi");

    await expect(getSettings()).resolves.toEqual(defaultAppSettings);
    await expect(
      updateSettings({ ...defaultAppSettings, themeMode: "light" }),
    ).resolves.toMatchObject({ themeMode: "light" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
