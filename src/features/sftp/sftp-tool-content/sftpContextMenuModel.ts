/**
 * SFTP context menu action availability model.
 *
 * @author kongweiguang
 */

import type { SftpEntry } from "../../../lib/sftpApi";
import {
  isDownloadableFileEntry,
  transferKindFromEntry,
} from "./sftpEntryModel";
import type { SftpMenuAction } from "./types";

export const SFTP_FILE_PANEL_MENU_DOMAIN = "sftpFilePanel";

export const SFTP_FILE_PANEL_MENU_ACTIONS = [
  "open",
  "workspace",
  "preview",
  "download",
  "transferToTarget",
  "downloadArchive",
  "downloadClipboard",
  "copyItem",
  "pasteClipboard",
  "copyPath",
  "rename",
  "chmod",
  "delete",
  "uploadFile",
  "uploadDirectory",
  "uploadFileArchive",
  "uploadDirectoryArchive",
  "uploadFileInto",
  "uploadDirectoryInto",
  "newDirectory",
  "refresh",
  "toggleHidden",
] satisfies readonly SftpMenuAction[];

export type SftpContextMenuIcon =
  | "archive"
  | "clipboardPaste"
  | "copy"
  | "download"
  | "eye"
  | "eyeOff"
  | "fileSearch"
  | "folderOpen"
  | "folderPlus"
  | "pencil"
  | "refresh"
  | "trash"
  | "transfer"
  | "upload";

export type SftpContextMenuItemModel = {
  action: SftpMenuAction;
  danger?: boolean;
  disabled?: boolean;
  domain: typeof SFTP_FILE_PANEL_MENU_DOMAIN;
  icon: SftpContextMenuIcon;
  label: string;
};

type SftpContextMenuItemDraft = Omit<SftpContextMenuItemModel, "domain">;

export type SftpContextMenuGroupsOptions = {
  entry: SftpEntry | null;
  hasTransferTarget?: boolean;
  showHiddenFiles: boolean;
  supportsAdvancedActions: boolean;
  transferTargetSide?: "left" | "right";
};

export function buildSftpContextMenuGroups({
  entry,
  hasTransferTarget = false,
  showHiddenFiles,
  supportsAdvancedActions,
  transferTargetSide,
}: SftpContextMenuGroupsOptions): SftpContextMenuItemModel[][] {
  if (!entry) {
    return withSftpFilePanelDomain([
      [
        {
          action: "uploadFile",
          icon: "upload",
          label: "上传文件",
        },
        {
          action: "uploadDirectory",
          icon: "folderOpen",
          label: "上传文件夹",
        },
        ...(supportsAdvancedActions
          ? [
              {
                action: "pasteClipboard" as const,
                icon: "clipboardPaste" as const,
                label: "粘贴 SFTP 剪贴板",
              },
              {
                action: "uploadFileArchive" as const,
                icon: "archive" as const,
                label: "上传文件为 ZIP",
              },
              {
                action: "uploadDirectoryArchive" as const,
                icon: "archive" as const,
                label: "上传文件夹为 ZIP",
              },
            ]
          : []),
        {
          action: "newDirectory",
          icon: "folderPlus",
          label: "新建目录",
        },
      ],
      [
        {
          action: "refresh",
          icon: "refresh",
          label: "刷新目录",
        },
        {
          action: "toggleHidden",
          icon: showHiddenFiles ? "eyeOff" : "eye",
          label: showHiddenFiles ? "隐藏隐藏文件" : "显示隐藏文件",
        },
        {
          action: "copyPath",
          icon: "copy",
          label: "复制当前路径",
        },
      ],
    ]);
  }

  if (entry.kind === "directory") {
    return withSftpFilePanelDomain([
      [
        ...transferTargetMenuItems({
          entry,
          hasTransferTarget,
          transferTargetSide,
        }),
        {
          action: "open",
          icon: "folderOpen",
          label: "打开",
        },
        {
          action: "workspace",
          icon: "fileSearch",
          label: "工作区打开",
        },
        {
          action: "download",
          icon: "download",
          label: "下载文件夹",
        },
        ...(supportsAdvancedActions
          ? [
              {
                action: "downloadArchive" as const,
                icon: "archive" as const,
                label: "下载为 ZIP",
              },
              {
                action: "downloadClipboard" as const,
                icon: "download" as const,
                label: "下载到剪贴板",
              },
            ]
          : []),
        {
          action: "uploadFileInto",
          icon: "upload",
          label: "上传文件到此目录",
        },
        {
          action: "uploadDirectoryInto",
          icon: "folderPlus",
          label: "上传文件夹到此目录",
        },
        ...(supportsAdvancedActions
          ? [
              {
                action: "pasteClipboard" as const,
                icon: "clipboardPaste" as const,
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
                icon: "copy" as const,
                label: "复制项目",
              },
            ]
          : []),
        {
          action: "copyPath",
          icon: "copy",
          label: "复制路径",
        },
        {
          action: "rename",
          icon: "pencil",
          label: "重命名",
        },
        {
          action: "chmod",
          icon: "pencil",
          label: "修改权限",
        },
      ],
      [
        {
          action: "delete",
          danger: true,
          icon: "trash",
          label: "删除目录",
        },
      ],
    ]);
  }

  return withSftpFilePanelDomain([
    [
      ...transferTargetMenuItems({
        entry,
        hasTransferTarget,
        transferTargetSide,
      }),
      {
        action: "preview",
        disabled: entry.kind !== "file",
        icon: "fileSearch",
        label: "打开编辑器",
      },
      {
        action: "download",
        disabled: !isDownloadableFileEntry(entry),
        icon: "download",
        label: "下载",
      },
      ...(supportsAdvancedActions
        ? [
            {
              action: "downloadArchive" as const,
              disabled: !transferKindFromEntry(entry),
              icon: "archive" as const,
              label: "下载为 ZIP",
            },
            {
              action: "downloadClipboard" as const,
              disabled: !transferKindFromEntry(entry),
              icon: "download" as const,
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
              icon: "copy" as const,
              label: "复制项目",
            },
          ]
        : []),
      {
        action: "copyPath",
        icon: "copy",
        label: "复制路径",
      },
      {
        action: "rename",
        icon: "pencil",
        label: "重命名",
      },
      {
        action: "chmod",
        icon: "pencil",
        label: "修改权限",
      },
    ],
    [
      {
        action: "delete",
        danger: true,
        icon: "trash",
        label: "删除",
      },
    ],
  ]);
}

function withSftpFilePanelDomain(
  groups: SftpContextMenuItemDraft[][],
): SftpContextMenuItemModel[][] {
  return groups.map((group) =>
    group.map((item) => ({
      ...item,
      domain: SFTP_FILE_PANEL_MENU_DOMAIN,
    })),
  );
}

function transferTargetMenuItems({
  entry,
  hasTransferTarget,
  transferTargetSide,
}: {
  entry: SftpEntry;
  hasTransferTarget: boolean;
  transferTargetSide: "left" | "right" | undefined;
}): SftpContextMenuItemDraft[] {
  if (!hasTransferTarget) {
    return [];
  }
  return [
    {
      action: "transferToTarget",
      disabled: !transferKindFromEntry(entry),
      icon: "transfer",
      label: transferTargetSide === "right" ? "传输到右侧" : "传输到左侧",
    },
  ];
}
