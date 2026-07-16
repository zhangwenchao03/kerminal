import {
  Edit3,
  ExternalLink,
  FileText,
  FolderPlus,
  PanelRight,
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
  onOpenFile,
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
  onOpenFile?: (entry: LocalDirectoryEntry) => void;
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
      className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-56"
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
          {contextMenu.entry.kind === "file" && onOpenFile ? (
            <LocalContextMenuItem
              icon={<PanelRight className="h-4 w-4" />}
              label="在中间打开"
              onClick={() => {
                if (contextMenu.entry) {
                  onOpenFile(contextMenu.entry);
                }
              }}
            />
          ) : null}
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
                danger
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
  danger = false,
  disabled,
  icon,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "kerminal-context-menu-item",
        danger && "kerminal-context-menu-item--danger",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-icon">{icon}</span>
      <span className="kerminal-context-menu-label">{label}</span>
    </button>
  );
}

function LocalContextMenuSeparator() {
  return <div className="kerminal-context-menu-separator" role="none" />;
}

function isMutableLocalEntry(entry: LocalDirectoryEntry) {
  return entry.kind === "file" || entry.kind === "directory";
}

const isRenameableLocalEntry = isMutableLocalEntry;
