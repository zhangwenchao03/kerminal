export type TmuxCommandQuickrefItem = {
  command: string;
  kind: "command";
  label: string;
};

export type TmuxShortcutQuickrefItem = {
  data: string;
  kind: "shortcut";
  label: string;
  shortcut: string;
};

export type TmuxQuickrefItem =
  | TmuxCommandQuickrefItem
  | TmuxShortcutQuickrefItem;

const TMUX_PREFIX = "\u0002";

export const COMMON_TMUX_COMMANDS: TmuxCommandQuickrefItem[] = [
  { command: "tmux ls", kind: "command", label: "列出所有会话" },
  {
    command: "tmux new -s work",
    kind: "command",
    label: "新建名为 work 的会话",
  },
  {
    command: "tmux attach -t work",
    kind: "command",
    label: "连接到 work 会话",
  },
  {
    command: "tmux detach-client",
    kind: "command",
    label: "命令方式退出当前连接",
  },
  {
    command: "tmux switch-client -t work",
    kind: "command",
    label: "在 tmux 内切换会话",
  },
  {
    command: "tmux new-window -n logs",
    kind: "command",
    label: "新建名为 logs 的窗口",
  },
  { command: "tmux split-window -h", kind: "command", label: "左右分屏" },
  { command: "tmux split-window -v", kind: "command", label: "上下分屏" },
  {
    command: "tmux list-windows -t work",
    kind: "command",
    label: "查看 work 会话窗口",
  },
  {
    command: "tmux source-file ~/.tmux.conf",
    kind: "command",
    label: "重新加载 tmux 配置",
  },
];

export const COMMON_TMUX_SHORTCUTS: TmuxShortcutQuickrefItem[] = [
  {
    data: tmuxShortcutData("d"),
    kind: "shortcut",
    label: "快捷键退出当前 tmux 连接",
    shortcut: "Ctrl-b d",
  },
  {
    data: tmuxShortcutData("c"),
    kind: "shortcut",
    label: "新建窗口",
    shortcut: "Ctrl-b c",
  },
  {
    data: tmuxShortcutData("n"),
    kind: "shortcut",
    label: "切到下一个窗口",
    shortcut: "Ctrl-b n",
  },
  {
    data: tmuxShortcutData("p"),
    kind: "shortcut",
    label: "切到上一个窗口",
    shortcut: "Ctrl-b p",
  },
  {
    data: tmuxShortcutData("%"),
    kind: "shortcut",
    label: "左右分屏",
    shortcut: "Ctrl-b %",
  },
  {
    data: tmuxShortcutData('"'),
    kind: "shortcut",
    label: "上下分屏",
    shortcut: 'Ctrl-b "',
  },
  {
    data: tmuxShortcutData("o"),
    kind: "shortcut",
    label: "切换到下一个分屏",
    shortcut: "Ctrl-b o",
  },
  {
    data: tmuxShortcutData("x"),
    kind: "shortcut",
    label: "关闭当前分屏，tmux 会确认",
    shortcut: "Ctrl-b x",
  },
  {
    data: tmuxShortcutData("["),
    kind: "shortcut",
    label: "进入复制模式",
    shortcut: "Ctrl-b [",
  },
  {
    data: tmuxShortcutData("?"),
    kind: "shortcut",
    label: "查看 tmux 快捷键列表",
    shortcut: "Ctrl-b ?",
  },
];

export function tmuxShortcutData(key: string) {
  return `${TMUX_PREFIX}${key}`;
}

export function tmuxQuickrefDisplay(item: TmuxQuickrefItem) {
  return item.kind === "shortcut" ? item.shortcut : item.command;
}
