import { invoke, isTauri } from "@tauri-apps/api/core";

export async function selectLocalFile(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("file_dialog_select_local_file");
}

export async function selectLocalDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("file_dialog_select_local_directory");
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
