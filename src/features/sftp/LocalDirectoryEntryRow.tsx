/**
 * 本机目录行渲染和本机文件拖拽 payload。
 *
 * @author kongweiguang
 */

import { Archive, Check, ExternalLink, FileText, FolderOpen } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "../../lib/cn";
import type { LocalDirectoryEntry } from "../../lib/fileDialogApi";
import { formatFileSize } from "./sftpFileUtils";
import { formatEntryModified } from "./sftp-tool-content/sftpEntryModel";
import {
  SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
  buildSftpLocalFileDragPayload,
} from "./sftp-tool-content/sftpLocalUploadDropModel";

export function LocalDirectoryEntryRow({
  dragEntries,
  entry,
  onOpenDirectory,
  onOpenContextMenu,
  onSelect,
  selected,
}: {
  dragEntries: LocalDirectoryEntry[];
  entry: LocalDirectoryEntry;
  onOpenDirectory: (path: string) => Promise<void>;
  onOpenContextMenu: (
    event: ReactMouseEvent,
    entry: LocalDirectoryEntry | null,
  ) => void;
  onSelect: (entry: LocalDirectoryEntry, event: ReactMouseEvent) => void;
  selected: boolean;
}) {
  const isDirectory = entry.kind === "directory";
  const Icon = localEntryIcon(entry.kind);

  return (
    <div
      aria-selected={selected}
      className={cn(
        "grid h-full min-h-0 w-full grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors min-[560px]:grid-cols-[minmax(0,1fr)_4.25rem_5.75rem]",
        selected &&
          "bg-[var(--surface-selected)] ring-1 ring-inset ring-sky-400/25 dark:ring-sky-300/20",
        isDirectory
          ? "text-zinc-900 hover:bg-[var(--surface-hover)] dark:text-zinc-100"
          : "text-zinc-800 hover:bg-[var(--surface-hover)] dark:text-zinc-200",
      )}
      draggable={isTransferableLocalEntry(entry)}
      data-local-entry-row
      onClick={(event) => onSelect(entry, event)}
      onContextMenu={(event) => onOpenContextMenu(event, entry)}
      onDoubleClick={() => {
        if (isDirectory) {
          void onOpenDirectory(entry.path);
        }
      }}
      onDragStart={(event) => {
        if (!isTransferableLocalEntry(entry)) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
          SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
          JSON.stringify(
            buildSftpLocalFileDragPayload({
              entries: dragEntries.filter(isTransferableLocalEntry),
            }),
          ),
        );
        event.dataTransfer.setData("text/plain", entry.path);
      }}
      title={entry.path}
    >
      <button
        aria-label={`${localEntryKindLabel(entry.kind)} ${entry.name}`}
        className={cn(
          "kerminal-focus-ring flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left",
          isDirectory ? "cursor-pointer" : "cursor-default",
        )}
        draggable={isTransferableLocalEntry(entry)}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entry, event);
        }}
        onContextMenu={(event) => onOpenContextMenu(event, entry)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (isDirectory) {
            void onOpenDirectory(entry.path);
          }
        }}
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition",
            selected
              ? "border-sky-500 bg-sky-500 text-white dark:border-sky-300 dark:bg-sky-400 dark:text-zinc-950"
              : "border-zinc-300/80 bg-transparent dark:border-zinc-700",
          )}
        >
          {selected ? <Check className="h-2.5 w-2.5" /> : null}
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
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium" title={entry.name}>
          {entry.name}
        </span>
      </button>
      <span className="hidden truncate text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400 min-[560px]:block">
        {formatLocalEntrySize(entry)}
      </span>
      <span className="truncate text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {formatEntryModified(entry.modified ?? undefined)}
      </span>
      <span className="sr-only">{localEntryKindLabel(entry.kind)}</span>
    </div>
  );
}

function localEntryIcon(kind: LocalDirectoryEntry["kind"]) {
  if (kind === "directory") {
    return FolderOpen;
  }
  if (kind === "symlink") {
    return ExternalLink;
  }
  if (kind === "other") {
    return Archive;
  }
  return FileText;
}

function localEntryKindLabel(kind: LocalDirectoryEntry["kind"]) {
  if (kind === "directory") {
    return "目录";
  }
  if (kind === "symlink") {
    return "链接";
  }
  if (kind === "file") {
    return "文件";
  }
  return "项目";
}

function formatLocalEntrySize(entry: LocalDirectoryEntry) {
  if (entry.kind === "directory") {
    return "-";
  }
  return entry.size == null ? "-" : formatFileSize(entry.size);
}

export function isTransferableLocalEntry(
  entry: LocalDirectoryEntry,
): entry is LocalDirectoryEntry & { kind: "directory" | "file" } {
  return entry.kind === "file" || entry.kind === "directory";
}
