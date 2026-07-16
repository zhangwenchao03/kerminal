import {
  ClipboardPaste,
  Copy,
  FileText,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Undo2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import type {
  RemoteWorkspaceEditorCommandIcon,
  RemoteWorkspaceEditorCommandId,
  RemoteWorkspaceEditorCommandItem,
} from "./remoteWorkspaceEditorCommandModel";
import { resolveRemoteWorkspaceEditorContextMenuPosition } from "./remoteWorkspaceEditorCommandModel";

const COMMAND_ICONS: Record<RemoteWorkspaceEditorCommandIcon, typeof FileText> = {
  clipboardPaste: ClipboardPaste,
  copy: Copy,
  fileText: FileText,
  redo: Redo2,
  refresh: RefreshCw,
  save: Save,
  scissors: Scissors,
  search: Search,
  undo: Undo2,
};

export function RemoteWorkspaceEditorContextMenu({
  groups,
  onAction,
  onClose,
  position,
  title,
}: {
  groups: RemoteWorkspaceEditorCommandItem[][];
  onAction: (command: RemoteWorkspaceEditorCommandId) => void;
  onClose: () => void;
  position: { x: number; y: number };
  title: string;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [resolvedPosition, setResolvedPosition] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || typeof window === "undefined") {
      setResolvedPosition({ x: position.x, y: position.y });
      return;
    }

    const rect = menu.getBoundingClientRect();
    const nextPosition = resolveRemoteWorkspaceEditorContextMenuPosition({
      menuHeight: menu.offsetHeight || rect.height || undefined,
      menuWidth: menu.offsetWidth || rect.width || undefined,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      x: position.x,
      y: position.y,
    });
    setResolvedPosition((current) =>
      current.x === nextPosition.x && current.y === nextPosition.y
        ? current
        : nextPosition,
    );
  }, [groups, position.x, position.y]);

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
      aria-label={`${title} 编辑菜单`}
      className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-60"
      data-menu-domain="remote-workspace-editor"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: resolvedPosition.x, top: resolvedPosition.y }}
    >
      <div className="kerminal-context-menu-header">
        <div className="kerminal-context-menu-title">{title}</div>
        <div className="kerminal-context-menu-description">文本编辑</div>
      </div>
      {groups.map((group) => (
        <div
          className="kerminal-context-menu-group"
          key={group.map((item) => item.id).join("-")}
        >
          {group.map((item) => (
            <RemoteWorkspaceEditorContextMenuItem
              item={item}
              key={item.id}
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

function RemoteWorkspaceEditorContextMenuItem({
  item,
  onAction,
}: {
  item: RemoteWorkspaceEditorCommandItem;
  onAction: (command: RemoteWorkspaceEditorCommandId) => void;
}) {
  const Icon = COMMAND_ICONS[item.icon];
  return (
    <button
      className={cn(
        "kerminal-context-menu-item",
        "grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-2",
      )}
      data-menu-action={item.id}
      data-menu-domain="remote-workspace-editor"
      disabled={item.disabled}
      onClick={() => onAction(item.id)}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-icon">
        <Icon />
      </span>
      <span className="kerminal-context-menu-label">{item.label}</span>
      {item.shortcut ? (
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {item.shortcut}
        </span>
      ) : null}
    </button>
  );
}
