import type { SftpEntry } from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import type { SftpClipboardEntry } from "./types";

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function resolveRemoteInputPath(currentPath: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("/")) {
    return normalizeRemotePath(trimmed);
  }
  return joinRemotePath(currentPath, trimmed);
}

export function joinRemotePath(basePath: string, childPath: string) {
  const normalizedChild = childPath.trim().replace(/^\/+/g, "");
  if (!normalizedChild) {
    return normalizeRemotePath(basePath);
  }
  return normalizeRemotePath(
    basePath === "/" ? `/${normalizedChild}` : `${basePath}/${normalizedChild}`,
  );
}

export function normalizeRemotePath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.length > 1
    ? normalized.replace(/\/+$/g, "")
    : normalized || "/";
}

export function isFollowableRemotePath(path: string | undefined): path is string {
  return Boolean(path?.trim().startsWith("/"));
}

export function defaultRenamePath(entry: SftpEntry) {
  const parent = parentRemotePath(entry.path);
  return joinRemotePath(parent, `${entry.name}.renamed`);
}

export function defaultUploadRemotePath(
  currentPath: string,
  localPath: string,
  fallback = "upload.bin",
) {
  return joinRemotePath(currentPath, fileNameFromPath(localPath, fallback));
}

export function defaultArchiveFileName(entry: SftpEntry) {
  const name = entry.name || fileNameFromPath(entry.path, "archive");
  return /\.zip$/i.test(name) ? name : `${name}.zip`;
}

export function defaultArchiveUploadRemotePath(
  currentPath: string,
  localPath: string,
) {
  const name = fileNameFromPath(localPath, "archive");
  return joinRemotePath(
    currentPath,
    /\.zip$/i.test(name) ? name : `${name}.zip`,
  );
}

export function defaultPastedRemotePath(
  currentPath: string,
  entry: SftpClipboardEntry,
  sourceHostId: string,
  targetHostId: string,
) {
  const targetPath = joinRemotePath(
    currentPath,
    entry.name || fileNameFromPath(entry.path),
  );
  if (
    sourceHostId === targetHostId &&
    normalizeRemotePath(entry.path) === targetPath
  ) {
    return duplicateRemotePath(targetPath);
  }
  return targetPath;
}

export function duplicateRemotePath(path: string) {
  const parent = parentRemotePath(path);
  const name = fileNameFromPath(path, "copy");
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    return joinRemotePath(
      parent,
      `${name.slice(0, dotIndex)}.copy${name.slice(dotIndex)}`,
    );
  }
  return joinRemotePath(parent, `${name}.copy`);
}

export function parentRemotePath(path: string) {
  const normalized = normalizeRemotePath(path);
  if (normalized === "/") {
    return "/";
  }
  const parent = normalized.slice(0, normalized.lastIndexOf("/"));
  return parent || "/";
}

export function joinLocalPath(basePath: string, childName: string) {
  const separator = basePath.includes("\\") ? "\\" : "/";
  const trimmedBase = basePath.replace(/[\\/]+$/g, "");
  if (!trimmedBase) {
    return `${separator}${childName}`;
  }
  return `${trimmedBase}${separator}${childName}`;
}

export function modeFromPermissions(permissions: string | undefined) {
  if (!permissions || permissions.length < 10) {
    return "";
  }

  const bits = permissions.slice(1, 10);
  const groups = [bits.slice(0, 3), bits.slice(3, 6), bits.slice(6, 9)];
  return groups
    .map((group) => {
      let value = 0;
      if (group[0] === "r") {
        value += 4;
      }
      if (group[1] === "w") {
        value += 2;
      }
      if (["x", "s", "t"].includes(group[2])) {
        value += 1;
      }
      return String(value);
    })
    .join("");
}
