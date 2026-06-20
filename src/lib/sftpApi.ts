import { invoke, isTauri } from "@tauri-apps/api/core";

export type SftpEntryKind = "file" | "directory" | "symlink" | "other";

export interface SftpEntry {
  name: string;
  path: string;
  kind: SftpEntryKind;
  size?: number;
  permissions?: string;
  modified?: string;
  raw: string;
}

export interface SftpDirectoryListing {
  hostId: string;
  path: string;
  parentPath?: string;
  entries: SftpEntry[];
}

export interface SftpListDirectoryRequest {
  hostId: string;
  path: string;
}

export interface SftpPathRequest {
  hostId: string;
  path: string;
}

export interface SftpPreviewRequest extends SftpPathRequest {
  maxBytes?: number;
}

export interface SftpFilePreview {
  hostId: string;
  path: string;
  content: string;
  bytesRead: number;
  maxBytes: number;
  truncated: boolean;
  encoding: string;
}

export interface SftpFileRevision {
  size: number;
  modified?: string | null;
  permissions?: string | null;
  permissionsMode?: number | null;
  contentSha256?: string | null;
}

export interface SftpReadTextFileRequest extends SftpPathRequest {
  maxBytes?: number;
}

export interface SftpReadTextFileResponse {
  hostId: string;
  path: string;
  content: string;
  bytesRead: number;
  maxBytes: number;
  truncated: boolean;
  encoding: string;
  lineEnding: string;
  revision: SftpFileRevision;
  binary: boolean;
  readonly: boolean;
}

export interface SftpWriteTextFileRequest extends SftpPathRequest {
  content: string;
  encoding: string;
  expectedRevision?: SftpFileRevision | null;
  create: boolean;
  overwriteOnConflict: boolean;
}

export interface SftpWriteTextFileResponse {
  hostId: string;
  path: string;
  bytesWritten: number;
  encoding: string;
  lineEnding: string;
  revision: SftpFileRevision;
}

export interface SftpPathStat {
  hostId: string;
  path: string;
  kind: SftpEntryKind;
  size?: number | null;
  permissions?: string | null;
  modified?: string | null;
  revision?: SftpFileRevision | null;
  readonly: boolean;
}

export interface SftpDeleteRequest extends SftpPathRequest {
  directory: boolean;
}

export interface SftpRenameRequest {
  hostId: string;
  fromPath: string;
  toPath: string;
}

export interface SftpChmodRequest extends SftpPathRequest {
  mode: string;
}

export interface SftpTransferRequest {
  hostId: string;
  remotePath: string;
  localPath: string;
}

export type SftpTransferDirection = "upload" | "download";
export type SftpTransferKind = "file" | "directory";
export type SftpTransferStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";
export type SftpTransferEndpoint =
  | { kind: "local"; path: string }
  | { kind: "remote"; hostId: string; hostLabel: string; path: string };
export type SftpTransferOperation =
  | "upload"
  | "download"
  | "remoteCopy"
  | "archiveDownload"
  | "archiveUpload"
  | "clipboardDownload";
export type SftpTransferTransportMode =
  | "singleHostSftp"
  | "clientBridge"
  | "localStage";

export interface SftpManagedTransferRequest extends SftpTransferRequest {
  direction: SftpTransferDirection;
  kind: SftpTransferKind;
}

export interface SftpRemoteCopyRequest {
  sourceHostId: string;
  sourceRemotePath: string;
  targetHostId: string;
  targetRemotePath: string;
  kind: SftpTransferKind;
}

export interface SftpArchiveDownloadRequest {
  hostId: string;
  sourceRemotePath: string;
  targetLocalPath: string;
  kind: SftpTransferKind;
}

export interface SftpArchiveUploadRequest {
  hostId: string;
  sourceLocalPath: string;
  targetRemotePath: string;
  kind: SftpTransferKind;
}

export interface SftpClipboardDownloadRequest {
  hostId: string;
  sourceRemotePath: string;
  kind: SftpTransferKind;
}

export type SftpLocalPathKind = "file" | "directory";

export interface SftpClassifyLocalPathsRequest {
  paths: string[];
}

export interface SftpLocalPathInfo {
  path: string;
  kind: SftpLocalPathKind;
}

export interface SftpTransferCancelRequest {
  transferId: string;
}

export interface SftpTransferSummary {
  id: string;
  hostId: string;
  remotePath: string;
  localPath: string;
  direction: SftpTransferDirection;
  kind: SftpTransferKind;
  status: SftpTransferStatus;
  bytesTransferred: number;
  totalBytes?: number | null;
  error?: string | null;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  operation?: SftpTransferOperation | null;
  source?: SftpTransferEndpoint | null;
  target?: SftpTransferEndpoint | null;
  transportMode?: SftpTransferTransportMode | null;
  phase?: string | null;
  currentItem?: string | null;
}

export interface SftpTrustHostKeyRequest {
  hostId: string;
}

export interface SftpHostKeyTrustSummary {
  hostId: string;
  host: string;
  port: number;
  knownHostsPath: string;
}

export async function listSftpDirectory(
  request: SftpListDirectoryRequest,
): Promise<SftpDirectoryListing> {
  if (!isTauri()) {
    return browserPreviewListing(request);
  }

  return invoke<SftpDirectoryListing>("sftp_list_directory", { request });
}

export async function createSftpDirectory(
  request: SftpPathRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_create_directory", { request });
}

export async function deleteSftpPath(
  request: SftpDeleteRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_delete", { request });
}

export async function renameSftpPath(
  request: SftpRenameRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_rename", { request });
}

export async function previewSftpFile(
  request: SftpPreviewRequest,
): Promise<SftpFilePreview> {
  if (!isTauri()) {
    return browserPreviewFile(request);
  }

  return invoke<SftpFilePreview>("sftp_preview_file", { request });
}

export async function readSftpTextFile(
  request: SftpReadTextFileRequest,
): Promise<SftpReadTextFileResponse> {
  if (!isTauri()) {
    return browserReadTextFile(request);
  }

  return invoke<SftpReadTextFileResponse>("sftp_read_text_file", { request });
}

export async function writeSftpTextFile(
  request: SftpWriteTextFileRequest,
): Promise<SftpWriteTextFileResponse> {
  if (!isTauri()) {
    return browserWriteTextFile(request);
  }

  return invoke<SftpWriteTextFileResponse>("sftp_write_text_file", { request });
}

export async function statSftpPath(
  request: SftpPathRequest,
): Promise<SftpPathStat> {
  if (!isTauri()) {
    return browserStatPath(request);
  }

  return invoke<SftpPathStat>("sftp_stat_path", { request });
}

export async function chmodSftpPath(
  request: SftpChmodRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_chmod", { request });
}

export async function uploadSftpFile(
  request: SftpTransferRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_upload", { request });
}

export async function uploadSftpDirectory(
  request: SftpTransferRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_upload_directory", { request });
}

export async function downloadSftpFile(
  request: SftpTransferRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_download", { request });
}

export async function downloadSftpDirectory(
  request: SftpTransferRequest,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("sftp_download_directory", { request });
}

export async function enqueueSftpTransfer(
  request: SftpManagedTransferRequest,
): Promise<SftpTransferSummary> {
  if (!isTauri()) {
    return browserEnqueueTransfer(request);
  }

  return invoke<SftpTransferSummary>("sftp_enqueue_transfer", { request });
}

export async function enqueueSftpRemoteCopy(
  request: SftpRemoteCopyRequest,
): Promise<SftpTransferSummary> {
  if (!isTauri()) {
    return browserEnqueueRemoteCopy(request);
  }

  return invoke<SftpTransferSummary>("sftp_enqueue_remote_copy", { request });
}

export async function enqueueSftpArchiveDownload(
  request: SftpArchiveDownloadRequest,
): Promise<SftpTransferSummary> {
  if (!isTauri()) {
    return browserEnqueueArchiveDownload(request);
  }

  return invoke<SftpTransferSummary>("sftp_enqueue_archive_download", {
    request,
  });
}

export async function enqueueSftpArchiveUpload(
  request: SftpArchiveUploadRequest,
): Promise<SftpTransferSummary> {
  if (!isTauri()) {
    return browserEnqueueArchiveUpload(request);
  }

  return invoke<SftpTransferSummary>("sftp_enqueue_archive_upload", {
    request,
  });
}

export async function enqueueSftpClipboardDownload(
  request: SftpClipboardDownloadRequest,
): Promise<SftpTransferSummary> {
  if (!isTauri()) {
    return browserEnqueueClipboardDownload(request);
  }

  return invoke<SftpTransferSummary>("sftp_enqueue_clipboard_download", {
    request,
  });
}

export async function listSftpTransfers(): Promise<SftpTransferSummary[]> {
  if (!isTauri()) {
    return browserListTransfers();
  }

  return invoke<SftpTransferSummary[]>("sftp_list_transfers");
}

export async function cancelSftpTransfer(
  request: SftpTransferCancelRequest,
): Promise<SftpTransferSummary> {
  if (!isTauri()) {
    return browserCancelTransfer(request);
  }

  return invoke<SftpTransferSummary>("sftp_cancel_transfer", { request });
}

export async function clearCompletedSftpTransfers(): Promise<
  SftpTransferSummary[]
> {
  if (!isTauri()) {
    return browserClearCompletedTransfers();
  }

  return invoke<SftpTransferSummary[]>("sftp_clear_completed_transfers");
}

export async function classifySftpLocalPaths(
  request: SftpClassifyLocalPathsRequest,
): Promise<SftpLocalPathInfo[]> {
  if (!isTauri()) {
    return browserClassifyLocalPaths(request);
  }

  return invoke<SftpLocalPathInfo[]>("sftp_classify_local_paths", { request });
}

export async function readSftpLocalFileClipboard(): Promise<
  SftpLocalPathInfo[]
> {
  if (!isTauri()) {
    return [];
  }

  return invoke<SftpLocalPathInfo[]>("sftp_read_local_file_clipboard");
}

export async function trustSftpHostKey(
  request: SftpTrustHostKeyRequest,
): Promise<SftpHostKeyTrustSummary> {
  if (!isTauri()) {
    return {
      host: request.hostId,
      hostId: request.hostId,
      knownHostsPath: "browser-preview-known-hosts",
      port: 22,
    };
  }

  return invoke<SftpHostKeyTrustSummary>("sftp_trust_host_key", { request });
}

function browserPreviewListing(
  request: SftpListDirectoryRequest,
): SftpDirectoryListing {
  const path = normalizePreviewPath(request.path);

  return {
    entries: browserPreviewEntriesByPath[path] ?? [],
    hostId: request.hostId,
    parentPath: parentPreviewPath(path),
    path,
  };
}

const browserPreviewEntriesByPath: Record<string, SftpEntry[]> = {
  "/": [
    previewEntry("/", "var", "directory", "drwxr-xr-x", 4096),
    previewEntry("/", "srv", "directory", "drwxr-xr-x", 4096),
    previewEntry("/", "home", "directory", "drwxr-xr-x", 4096),
  ],
  "/var": [previewEntry("/var", "log", "directory", "drwxr-xr-x", 4096)],
  "/var/log": [
    previewEntry("/var/log", "app.log", "file", "-rw-r--r--", 524288),
    previewEntry("/var/log", "nginx", "directory", "drwxr-xr-x", 4096),
    previewEntry("/var/log", "current", "symlink", "lrwxrwxrwx", 7),
  ],
  "/srv": [previewEntry("/srv", "app", "directory", "drwxr-xr-x", 4096)],
  "/srv/app": [
    previewEntry("/srv/app", "release.sh", "file", "-rwxr-xr-x", 2048),
    previewEntry("/srv/app", "config", "directory", "drwx------", 4096),
  ],
  "/home": [previewEntry("/home", "deploy", "directory", "drwxr-xr-x", 4096)],
  "/home/deploy": [
    previewEntry("/home/deploy", ".ssh", "directory", "drwx------", 4096),
    previewEntry("/home/deploy", "README.md", "file", "-rw-r--r--", 1200),
  ],
};

const browserTextFileSeeds: Record<string, string> = {
  "/home/deploy/README.md":
    "# Kerminal 预览\n\n这是浏览器预览模式下的远程 README.md。\n真实应用会通过原生异步 SFTP 后端读取远程文件。",
  "/srv/app/release.sh":
    "#!/usr/bin/env bash\nset -euo pipefail\nnpm run check\nsystemctl --user restart kerminal-preview",
  "/var/log/app.log": [
    "2026-06-17 18:00:00 INFO service started",
    "2026-06-17 18:01:12 WARN retrying remote task",
    "2026-06-17 18:02:20 INFO health check ok",
    "2026-06-17 18:03:44 INFO worker completed sftp preview smoke",
    "2026-06-17 18:04:09 INFO audit record persisted for browser preview",
    "2026-06-17 18:05:31 INFO release candidate remains healthy",
  ].join("\n"),
};

const browserTextFiles = new Map<string, string>();

function browserPreviewFile(request: SftpPreviewRequest): SftpFilePreview {
  const path = normalizePreviewPath(request.path);
  const maxBytes = normalizePreviewMaxBytes(request.maxBytes);
  const rawContent = browserTextContent(path);
  const content =
    rawContent.length > maxBytes ? rawContent.slice(0, maxBytes) : rawContent;

  return {
    bytesRead: content.length,
    content,
    encoding: "utf-8-lossy",
    hostId: request.hostId,
    maxBytes,
    path,
    truncated: rawContent.length > maxBytes,
  };
}

function browserReadTextFile(
  request: SftpReadTextFileRequest,
): SftpReadTextFileResponse {
  const path = normalizePreviewPath(request.path);
  const maxBytes = normalizeTextFileMaxBytes(request.maxBytes);
  const rawContent = browserTextContent(path);
  const content =
    rawContent.length > maxBytes ? rawContent.slice(0, maxBytes) : rawContent;
  const truncated = rawContent.length > maxBytes;

  return {
    binary: false,
    bytesRead: content.length,
    content,
    encoding: "utf-8",
    hostId: request.hostId,
    lineEnding: browserLineEnding(content),
    maxBytes,
    path,
    readonly: truncated,
    revision: browserRevision(path, rawContent),
    truncated,
  };
}

function browserWriteTextFile(
  request: SftpWriteTextFileRequest,
): SftpWriteTextFileResponse {
  const path = normalizePreviewPath(request.path);
  const encoding = normalizeBrowserTextEncoding(request.encoding);
  const exists = browserTextFileExists(path);
  const currentContent = browserTextContent(path);
  const currentRevision = browserRevision(path, currentContent);

  if (request.create && exists && !request.overwriteOnConflict) {
    throw new Error(`远程文件已存在: ${path}`);
  }
  if (
    !request.create &&
    !request.overwriteOnConflict &&
    !request.expectedRevision
  ) {
    throw new Error("保存远程文件必须提供 expectedRevision");
  }
  if (
    !request.create &&
    !request.overwriteOnConflict &&
    request.expectedRevision &&
    !sameBrowserRevision(currentRevision, request.expectedRevision)
  ) {
    throw new Error("远端文件已变更，请重新加载或选择覆盖后再保存");
  }

  browserTextFiles.set(path, request.content);

  return {
    bytesWritten: request.content.length,
    encoding,
    hostId: request.hostId,
    lineEnding: browserLineEnding(request.content),
    path,
    revision: browserRevision(path, request.content),
  };
}

function browserStatPath(request: SftpPathRequest): SftpPathStat {
  const path = normalizePreviewPath(request.path);
  const entry = browserFindEntry(path);
  const isDirectory = path === "/" || Boolean(browserPreviewEntriesByPath[path]);
  const isFile = browserTextFileExists(path) || entry?.kind === "file";
  const content = isFile ? browserTextContent(path) : "";

  return {
    hostId: request.hostId,
    kind: isDirectory ? "directory" : (entry?.kind ?? "file"),
    modified: entry?.modified ?? "Jun 17 18:00",
    path,
    permissions: entry?.permissions ?? (isDirectory ? "drwxr-xr-x" : "-rw-r--r--"),
    readonly: !isFile,
    revision: isFile ? browserRevision(path, content) : null,
    size: isDirectory ? 4096 : (entry?.size ?? content.length),
  };
}

function previewEntry(
  basePath: string,
  name: string,
  kind: SftpEntryKind,
  permissions: string,
  size: number,
): SftpEntry {
  return {
    kind,
    modified: "Jun 17 18:00",
    name,
    path: basePath === "/" ? `/${name}` : `${basePath}/${name}`,
    permissions,
    raw: `${permissions} ${size} ${name}`,
    size,
  };
}

function normalizePreviewPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/") || "/";
  return normalized.length > 1 ? normalized.replace(/\/+$/g, "") : normalized;
}

function parentPreviewPath(path: string) {
  if (path === "/") {
    return undefined;
  }
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent || "/";
}

function normalizePreviewMaxBytes(maxBytes: number | undefined) {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return 16 * 1024;
  }
  return Math.min(Math.max(Math.trunc(maxBytes), 256), 128 * 1024);
}

function normalizeTextFileMaxBytes(maxBytes: number | undefined) {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return 2 * 1024 * 1024;
  }
  return Math.min(Math.max(Math.trunc(maxBytes), 1024), 10 * 1024 * 1024);
}

function normalizeBrowserTextEncoding(encoding: string) {
  const normalized = encoding.trim().toLowerCase();
  if (normalized !== "utf-8") {
    throw new Error(`暂不支持保存 ${encoding} 编码的远程文件`);
  }
  return "utf-8";
}

function browserTextFileExists(path: string) {
  return (
    browserTextFiles.has(path) ||
    Object.prototype.hasOwnProperty.call(browserTextFileSeeds, path)
  );
}

function browserTextContent(path: string) {
  return (
    browserTextFiles.get(path) ??
    browserTextFileSeeds[path] ??
    `Kerminal 浏览器预览文件\n远程路径：${path}\n`
  );
}

function browserFindEntry(path: string) {
  const parent = parentPreviewPath(path);
  const listing = parent ? browserPreviewEntriesByPath[parent] : undefined;
  return listing?.find((entry) => entry.path === path);
}

function browserRevision(path: string, content: string): SftpFileRevision {
  const entry = browserFindEntry(path);
  return {
    contentSha256: browserChecksum(`${path}\n${content}`),
    modified: entry?.modified ?? "Jun 17 18:00",
    permissions: entry?.permissions ?? "-rw-r--r--",
    permissionsMode: null,
    size: content.length,
  };
}

function sameBrowserRevision(
  current: SftpFileRevision,
  expected: SftpFileRevision,
) {
  if (current.contentSha256 && expected.contentSha256) {
    return current.contentSha256 === expected.contentSha256;
  }
  return (
    current.size === expected.size &&
    current.modified === expected.modified &&
    current.permissions === expected.permissions
  );
}

function browserChecksum(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return `browser-${hash.toString(16).padStart(8, "0")}`;
}

function browserLineEnding(content: string) {
  const hasCrLf = content.includes("\r\n");
  const hasLf = /(?<!\r)\n/.test(content);
  if (hasCrLf && hasLf) {
    return "mixed";
  }
  if (hasCrLf) {
    return "crlf";
  }
  return "lf";
}

const browserTransfers: SftpTransferSummary[] = [];
const browserTransferTimers = new Map<string, ReturnType<typeof setInterval>>();
let browserTransferSeq = 0;

function browserLocalEndpoint(path: string): SftpTransferEndpoint {
  return { kind: "local", path };
}

function browserRemoteEndpoint(
  hostId: string,
  path: string,
  hostLabel = hostId,
): SftpTransferEndpoint {
  return { hostId, hostLabel, kind: "remote", path };
}

function managedBrowserTransferOperation(
  direction: SftpTransferDirection,
): SftpTransferOperation {
  return direction === "upload" ? "upload" : "download";
}

function browserManagedTransferSource(
  request: SftpManagedTransferRequest,
): SftpTransferEndpoint {
  return request.direction === "upload"
    ? browserLocalEndpoint(request.localPath)
    : browserRemoteEndpoint(request.hostId, request.remotePath);
}

function browserManagedTransferTarget(
  request: SftpManagedTransferRequest,
): SftpTransferEndpoint {
  return request.direction === "upload"
    ? browserRemoteEndpoint(request.hostId, request.remotePath)
    : browserLocalEndpoint(request.localPath);
}

function browserEnqueueTransfer(
  request: SftpManagedTransferRequest,
  metadata: Partial<
    Pick<
      SftpTransferSummary,
      | "currentItem"
      | "operation"
      | "phase"
      | "source"
      | "target"
      | "transportMode"
    >
  > = {},
): SftpTransferSummary {
  const now = nowSeconds();
  const totalBytes = browserTransferTotalBytes(request);
  const transfer: SftpTransferSummary = {
    ...request,
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: now,
    id: `browser-transfer-${++browserTransferSeq}`,
    status: "running",
    totalBytes,
    updatedAt: now,
    operation: managedBrowserTransferOperation(request.direction),
    source: browserManagedTransferSource(request),
    target: browserManagedTransferTarget(request),
    transportMode: "singleHostSftp",
    phase: "running",
    currentItem: null,
    ...metadata,
  };
  browserTransfers.unshift(transfer);
  startBrowserTransferSimulation(transfer.id);
  return { ...transfer };
}

function browserEnqueueRemoteCopy(
  request: SftpRemoteCopyRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      direction: "upload",
      hostId: request.targetHostId,
      kind: request.kind,
      localPath: `sftp://${request.sourceHostId}${request.sourceRemotePath}`,
      remotePath: request.targetRemotePath,
    },
    {
      operation: "remoteCopy",
      source: browserRemoteEndpoint(
        request.sourceHostId,
        request.sourceRemotePath,
      ),
      target: browserRemoteEndpoint(
        request.targetHostId,
        request.targetRemotePath,
      ),
      transportMode: "clientBridge",
    },
  );
}

function browserEnqueueArchiveDownload(
  request: SftpArchiveDownloadRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      direction: "download",
      hostId: request.hostId,
      kind: request.kind,
      localPath: request.targetLocalPath,
      remotePath: request.sourceRemotePath,
    },
    { operation: "archiveDownload" },
  );
}

function browserEnqueueArchiveUpload(
  request: SftpArchiveUploadRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      direction: "upload",
      hostId: request.hostId,
      kind: "file",
      localPath: request.sourceLocalPath,
      remotePath: request.targetRemotePath,
    },
    { operation: "archiveUpload" },
  );
}

function browserEnqueueClipboardDownload(
  request: SftpClipboardDownloadRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      direction: "download",
      hostId: request.hostId,
      kind: request.kind,
      localPath: `~/Downloads/${browserRemoteFileName(request.sourceRemotePath, request.kind)}`,
      remotePath: request.sourceRemotePath,
    },
    { operation: "clipboardDownload" },
  );
}

function browserListTransfers(): SftpTransferSummary[] {
  return browserTransfers.map((transfer) => ({ ...transfer }));
}

function browserCancelTransfer(
  request: SftpTransferCancelRequest,
): SftpTransferSummary {
  const transfer = browserTransfers.find(
    (item) => item.id === request.transferId,
  );
  if (!transfer) {
    throw new Error(`SFTP 传输任务不存在: ${request.transferId}`);
  }
  transfer.cancelRequested = true;
  transfer.status = "canceled";
  transfer.phase = "canceled";
  transfer.updatedAt = nowSeconds();
  stopBrowserTransferSimulation(transfer.id);
  return { ...transfer };
}

function browserClearCompletedTransfers(): SftpTransferSummary[] {
  for (let index = browserTransfers.length - 1; index >= 0; index -= 1) {
    const transfer = browserTransfers[index];
    if (
      transfer.status === "succeeded" ||
      transfer.status === "failed" ||
      transfer.status === "canceled"
    ) {
      stopBrowserTransferSimulation(transfer.id);
      browserTransfers.splice(index, 1);
    }
  }
  return browserListTransfers();
}

function browserClassifyLocalPaths(
  request: SftpClassifyLocalPathsRequest,
): SftpLocalPathInfo[] {
  return request.paths.map((path) => ({
    kind: path.endsWith("/") || path.endsWith("\\") ? "directory" : "file",
    path,
  }));
}

function startBrowserTransferSimulation(transferId: string) {
  stopBrowserTransferSimulation(transferId);
  const timer = setInterval(() => {
    const transfer = browserTransfers.find((item) => item.id === transferId);
    if (!transfer || transfer.status !== "running") {
      stopBrowserTransferSimulation(transferId);
      return;
    }
    const totalBytes = transfer.totalBytes ?? 512 * 1024;
    const chunk = Math.max(32 * 1024, Math.ceil(totalBytes / 6));
    transfer.bytesTransferred = Math.min(
      totalBytes,
      transfer.bytesTransferred + chunk,
    );
    transfer.updatedAt = nowSeconds();
    if (transfer.bytesTransferred >= totalBytes) {
      transfer.status = "succeeded";
      transfer.phase = "done";
      stopBrowserTransferSimulation(transferId);
    }
  }, 220);
  browserTransferTimers.set(transferId, timer);
}

function stopBrowserTransferSimulation(transferId: string) {
  const timer = browserTransferTimers.get(transferId);
  if (timer) {
    clearInterval(timer);
    browserTransferTimers.delete(transferId);
  }
}

function browserTransferTotalBytes(request: SftpManagedTransferRequest) {
  return request.kind === "directory" ? 4 * 1024 * 1024 : 768 * 1024;
}

function browserRemoteFileName(path: string, kind: SftpTransferKind) {
  const fallback = kind === "directory" ? "remote-directory" : "remote-file";
  return (
    path
      .replace(/\\/g, "/")
      .replace(/\/+$/g, "")
      .split("/")
      .filter(Boolean)
      .pop() || fallback
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
