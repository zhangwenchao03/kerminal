import type { TerminalSplitDirection } from "../workspace/types";

export type TerminalContextMenuAction =
  | "copy"
  | "paste"
  | "selectAll"
  | "search"
  | "clear"
  | "startLog"
  | "stopLog"
  | "disconnect"
  | "reconnect"
  | "openLogs"
  | "splitHorizontal"
  | "splitVertical";

export interface TerminalContextMenuPosition {
  x: number;
  y: number;
}

export interface TerminalContextMenuItemModel {
  action: TerminalContextMenuAction;
  disabled?: boolean;
  label: string;
  shortcut?: string;
}

export interface TerminalContextMenuGroupOptions {
  canCopy: boolean;
  canDisconnect?: boolean;
  canReconnect?: boolean;
}

export function terminalContextMenuGroups({
  canCopy,
  canDisconnect = true,
  canReconnect = true,
}: TerminalContextMenuGroupOptions): TerminalContextMenuItemModel[][] {
  return [
    [
      {
        action: "copy",
        disabled: !canCopy,
        label: "复制",
        shortcut: "Ctrl+C",
      },
      {
        action: "paste",
        label: "粘贴",
        shortcut: "Ctrl+V",
      },
      {
        action: "selectAll",
        label: "全选",
      },
      {
        action: "clear",
        label: "清屏",
      },
      {
        action: "search",
        label: "搜索",
        shortcut: "Ctrl+F",
      },
    ],
    [
      {
        action: "reconnect",
        disabled: !canReconnect,
        label: "重新连接",
      },
      {
        action: "disconnect",
        disabled: !canDisconnect,
        label: "断开连接",
      },
    ],
    [
      {
        action: "splitHorizontal",
        label: "左右分屏",
      },
      {
        action: "splitVertical",
        label: "上下分屏",
      },
    ],
  ];
}

export function splitDirectionForMenuAction(
  action: TerminalContextMenuAction,
): TerminalSplitDirection | null {
  if (action === "splitHorizontal") {
    return "horizontal";
  }
  if (action === "splitVertical") {
    return "vertical";
  }
  return null;
}
