/**
 * SFTP 远程剪贴板与跨主机传输的纯业务模型。
 *
 * @author kongweiguang
 */

import type {
  SftpEntry,
  SftpRemoteCopyRequest,
  SftpTransferConflictPolicy,
} from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import { transferKindFromEntry } from "./sftpEntryModel";
import { defaultPastedRemotePath, normalizeRemotePath } from "./sftpPathModel";
import type {
  SftpClipboard,
  SftpClipboardEntry,
  SftpRemoteTransferTarget,
  SftpStatus,
} from "./types";

const DEFAULT_REMOTE_TRANSFER_CONFLICT_POLICY: SftpTransferConflictPolicy =
  "overwrite";

type RemoteEntrySelection = {
  entry: SftpEntry | null;
  selectedEntries: SftpEntry[];
  selectedEntryPaths: ReadonlySet<string>;
};

type RemoteClipboardCopyPlanOptions = RemoteEntrySelection & {
  copiedAt: number;
  sourceHostId: string;
  sourceHostLabel: string;
};

type RemoteDownloadSelection = {
  entry: SftpEntry;
  selectedEntryPaths: ReadonlySet<string>;
  transferableSelectedEntries: SftpEntry[];
};

type ClipboardPastePlanOptions = {
  clipboard: SftpClipboard;
  conflictPolicy?: SftpTransferConflictPolicy;
  destinationRemotePath: string;
  targetHostId: string;
};

type ClipboardPasteIntentOptions = {
  clipboard: SftpClipboard | null;
  destinationRemotePath: string;
  targetHostId: string;
};

type TargetTransferPlanOptions = {
  conflictPolicy?: SftpTransferConflictPolicy;
  entries: SftpEntry[];
  sourceHostId: string;
  transferTarget: SftpRemoteTransferTarget;
};

type RemoteDownloadDragStartPlanOptions = RemoteDownloadSelection & {
  sourceHostId?: string;
  sourceHostLabel?: string;
};

export type SftpRemoteCopyPlan = {
  destinationRemotePath: string;
  requests: SftpRemoteCopyRequest[];
  statusMessage: string;
  targetDescription: string;
};

export type SftpClipboardPasteIntent =
  | {
      emptyStatus: SftpStatus;
      kind: "localFileClipboard";
      readFailureMessagePrefix: string;
    }
  | {
      kind: "remoteCopy";
      remoteCopyPlan: SftpRemoteCopyPlan;
    };

export type SftpRemoteClipboardCopyPlan =
  | {
      kind: "copy";
      clipboard: SftpClipboard;
      status: SftpStatus;
    }
  | {
      kind: "empty" | "unsupported";
      status: SftpStatus;
    };

export type SftpRemoteDownloadDragStartPlan = {
  entriesToDrag: SftpEntry[];
  selectOnlyEntryPath: string | null;
  dataTransferItems: Array<{
    type: string;
    value: string;
  }>;
};

export type SftpRemoteDragPayloadEntry = {
  kind: "directory" | "file";
  name: string;
  path: string;
};

export type SftpRemoteDragPayload = {
  entries: SftpRemoteDragPayloadEntry[];
  sourceHostId: string;
  sourceHostLabel: string;
};

export const SFTP_REMOTE_DRAG_PAYLOAD_MIME =
  "application/x-kerminal-sftp-remote-drag";

export function remoteDownloadEntriesFor({
  entry,
  selectedEntryPaths,
  transferableSelectedEntries,
}: RemoteDownloadSelection) {
  if (!transferKindFromEntry(entry)) {
    return [];
  }
  if (selectedEntryPaths.has(entry.path) && transferableSelectedEntries.length) {
    return transferableSelectedEntries;
  }
  return [entry];
}

export function buildRemoteDownloadDragStartPlan({
  entry,
  selectedEntryPaths,
  sourceHostId,
  sourceHostLabel,
  transferableSelectedEntries,
}: RemoteDownloadDragStartPlanOptions): SftpRemoteDownloadDragStartPlan | null {
  const entriesToDrag = remoteDownloadEntriesFor({
    entry,
    selectedEntryPaths,
    transferableSelectedEntries,
  });
  if (entriesToDrag.length === 0) {
    return null;
  }

  const paths = entriesToDrag.map((nextEntry) => nextEntry.path);
  const remotePayload =
    sourceHostId && sourceHostLabel
      ? buildSftpRemoteDragPayload({
          entries: entriesToDrag,
          sourceHostId,
          sourceHostLabel,
        })
      : null;

  return {
    dataTransferItems: [
      {
        type: "text/plain",
        value: paths.join("\n"),
      },
      ...(remotePayload
        ? [
            {
              type: SFTP_REMOTE_DRAG_PAYLOAD_MIME,
              value: JSON.stringify(remotePayload),
            },
          ]
        : []),
    ],
    entriesToDrag,
    selectOnlyEntryPath: selectedEntryPaths.has(entry.path) ? null : entry.path,
  };
}

export function buildSftpRemoteDragPayload({
  entries,
  sourceHostId,
  sourceHostLabel,
}: {
  entries: SftpEntry[];
  sourceHostId: string;
  sourceHostLabel: string;
}): SftpRemoteDragPayload | null {
  const payloadEntries = entries
    .map(remoteEntryToDragPayloadEntry)
    .filter(
      (nextEntry): nextEntry is SftpRemoteDragPayloadEntry =>
        Boolean(nextEntry),
    );

  if (!sourceHostId || !sourceHostLabel || payloadEntries.length === 0) {
    return null;
  }

  return {
    entries: payloadEntries,
    sourceHostId,
    sourceHostLabel,
  };
}

export function parseSftpRemoteDragPayload(
  value: string,
): SftpRemoteDragPayload | null {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const sourceHostId = objectString(payload, "sourceHostId");
  const sourceHostLabel = objectString(payload, "sourceHostLabel");
  const rawEntries = Array.isArray((payload as { entries?: unknown }).entries)
    ? (payload as { entries: unknown[] }).entries
    : [];
  const entries = rawEntries
    .map(parseRemoteDragPayloadEntry)
    .filter(
      (nextEntry): nextEntry is SftpRemoteDragPayloadEntry =>
        Boolean(nextEntry),
    );

  if (!sourceHostId || !sourceHostLabel || entries.length === 0) {
    return null;
  }

  return {
    entries,
    sourceHostId,
    sourceHostLabel,
  };
}

export function hasSftpRemoteDragPayloadType(
  types: ArrayLike<string> | Iterable<string> | null | undefined,
) {
  return Array.from(types ?? []).includes(SFTP_REMOTE_DRAG_PAYLOAD_MIME);
}

export function remoteDragPayloadEntriesToSftpEntries(
  entries: SftpRemoteDragPayloadEntry[],
): SftpEntry[] {
  return entries.map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    raw: `${entry.kind} ${entry.path}`,
  }));
}

function parseRemoteDragPayloadEntry(
  value: unknown,
): SftpRemoteDragPayloadEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const kind = objectString(value, "kind");
  const name = objectString(value, "name");
  const path = objectString(value, "path");
  if ((kind !== "file" && kind !== "directory") || !path) {
    return null;
  }

  return {
    kind,
    name: name || fileNameFromPath(path),
    path,
  };
}

function objectString(value: object, key: string) {
  const nextValue = (value as Record<string, unknown>)[key];
  return typeof nextValue === "string" ? nextValue : "";
}

function remoteEntryToDragPayloadEntry(
  entry: SftpEntry,
): SftpRemoteDragPayloadEntry | null {
  const kind = transferKindFromEntry(entry);
  if (!kind) {
    return null;
  }

  return {
    kind,
    name: entry.name || fileNameFromPath(entry.path),
    path: entry.path,
  };
}

export function remoteClipboardEntriesFor({
  entry,
  selectedEntries,
  selectedEntryPaths,
}: RemoteEntrySelection) {
  return selectedRemoteEntries({
    entry,
    selectedEntries,
    selectedEntryPaths,
  })
    .map(remoteEntryToClipboardEntry)
    .filter((nextEntry): nextEntry is SftpClipboardEntry => Boolean(nextEntry));
}

export function remoteClipboardCopySuccessMessage(
  clipboardEntries: SftpClipboardEntry[],
) {
  return clipboardEntries.length === 1
    ? `已复制到 SFTP 剪贴板：${clipboardEntries[0].path}`
    : `已复制到 SFTP 剪贴板：${clipboardEntries.length} 个远程项目`;
}

export function buildSftpRemoteClipboardCopyPlan({
  copiedAt,
  entry,
  selectedEntries,
  selectedEntryPaths,
  sourceHostId,
  sourceHostLabel,
}: RemoteClipboardCopyPlanOptions): SftpRemoteClipboardCopyPlan {
  const clipboardEntries = remoteClipboardEntriesFor({
    entry,
    selectedEntries,
    selectedEntryPaths,
  });
  if (clipboardEntries.length === 0 && selectedEntries.length === 0 && !entry) {
    return {
      kind: "empty",
      status: { kind: "info", message: "请先选择一个远程项目。" },
    };
  }
  if (clipboardEntries.length === 0) {
    return {
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持复制到 SFTP 剪贴板。",
      },
    };
  }

  return {
    clipboard: {
      copiedAt,
      entries: clipboardEntries,
      sourceHostId,
      sourceHostLabel,
    },
    kind: "copy",
    status: {
      kind: "success",
      message: remoteClipboardCopySuccessMessage(clipboardEntries),
    },
  };
}

export function buildSftpClipboardPastePlan({
  clipboard,
  conflictPolicy,
  destinationRemotePath,
  targetHostId,
}: ClipboardPastePlanOptions): SftpRemoteCopyPlan {
  const sameHost = clipboard.sourceHostId === targetHostId;
  const targetDescription = sameHost ? "远程复制" : "跨主机传输";
  const sourceDescription = sameHost ? "当前主机" : clipboard.sourceHostLabel;
  const requests = clipboard.entries.map((entry) => ({
    conflictPolicy: conflictPolicy ?? DEFAULT_REMOTE_TRANSFER_CONFLICT_POLICY,
    kind: entry.kind,
    sourceHostId: clipboard.sourceHostId,
    sourceRemotePath: entry.path,
    targetHostId,
    targetRemotePath: defaultPastedRemotePath(
      destinationRemotePath,
      entry,
      clipboard.sourceHostId,
      targetHostId,
    ),
  }));

  return {
    destinationRemotePath,
    requests,
    statusMessage: `已加入${targetDescription}队列：${sourceDescription} ${remoteEntryNames(clipboard.entries)} -> ${destinationRemotePath}`,
    targetDescription,
  };
}

export function buildSftpClipboardPasteIntent({
  clipboard,
  destinationRemotePath,
  targetHostId,
}: ClipboardPasteIntentOptions): SftpClipboardPasteIntent {
  if (!clipboard || clipboard.entries.length === 0) {
    return {
      emptyStatus: {
        kind: "info",
        message: "SFTP 剪贴板为空，系统剪贴板也没有本地文件。",
      },
      kind: "localFileClipboard",
      readFailureMessagePrefix: "读取系统文件剪贴板失败",
    };
  }

  return {
    kind: "remoteCopy",
    remoteCopyPlan: buildSftpClipboardPastePlan({
      clipboard,
      destinationRemotePath,
      targetHostId,
    }),
  };
}

export function buildSftpTargetTransferPlan({
  conflictPolicy,
  entries,
  sourceHostId,
  transferTarget,
}: TargetTransferPlanOptions): SftpRemoteCopyPlan {
  const destinationRemotePath = normalizeRemotePath(transferTarget.remotePath);
  const requests = entries.flatMap((entry) => {
    const kind = transferKindFromEntry(entry);
    if (!kind) {
      return [];
    }
    const clipboardEntry = {
      kind,
      name: entry.name,
      path: entry.path,
    };
    return {
      conflictPolicy: conflictPolicy ?? DEFAULT_REMOTE_TRANSFER_CONFLICT_POLICY,
      kind,
      sourceHostId,
      sourceRemotePath: entry.path,
      targetHostId: transferTarget.hostId,
      targetRemotePath: defaultPastedRemotePath(
        destinationRemotePath,
        clipboardEntry,
        sourceHostId,
        transferTarget.hostId,
      ),
    };
  });

  return {
    destinationRemotePath,
    requests,
    statusMessage: `已加入传输队列：${remoteEntryNames(entries)} -> ${transferTarget.hostLabel} ${destinationRemotePath}`,
    targetDescription: "传输",
  };
}

function selectedRemoteEntries({
  entry,
  selectedEntries,
  selectedEntryPaths,
}: RemoteEntrySelection) {
  if (entry && selectedEntryPaths.has(entry.path) && selectedEntries.length > 1) {
    return selectedEntries;
  }
  return entry ? [entry] : selectedEntries;
}

function remoteEntryToClipboardEntry(
  entry: SftpEntry,
): SftpClipboardEntry | null {
  const kind = transferKindFromEntry(entry);
  if (!kind) {
    return null;
  }
  return {
    kind,
    name: entry.name,
    path: entry.path,
  };
}

function remoteEntryNames(entries: Array<Pick<SftpClipboardEntry, "name" | "path">>) {
  return entries
    .map((entry) => entry.name || fileNameFromPath(entry.path))
    .join("、");
}
