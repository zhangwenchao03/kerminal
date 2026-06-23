import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

export type AppUpdateCheckResult =
  | {
      kind: "unavailable";
      message: string;
    }
  | {
      kind: "up-to-date";
    }
  | {
      body?: string;
      currentVersion: string;
      date?: string;
      kind: "available";
      version: string;
    };

export interface AppUpdateProgress {
  contentLength?: number;
  downloadedBytes: number;
  percent?: number;
  phase: "starting" | "downloading" | "installing" | "finished";
}

export interface AppUpdateInstallResult {
  contentLength?: number;
  downloadedBytes: number;
  version: string;
}

let pendingUpdate: Update | null = null;

export async function checkForAppUpdate(): Promise<AppUpdateCheckResult> {
  if (!isTauri()) {
    pendingUpdate = null;
    return {
      kind: "unavailable",
      message: "更新检查只在已安装的桌面应用内可用。",
    };
  }

  const update = await check({ timeout: 15_000 });
  pendingUpdate = update;

  if (!update) {
    return { kind: "up-to-date" };
  }

  return {
    body: update.body,
    currentVersion: update.currentVersion,
    date: update.date,
    kind: "available",
    version: update.version,
  };
}

export async function installPendingAppUpdate(
  onProgress?: (progress: AppUpdateProgress) => void,
): Promise<AppUpdateInstallResult> {
  if (!pendingUpdate) {
    throw new Error("没有可安装的更新，请先检查更新。");
  }

  const update = pendingUpdate;
  let contentLength: number | undefined;
  let downloadedBytes = 0;

  await update.download((event) => {
    const progress = normalizeDownloadEvent(event, downloadedBytes, contentLength);
    downloadedBytes = progress.downloadedBytes;
    contentLength = progress.contentLength;
    onProgress?.(progress);
  });

  onProgress?.({
    contentLength,
    downloadedBytes,
    percent: progressPercent(downloadedBytes, contentLength),
    phase: "installing",
  });
  await update.install();
  pendingUpdate = null;

  onProgress?.({
    contentLength,
    downloadedBytes,
    percent: progressPercent(downloadedBytes, contentLength),
    phase: "finished",
  });

  return {
    contentLength,
    downloadedBytes,
    version: update.version,
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri()) {
    throw new Error("重启安装只在已安装的桌面应用内可用。");
  }

  await relaunch();
}

function normalizeDownloadEvent(
  event: DownloadEvent,
  downloadedBytes: number,
  contentLength?: number,
): AppUpdateProgress {
  if (event.event === "Started") {
    const nextContentLength = event.data.contentLength;
    return {
      contentLength: nextContentLength,
      downloadedBytes: 0,
      percent: progressPercent(0, nextContentLength),
      phase: "starting",
    };
  }

  if (event.event === "Progress") {
    const nextDownloadedBytes = downloadedBytes + event.data.chunkLength;
    return {
      contentLength,
      downloadedBytes: nextDownloadedBytes,
      percent: progressPercent(nextDownloadedBytes, contentLength),
      phase: "downloading",
    };
  }

  return {
    contentLength,
    downloadedBytes,
    percent: progressPercent(downloadedBytes, contentLength),
    phase: "finished",
  };
}

function progressPercent(downloadedBytes: number, contentLength?: number) {
  if (!contentLength || contentLength <= 0) {
    return undefined;
  }

  return Math.min(100, Math.round((downloadedBytes / contentLength) * 100));
}
