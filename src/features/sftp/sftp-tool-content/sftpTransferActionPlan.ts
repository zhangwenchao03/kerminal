/**
 * SFTP transfer action planning helpers.
 *
 * The hook owns dialogs, API calls, and React state updates; this module owns
 * request construction and user-facing status text for transfer actions.
 *
 * @author kongweiguang
 */

import type { DockerContainerTransferRequest } from "../../../lib/containerFilesApi";
import type {
  SftpArchiveDownloadRequest,
  SftpArchiveUploadRequest,
  SftpClipboardDownloadRequest,
  SftpEntry,
  SftpLocalPathInfo,
  SftpManagedTransferRequest,
  SftpTransferConflictPolicy,
  SftpTransferKind,
} from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import { transferKindFromEntry } from "./sftpEntryModel";
import {
  defaultArchiveFileName,
  defaultArchiveUploadRemotePath,
  defaultUploadRemotePath,
  joinLocalPath,
  normalizeRemotePath,
  parentRemotePath,
} from "./sftpPathModel";
import type { SftpFileTarget, SftpStatus } from "./types";

const DEFAULT_TRANSFER_CONFLICT_POLICY: SftpTransferConflictPolicy = "overwrite";

export type SftpTransferActionItem = {
  queuedStatus: SftpStatus;
  request: SftpManagedTransferRequest;
};

export type SftpTransferActionBatchPlan = {
  completionStatus: SftpStatus | null;
  items: SftpTransferActionItem[];
};

export type SftpLocalClipboardUploadPlan =
  | {
      kind: "empty";
      status: SftpStatus;
    }
  | {
      batchPlan: SftpTransferActionBatchPlan;
      kind: "upload";
    };

export type SftpDownloadSelectionPlan =
  | {
      kind: "empty";
      status: SftpStatus;
    }
  | {
      entry: SftpEntry;
      kind: "single";
    }
  | {
      entries: SftpEntry[];
      kind: "batch";
    };

export type SftpRemoteQueuedRequestPlan<TRequest> =
  | {
      errorMessagePrefix: string;
      kind: "ready";
      queuedStatus: SftpStatus;
      request: TRequest;
    }
  | {
      kind: "unsupported";
      status: SftpStatus;
    };

export type SftpArchiveUploadPlan = {
  errorMessagePrefix: string;
  queuedStatus: SftpStatus;
  request: SftpArchiveUploadRequest;
};

export type SftpArchiveDownloadPreparation =
  | {
      defaultLocalFileName: string;
      kind: "ready";
    }
  | {
      kind: "unsupported";
      status: SftpStatus;
    };

type UploadTransferPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  hostId: string;
  kind: SftpManagedTransferRequest["kind"];
  localNameFallback: string;
  localPath: string;
  queuedStatusMessage: string;
  targetRemotePath: string;
};

type LocalPathUploadPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  hostId: string;
  localPath: SftpLocalPathInfo;
  sourceLabel: string;
  targetRemotePath: string;
};

type LocalPathBatchUploadPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  fileTargetKind: SftpFileTarget["kind"];
  hostId: string;
  localPaths: SftpLocalPathInfo[];
  sourceLabel: string;
  targetRemotePath: string;
};

type LocalClipboardUploadPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  fileTargetKind: SftpFileTarget["kind"];
  hostId: string;
  localPaths: SftpLocalPathInfo[];
  targetRemotePath: string;
};

type DownloadTransferPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  entry: SftpEntry;
  hostId: string;
  localPath: string;
};

type DownloadSelectionPlanOptions = {
  emptyMessage: string;
  entries: SftpEntry[];
};

type DirectoryDownloadTransferPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  entry: SftpEntry;
  hostId: string;
  selectedDirectory: string;
};

type BatchDownloadPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  entries: SftpEntry[];
  fileTargetKind: SftpFileTarget["kind"];
  hostId: string;
  selectedDirectory: string;
};

type ArchiveDownloadPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  entry: SftpEntry;
  hostId: string;
  targetLocalPath: string;
};

type ClipboardDownloadPlanOptions = {
  entry: SftpEntry;
  hostId: string;
};

type ArchiveUploadPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  destinationRemotePath: string;
  hostId: string;
  kind: SftpTransferKind;
  sourceLocalPath: string;
};

export function buildFileUploadTransferPlan({
  conflictPolicy,
  hostId,
  localPath,
  targetRemotePath,
}: {
  conflictPolicy?: SftpTransferConflictPolicy;
  hostId: string;
  localPath: string;
  targetRemotePath: string;
}): SftpTransferActionItem {
  return buildUploadTransferPlan({
    conflictPolicy,
    hostId,
    kind: "file",
    localNameFallback: "upload.bin",
    localPath,
    queuedStatusMessage: `已加入上传队列：${fileNameFromPath(
      localPath,
      "upload.bin",
    )}`,
    targetRemotePath,
  });
}

export function buildDirectoryUploadTransferPlan({
  conflictPolicy,
  hostId,
  localPath,
  targetRemotePath,
}: {
  conflictPolicy?: SftpTransferConflictPolicy;
  hostId: string;
  localPath: string;
  targetRemotePath: string;
}): SftpTransferActionItem {
  return buildUploadTransferPlan({
    conflictPolicy,
    hostId,
    kind: "directory",
    localNameFallback: "upload-folder",
    localPath,
    queuedStatusMessage: `已加入文件夹上传队列：${fileNameFromPath(
      localPath,
      "upload-folder",
    )}`,
    targetRemotePath,
  });
}

export function buildLocalPathUploadTransferPlan({
  conflictPolicy,
  hostId,
  localPath,
  sourceLabel,
  targetRemotePath,
}: LocalPathUploadPlanOptions): SftpTransferActionItem {
  return buildUploadTransferPlan({
    conflictPolicy,
    hostId,
    kind: localPath.kind,
    localNameFallback:
      localPath.kind === "directory" ? "upload-folder" : "upload.bin",
    localPath: localPath.path,
    queuedStatusMessage: `已加入${sourceLabel}上传队列：${fileNameFromPath(
      localPath.path,
      "upload",
    )}`,
    targetRemotePath,
  });
}

export function buildLocalPathBatchUploadPlan({
  conflictPolicy,
  fileTargetKind,
  hostId,
  localPaths,
  sourceLabel,
  targetRemotePath,
}: LocalPathBatchUploadPlanOptions): SftpTransferActionBatchPlan {
  const items = localPaths.map((localPath) =>
    buildLocalPathUploadTransferPlan({
      conflictPolicy,
      hostId,
      localPath,
      sourceLabel,
      targetRemotePath,
    }),
  );

  return {
    completionStatus:
      items.length === 0
        ? null
        : {
            kind: fileTargetKind === "ssh" ? "info" : "success",
            message:
              fileTargetKind === "ssh"
                ? `已加入${sourceLabel}上传队列：${items.length} 个本地项目 -> ${targetRemotePath}`
                : `已完成${sourceLabel}上传：${items.length} 个本地项目 -> ${targetRemotePath}`,
          },
    items,
  };
}

export function buildSftpLocalClipboardUploadPlan({
  conflictPolicy,
  fileTargetKind,
  hostId,
  localPaths,
  targetRemotePath,
}: LocalClipboardUploadPlanOptions): SftpLocalClipboardUploadPlan {
  if (localPaths.length === 0) {
    return {
      kind: "empty",
      status: {
        kind: "info",
        message: "SFTP 剪贴板为空，系统剪贴板也没有本地文件。",
      },
    };
  }

  return {
    batchPlan: buildLocalPathBatchUploadPlan({
      conflictPolicy,
      fileTargetKind,
      hostId,
      localPaths,
      sourceLabel: "剪贴板",
      targetRemotePath,
    }),
    kind: "upload",
  };
}

export function sftpArchiveDownloadFileNameFor(entry: SftpEntry) {
  return defaultArchiveFileName(entry);
}

export function buildSftpArchiveDownloadPreparation(
  entry: SftpEntry,
): SftpArchiveDownloadPreparation {
  if (!transferKindFromEntry(entry)) {
    return {
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持下载为 ZIP。",
      },
    };
  }

  return {
    defaultLocalFileName: sftpArchiveDownloadFileNameFor(entry),
    kind: "ready",
  };
}

export function buildSftpArchiveDownloadPlan({
  conflictPolicy,
  entry,
  hostId,
  targetLocalPath,
}: ArchiveDownloadPlanOptions): SftpRemoteQueuedRequestPlan<SftpArchiveDownloadRequest> {
  const kind = transferKindFromEntry(entry);
  if (!kind) {
    return {
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持下载为 ZIP。",
      },
    };
  }

  return {
    errorMessagePrefix: "下载为 ZIP 失败",
    kind: "ready",
    queuedStatus: {
      kind: "info",
      message: `已加入 ZIP 下载队列：${entry.path}`,
    },
    request: {
      conflictPolicy: conflictPolicy ?? DEFAULT_TRANSFER_CONFLICT_POLICY,
      hostId,
      kind,
      sourceRemotePath: normalizeRemotePath(entry.path),
      targetLocalPath,
    },
  };
}

export function buildSftpClipboardDownloadPlan({
  entry,
  hostId,
}: ClipboardDownloadPlanOptions): SftpRemoteQueuedRequestPlan<SftpClipboardDownloadRequest> {
  const kind = transferKindFromEntry(entry);
  if (!kind) {
    return {
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持下载到本地剪贴板。",
      },
    };
  }

  return {
    errorMessagePrefix: "下载到本地剪贴板失败",
    kind: "ready",
    queuedStatus: {
      kind: "info",
      message: `已加入本地剪贴板下载队列：${entry.path}`,
    },
    request: {
      hostId,
      kind,
      sourceRemotePath: normalizeRemotePath(entry.path),
    },
  };
}

export function buildSftpArchiveUploadPlan({
  conflictPolicy,
  destinationRemotePath,
  hostId,
  kind,
  sourceLocalPath,
}: ArchiveUploadPlanOptions): SftpArchiveUploadPlan {
  const targetRemotePath = defaultArchiveUploadRemotePath(
    destinationRemotePath,
    sourceLocalPath,
  );

  return {
    errorMessagePrefix: "上传为 ZIP 失败",
    queuedStatus: {
      kind: "info",
      message: `已加入 ZIP 上传队列：${fileNameFromPath(
        sourceLocalPath,
        "archive",
      )} -> ${targetRemotePath}`,
    },
    request: {
      conflictPolicy: conflictPolicy ?? DEFAULT_TRANSFER_CONFLICT_POLICY,
      hostId,
      kind,
      sourceLocalPath,
      targetRemotePath,
    },
  };
}

export function buildDownloadSelectionPlan({
  emptyMessage,
  entries,
}: DownloadSelectionPlanOptions): SftpDownloadSelectionPlan {
  const transferableEntries = entries.filter((entry) =>
    transferKindFromEntry(entry),
  );

  if (transferableEntries.length === 0) {
    return {
      kind: "empty",
      status: {
        kind: "info",
        message: emptyMessage,
      },
    };
  }

  if (transferableEntries.length === 1) {
    return {
      entry: transferableEntries[0],
      kind: "single",
    };
  }

  return {
    entries: transferableEntries,
    kind: "batch",
  };
}

export function buildDownloadTransferPlan({
  conflictPolicy,
  entry,
  hostId,
  localPath,
}: DownloadTransferPlanOptions): SftpTransferActionItem | null {
  const kind = transferKindFromEntry(entry);
  if (!kind) {
    return null;
  }

  const remotePath = normalizeRemotePath(entry.path);
  return {
    queuedStatus: {
      kind: "info",
      message:
        kind === "directory"
          ? `已加入文件夹下载队列：${entry.path}`
          : `已加入下载队列：${entry.path}`,
    },
    request: {
      conflictPolicy: conflictPolicy ?? DEFAULT_TRANSFER_CONFLICT_POLICY,
      direction: "download",
      hostId,
      kind,
      localPath,
      remotePath,
    },
  };
}

export function buildDirectoryDownloadTransferPlan({
  conflictPolicy,
  entry,
  hostId,
  selectedDirectory,
}: DirectoryDownloadTransferPlanOptions): SftpTransferActionItem | null {
  return buildDownloadTransferPlan({
    conflictPolicy,
    entry,
    hostId,
    localPath: joinLocalPath(
      selectedDirectory,
      entry.name || fileNameFromPath(entry.path),
    ),
  });
}

export function buildBatchDownloadTransferPlan({
  conflictPolicy,
  entries,
  fileTargetKind,
  hostId,
  selectedDirectory,
}: BatchDownloadPlanOptions): SftpTransferActionBatchPlan {
  const items = entries.flatMap((entry) => {
    const kind = transferKindFromEntry(entry);
    if (!kind) {
      return [];
    }
    const localPath = joinLocalPath(
      selectedDirectory,
      entry.name || fileNameFromPath(entry.path),
    );
    const item = buildDownloadTransferPlan({
      conflictPolicy,
      entry,
      hostId,
      localPath,
    });
    return item ? [item] : [];
  });

  return {
    completionStatus:
      items.length === 0
        ? null
        : {
            kind: fileTargetKind === "ssh" ? "info" : "success",
            message:
              fileTargetKind === "ssh"
                ? `已加入批量下载队列：${items.length} 个远程项目 -> ${selectedDirectory}`
                : `已完成批量下载：${items.length} 个远程项目 -> ${selectedDirectory}`,
          },
    items,
  };
}

export function buildDockerContainerTransferRequest(
  fileTarget: Extract<SftpFileTarget, { kind: "dockerContainer" }>,
  request: SftpManagedTransferRequest,
): DockerContainerTransferRequest {
  return {
    containerId: fileTarget.containerId,
    hostId: fileTarget.hostId,
    kind: request.kind,
    localPath: request.localPath,
    remotePath: request.remotePath,
    runtime: fileTarget.runtime,
  };
}

export function statusForDockerDirectTransfer(
  request: SftpManagedTransferRequest,
  phase: "running" | "success",
): SftpStatus {
  const transferName =
    request.direction === "upload"
      ? fileNameFromPath(request.localPath, "upload")
      : fileNameFromPath(request.remotePath, "download");

  if (phase === "running") {
    return {
      kind: "info",
      message:
        request.direction === "upload"
          ? `正在上传：${transferName}`
          : `正在下载：${request.remotePath}`,
    };
  }

  return {
    kind: "success",
    message:
      request.direction === "upload"
        ? `已上传：${transferName}`
        : `已下载：${request.remotePath}`,
  };
}

export function shouldRefreshAfterDockerUpload(
  request: SftpManagedTransferRequest,
  currentPath: string,
) {
  return (
    request.direction === "upload" &&
    parentRemotePath(request.remotePath) === currentPath
  );
}

function buildUploadTransferPlan({
  conflictPolicy,
  hostId,
  kind,
  localNameFallback,
  localPath,
  queuedStatusMessage,
  targetRemotePath,
}: UploadTransferPlanOptions): SftpTransferActionItem {
  return {
    queuedStatus: {
      kind: "info",
      message: queuedStatusMessage,
    },
    request: {
      conflictPolicy: conflictPolicy ?? DEFAULT_TRANSFER_CONFLICT_POLICY,
      direction: "upload",
      hostId,
      kind,
      localPath,
      remotePath: defaultUploadRemotePath(
        targetRemotePath,
        localPath,
        localNameFallback,
      ),
    },
  };
}
