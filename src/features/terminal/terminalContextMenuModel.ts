import type { TerminalSplitDirection } from "../workspace/contracts/index";

export type TerminalContextMenuAction =
  | "copy"
  | "copySessionId"
  | "sendSelectionToAgent"
  | "sendContextToAgent"
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

interface TerminalContextMenuSize {
  height: number;
  width: number;
}

interface TerminalContextMenuViewport {
  height: number;
  width: number;
}

export interface TerminalContextMenuPositionOptions {
  inset?: number;
  menuSize?: TerminalContextMenuSize;
  viewport?: TerminalContextMenuViewport;
}

export interface TerminalContextMenuItemModel {
  action: TerminalContextMenuAction;
  disabled?: boolean;
  label: string;
  shortcut?: string;
}

export interface TerminalContextMenuGroupOptions {
  canCopy: boolean;
  canCopySessionId?: boolean;
  canDisconnect?: boolean;
  canReconnect?: boolean;
  canSendSelectionToAgent?: boolean;
  canSendToAgent?: boolean;
  canSplit?: boolean;
}

const TERMINAL_CONTEXT_MENU_VIEWPORT_INSET = 8;

export function terminalContextMenuGroups({
  canCopy,
  canCopySessionId = true,
  canDisconnect = true,
  canReconnect = true,
  canSendSelectionToAgent = false,
  canSendToAgent = true,
  canSplit = true,
}: TerminalContextMenuGroupOptions): TerminalContextMenuItemModel[][] {
  const groups: TerminalContextMenuItemModel[][] = [
    [
      {
        action: "copySessionId",
        disabled: !canCopySessionId,
        label: "复制会话 ID",
      },
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
        action: "sendSelectionToAgent",
        disabled: !canSendSelectionToAgent,
        label: "发送选中内容到 Agent",
      },
      {
        action: "sendContextToAgent",
        disabled: !canSendToAgent,
        label: "发送当前终端上下文到 Agent",
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
  ];
  if (canSplit) {
    groups.push([
      {
        action: "splitHorizontal",
        label: "左右分屏",
      },
      {
        action: "splitVertical",
        label: "上下分屏",
      },
    ]);
  }
  return groups;
}

export function resolveTerminalContextMenuPosition(
  position: TerminalContextMenuPosition,
  options: TerminalContextMenuPositionOptions = {},
): TerminalContextMenuPosition {
  const {
    inset = TERMINAL_CONTEXT_MENU_VIEWPORT_INSET,
    menuSize,
    viewport,
  } = options;
  if (
    !menuSize ||
    !viewport ||
    menuSize.width <= 0 ||
    menuSize.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return position;
  }

  const maxX = Math.max(inset, viewport.width - menuSize.width - inset);
  const maxY = Math.max(inset, viewport.height - menuSize.height - inset);
  return {
    x: Math.max(inset, Math.min(position.x, maxX)),
    y: Math.max(inset, Math.min(position.y, maxY)),
  };
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
