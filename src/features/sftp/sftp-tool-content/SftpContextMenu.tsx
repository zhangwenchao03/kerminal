import {
  ArrowLeftRight,
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
} from "lucide-react";
import { useEffect } from "react";
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
import type { SftpContextMenuScope, SftpMenuAction } from "./types";

const CONTEXT_MENU_ICONS: Record<SftpContextMenuIcon, typeof FileText> = {
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
  scope,
  showHiddenFiles,
  supportsAdvancedActions,
  transferTargetSide,
}: {
  currentPath: string;
  entry: SftpEntry | null;
  onAction: (action: SftpMenuAction) => void;
  onClose: () => void;
  position: { x: number; y: number };
  scope?: SftpContextMenuScope;
  showHiddenFiles: boolean;
  supportsAdvancedActions: boolean;
  transferTargetSide?: "left" | "right";
}) {
  const groups = buildSftpContextMenuGroups({
    entry,
    hasTransferTarget: Boolean(transferTargetSide),
    scope,
    showHiddenFiles,
    supportsAdvancedActions,
    transferTargetSide,
  });
  const title =
    scope?.kind === "selection"
      ? `已选 ${scope.entries.length} 项`
      : entry
        ? entry.name
        : currentPath;
  const description =
    scope?.kind === "selection"
      ? `${scope.transferableEntries.length} 项可传输`
      : entry
        ? entryKindLabel(entry.kind)
        : "当前目录";
  const ariaLabel =
    scope?.kind === "selection"
      ? `SFTP 已选 ${scope.entries.length} 项右键菜单`
      : entry
        ? `SFTP ${entry.name} 右键菜单`
        : "SFTP 目录右键菜单";

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
      aria-label={ariaLabel}
      className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-60"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      data-menu-domain={SFTP_FILE_PANEL_MENU_DOMAIN}
      style={{ left: position.x, top: position.y }}
    >
      <div className="kerminal-context-menu-header">
        <div className="kerminal-context-menu-title">{title}</div>
        <div className="kerminal-context-menu-description font-mono">
          {description}
        </div>
      </div>
      {groups.map((group) => (
        <div
          className="kerminal-context-menu-group"
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
        "kerminal-context-menu-item",
        item.danger && "kerminal-context-menu-item--danger",
      )}
      disabled={item.disabled}
      onClick={() => onAction(item.action)}
      role="menuitem"
      data-menu-action={item.action}
      data-menu-domain={item.domain}
      type="button"
    >
      <span className="kerminal-context-menu-icon">
        <Icon />
      </span>
      <span className="kerminal-context-menu-label">{item.label}</span>
    </button>
  );
}
