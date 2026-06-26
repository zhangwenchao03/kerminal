import {
  Bell,
  Clipboard,
  GitBranch,
  Info,
  Keyboard,
  MonitorCog,
  Moon,
  Network,
  Puzzle,
  Route,
  Sun,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CommandSuggestionProvider } from "../../../lib/terminalSuggestionApi";
import type {
  KeybindingPlatform,
  TerminalInlineSuggestionAcceptKey,
  TerminalInlineSuggestionProductionHostPolicy,
  TerminalInlineSuggestionProviderSettings,
  ThemeMode,
} from "../settingsModel";
import type { VisibleSettingsSectionId } from "./types";

export const themeOptions: Array<{
  icon: typeof Moon;
  label: string;
  value: ThemeMode;
}> = [
  { icon: Moon, label: "深色", value: "dark" },
  { icon: Sun, label: "浅色", value: "light" },
  { icon: MonitorCog, label: "跟随系统", value: "system" },
];

export const inlineSuggestionAcceptKeyOptions: Array<{
  label: string;
  value: TerminalInlineSuggestionAcceptKey;
}> = [
  { label: "右方向键", value: "rightArrow" },
  { label: "不绑定", value: "disabled" },
];

export const inlineSuggestionProductionHostPolicyOptions: Array<{
  label: string;
  value: TerminalInlineSuggestionProductionHostPolicy;
}> = [
  { label: "限制远端探测", value: "restricted" },
  { label: "按普通主机", value: "normal" },
];

export const inlineSuggestionProviderOptions: Array<{
  icon: LucideIcon;
  key: keyof TerminalInlineSuggestionProviderSettings;
  label: string;
}> = [
  { icon: Clipboard, key: "history", label: "历史" },
  { icon: Route, key: "remotePath", label: "远端路径" },
  { icon: Terminal, key: "remoteCommand", label: "远端命令" },
  { icon: GitBranch, key: "git", label: "Git" },
  { icon: Wrench, key: "spec", label: "CLI Spec" },
];

export const commandSuggestionProviderLabels: Record<CommandSuggestionProvider, string> = {
  git: "Git",
  history: "历史",
  remoteCommand: "远端命令",
  remotePath: "远端路径",
  spec: "CLI Spec",
};

export const settingsSections: Array<{
  description: string;
  icon: LucideIcon;
  id: VisibleSettingsSectionId;
  label: string;
}> = [
  {
    description: "界面、终端与工作台",
    icon: MonitorCog,
    id: "settings-appearance",
    label: "主题外观",
  },
  {
    description: "状态和 endpoint",
    icon: Puzzle,
    id: "settings-mcp",
    label: "MCP",
  },
  {
    description: "通知和后台事件",
    icon: Bell,
    id: "settings-desktop",
    label: "桌面",
  },
  {
    description: "并发、流水线与超时",
    icon: Network,
    id: "settings-sftp",
    label: "SFTP",
  },
  {
    description: "Win / macOS",
    icon: Keyboard,
    id: "settings-keybindings",
    label: "快捷键列表",
  },
  {
    description: "版本、更新与项目链接",
    icon: Info,
    id: "settings-about",
    label: "关于",
  },
];

export const keybindingPlatformOptions: Array<{
  label: string;
  value: KeybindingPlatform;
}> = [
  { label: "Windows", value: "windows" },
  { label: "macOS", value: "mac" },
];

