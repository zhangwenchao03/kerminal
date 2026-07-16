import { resolveSettingsRuntime } from "../../lib/settingsApi.tauri";
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
} from "./settingsModel";

/**
 * Settings feature 依赖的窄运行时端口。
 *
 * 领域层只处理 settings payload 的归一化，不感知 Tauri 或 browser preview
 * 的运行时判定。平台选择由 composition adapter 负责，方便测试注入。
 */
export interface SettingsRuntimePort {
  load: () => Promise<unknown | null>;
  save: (payload: unknown) => Promise<unknown | null>;
}

/**
 * 创建 settings 用例，供生产 composition 和单元测试复用。
 *
 * runtimeProvider 在每次调用时解析，保留原有测试和运行期中 Tauri 状态变化的
 * 语义，而不是在模块初始化时缓存平台模式。
 */
export function createSettingsApi(
  runtimeProvider: () => SettingsRuntimePort,
): {
  getSettings: () => Promise<AppSettings>;
  updateSettings: (request: AppSettings) => Promise<AppSettings>;
} {
  return {
    async getSettings(): Promise<AppSettings> {
      const settings = await runtimeProvider().load();
      return settings === null ? defaultAppSettings : normalizeAppSettings(settings);
    },
    async updateSettings(request: AppSettings): Promise<AppSettings> {
      const normalizedRequest = normalizeAppSettings(request);
      const settings = await runtimeProvider().save(normalizedRequest);
      return settings === null
        ? normalizedRequest
        : normalizeAppSettings(settings);
    },
  };
}

/** 默认 composition 保持既有 getSettings/updateSettings 公共行为。 */
const settingsApi = createSettingsApi(resolveSettingsRuntime);

export const { getSettings, updateSettings } = settingsApi;
