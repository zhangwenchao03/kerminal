import type { DragEvent as ReactDragEvent } from "react";
import { Archive, Check, ExternalLink, FileText, FolderOpen } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { SftpEntry } from "../../../lib/sftpApi";
import {
  entryKindLabel,
  formatEntryModified,
  formatEntrySize,
  transferKindFromEntry,
} from "./sftpEntryModel";
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
  return (
    <div
      className={cn(
        "kerminal-sftp-entry-grid grid h-full min-h-0 w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
        (contextMenuOpen || selected) &&
          "bg-[var(--surface-selected)] ring-1 ring-inset ring-sky-400/25 dark:ring-sky-300/20",
        isDirectory
          ? "text-zinc-900 hover:bg-[var(--surface-hover)] dark:text-zinc-100"
          : "text-zinc-800 hover:bg-[var(--surface-hover)] dark:text-zinc-200",
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
          "kerminal-focus-ring flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left",
          isDirectory || isRegularFile ? "cursor-pointer" : "cursor-default",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(event);
        }}
        onContextMenu={onContextMenu}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (isDirectory) {
            void onOpenDirectory(entry.path);
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
      <span className="kerminal-sftp-permissions-column hidden truncate text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {entry.permissions ?? "-"}
      </span>
      <span className="kerminal-sftp-size-column hidden truncate text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {formatEntrySize(entry)}
      </span>
      <span className="truncate text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {formatEntryModified(entry.modified)}
      </span>
    </div>
  );
}
