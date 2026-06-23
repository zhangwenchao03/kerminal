import { useEffect } from "react";
import { cn } from "../../lib/cn";
import {
  terminalContextMenuGroups,
  type TerminalContextMenuAction,
  type TerminalContextMenuItemModel,
  type TerminalContextMenuPosition,
} from "./terminalContextMenuModel";

export {
  splitDirectionForMenuAction,
  terminalContextMenuGroups,
} from "./terminalContextMenuModel";
export type {
  TerminalContextMenuAction,
  TerminalContextMenuItemModel,
  TerminalContextMenuPosition,
} from "./terminalContextMenuModel";

const terminalMenuSurfaceClassName =
  "kerminal-floating-enter fixed z-[1000] w-56 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-1.5 text-sm shadow-2xl shadow-black/20 backdrop-blur-xl dark:shadow-black/50";
const terminalMenuDividerClassName =
  "mt-1 border-t border-[var(--border-subtle)] pt-1";
const terminalMenuItemClassName =
  "kerminal-focus-ring kerminal-pressable flex w-full items-center rounded-lg px-3 py-2 text-left text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-200 dark:hover:text-zinc-50";

interface TerminalContextMenuProps {
  canCopy: boolean;
  canDisconnect?: boolean;
  canReconnect?: boolean;
  onAction: (action: TerminalContextMenuAction) => void;
  onClose: () => void;
  position: TerminalContextMenuPosition;
}

export function TerminalContextMenu({
  canCopy,
  canDisconnect = true,
  canReconnect = true,
  onAction,
  onClose,
  position,
}: TerminalContextMenuProps) {
  const groups = terminalContextMenuGroups({
    canCopy,
    canDisconnect,
    canReconnect,
  });

  useEffect(() => {
    const close = () => onClose();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [onClose]);

  return (
    <div
      aria-label="终端右键菜单"
      className={terminalMenuSurfaceClassName}
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
          className={cn(groupIndex > 0 && terminalMenuDividerClassName)}
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
      className={terminalMenuItemClassName}
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
