import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LocalDirectoryListing } from "./fileDialogApi";
import type { SftpEntryKind, SftpFileRevision } from "./sftpApi";

export interface LocalCreateDirectoryRequest {
  parentPath: string;
  name: string;
  rootPath?: string;
}

export interface LocalCopyPathRequest {
  sourcePath: string;
  targetDirectoryPath: string;
  kind: Extract<SftpEntryKind, "directory" | "file">;
  rootPath?: string;
}

export interface LocalRenamePathRequest {
  path: string;
  name: string;
  kind: Extract<SftpEntryKind, "directory" | "file">;
  rootPath?: string;
}

export interface LocalDeletePathRequest {
  path: string;
  kind: Extract<SftpEntryKind, "directory" | "file">;
  rootPath?: string;
  confirmName: string;
  recursive: boolean;
}

export interface LocalStatPathRequest {
  path: string;
  rootPath?: string;
}

export interface LocalReadTextFileRequest {
  path: string;
  maxBytes?: number;
}

export interface LocalReadTextFileResponse {
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

export interface LocalWriteTextFileRequest {
  path: string;
  content: string;
  encoding: string;
  expectedRevision?: SftpFileRevision | null;
  create: boolean;
  overwriteOnConflict: boolean;
}

export interface LocalWriteTextFileResponse {
  path: string;
  bytesWritten: number;
  encoding: string;
  lineEnding: string;
  revision: SftpFileRevision;
}

export interface LocalPathStat {
  path: string;
  exists: boolean;
  kind?: SftpEntryKind | null;
  size?: number | null;
  modified?: string | null;
  readonly: boolean;
}

export async function createLocalDirectory(
  request: LocalCreateDirectoryRequest,
): Promise<LocalDirectoryListing> {
  assertLocalFilesAvailable();
  return invoke<LocalDirectoryListing>("local_files_create_directory", {
    request,
  });
}

export async function copyLocalPath(
  request: LocalCopyPathRequest,
): Promise<LocalDirectoryListing> {
  assertLocalFilesAvailable();
  return invoke<LocalDirectoryListing>("local_files_copy_path", {
    request,
  });
}

export async function renameLocalPath(
  request: LocalRenamePathRequest,
): Promise<LocalDirectoryListing> {
  assertLocalFilesAvailable();
  return invoke<LocalDirectoryListing>("local_files_rename_path", {
    request,
  });
}

export async function deleteLocalPath(
  request: LocalDeletePathRequest,
): Promise<LocalDirectoryListing> {
  assertLocalFilesAvailable();
  return invoke<LocalDirectoryListing>("local_files_delete_path", {
    request,
  });
}

export async function statLocalPath(
  request: LocalStatPathRequest,
): Promise<LocalPathStat> {
  assertLocalFilesAvailable();
  return invoke<LocalPathStat>("local_files_stat_path", {
    request,
  });
}

export async function readLocalTextFile(
  request: LocalReadTextFileRequest,
): Promise<LocalReadTextFileResponse> {
  const normalized = {
    maxBytes: request.maxBytes,
    path: request.path.trim(),
  };
  if (!isTauri()) {
    return browserReadTextFile(normalized);
  }

  return invoke<LocalReadTextFileResponse>("local_files_read_text_file", {
    request: normalized,
  });
}

export async function writeLocalTextFile(
  request: LocalWriteTextFileRequest,
): Promise<LocalWriteTextFileResponse> {
  const normalized = {
    content: request.content,
    create: request.create,
    encoding: request.encoding,
    expectedRevision: request.expectedRevision ?? null,
    overwriteOnConflict: request.overwriteOnConflict,
    path: request.path.trim(),
  };
  if (!isTauri()) {
    return browserWriteTextFile(normalized);
  }

  return invoke<LocalWriteTextFileResponse>("local_files_write_text_file", {
    request: normalized,
  });
}

function assertLocalFilesAvailable() {
  if (!isTauri()) {
    throw new Error("本机文件操作仅支持桌面应用。");
  }
}

const browserFiles = new Map<string, string>();

function browserReadTextFile(
  request: LocalReadTextFileRequest,
): LocalReadTextFileResponse {
  const content = browserFileContent(request.path);
  const maxBytes = request.maxBytes ?? 10 * 1024 * 1024;
  const visibleContent =
    content.length > maxBytes ? content.slice(0, maxBytes) : content;
  return {
    binary: false,
    bytesRead: visibleContent.length,
    content: visibleContent,
    encoding: "utf-8-lossy",
    lineEnding: detectLineEnding(visibleContent),
    maxBytes,
    path: request.path,
    readonly: false,
    revision: browserRevision(request.path, content),
    truncated: content.length > maxBytes,
  };
}

function browserWriteTextFile(
  request: LocalWriteTextFileRequest,
): LocalWriteTextFileResponse {
  browserFiles.set(request.path, request.content);
  return {
    bytesWritten: request.content.length,
    encoding: "utf-8",
    lineEnding: detectLineEnding(request.content),
    path: request.path,
    revision: browserRevision(request.path, request.content),
  };
}

function browserFileContent(path: string) {
  const saved = browserFiles.get(path);
  if (saved !== undefined) {
    return saved;
  }
  if (path.endsWith("notes.md")) {
    return "# Local notes\n\nBrowser preview content.";
  }
  return [
    `# ${path}`,
    "local preview content",
    "桌面运行时会读取真实本机文件。",
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
