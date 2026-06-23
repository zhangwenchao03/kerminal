/**
 * SFTP 本地文件拖放上传的纯决策模型。
 *
 * @author kongweiguang
 */

import {
  isDragPositionInsideDropZone,
  unwrapDragDropPayload,
} from "./sftpDragDropModel";

export type SftpLocalFileDragPayloadEntry = {
  kind: "directory" | "file";
  name: string;
  path: string;
};

export type SftpLocalFileDragPayload = {
  entries: SftpLocalFileDragPayloadEntry[];
  source: "local";
};

export type SftpLocalUploadDropDecision =
  | { active: boolean; kind: "hover" }
  | { kind: "upload"; paths: string[] }
  | { kind: "clear" }
  | { kind: "ignore" };

export type SftpLocalPaneDropDecision =
  | { active: boolean; kind: "download-hover" }
  | { active: boolean; kind: "copy-hover" }
  | { kind: "download" }
  | { kind: "copy" }
  | { kind: "ignore" };

export const SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME =
  "application/x-kerminal-local-file";

export function resolveSftpLocalUploadDropEvent(
  event: unknown,
  dropZone: HTMLElement | null,
): SftpLocalUploadDropDecision {
  const payload = unwrapDragDropPayload(event);

  if (payload.type === "leave") {
    return { kind: "clear" };
  }

  if (payload.type === "enter" || payload.type === "over") {
    return {
      active: isDragPositionInsideDropZone(payload, dropZone),
      kind: "hover",
    };
  }

  if (!isDragPositionInsideDropZone(payload, dropZone)) {
    return { kind: "ignore" };
  }

  const paths =
    "paths" in payload && Array.isArray(payload.paths) ? payload.paths : [];
  return paths.length > 0 ? { kind: "upload", paths } : { kind: "ignore" };
}

export function resolveSftpLocalPaneDropTarget({
  hasLocalPayload,
  hasRemotePayload,
  type,
}: {
  hasLocalPayload: boolean;
  hasRemotePayload: boolean;
  type: "enter" | "over" | "drop";
}): SftpLocalPaneDropDecision {
  if (hasLocalPayload) {
    return type === "drop"
      ? { kind: "copy" }
      : { active: true, kind: "copy-hover" };
  }
  if (hasRemotePayload) {
    return type === "drop"
      ? { kind: "download" }
      : { active: true, kind: "download-hover" };
  }
  return { kind: "ignore" };
}

export function buildSftpLocalFileDragPayload({
  entries,
}: {
  entries: SftpLocalFileDragPayloadEntry[];
}): SftpLocalFileDragPayload {
  return {
    entries: entries.filter(isLocalFileDragPayloadEntry),
    source: "local",
  };
}

export function parseSftpLocalFileDragPayload(
  value: string,
): SftpLocalFileDragPayload | null {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ((payload as { source?: unknown }).source !== "local") {
    return null;
  }

  const rawEntries = Array.isArray((payload as { entries?: unknown }).entries)
    ? (payload as { entries: unknown[] }).entries
    : [];
  const entries = rawEntries
    .map(parseLocalFileDragPayloadEntry)
    .filter(
      (entry): entry is SftpLocalFileDragPayloadEntry => Boolean(entry),
    );

  return entries.length > 0 ? { entries, source: "local" } : null;
}

export function hasSftpLocalFileDragPayloadType(
  types: ArrayLike<string> | Iterable<string> | null | undefined,
) {
  return Array.from(types ?? []).includes(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME);
}

function parseLocalFileDragPayloadEntry(
  value: unknown,
): SftpLocalFileDragPayloadEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const kind = objectString(value, "kind");
  const name = objectString(value, "name");
  const path = objectString(value, "path");
  const entry = { kind, name, path };
  return isLocalFileDragPayloadEntry(entry) ? entry : null;
}

function isLocalFileDragPayloadEntry(
  entry: unknown,
): entry is SftpLocalFileDragPayloadEntry {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const { kind, name, path } = entry as Record<string, unknown>;
  return (
    (kind === "directory" || kind === "file") &&
    typeof name === "string" &&
    name.length > 0 &&
    typeof path === "string" &&
    path.length > 0
  );
}

function objectString(value: object, key: string) {
  const nextValue = (value as Record<string, unknown>)[key];
  return typeof nextValue === "string" ? nextValue : "";
}
