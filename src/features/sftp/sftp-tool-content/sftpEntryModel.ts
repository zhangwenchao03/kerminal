import type { SftpEntry, SftpTransferKind } from "../../../lib/sftpApi";
import { formatFileSize } from "../sftpFileUtils";

export function isHiddenEntry(entry: SftpEntry) {
  return entry.name.startsWith(".");
}

export function formatEntrySize(entry: SftpEntry) {
  if (entry.kind === "directory") {
    return "-";
  }
  return entry.size === undefined ? "-" : formatFileSize(entry.size);
}

export function formatEntryModified(modified: string | undefined) {
  if (!modified) {
    return "-";
  }

  const trimmed = modified.trim();
  if (!/^\d{10,13}$/.test(trimmed)) {
    return trimmed;
  }

  const timestamp = Number(trimmed);
  const date = new Date(trimmed.length === 13 ? timestamp : timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  const now = new Date();
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());

  if (year === now.getFullYear()) {
    return `${month}-${day} ${hour}:${minute}`;
  }
  return `${year}-${month}-${day}`;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function isDownloadableFileEntry(entry: SftpEntry) {
  return entry.kind === "file" || entry.kind === "symlink";
}

export function transferKindFromEntry(entry: SftpEntry): SftpTransferKind | null {
  if (entry.kind === "directory") {
    return "directory";
  }
  if (entry.kind === "file" || entry.kind === "symlink") {
    return "file";
  }
  return null;
}

export function entryKindLabel(kind: SftpEntry["kind"]) {
  if (kind === "directory") {
    return "目录";
  }
  if (kind === "symlink") {
    return "链接";
  }
  if (kind === "file") {
    return "文件";
  }
  return "项目";
}
