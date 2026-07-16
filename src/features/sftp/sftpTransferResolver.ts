/**
 * Pure transfer intent resolver for the SFTP transfer workbench.
 *
 * @author kongweiguang
 */

export type FileTransferEndpoint =
  | { kind: "local"; path: string }
  | { kind: "remote"; hostId: string; hostLabel?: string; path: string };

type FileTransferEntryKind = "file" | "directory" | "symlink";

export type FileTransferEntry = {
  name: string;
  path: string;
  kind: FileTransferEntryKind;
};

export type TransferRequestedBy =
  | "drag"
  | "contextMenu"
  | "toolbar"
  | "paste";

export type TransferConflictPolicy = "ask" | "overwrite" | "rename" | "skip";

export type TransferIntent = {
  source: FileTransferEndpoint;
  target: FileTransferEndpoint;
  entries: FileTransferEntry[];
  requestedBy: TransferRequestedBy;
  conflictPolicy: TransferConflictPolicy;
};

type TransferOperation =
  | "upload"
  | "download"
  | "remoteCopy"
  | "localCopy";

type ResolvedTransferTask = {
  sourceEntryPath: string;
  targetEntryPath: string;
  targetPath: string;
  entryKind: FileTransferEntryKind;
  entryName: string;
};

export type ResolvedTransferPlan = {
  operation: TransferOperation;
  source: FileTransferEndpoint;
  target: FileTransferEndpoint;
  entries: FileTransferEntry[];
  tasks: ResolvedTransferTask[];
  requestedBy: TransferRequestedBy;
  conflictPolicy: TransferConflictPolicy;
};

export const TRANSFER_RESOLVER_ERRORS = {
  emptyEntries: "Transfer entries cannot be empty.",
  sameEntry: "Cannot copy an entry onto itself.",
  directoryIntoDescendant: "Cannot copy a directory into its own subtree.",
} as const;

export function resolveTransferIntent(
  intent: TransferIntent,
): ResolvedTransferPlan {
  if (intent.entries.length === 0) {
    throw new Error(TRANSFER_RESOLVER_ERRORS.emptyEntries);
  }

  const operation = resolveTransferOperation(intent.source, intent.target);
  const source = normalizeEndpoint(intent.source);
  const target = normalizeEndpoint(intent.target);
  const sameStorage = isSameStorageEndpoint(source, target);
  const tasks = intent.entries.map((entry) =>
    resolveTransferTask({ entry, sameStorage, source, target }),
  );

  return {
    operation,
    source,
    target,
    entries: intent.entries,
    tasks,
    requestedBy: intent.requestedBy,
    conflictPolicy: intent.conflictPolicy,
  };
}

function resolveTransferOperation(
  source: FileTransferEndpoint,
  target: FileTransferEndpoint,
): TransferOperation {
  if (source.kind === "local" && target.kind === "remote") {
    return "upload";
  }
  if (source.kind === "remote" && target.kind === "local") {
    return "download";
  }
  if (source.kind === "remote" && target.kind === "remote") {
    return "remoteCopy";
  }
  return "localCopy";
}

function resolveTransferTask({
  entry,
  sameStorage,
  source,
  target,
}: {
  entry: FileTransferEntry;
  sameStorage: boolean;
  source: FileTransferEndpoint;
  target: FileTransferEndpoint;
}): ResolvedTransferTask {
  const entryName = fileNameForEntry(entry);
  const sourceEntryPath = normalizePathForEndpoint(source, entry.path);
  const targetPath = target.path;
  const targetEntryPath = joinEndpointPath(target, entryName);

  if (sameStorage && samePathForEndpoint(source, sourceEntryPath, targetEntryPath)) {
    throw new Error(TRANSFER_RESOLVER_ERRORS.sameEntry);
  }

  if (
    sameStorage &&
    entry.kind === "directory" &&
    isDescendantPathForEndpoint(source, sourceEntryPath, targetEntryPath)
  ) {
    throw new Error(TRANSFER_RESOLVER_ERRORS.directoryIntoDescendant);
  }

  return {
    sourceEntryPath,
    targetEntryPath,
    targetPath,
    entryKind: entry.kind,
    entryName,
  };
}

function normalizeEndpoint(endpoint: FileTransferEndpoint): FileTransferEndpoint {
  if (endpoint.kind === "remote") {
    return { ...endpoint, path: normalizeRemotePath(endpoint.path) };
  }
  return { ...endpoint, path: normalizeLocalPath(endpoint.path) };
}

function isSameStorageEndpoint(
  source: FileTransferEndpoint,
  target: FileTransferEndpoint,
) {
  if (source.kind !== target.kind) {
    return false;
  }
  if (source.kind === "remote" && target.kind === "remote") {
    return source.hostId === target.hostId;
  }
  return true;
}

function joinEndpointPath(endpoint: FileTransferEndpoint, entryName: string) {
  if (endpoint.kind === "remote") {
    return joinRemotePath(endpoint.path, entryName);
  }
  return joinLocalPath(endpoint.path, entryName);
}

function normalizePathForEndpoint(
  endpoint: FileTransferEndpoint,
  path: string,
) {
  if (endpoint.kind === "remote") {
    return normalizeRemotePath(path);
  }
  return normalizeLocalPath(path);
}

function samePathForEndpoint(
  endpoint: FileTransferEndpoint,
  left: string,
  right: string,
) {
  return (
    comparisonPathForEndpoint(endpoint, left) ===
    comparisonPathForEndpoint(endpoint, right)
  );
}

function isDescendantPathForEndpoint(
  endpoint: FileTransferEndpoint,
  parentPath: string,
  childPath: string,
) {
  const parent = comparisonPathForEndpoint(endpoint, parentPath);
  const child = comparisonPathForEndpoint(endpoint, childPath);
  const separator = endpoint.kind === "remote" ? "/" : comparisonSeparator(parent);
  const parentPrefix = parent.endsWith(separator)
    ? parent
    : `${parent}${separator}`;

  return child.startsWith(parentPrefix);
}

function comparisonPathForEndpoint(
  endpoint: FileTransferEndpoint,
  path: string,
) {
  if (endpoint.kind === "remote") {
    return normalizeRemotePath(path);
  }

  const normalized = normalizeLocalPath(path);
  return isWindowsLikePath(normalized) ? normalized.toLowerCase() : normalized;
}

function comparisonSeparator(path: string) {
  return path.includes("\\") ? "\\" : "/";
}

function joinRemotePath(basePath: string, entryName: string) {
  const base = normalizeRemotePath(basePath);
  const name = normalizeEntryName(entryName);
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

function joinLocalPath(basePath: string, entryName: string) {
  const separator = localSeparatorFor(basePath);
  const base = normalizeLocalPath(basePath, separator);
  const name = normalizeEntryName(entryName);

  if (!base) {
    return name;
  }
  if (base.endsWith(separator)) {
    return `${base}${name}`;
  }
  return `${base}${separator}${name}`;
}

function normalizeRemotePath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized) {
    return "/";
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/g, "") : normalized;
}

function normalizeLocalPath(path: string, separator = localSeparatorFor(path)) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/[\\/]+/g, separator);
  if (isLocalRootPath(normalized, separator)) {
    return normalized;
  }
  return normalized.replace(/[\\/]+$/g, "");
}

function isLocalRootPath(path: string, separator: string) {
  if (path === separator) {
    return true;
  }
  if (separator === "\\") {
    return /^[A-Za-z]:\\$/.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path);
  }
  return /^[A-Za-z]:\/$/.test(path);
}

function localSeparatorFor(path: string) {
  return path.includes("\\") ? "\\" : "/";
}

function isWindowsLikePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
}

function fileNameForEntry(entry: FileTransferEntry) {
  return normalizeEntryName(entry.name || entry.path);
}

function normalizeEntryName(name: string) {
  const normalized = name.trim().replace(/\\/g, "/");
  const basename = normalized.split("/").filter(Boolean).pop();
  return basename ?? normalized;
}
