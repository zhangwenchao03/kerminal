// Workspace 状态能力的最小公开入口；测试 reset 和 fixture 保持特性私有。
export {
  useWorkspaceStore,
  type AddTerminalTabOptions,
  type OpenWorkspaceFileTabOptions,
  type TmuxAttachPlacement,
} from "../workspaceStore";
