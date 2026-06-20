import { useEffect, useRef, type DragEvent as ReactDragEvent } from "react";
import { Archive, Check, ExternalLink, FileText, FolderOpen } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { SftpEntry } from "../../../lib/sftpApi";
import {
  entryKindLabel,
  formatEntryModified,
  formatEntrySize,
  transferKindFromEntry,
} from "./sftpEntryModel";
import { isExtendedSelectionEvent } from "./sftpDragDropModel";
import type { SftpContextMenuEvent, SftpSelectionEvent } from "./types";

export function SftpEntryRow({
  contextMenuOpen,
  entry,
  onContextMenu,
  onContextMenuMouseDown,
  onContextMenuPointerDown,
  onDragEnd,
  onDragStart,
  onOpenDirectory,
  onOpenWorkspaceDirectory,
  onPreviewFile,
  onSelect,
  previewing,
  selected,
}: {
  contextMenuOpen: boolean;
  entry: SftpEntry;
  onContextMenu: (event: SftpContextMenuEvent) => void;
  onContextMenuMouseDown: (event: SftpContextMenuEvent) => void;
  onContextMenuPointerDown: (event: SftpContextMenuEvent) => void;
  onDragEnd: () => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
  onOpenDirectory: (path: string) => Promise<void>;
  onOpenWorkspaceDirectory: (path: string) => void;
  onPreviewFile: () => void;
  onSelect: (event?: SftpSelectionEvent) => void;
  previewing: boolean;
  selected: boolean;
}) {
  const isDirectory = entry.kind === "directory";
  const isRegularFile = entry.kind === "file";
  const Icon =
    entry.kind === "directory"
      ? FolderOpen
      : entry.kind === "symlink"
        ? ExternalLink
        : entry.kind === "other"
          ? Archive
          : FileText;
  const directoryOpenTimerRef = useRef<number | null>(null);

  const cancelQueuedDirectoryOpen = () => {
    if (directoryOpenTimerRef.current !== null) {
      window.clearTimeout(directoryOpenTimerRef.current);
      directoryOpenTimerRef.current = null;
    }
  };

  const queueDirectoryOpen = () => {
    cancelQueuedDirectoryOpen();
    directoryOpenTimerRef.current = window.setTimeout(() => {
      directoryOpenTimerRef.current = null;
      void onOpenDirectory(entry.path);
    }, 180);
  };

  useEffect(() => cancelQueuedDirectoryOpen, []);

  return (
    <div
      className={cn(
        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 px-3 py-2 text-left text-sm transition min-[560px]:grid-cols-[minmax(0,1fr)_4.25rem_5.75rem] min-[720px]:grid-cols-[minmax(0,1fr)_4.75rem_4.25rem_5.75rem]",
        (contextMenuOpen || selected) &&
          "bg-sky-500/12 ring-1 ring-inset ring-sky-400/20 dark:bg-white/[0.08] dark:ring-white/10",
        isDirectory
          ? "text-zinc-900 hover:bg-sky-500/[0.07] dark:text-zinc-100"
          : "text-zinc-800 hover:bg-black/[0.035] dark:text-zinc-200 dark:hover:bg-white/[0.045]",
      )}
      aria-selected={contextMenuOpen || selected}
      data-sftp-entry-row
      draggable={Boolean(transferKindFromEntry(entry))}
      onClick={(event) => onSelect(event)}
      onContextMenu={onContextMenu}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onMouseDown={onContextMenuMouseDown}
      onPointerDown={onContextMenuPointerDown}
      title={entry.path}
    >
      <button
        aria-label={
          isDirectory
            ? `打开目录 ${entry.name}`
            : `${entryKindLabel(entry.kind)} ${entry.name}`
        }
        className={cn(
          "flex min-w-0 items-center gap-2.5 text-left",
          isDirectory || isRegularFile ? "cursor-pointer" : "cursor-default",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(event);
          if (isDirectory && !isExtendedSelectionEvent(event)) {
            queueDirectoryOpen();
          }
        }}
        onContextMenu={onContextMenu}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (isDirectory) {
            cancelQueuedDirectoryOpen();
            onOpenWorkspaceDirectory(entry.path);
            return;
          }
          if (isRegularFile) {
            onPreviewFile();
          }
        }}
        onMouseDown={onContextMenuMouseDown}
        onPointerDown={onContextMenuPointerDown}
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition",
            selected || contextMenuOpen
              ? "border-sky-500 bg-sky-500 text-white dark:border-sky-300 dark:bg-sky-400 dark:text-zinc-950"
              : "border-zinc-300/80 bg-transparent dark:border-zinc-700",
          )}
        >
          {selected || contextMenuOpen ? (
            <Check className="h-2.5 w-2.5" />
          ) : null}
        </span>
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            isDirectory
              ? "text-sky-600 dark:text-sky-300"
              : entry.kind === "symlink"
                ? "text-amber-500 dark:text-amber-300"
                : entry.kind === "other"
                  ? "text-zinc-500 dark:text-zinc-400"
                  : "text-zinc-400 dark:text-zinc-500",
            previewing && "animate-pulse",
          )}
        />
        <span
          className="min-w-0 flex-1 truncate font-medium text-zinc-950 dark:text-zinc-50"
          title={entry.name}
        >
          {entry.name}
        </span>
      </button>
      <span className="hidden truncate text-right font-mono text-[11px] text-zinc-500 min-[720px]:block">
        {entry.permissions ?? "-"}
      </span>
      <span className="hidden truncate text-right font-mono text-[11px] text-zinc-500 min-[560px]:block">
        {formatEntrySize(entry)}
      </span>
      <span className="truncate text-right font-mono text-[11px] text-zinc-500">
        {formatEntryModified(entry.modified)}
      </span>
    </div>
  );
}
