import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  resolveTerminalContextMenuPosition,
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
  "kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-56";
const terminalMenuDividerClassName =
  "kerminal-context-menu-group";
const terminalMenuItemClassName =
  "kerminal-context-menu-item";

interface TerminalContextMenuProps {
  canCopy: boolean;
  canCopySessionId?: boolean;
  canDisconnect?: boolean;
  canReconnect?: boolean;
  canSendSelectionToAgent?: boolean;
  canSendToAgent?: boolean;
  canSplit?: boolean;
  onAction: (action: TerminalContextMenuAction) => void;
  onClose: () => void;
  position: TerminalContextMenuPosition;
}

export function TerminalContextMenu({
  canCopy,
  canCopySessionId = true,
  canDisconnect = true,
  canReconnect = true,
  canSendSelectionToAgent = false,
  canSendToAgent = true,
  canSplit = true,
  onAction,
  onClose,
  position,
}: TerminalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState(position);
  const groups = terminalContextMenuGroups({
    canCopy,
    canCopySessionId,
    canDisconnect,
    canReconnect,
    canSendSelectionToAgent,
    canSendToAgent,
    canSplit,
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || typeof window === "undefined") {
      setResolvedPosition(position);
      return;
    }

    const rect = menu.getBoundingClientRect();
    const nextPosition = resolveTerminalContextMenuPosition(position, {
      menuSize: {
        height: menu.offsetHeight || rect.height,
        width: menu.offsetWidth || rect.width,
      },
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    });
    setResolvedPosition((current) =>
      current.x === nextPosition.x && current.y === nextPosition.y
        ? current
        : nextPosition,
    );
  }, [
    canCopy,
    canCopySessionId,
    canDisconnect,
    canReconnect,
    canSendSelectionToAgent,
    canSendToAgent,
    canSplit,
    position.x,
    position.y,
  ]);

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

  const menu = (
    <div
      aria-label="终端右键菜单"
      className={terminalMenuSurfaceClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{
        left: resolvedPosition.x,
        top: resolvedPosition.y,
      }}
    >
      {groups.map((group) => (
        <div
          className={terminalMenuDividerClassName}
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

  if (typeof document === "undefined") {
    return menu;
  }
  return createPortal(menu, document.body);
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
      <span className="kerminal-context-menu-label">{item.label}</span>
      {item.shortcut ? (
        <span className="kerminal-context-menu-shortcut">{item.shortcut}</span>
      ) : null}
    </button>
  );
}
