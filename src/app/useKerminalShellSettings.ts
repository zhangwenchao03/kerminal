import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsSaveState } from "../features/settings/SettingsToolContent";
import type { AppSettings } from "../features/settings/settingsModel";
import { getSettings, updateSettings } from "../lib/settingsApi";

interface UseKerminalShellSettingsOptions {
  setSettings: (settings: AppSettings) => void;
}

export function useKerminalShellSettings({
  setSettings,
}: UseKerminalShellSettingsOptions) {
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(
    null,
  );
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(
    null,
  );
  const [settingsSaveState, setSettingsSaveState] =
    useState<SettingsSaveState>("idle");
  const settingsSaveRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    getSettings()
      .then((storedSettings) => {
        if (cancelled) {
          return;
        }
        setSettings(storedSettings);
        setSettingsLoadError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSettingsLoadError("设置加载失败，已使用默认本地设置。");
      });

    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      settingsSaveRequestRef.current += 1;
      const requestId = settingsSaveRequestRef.current;
      setSettings(nextSettings);
      setSettingsSaveState("saving");
      setSettingsSaveError(null);

      updateSettings(nextSettings)
        .then((storedSettings) => {
          if (requestId !== settingsSaveRequestRef.current) {
            return;
          }
          setSettings(storedSettings);
          setSettingsSaveState("saved");
        })
        .catch((error: unknown) => {
          if (requestId !== settingsSaveRequestRef.current) {
            return;
          }
          setSettingsSaveState("error");
          setSettingsSaveError(
            error instanceof Error ? error.message : String(error),
          );
        });
    },
    [setSettings],
  );

  return {
    handleSettingsChange,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
  };
}
