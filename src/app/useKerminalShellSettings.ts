import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SettingsSaveState,
  SettingsSectionId,
} from "../features/settings/SettingsToolContent";
import type { AppSettings } from "../features/settings/settingsModel";
import { getSettings, updateSettings } from "../features/settings/settingsApi";
import { DEFAULT_SETTINGS_SECTION_ID } from "./KerminalShell.static";

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
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsInitialSectionId, setSettingsInitialSectionId] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ID);
  const settingsSaveRequestRef = useRef(0);
  const settingsDialogDirtyRef = useRef(false);
  const settingsDialogOpenRef = useRef(settingsDialogOpen);
  const settingsSaveStateRef = useRef<SettingsSaveState>(settingsSaveState);
  settingsDialogOpenRef.current = settingsDialogOpen;
  settingsSaveStateRef.current = settingsSaveState;

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

  const handleSettingsDialogChange = useCallback(
    (nextSettings: AppSettings) => {
      settingsDialogDirtyRef.current = true;
      handleSettingsChange(nextSettings);
    },
    [handleSettingsChange],
  );

  const handleSettingsDialogClose = useCallback(() => {
    settingsDialogDirtyRef.current = false;
    settingsDialogOpenRef.current = false;
    setSettingsDialogOpen(false);
  }, []);

  const openSettingsTool = useCallback(
    (sectionId: SettingsSectionId = DEFAULT_SETTINGS_SECTION_ID) => {
      settingsDialogDirtyRef.current = false;
      settingsDialogOpenRef.current = true;
      setSettingsInitialSectionId(sectionId);
      setSettingsDialogOpen(true);
    },
    [],
  );

  return {
    handleSettingsChange,
    handleSettingsDialogChange,
    handleSettingsDialogClose,
    openSettingsTool,
    settingsDialogDirtyRef,
    settingsDialogOpen,
    settingsDialogOpenRef,
    settingsInitialSectionId,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
    settingsSaveStateRef,
  };
}
