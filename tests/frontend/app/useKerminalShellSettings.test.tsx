import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppSettings,
  type ThemeMode,
} from "../../../src/features/settings/settingsModel";
import { useKerminalShellSettings } from "../../../src/app/useKerminalShellSettings";

const settingsApiMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../../../src/lib/settingsApi", () => ({
  getSettings: (...args: unknown[]) => settingsApiMocks.getSettings(...args),
  updateSettings: (...args: unknown[]) =>
    settingsApiMocks.updateSettings(...args),
}));

describe("useKerminalShellSettings", () => {
  beforeEach(() => {
    settingsApiMocks.getSettings.mockReset();
    settingsApiMocks.updateSettings.mockReset();
  });

  it("loads stored settings into the shell state", async () => {
    settingsApiMocks.getSettings.mockResolvedValue(settingsFixture("light"));

    render(<SettingsHarness />);

    expect(await screen.findByTestId("theme-mode")).toHaveTextContent("light");
    expect(screen.getByTestId("load-error")).toBeEmptyDOMElement();
  });

  it("shows a load error while keeping default settings available", async () => {
    settingsApiMocks.getSettings.mockRejectedValue(new Error("load failed"));

    render(<SettingsHarness />);

    expect(await screen.findByTestId("load-error")).toHaveTextContent(
      "设置加载失败，已使用默认本地设置。",
    );
    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
  });

  it("ignores stale save responses and keeps the latest save result", async () => {
    settingsApiMocks.getSettings.mockResolvedValue(defaultAppSettings);
    const firstSave = deferred<AppSettings>();
    const secondSave = deferred<AppSettings>();
    settingsApiMocks.updateSettings
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    render(<SettingsHarness />);
    await waitFor(() => expect(settingsApiMocks.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "保存浅色" }));
    expect(screen.getByTestId("theme-mode")).toHaveTextContent("light");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saving");

    fireEvent.click(screen.getByRole("button", { name: "保存深色" }));
    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");

    await act(async () => {
      firstSave.resolve(settingsFixture("light"));
      await firstSave.promise;
    });
    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saving");

    await act(async () => {
      secondSave.resolve(settingsFixture("dark"));
      await secondSave.promise;
    });

    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("save-state")).toHaveTextContent("saved");
  });

  it("reports the latest save failure", async () => {
    settingsApiMocks.getSettings.mockResolvedValue(defaultAppSettings);
    settingsApiMocks.updateSettings.mockRejectedValue(new Error("save failed"));

    render(<SettingsHarness />);
    await waitFor(() => expect(settingsApiMocks.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "保存浅色" }));

    expect(await screen.findByTestId("save-error")).toHaveTextContent(
      "save failed",
    );
    expect(screen.getByTestId("save-state")).toHaveTextContent("error");
  });
});

function SettingsHarness() {
  const [settings, setSettings] = useState(defaultAppSettings);
  const {
    handleSettingsChange,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
  } = useKerminalShellSettings({ setSettings });

  return (
    <div>
      <div data-testid="theme-mode">{settings.themeMode}</div>
      <div data-testid="load-error">{settingsLoadError}</div>
      <div data-testid="save-error">{settingsSaveError}</div>
      <div data-testid="save-state">{settingsSaveState}</div>
      <button onClick={() => handleSettingsChange(settingsFixture("light"))}>
        保存浅色
      </button>
      <button onClick={() => handleSettingsChange(settingsFixture("dark"))}>
        保存深色
      </button>
    </div>
  );
}

function settingsFixture(themeMode: ThemeMode): AppSettings {
  return {
    ...defaultAppSettings,
    themeMode,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
