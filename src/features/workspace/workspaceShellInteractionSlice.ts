import type { StateCreator } from "zustand";
import { isToolId } from "./types";
import type { WorkspaceShellInteractionSlice } from "./workspaceStoreContract";

/** 工作区工具选择、机器搜索和广播草稿的稳定初始状态。 */
export const initialWorkspaceShellInteractionState = {
  activeTool: null,
  broadcastDraft: "",
  machineSearch: "",
} satisfies Pick<
  WorkspaceShellInteractionSlice,
  "activeTool" | "broadcastDraft" | "machineSearch"
>;

/** 创建不参与 session 持久化的工作区 shell 交互 action slice。 */
export const createWorkspaceShellInteractionSlice: StateCreator<
  WorkspaceShellInteractionSlice,
  [],
  [],
  WorkspaceShellInteractionSlice
> = (set) => ({
  ...initialWorkspaceShellInteractionState,
  setActiveTool: (activeTool) =>
    set(() => {
      if (activeTool === null) {
        return { activeTool };
      }
      return isToolId(activeTool) ? { activeTool } : {};
    }),
  setBroadcastDraft: (broadcastDraft) => set({ broadcastDraft }),
  setMachineSearch: (machineSearch) => set({ machineSearch }),
});
