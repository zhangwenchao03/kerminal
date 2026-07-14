import {
  normalizeWorkspaceSessionSnapshot,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";
import {
  loadWorkspaceSessionFile,
  saveWorkspaceSessionFile,
} from "./workspaceSessionApi";

export async function loadWorkspaceSession(): Promise<WorkspaceSessionSnapshot | null> {
  try {
    return await loadWorkspaceSessionFile();
  } catch {
    return null;
  }
}

export async function saveWorkspaceSession(
  session: WorkspaceSessionSnapshot,
): Promise<void> {
  const normalized = normalizeWorkspaceSessionSnapshot(session);
  if (!normalized) {
    return;
  }

  try {
    await saveWorkspaceSessionFile(normalized);
  } catch {
    // 工作区会话恢复是辅助能力，文件 API 不可用时不影响终端主流程。
  }
}
