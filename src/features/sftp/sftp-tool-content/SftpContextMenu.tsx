import {
  ArrowLeftRight,
  Archive,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileSearch,
  FileText,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { SftpEntry } from "../../../lib/sftpApi";
import {
  SFTP_FILE_PANEL_MENU_DOMAIN,
  buildSftpContextMenuGroups,
  type SftpContextMenuIcon,
  type SftpContextMenuItemModel,
} from "./sftpContextMenuModel";
import {
  entryKindLabel,
} from "./sftpEntryModel";
import type { SftpMenuAction } from "./types";

const CONTEXT_MENU_ICONS: Record<SftpContextMenuIcon, typeof FileText> = {
  archive: Archive,
  clipboardPaste: ClipboardPaste,
  copy: Copy,
  download: Download,
  eye: Eye,
  eyeOff: EyeOff,
  fileSearch: FileSearch,
  folderOpen: FolderOpen,
  folderPlus: FolderPlus,
  pencil: Pencil,
  refresh: RefreshCw,
  trash: Trash2,
  transfer: ArrowLeftRight,
  upload: Upload,
};

export function SftpContextMenu({
  currentPath,
  entry,
  onAction,
  onClose,
  position,
  showHiddenFiles,
  supportsAdvancedActions,
  transferTargetSide,
}: {
  currentPath: string;
  entry: SftpEntry | null;
  onAction: (action: SftpMenuAction) => void;
  onClose: () => void;
  position: { x: number; y: number };
  showHiddenFiles: boolean;
  supportsAdvancedActions: boolean;
  transferTargetSide?: "left" | "right";
}) {
  const groups = buildSftpContextMenuGroups({
    entry,
    hasTransferTarget: Boolean(transferTargetSide),
    showHiddenFiles,
    supportsAdvancedActions,
    transferTargetSide,
  });
  const title = entry ? entry.name : currentPath;

  return (
    <div
      aria-label={entry ? `SFTP ${entry.name} 右键菜单` : "SFTP 目录右键菜单"}
      className={cn(
        "kerminal-floating-surface kerminal-floating-enter fixed z-[1000] w-56 overflow-hidden rounded-2xl border p-1.5 text-zinc-900 dark:text-zinc-100",
      )}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      data-menu-domain={SFTP_FILE_PANEL_MENU_DOMAIN}
      style={{ left: position.x, top: position.y }}
    >
      <div className="mb-1 border-b border-[var(--border-subtle)] px-2 py-1.5">
        <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
          {title}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
          {entry ? entryKindLabel(entry.kind) : "当前目录"}
        </div>
      </div>
      {groups.map((group, groupIndex) => (
        <div
          className={cn(
            groupIndex > 0 &&
              "mt-1 border-t border-[var(--border-subtle)] pt-1",
          )}
          key={group.map((item) => item.action).join("-")}
        >
          {group.map((item) => (
            <SftpContextMenuItem
              item={item}
              key={item.action}
              onAction={onAction}
            />
          ))}
        </div>
      ))}
      <Button
        aria-label="关闭 SFTP 右键菜单"
        className="kerminal-focus-ring kerminal-pressable mt-1 w-full justify-start rounded-xl text-xs hover:bg-[var(--surface-hover)]"
        onClick={onClose}
        size="sm"
        variant="ghost"
      >
        <X className="h-3.5 w-3.5" />
        关闭菜单
      </Button>
    </div>
  );
}

function SftpContextMenuItem({
  item,
  onAction,
}: {
  item: SftpContextMenuItemModel;
  onAction: (action: SftpMenuAction) => void;
}) {
  const Icon = CONTEXT_MENU_ICONS[item.icon];
  return (
    <button
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-45",
        item.danger
          ? "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
          : "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50",
      )}
      disabled={item.disabled}
      onClick={() => onAction(item.action)}
      role="menuitem"
      data-menu-action={item.action}
      data-menu-domain={item.domain}
      type="button"
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          item.disabled
            ? "text-zinc-400 dark:text-zinc-600"
            : item.danger
              ? "text-red-500 dark:text-red-300"
              : "text-sky-500 dark:text-sky-300",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );
}
