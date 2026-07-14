import {
  loadSettingsPayload,
  saveSettingsPayload,
} from "../../lib/settingsApi.tauri";
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
} from "./settingsModel";

/**
 * 设置能力的运行时适配器。
 *
 * 领域归一化留在 settings feature，Tauri IPC 仅在此边界调用；浏览器预览
 * 保持原有的无副作用默认值语义，避免把平台分支扩散到调用方。
 */
export async function getSettings(): Promise<AppSettings> {
  const settings = await loadSettingsPayload();
  if (settings === null) {
    return defaultAppSettings;
  }
  return normalizeAppSettings(settings);
}

/** 保持 settings_update 的请求与返回值均经过同一领域归一化。 */
export async function updateSettings(
  request: AppSettings,
): Promise<AppSettings> {
  const normalizedRequest = normalizeAppSettings(request);
  const settings = await saveSettingsPayload(normalizedRequest);
  return settings === null ? normalizedRequest : normalizeAppSettings(settings);
}
