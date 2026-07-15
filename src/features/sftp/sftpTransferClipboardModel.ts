/**
 * SFTP 传输工作台内部剪贴板模型。
 *
 * @author kongweiguang
 */

import type { LocalDirectoryEntry } from "../../lib/fileDialogApi";
import { SFTP_LOCAL_TO_LOCAL_DROP_UNSUPPORTED_MESSAGE } from "./sftp-tool-content/sftpDropReasonModel";
import type { SftpClipboard, SftpStatus } from "./sftp-tool-content/types";
import {
  resolveTransferIntent,
  type FileTransferEndpoint,
  type ResolvedTransferPlan,
} from "./sftpTransferResolver";

type SftpWorkbenchLocalClipboardEntry = {
  kind: "directory" | "file";
  name: string;
  path: string;
};

export type SftpWorkbenchLocalClipboard = {
  copiedAt: number;
  entries: SftpWorkbenchLocalClipboardEntry[];
  kind: "local";
  sourcePath: string;
};

type SftpWorkbenchRemoteClipboard = {
  clipboard: SftpClipboard;
  kind: "remote";
};

export type SftpWorkbenchClipboard =
  | SftpWorkbenchLocalClipboard
  | SftpWorkbenchRemoteClipboard;

export type SftpWorkbenchLocalClipboardCopyPlan =
  | {
      clipboard: SftpWorkbenchLocalClipboard;
      kind: "copy";
      status: SftpStatus;
    }
  | {
      kind: "empty";
      status: SftpStatus;
    };

export type SftpWorkbenchClipboardPastePlan =
  | {
      kind: "transfer";
      plan: ResolvedTransferPlan;
      status: SftpStatus;
    }
  | {
      kind: "empty" | "unsupported";
      status: SftpStatus;
    };

export function buildSftpWorkbenchLocalClipboard({
  copiedAt,
  entries,
  sourcePath,
}: {
  copiedAt: number;
  entries: LocalDirectoryEntry[];
  sourcePath: string;
}): SftpWorkbenchLocalClipboardCopyPlan {
  const transferableEntries = entries
    .map(localDirectoryEntryToClipboardEntry)
    .filter(
      (entry): entry is SftpWorkbenchLocalClipboardEntry => Boolean(entry),
    );

  if (transferableEntries.length === 0) {
    return {
      kind: "empty",
      status: {
        kind: "info",
        message: "请先选择可复制的本机文件或目录。",
      },
    };
  }

  return {
    clipboard: {
      copiedAt,
      entries: transferableEntries,
      kind: "local",
      sourcePath,
    },
    kind: "copy",
    status: {
      kind: "success",
      message:
        transferableEntries.length === 1
          ? `已复制本机项目：${transferableEntries[0].name}`
          : `已复制 ${transferableEntries.length} 个本机项目。`,
    },
  };
}

export function remoteClipboardFromWorkbenchClipboard(
  clipboard: SftpWorkbenchClipboard | null,
) {
  return clipboard?.kind === "remote" ? clipboard.clipboard : null;
}

export function wrapRemoteWorkbenchClipboard(
  clipboard: SftpClipboard | null,
): SftpWorkbenchClipboard | null {
  return clipboard ? { clipboard, kind: "remote" } : null;
}

export function buildSftpWorkbenchClipboardPastePlan({
  clipboard,
  target,
}: {
  clipboard: SftpWorkbenchClipboard | null;
  target: FileTransferEndpoint | null;
}): SftpWorkbenchClipboardPastePlan {
  if (!clipboard) {
    return {
      kind: "empty",
      status: {
        kind: "info",
        message: "剪贴板中没有可粘贴的 SFTP 传输项目。",
      },
    };
  }
  if (!target) {
    return {
      kind: "unsupported",
      status: {
        kind: "error",
        message: "请选择可粘贴的目标目录。",
      },
    };
  }
  if (clipboard.kind === "local" && target.kind === "local") {
    return {
      kind: "unsupported",
      status: {
        kind: "error",
        message: SFTP_LOCAL_TO_LOCAL_DROP_UNSUPPORTED_MESSAGE,
      },
    };
  }
  if (clipboard.kind !== "local" || target.kind !== "remote") {
    return {
      kind: "unsupported",
      status: {
        kind: "error",
        message: "当前剪贴板暂不支持粘贴到此目标。",
      },
    };
  }

  const plan = resolveTransferIntent({
    conflictPolicy: "ask",
    entries: clipboard.entries,
    requestedBy: "paste",
    source: { kind: "local", path: clipboard.sourcePath },
    target,
  });

  return {
    kind: "transfer",
    plan,
    status: {
      kind: "success",
      message:
        clipboard.entries.length === 1
          ? `已粘贴本机项目：${clipboard.entries[0].name}`
          : `已粘贴 ${clipboard.entries.length} 个本机项目。`,
    },
  };
}

function localDirectoryEntryToClipboardEntry(
  entry: LocalDirectoryEntry,
): SftpWorkbenchLocalClipboardEntry | null {
  if (entry.kind !== "directory" && entry.kind !== "file") {
    return null;
  }
  return {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
  };
}
