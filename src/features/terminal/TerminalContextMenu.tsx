import { useEffect } from "react";
import { cn } from "../../lib/cn";
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

interface TerminalContextMenuProps {
  canCopy: boolean;
  canDisconnect?: boolean;
  canReconnect?: boolean;
  isLogging?: boolean;
  onAction: (action: TerminalContextMenuAction) => void;
  onClose: () => void;
  position: TerminalContextMenuPosition;
}

export interface TerminalContextMenuItemModel {
  action: TerminalContextMenuAction;
  disabled?: boolean;
  label: string;
  shortcut?: string;
}

export function terminalContextMenuGroups({
  canCopy,
  canDisconnect = true,
  canReconnect = true,
  isLogging = false,
}: {
  canCopy: boolean;
  canDisconnect?: boolean;
  canReconnect?: boolean;
  isLogging?: boolean;
}): TerminalContextMenuItemModel[][] {
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
        action: isLogging ? "stopLog" : "startLog",
        label: isLogging ? "停止记录日志" : "开始记录日志",
      },
      {
        action: "openLogs",
        label: "打开日志",
      },
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

export function TerminalContextMenu({
  canCopy,
  canDisconnect = true,
  canReconnect = true,
  isLogging = false,
  onAction,
  onClose,
  position,
}: TerminalContextMenuProps) {
  const groups = terminalContextMenuGroups({
    canCopy,
    canDisconnect,
    canReconnect,
    isLogging,
  });

  useEffect(() => {
    const close = () => onClose();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      aria-label="终端右键菜单"
      className="fixed z-50 w-56 rounded-xl border border-black/10 bg-white p-1.5 text-sm shadow-xl shadow-black/15 dark:border-white/10 dark:bg-zinc-950"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          className={cn(groupIndex > 0 && "mt-1 border-t border-black/8 pt-1 dark:border-white/8")}
          key={group.map((item) => item.action).join("-")}
        >
          {group.map((item) => (
            <TerminalContextMenuItem
              item={item}
              key={item.action}
              onAction={onAction}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TerminalContextMenuItem({
  item,
  onAction,
}: {
  item: TerminalContextMenuItemModel;
  onAction: (action: TerminalContextMenuAction) => void;
}) {
  return (
    <button
      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-zinc-700 transition hover:bg-black/5 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-200 dark:hover:bg-white/8 dark:hover:text-zinc-50"
      disabled={item.disabled}
      onClick={(event) => {
        event.stopPropagation();
        onAction(item.action);
      }}
      role="menuitem"
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut ? (
        <span className="ml-6 text-zinc-400 dark:text-zinc-500">
          {item.shortcut}
        </span>
      ) : null}
    </button>
  );
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
