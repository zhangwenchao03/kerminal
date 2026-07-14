import {
  loadWorkspaceSessionPayload,
  saveWorkspaceSessionPayload,
} from "../../lib/workspaceSessionApi.tauri";
import {
  normalizeWorkspaceSessionSnapshot,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";

/**
 * Workspace session 的领域 API。
 *
 * 归一化、版本固定和空快照处理均属于 workspace feature；平台 transport 只接收
 * 已完成领域校验的 payload。
 */
export async function loadWorkspaceSessionFile(): Promise<WorkspaceSessionSnapshot | null> {
  const payload = await loadWorkspaceSessionPayload();
  return payload === null ? null : normalizeWorkspaceSessionSnapshot(payload);
}

/** 保存已归一化的 workspace session，保持既有空快照 no-op 语义。 */
export async function saveWorkspaceSessionFile(
  session: WorkspaceSessionSnapshot,
): Promise<void> {
  const normalized = normalizeWorkspaceSessionSnapshot(session);
  if (!normalized) {
    return;
  }
  await saveWorkspaceSessionPayload({
    ...normalized,
    version: WORKSPACE_SESSION_VERSION,
  });
}
