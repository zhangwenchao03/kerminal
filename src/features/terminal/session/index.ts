// 终端 session registry 的最小跨功能公开入口；测试 reset 保持特性私有。
export {
  getTerminalPaneSession,
  getTerminalPaneSessionRecord,
  runSnippetCommand,
  writePaneCommand,
  writeSnippetCommand,
  writeWorkflowCommand,
  type PaneSessionRecord,
} from "../terminalSessionRegistry";
