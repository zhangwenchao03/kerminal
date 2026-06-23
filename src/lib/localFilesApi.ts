import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LocalDirectoryListing } from "./fileDialogApi";
import type { SftpEntryKind } from "./sftpApi";

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

function assertLocalFilesAvailable() {
  if (!isTauri()) {
    throw new Error("本机文件操作仅支持桌面应用。");
  }
}
