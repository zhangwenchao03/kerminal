import {
  normalizeWorkspaceSessionSnapshot,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";

export const WORKSPACE_SESSION_STORAGE_KEY = "kerminal.workspace.session.v1";

export function loadWorkspaceSession(): WorkspaceSessionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeWorkspaceSessionSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveWorkspaceSession(session: WorkspaceSessionSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const normalized = normalizeWorkspaceSessionSnapshot(session);
    window.localStorage.setItem(
      WORKSPACE_SESSION_STORAGE_KEY,
      JSON.stringify({
        ...normalized,
        version: WORKSPACE_SESSION_VERSION,
      }),
    );
  } catch {
    // 本地会话恢复是辅助能力，存储不可用时不影响终端主流程。
  }
}
