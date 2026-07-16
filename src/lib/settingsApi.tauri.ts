import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Settings 的 runtime composition adapter。
 *
 * 此处是 settings 唯一读取 Tauri runtime mode 的位置；它返回结构化端口而非
 * settings 领域类型，避免 composition adapter 反向依赖 feature。
 */
const tauriRuntime = {
  load: (): Promise<unknown> => invoke<unknown>("settings_get"),
  save: (payload: unknown): Promise<unknown> =>
    invoke<unknown>("settings_update", { request: payload }),
};

/** browser preview 不读写 IPC，沿用 null 表示 feature 应使用既有默认语义。 */
const previewRuntime = {
  load: async (): Promise<null> => null,
  save: async (_payload: unknown): Promise<null> => null,
};

/**
 * 按调用时的实际平台返回 settings runtime port。
 *
 * feature 不再自行判断 isTauri，也不直接调用 invoke；所有平台分支收敛于此。
 */
export function resolveSettingsRuntime() {
  return isTauri() ? tauriRuntime : previewRuntime;
}
