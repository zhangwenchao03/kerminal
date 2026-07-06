// @author kongweiguang

import {
  AlertTriangle,
  Check,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type {
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type {
  RemoteWorkspaceStatus,
  WorkspaceTreeNode,
} from "./remoteWorkspaceEditorModel";

export function WorkspaceTreeRow({
  activePath,
  depth,
  isOpen,
  node,
  onContextMenu,
  onContextMenuFromPress,
  onOpenFile,
  onToggleDirectory,
}: {
  activePath: string | null;
  depth: number;
  isOpen: boolean;
  node: WorkspaceTreeNode;
  onContextMenu?: (
    event: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
    item: WorkspaceTreeNode,
  ) => void;
  onContextMenuFromPress?: (
    event: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
    item: WorkspaceTreeNode,
  ) => void;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (item: WorkspaceTreeNode) => void;
}) {
  const isDirectory = node.kind === "directory";
  const selected = activePath === node.path;
  const Icon = isDirectory ? (isOpen ? FolderOpen : Folder) : FileText;

  return (
    <button
      aria-expanded={isDirectory ? isOpen : undefined}
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex h-8 w-full items-center gap-2 px-2 text-left text-xs transition",
        selected
          ? "bg-[var(--surface-selected)] text-sky-800 dark:text-sky-100"
          : "text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
      )}
      onClick={() => {
        if (isDirectory) {
          onToggleDirectory(node);
          return;
        }
        onOpenFile(node.path);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) {
          return;
        }
        event.stopPropagation();
        onContextMenu(event, node);
      }}
      onMouseDown={(event) => {
        if (!onContextMenuFromPress) {
          return;
        }
        event.stopPropagation();
        onContextMenuFromPress(event, node);
      }}
      onPointerDown={(event) => {
        if (!onContextMenuFromPress) {
          return;
        }
        event.stopPropagation();
        onContextMenuFromPress(event, node);
      }}
      role="treeitem"
      style={{ paddingLeft: 8 + depth * 18 }}
      title={node.path}
      type="button"
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isDirectory
            ? "text-sky-600 dark:text-sky-300"
            : "text-zinc-400 dark:text-zinc-500",
          node.loading && "animate-pulse",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {node.error ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
      ) : null}
    </button>
  );
}

export function EditorToolbarButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-8 rounded-md px-2 text-xs"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {icon}
      {label}
    </Button>
  );
}

export function WorkspaceInlineStatus({
  status,
}: {
  status: RemoteWorkspaceStatus | null;
}) {
  if (!status) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 truncate rounded-md border px-2 py-0.5",
        status.kind === "success" &&
          "border-emerald-300/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
        status.kind === "error" &&
          "border-rose-300/35 bg-rose-500/10 text-rose-700 dark:text-rose-100",
        status.kind === "info" &&
          "border-sky-300/35 bg-sky-500/10 text-sky-700 dark:text-sky-100",
      )}
      role={status.kind === "error" ? "alert" : "status"}
    >
      {status.kind === "success" ? <Check className="h-3 w-3" /> : null}
      {status.kind === "error" ? <AlertTriangle className="h-3 w-3" /> : null}
      <span className="truncate">{status.message}</span>
    </span>
  );
}
