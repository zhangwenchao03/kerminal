import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  normalizeWorkspaceSessionSnapshot,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSessionSnapshot,
} from "../features/workspace/workspaceSession";

const WORKSPACE_SESSION_LOAD_COMMAND = "workspace_session_load";
const WORKSPACE_SESSION_SAVE_COMMAND = "workspace_session_save";

export async function loadWorkspaceSessionFile(): Promise<WorkspaceSessionSnapshot | null> {
  if (!isTauri()) {
    throw new Error("Workspace session file API is only available in Tauri.");
  }

  const payload = await invoke<unknown>(WORKSPACE_SESSION_LOAD_COMMAND);
  if (payload === null) {
    return null;
  }
  return normalizeWorkspaceSessionSnapshot(payload);
}

export async function saveWorkspaceSessionFile(
  session: WorkspaceSessionSnapshot,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Workspace session file API is only available in Tauri.");
  }

  const normalized = normalizeWorkspaceSessionSnapshot(session);
  if (!normalized) {
    return;
  }

  await invoke(WORKSPACE_SESSION_SAVE_COMMAND, {
    session: {
      ...normalized,
      version: WORKSPACE_SESSION_VERSION,
    },
  });
}
