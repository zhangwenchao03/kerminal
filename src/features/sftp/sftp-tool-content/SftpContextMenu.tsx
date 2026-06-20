import {
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
  entryKindLabel,
  isDownloadableFileEntry,
  transferKindFromEntry,
} from "./sftpEntryModel";
import type { SftpMenuAction } from "./types";

export function SftpContextMenu({
  currentPath,
  entry,
  onAction,
  onClose,
  position,
  showHiddenFiles,
  supportsAdvancedActions,
}: {
  currentPath: string;
  entry: SftpEntry | null;
  onAction: (action: SftpMenuAction) => void;
  onClose: () => void;
  position: { x: number; y: number };
  showHiddenFiles: boolean;
  supportsAdvancedActions: boolean;
}) {
  const groups = contextMenuGroups(
    entry,
    showHiddenFiles,
    supportsAdvancedActions,
  );
  const title = entry ? entry.name : currentPath;

  return (
    <div
      aria-label={entry ? `SFTP ${entry.name} 右键菜单` : "SFTP 目录右键菜单"}
      className={cn(
        "fixed z-50 w-56 overflow-hidden rounded-2xl border border-black/10 bg-white/95 p-1.5 text-zinc-900 shadow-2xl shadow-black/20 backdrop-blur dark:border-white/10 dark:bg-zinc-950/95 dark:text-zinc-100 dark:shadow-black/45",
      )}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mb-1 border-b border-black/8 px-2 py-1.5 dark:border-white/8">
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
              "mt-1 border-t border-black/8 pt-1 dark:border-white/8",
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
        className="mt-1 w-full justify-start text-xs"
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

type SftpContextMenuItemModel = {
  action: SftpMenuAction;
  danger?: boolean;
  disabled?: boolean;
  icon: typeof FileText;
  label: string;
};

function SftpContextMenuItem({
  item,
  onAction,
}: {
  item: SftpContextMenuItemModel;
  onAction: (action: SftpMenuAction) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-45",
        item.danger
          ? "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
          : "text-zinc-700 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-200 dark:hover:bg-white/8 dark:hover:text-zinc-50",
      )}
      disabled={item.disabled}
      onClick={() => onAction(item.action)}
      role="menuitem"
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

function contextMenuGroups(
  entry: SftpEntry | null,
  showHiddenFiles: boolean,
  supportsAdvancedActions: boolean,
): SftpContextMenuItemModel[][] {
  if (!entry) {
    return [
      [
        {
          action: "uploadFile",
          icon: Upload,
          label: "上传文件",
        },
        {
          action: "uploadDirectory",
          icon: FolderOpen,
          label: "上传文件夹",
        },
        ...(supportsAdvancedActions
          ? [
              {
                action: "pasteClipboard" as const,
                icon: ClipboardPaste,
                label: "粘贴 SFTP 剪贴板",
              },
              {
                action: "uploadFileArchive" as const,
                icon: Archive,
                label: "上传文件为 ZIP",
              },
              {
                action: "uploadDirectoryArchive" as const,
                icon: Archive,
                label: "上传文件夹为 ZIP",
              },
            ]
          : []),
        {
          action: "newDirectory",
          icon: FolderPlus,
          label: "新建目录",
        },
      ],
      [
        {
          action: "refresh",
          icon: RefreshCw,
          label: "刷新目录",
        },
        {
          action: "toggleHidden",
          icon: showHiddenFiles ? EyeOff : Eye,
          label: showHiddenFiles ? "隐藏隐藏文件" : "显示隐藏文件",
        },
        {
          action: "copyPath",
          icon: Copy,
          label: "复制当前路径",
        },
      ],
    ];
  }

  if (entry.kind === "directory") {
    return [
      [
        {
          action: "open",
          icon: FolderOpen,
          label: "打开",
        },
        {
          action: "workspace",
          icon: FileSearch,
          label: "工作区打开",
        },
        {
          action: "download",
          icon: Download,
          label: "下载文件夹",
        },
        ...(supportsAdvancedActions
          ? [
              {
                action: "downloadArchive" as const,
                icon: Archive,
                label: "下载为 ZIP",
              },
              {
                action: "downloadClipboard" as const,
                icon: Download,
                label: "下载到剪贴板",
              },
            ]
          : []),
        {
          action: "uploadFileInto",
          icon: Upload,
          label: "上传文件到此目录",
        },
        {
          action: "uploadDirectoryInto",
          icon: FolderPlus,
          label: "上传文件夹到此目录",
        },
        ...(supportsAdvancedActions
          ? [
              {
                action: "pasteClipboard" as const,
                icon: ClipboardPaste,
                label: "粘贴到此目录",
              },
            ]
          : []),
      ],
      [
        ...(supportsAdvancedActions
          ? [
              {
                action: "copyItem" as const,
                icon: Copy,
                label: "复制项目",
              },
            ]
          : []),
        {
          action: "copyPath",
          icon: Copy,
          label: "复制路径",
        },
        {
          action: "rename",
          icon: Pencil,
          label: "重命名",
        },
        {
          action: "chmod",
          icon: Pencil,
          label: "修改权限",
        },
      ],
      [
        {
          action: "delete",
          danger: true,
          icon: Trash2,
          label: "删除目录",
        },
      ],
    ];
  }

  return [
    [
      {
        action: "preview",
        disabled: entry.kind !== "file",
        icon: FileSearch,
        label: "打开编辑器",
      },
      {
        action: "download",
        disabled: !isDownloadableFileEntry(entry),
        icon: Download,
        label: "下载",
      },
      ...(supportsAdvancedActions
        ? [
            {
              action: "downloadArchive" as const,
              disabled: !transferKindFromEntry(entry),
              icon: Archive,
              label: "下载为 ZIP",
            },
            {
              action: "downloadClipboard" as const,
              disabled: !transferKindFromEntry(entry),
              icon: Download,
              label: "下载到剪贴板",
            },
          ]
        : []),
    ],
    [
      ...(supportsAdvancedActions
        ? [
            {
              action: "copyItem" as const,
              disabled: !transferKindFromEntry(entry),
              icon: Copy,
              label: "复制项目",
            },
          ]
        : []),
      {
        action: "copyPath",
        icon: Copy,
        label: "复制路径",
      },
      {
        action: "rename",
        icon: Pencil,
        label: "重命名",
      },
      {
        action: "chmod",
        icon: Pencil,
        label: "修改权限",
      },
    ],
    [
      {
        action: "delete",
        danger: true,
        icon: Trash2,
        label: "删除",
      },
    ],
  ];
}
