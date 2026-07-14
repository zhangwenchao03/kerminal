import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Settings 的 Tauri 传输边界。
 *
 * 此处不依赖 settings 领域类型或归一化规则，避免共享 runtime adapter 反向依赖 feature。
 */
export async function loadSettingsPayload(): Promise<unknown | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<unknown>("settings_get");
}

/** 在 Tauri 运行时提交已由 feature 归一化的 settings payload。 */
export async function saveSettingsPayload(payload: unknown): Promise<unknown | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<unknown>("settings_update", { request: payload });
}
