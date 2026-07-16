import type { StateCreator } from "zustand";
import { restoreWorkspaceSessionState } from "./workspaceRestoreState";
import {
  normalizeWorkspaceSessionSnapshot,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";
import type { WorkspaceState } from "./workspaceStore";
import type { WorkspaceStoreCounterRuntime } from "./workspaceStoreCounterRuntime";

export interface WorkspacePersistenceSlice {
  restoreWorkspaceSession(session: WorkspaceSessionSnapshot): void;
}

/** 组合 workspace session 恢复，并同步后续生成 ID 的单调下界。 */
export function createWorkspacePersistenceSlice(
  counters: WorkspaceStoreCounterRuntime,
): StateCreator<WorkspaceState, [], [], WorkspacePersistenceSlice> {
  return (set) => ({
    restoreWorkspaceSession: (session) =>
      set((state) => {
        const normalized = normalizeWorkspaceSessionSnapshot(session);
        counters.restore(normalized);
        return restoreWorkspaceSessionState(state, normalized);
      }),
  });
}
