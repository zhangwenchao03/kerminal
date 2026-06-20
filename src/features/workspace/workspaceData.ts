import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  ToolSummary,
} from "./types";

export const machineGroups: MachineGroup[] = [];

export const terminalTabs: TerminalTab[] = [];

export const terminalPanes: TerminalPane[] = [];

export const tools: ToolSummary[] = [
  {
    id: "ai",
    title: "Kerminal Agent",
    description: "应用上下文、计划和工具调用",
  },
  {
    id: "system",
    title: "系统",
    description: "CPU、内存、网络和磁盘遥测",
  },
  {
    id: "sftp",
    title: "文件",
    description: "SSH/SFTP 与容器文件浏览",
  },
  {
    id: "ports",
    title: "端口",
    description: "SSH 端口转发",
  },
  {
    id: "snippets",
    title: "片段",
    description: "可复用脚本索引",
  },
  {
    id: "logs",
    title: "日志",
    description: "会话和 AI 审计记录",
  },
  {
    id: "settings",
    title: "设置",
    description: "主题、LLM 和安全策略",
  },
];
