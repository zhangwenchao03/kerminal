import { invoke, isTauri } from "@tauri-apps/api/core";

const WORKSPACE_SESSION_LOAD_COMMAND = "workspace_session_load";
const WORKSPACE_SESSION_SAVE_COMMAND = "workspace_session_save";

/**
 * Workspace session 的 Tauri 传输边界。
 *
 * 该模块不依赖工作区领域类型或归一化规则，避免平台 adapter 反向依赖 feature。
 */
export async function loadWorkspaceSessionPayload(): Promise<unknown | null> {
  if (!isTauri()) {
    throw new Error("Workspace session file API is only available in Tauri.");
  }
  return invoke<unknown>(WORKSPACE_SESSION_LOAD_COMMAND);
}

/** 提交已由 workspace feature 归一化的 session payload。 */
export async function saveWorkspaceSessionPayload(session: unknown): Promise<void> {
  if (!isTauri()) {
    throw new Error("Workspace session file API is only available in Tauri.");
  }
  await invoke(WORKSPACE_SESSION_SAVE_COMMAND, { session });
}
