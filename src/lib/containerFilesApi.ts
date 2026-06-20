import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ContainerRuntime } from "./targetModel";
import type {
  SftpEntry,
  SftpFileRevision,
  SftpTransferKind,
} from "./sftpApi";

export interface DockerContainerPathRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
  path: string;
}

export interface DockerContainerDirectoryListing {
  hostId: string;
  containerId: string;
  path: string;
  parentPath?: string | null;
  entries: SftpEntry[];
}

export interface DockerContainerPreviewRequest
  extends DockerContainerPathRequest {
  maxBytes?: number;
}

export interface DockerContainerFilePreview {
  hostId: string;
  containerId: string;
  path: string;
  content: string;
  bytesRead: number;
  maxBytes: number;
  truncated: boolean;
  encoding: string;
}

export interface DockerContainerReadTextFileRequest
  extends DockerContainerPathRequest {
  maxBytes?: number;
}

export interface DockerContainerReadTextFileResponse {
  hostId: string;
  containerId: string;
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

export interface DockerContainerWriteTextFileRequest
  extends DockerContainerPathRequest {
  content: string;
  encoding: string;
  expectedRevision?: SftpFileRevision | null;
  create: boolean;
  overwriteOnConflict: boolean;
}

export interface DockerContainerWriteTextFileResponse {
  hostId: string;
  containerId: string;
  path: string;
  bytesWritten: number;
  encoding: string;
  lineEnding: string;
  revision: SftpFileRevision;
}

export interface DockerContainerDeleteRequest
  extends DockerContainerPathRequest {
  directory: boolean;
}

export interface DockerContainerRenameRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
  fromPath: string;
  toPath: string;
}

export interface DockerContainerChmodRequest
  extends DockerContainerPathRequest {
  mode: string;
}

export interface DockerContainerTransferRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
  remotePath: string;
  localPath: string;
  kind: SftpTransferKind;
}

export async function listDockerContainerDirectory(
  request: DockerContainerPathRequest,
): Promise<DockerContainerDirectoryListing> {
  const normalized = normalizePathRequest(request);
  if (!isTauri()) {
    return browserPreviewListing(normalized);
  }

  return invoke<DockerContainerDirectoryListing>("docker_list_directory", {
    request: normalized,
  });
}

export async function previewDockerContainerFile(
  request: DockerContainerPreviewRequest,
): Promise<DockerContainerFilePreview> {
  const normalized = {
    ...normalizePathRequest(request),
    maxBytes: request.maxBytes,
  };
  if (!isTauri()) {
    return browserPreviewFile(normalized);
  }

  return invoke<DockerContainerFilePreview>("docker_preview_file", {
    request: normalized,
  });
}

export async function readDockerContainerTextFile(
  request: DockerContainerReadTextFileRequest,
): Promise<DockerContainerReadTextFileResponse> {
  const normalized = {
    ...normalizePathRequest(request),
    maxBytes: request.maxBytes,
  };
  if (!isTauri()) {
    return browserReadTextFile(normalized);
  }

  return invoke<DockerContainerReadTextFileResponse>(
    "docker_read_text_file",
    {
      request: normalized,
    },
  );
}

export async function writeDockerContainerTextFile(
  request: DockerContainerWriteTextFileRequest,
): Promise<DockerContainerWriteTextFileResponse> {
  const normalized = {
    ...normalizePathRequest(request),
    content: request.content,
    create: request.create,
    encoding: request.encoding,
    expectedRevision: request.expectedRevision ?? null,
    overwriteOnConflict: request.overwriteOnConflict,
  };
  if (!isTauri()) {
    return browserWriteTextFile(normalized);
  }

  return invoke<DockerContainerWriteTextFileResponse>(
    "docker_write_text_file",
    {
      request: normalized,
    },
  );
}

export async function createDockerContainerDirectory(
  request: DockerContainerPathRequest,
): Promise<boolean> {
  const normalized = normalizePathRequest(request);
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("docker_create_directory", { request: normalized });
}

export async function deleteDockerContainerPath(
  request: DockerContainerDeleteRequest,
): Promise<boolean> {
  const normalized = {
    ...normalizePathRequest(request),
    directory: request.directory,
  };
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("docker_delete_path", { request: normalized });
}

export async function renameDockerContainerPath(
  request: DockerContainerRenameRequest,
): Promise<boolean> {
  const normalized = {
    hostId: request.hostId.trim(),
    containerId: request.containerId.trim(),
    runtime: request.runtime ?? "docker",
    fromPath: normalizeRemotePath(request.fromPath),
    toPath: normalizeRemotePath(request.toPath),
  };
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("docker_rename_path", { request: normalized });
}

export async function chmodDockerContainerPath(
  request: DockerContainerChmodRequest,
): Promise<boolean> {
  const normalized = {
    ...normalizePathRequest(request),
    mode: request.mode.trim(),
  };
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("docker_chmod_path", { request: normalized });
}

export async function uploadDockerContainerPath(
  request: DockerContainerTransferRequest,
): Promise<boolean> {
  const normalized = normalizeTransferRequest(request);
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("docker_upload", { request: normalized });
}

export async function downloadDockerContainerPath(
  request: DockerContainerTransferRequest,
): Promise<boolean> {
  const normalized = normalizeTransferRequest(request);
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("docker_download", { request: normalized });
}

function normalizePathRequest(
  request: DockerContainerPathRequest,
): Required<DockerContainerPathRequest> {
  return {
    hostId: request.hostId.trim(),
    containerId: request.containerId.trim(),
    runtime: request.runtime ?? "docker",
    path: normalizeRemotePath(request.path),
  };
}

function normalizeTransferRequest(
  request: DockerContainerTransferRequest,
): Required<DockerContainerTransferRequest> {
  return {
    hostId: request.hostId.trim(),
    containerId: request.containerId.trim(),
    runtime: request.runtime ?? "docker",
    remotePath: normalizeRemotePath(request.remotePath),
    localPath: request.localPath.trim(),
    kind: request.kind,
  };
}

export function normalizeRemotePath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/g, "")
    : withLeadingSlash || "/";
}

export function joinRemotePath(basePath: string, childPath: string) {
  const child = childPath.trim().replace(/^\/+/g, "");
  if (!child) {
    return normalizeRemotePath(basePath);
  }
  return normalizeRemotePath(basePath === "/" ? `/${child}` : `${basePath}/${child}`);
}

export function parentRemotePath(path: string) {
  const normalized = normalizeRemotePath(path);
  if (normalized === "/") {
    return null;
  }
  const parent = normalized.slice(0, normalized.lastIndexOf("/")) || "/";
  return parent;
}

export function fileNameFromPath(path: string, fallback = "download") {
  const name = normalizeRemotePath(path).split("/").filter(Boolean).pop();
  return name?.trim() || fallback;
}

function browserPreviewListing(
  request: Required<DockerContainerPathRequest>,
): DockerContainerDirectoryListing {
  const entriesByPath: Record<string, SftpEntry[]> = {
    "/": [
      previewEntry("/", "app", "directory", "drwxr-xr-x", 4096),
      previewEntry("/", "etc", "directory", "drwxr-xr-x", 4096),
      previewEntry("/", "var", "directory", "drwxr-xr-x", 4096),
    ],
    "/app": [
      previewEntry("/app", "package.json", "file", "-rw-r--r--", 1460),
      previewEntry("/app", "src", "directory", "drwxr-xr-x", 4096),
      previewEntry("/app", "logs", "directory", "drwxr-xr-x", 4096),
    ],
    "/app/logs": [
      previewEntry("/app/logs", "server.log", "file", "-rw-r--r--", 8192),
    ],
  };
  const path = normalizeRemotePath(request.path);
  return {
    containerId: request.containerId,
    entries: entriesByPath[path] ?? [],
    hostId: request.hostId,
    parentPath: parentRemotePath(path),
    path,
  };
}

function browserPreviewFile(
  request: Required<DockerContainerPathRequest> & { maxBytes?: number },
): DockerContainerFilePreview {
  const content = browserFileContent(request.path);
  const maxBytes = request.maxBytes ?? 64 * 1024;
  return {
    bytesRead: content.length,
    containerId: request.containerId,
    content,
    encoding: "utf-8-lossy",
    hostId: request.hostId,
    maxBytes,
    path: request.path,
    truncated: false,
  };
}

function browserReadTextFile(
  request: Required<DockerContainerPathRequest> & { maxBytes?: number },
): DockerContainerReadTextFileResponse {
  const content = browserFileContent(request.path);
  const maxBytes = request.maxBytes ?? 10 * 1024 * 1024;
  return {
    binary: false,
    bytesRead: content.length,
    containerId: request.containerId,
    content,
    encoding: "utf-8-lossy",
    hostId: request.hostId,
    lineEnding: detectLineEnding(content),
    maxBytes,
    path: request.path,
    readonly: false,
    revision: browserRevision(request.path, content),
    truncated: content.length > maxBytes,
  };
}

function browserWriteTextFile(
  request: Required<DockerContainerPathRequest> &
    Omit<
      DockerContainerWriteTextFileRequest,
      keyof DockerContainerPathRequest
    >,
): DockerContainerWriteTextFileResponse {
  browserFiles.set(request.path, request.content);
  return {
    bytesWritten: request.content.length,
    containerId: request.containerId,
    encoding: "utf-8",
    hostId: request.hostId,
    lineEnding: detectLineEnding(request.content),
    path: request.path,
    revision: browserRevision(request.path, request.content),
  };
}

const browserFiles = new Map<string, string>();

function browserFileContent(path: string) {
  const normalized = normalizeRemotePath(path);
  const saved = browserFiles.get(normalized);
  if (saved !== undefined) {
    return saved;
  }
  if (normalized.endsWith("package.json")) {
    return JSON.stringify(
      {
        name: "container-app",
        scripts: { start: "node src/server.js" },
      },
      null,
      2,
    );
  }
  return [
    `# ${normalized}`,
    "container preview content",
    "docker exec 和 docker cp 将在桌面运行时读取真实容器文件。",
  ].join("\n");
}

function browserRevision(path: string, content: string): SftpFileRevision {
  return {
    contentSha256: `${path}:${content.length}`,
    modified: "browser-preview",
    permissions: "-rw-r--r--",
    permissionsMode: 0o644,
    size: content.length,
  };
}

function detectLineEnding(content: string) {
  const crlf = content.split("\r\n").length - 1;
  const lf = content.split("\n").length - 1 - crlf;
  if (crlf > 0 && lf > 0) {
    return "mixed";
  }
  return crlf > 0 ? "crlf" : "lf";
}

function previewEntry(
  basePath: string,
  name: string,
  kind: SftpEntry["kind"],
  permissions: string,
  size: number,
): SftpEntry {
  return {
    kind,
    modified: "Jun 18 12:00",
    name,
    path: joinRemotePath(basePath, name),
    permissions,
    raw: `${permissions} 1 root root ${size} Jun 18 12:00 ${name}`,
    size,
  };
}
