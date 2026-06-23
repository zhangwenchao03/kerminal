import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SftpEntryKind } from "./sftpApi";

export interface LocalDirectoryEntry {
  name: string;
  path: string;
  kind: SftpEntryKind;
  size?: number | null;
  modified?: string | null;
  hidden?: boolean;
  raw: string;
}

export interface LocalDirectoryListing {
  path: string;
  parentPath?: string | null;
  entries: LocalDirectoryEntry[];
}

export async function selectLocalFile(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("file_dialog_select_local_file");
}

export async function selectLocalImage(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("file_dialog_select_local_image");
}

export async function selectLocalDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("file_dialog_select_local_directory");
}

export async function listLocalDirectory(
  path?: string | null,
): Promise<LocalDirectoryListing> {
  if (!isTauri()) {
    return browserPreviewLocalDirectory(path);
  }

  return invoke<LocalDirectoryListing>("file_dialog_list_local_directory", {
    path: path ?? null,
  });
}

export async function getAppSkillsDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string>("file_dialog_get_app_skills_directory");
}

export async function openLocalDirectory(path: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke<void>("file_dialog_open_local_directory", { path });
}

export async function selectSaveFile(
  defaultPath?: string,
): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("file_dialog_select_save_file", {
    defaultPath,
  });
}

function browserPreviewLocalDirectory(
  path?: string | null,
): LocalDirectoryListing {
  const homePath = browserHomePath();
  const currentPath = path?.trim() || homePath;
  const parentPath =
    currentPath === homePath ? undefined : browserParentPath(currentPath, homePath);

  return {
    entries: [
      browserLocalEntry(currentPath, "Projects", "directory"),
      browserLocalEntry(currentPath, "Downloads", "directory"),
      browserLocalEntry(currentPath, ".ssh", "directory", undefined, true),
      browserLocalEntry(currentPath, "notes.md", "file", 2048),
      browserLocalEntry(currentPath, "kerminal.log", "file", 16384),
      browserLocalEntry(currentPath, ".bash_history", "file", 1024, true),
    ],
    parentPath,
    path: currentPath,
  };
}

function browserLocalEntry(
  parentPath: string,
  name: string,
  kind: SftpEntryKind,
  size?: number,
  hidden = name.startsWith("."),
): LocalDirectoryEntry {
  const separator = parentPath.includes("\\") ? "\\" : "/";
  const path = `${parentPath.replace(/[\\/]+$/g, "")}${separator}${name}`;
  return {
    kind,
    hidden,
    modified: "1771351200",
    name,
    path,
    raw: `${kind} ${path}`,
    size,
  };
}

function browserHomePath() {
  return navigator.platform.toLowerCase().includes("win")
    ? "C:\\Users\\kerminal"
    : "/home/kerminal";
}

function browserParentPath(path: string, fallback: string) {
  const normalized = path.replace(/[\\/]+$/g, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index <= 0) {
    return fallback;
  }
  return normalized.slice(0, index);
}
