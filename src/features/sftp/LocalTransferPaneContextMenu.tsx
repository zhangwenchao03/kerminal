import {
  Edit3,
  ExternalLink,
  FileText,
  FolderPlus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import type {
  LocalDirectoryEntry,
  LocalDirectoryListing,
} from "../../lib/fileDialogApi";

export type LocalContextMenuState = {
  entry: LocalDirectoryEntry | null;
  x: number;
  y: number;
};

export function LocalTransferPaneContextMenu({
  canTransferContextEntries,
  contextMenu,
  loading,
  listing,
  onCopyEntryPath,
  onCreateDirectory,
  onDeleteEntry,
  onOpenEntryInFileManager,
  onRefresh,
  onRenameEntry,
  onTransfer,
  transferableContextEntryCount,
}: {
  canTransferContextEntries: boolean;
  contextMenu: LocalContextMenuState | null;
  loading: boolean;
  listing: LocalDirectoryListing | null;
  onCopyEntryPath: (entry: LocalDirectoryEntry) => void;
  onCreateDirectory: () => void;
  onDeleteEntry: (entry: LocalDirectoryEntry) => void;
  onOpenEntryInFileManager: (entry: LocalDirectoryEntry) => void;
  onRefresh: () => void;
  onRenameEntry: (entry: LocalDirectoryEntry) => void;
  onTransfer: () => void;
  transferableContextEntryCount: number;
}) {
  if (!contextMenu || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-label="本地文件操作菜单"
      className="kerminal-floating-surface fixed z-50 w-56 overflow-hidden rounded-xl border p-1 text-sm text-zinc-900 shadow-lg dark:text-zinc-100"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      role="menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      <LocalContextMenuItem
        disabled={!canTransferContextEntries}
        icon={<Send className="h-4 w-4" />}
        label={
          transferableContextEntryCount > 1
            ? `传输 ${transferableContextEntryCount} 项`
            : "传输到右侧"
        }
        onClick={onTransfer}
      />
      {contextMenu.entry ? (
        <>
          <LocalContextMenuSeparator />
          <LocalContextMenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            label="在文件管理器中打开"
            onClick={() => {
              if (contextMenu.entry) {
                onOpenEntryInFileManager(contextMenu.entry);
              }
            }}
          />
          <LocalContextMenuItem
            icon={<FileText className="h-4 w-4" />}
            label="复制路径"
            onClick={() => {
              if (contextMenu.entry) {
                onCopyEntryPath(contextMenu.entry);
              }
            }}
          />
          {isRenameableLocalEntry(contextMenu.entry) ? (
            <LocalContextMenuItem
              icon={<Edit3 className="h-4 w-4" />}
              label="重命名"
              onClick={() => {
                if (contextMenu.entry) {
                  onRenameEntry(contextMenu.entry);
                }
              }}
            />
          ) : null}
          {isMutableLocalEntry(contextMenu.entry) ? (
            <>
              <LocalContextMenuSeparator />
              <LocalContextMenuItem
                icon={<Trash2 className="h-4 w-4" />}
                label="删除"
                onClick={() => {
                  if (contextMenu.entry) {
                    onDeleteEntry(contextMenu.entry);
                  }
                }}
              />
            </>
          ) : null}
        </>
      ) : null}
      <LocalContextMenuSeparator />
      {!contextMenu.entry ? (
        <>
          <LocalContextMenuItem
            disabled={!listing || loading}
            icon={<FolderPlus className="h-4 w-4" />}
            label="新建文件夹"
            onClick={onCreateDirectory}
          />
          <LocalContextMenuSeparator />
        </>
      ) : null}
      <LocalContextMenuItem
        disabled={!listing || loading}
        icon={<RefreshCw className="h-4 w-4" />}
        label="刷新"
        onClick={onRefresh}
      />
    </div>,
    document.body,
  );
}

function LocalContextMenuItem({
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
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition",
        disabled
          ? "cursor-not-allowed text-zinc-400 dark:text-zinc-600"
          : "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function LocalContextMenuSeparator() {
  return <div className="my-1 h-px bg-[var(--border-subtle)]" role="none" />;
}

function isMutableLocalEntry(entry: LocalDirectoryEntry) {
  return entry.kind === "file" || entry.kind === "directory";
}

const isRenameableLocalEntry = isMutableLocalEntry;
