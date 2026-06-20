import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
} from "../features/settings/settingsModel";

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    return defaultAppSettings;
  }

  const settings = await invoke<AppSettings>("settings_get");
  return normalizeAppSettings(settings);
}

export async function updateSettings(
  request: AppSettings,
): Promise<AppSettings> {
  if (!isTauri()) {
    return normalizeAppSettings(request);
  }

  const settings = await invoke<AppSettings>("settings_update", {
    request: normalizeAppSettings(request),
  });
  return normalizeAppSettings(settings);
}
