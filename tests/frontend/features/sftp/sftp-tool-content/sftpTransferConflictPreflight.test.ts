import { describe, expect, it, vi } from "vitest";
import type { LocalPathStat } from "../../../../../src/lib/localFilesApi";
import type {
  SftpArchiveDownloadRequest,
  SftpArchiveUploadRequest,
  SftpManagedTransferRequest,
  SftpPathStat,
  SftpRemoteCopyRequest,
} from "../../../../../src/lib/sftpApi";
import type { SftpTransferActionBatchPlan } from "../../../../../src/features/sftp/sftp-tool-content/sftpTransferActionPlan";
import {
  countSftpTransferConflicts,
  isSftpTransferConflictPreflightCanceledError,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight";

function transferRequest(
  direction: SftpManagedTransferRequest["direction"],
  overrides: Partial<SftpManagedTransferRequest> = {},
): SftpManagedTransferRequest {
  return {
    conflictPolicy: "overwrite",
    direction,
    hostId: "prod-api",
    kind: "file",
    localPath: "/Users/me/release.tgz",
    remotePath: "/var/www/release.tgz",
    ...overrides,
  };
}

function remoteStat(path = "/var/www/release.tgz"): SftpPathStat {
  return {
    hostId: "prod-api",
    kind: "file",
    path,
    readonly: false,
  };
}

function remoteCopyRequest(
  overrides: Partial<SftpRemoteCopyRequest> = {},
): SftpRemoteCopyRequest {
  return {
    conflictPolicy: "overwrite",
    kind: "file",
    sourceHostId: "prod-api",
    sourceRemotePath: "/var/www/release.tgz",
    targetHostId: "stage-api",
    targetRemotePath: "/deploy/release.tgz",
    ...overrides,
  };
}

function archiveDownloadRequest(
  overrides: Partial<SftpArchiveDownloadRequest> = {},
): SftpArchiveDownloadRequest {
  return {
    conflictPolicy: "overwrite",
    hostId: "prod-api",
    kind: "directory",
    sourceRemotePath: "/var/www/releases",
    targetLocalPath: "/Users/me/releases.zip",
    ...overrides,
  };
}

function archiveUploadRequest(
  overrides: Partial<SftpArchiveUploadRequest> = {},
): SftpArchiveUploadRequest {
  return {
    conflictPolicy: "overwrite",
    hostId: "prod-api",
    kind: "directory",
    sourceLocalPath: "/Users/me/releases",
    targetRemotePath: "/var/www/releases.zip",
    ...overrides,
  };
}

function localStat(exists: boolean, path = "/Users/me/release.tgz"): LocalPathStat {
  return {
    exists,
    path,
    readonly: false,
  };
}

function nextMicrotask() {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("sftpTransferConflictPreflight", () => {
  it("counts remote upload conflicts when stat succeeds", async () => {
    const statSftpPath = vi.fn().mockResolvedValue(remoteStat());
    const statLocalPath = vi.fn();

    await expect(
      countSftpTransferConflicts(transferRequest("upload"), {
        stats: { statLocalPath, statSftpPath },
      }),
    ).resolves.toBe(1);

    expect(statSftpPath).toHaveBeenCalledWith({
      hostId: "prod-api",
      path: "/var/www/release.tgz",
    });
    expect(statLocalPath).not.toHaveBeenCalled();
  });

  it("does not count missing remote upload targets as conflicts", async () => {
    const statSftpPath = vi
      .fn()
      .mockRejectedValue(new Error("SFTP 文件操作失败: No such file"));

    await expect(
      countSftpTransferConflicts(transferRequest("upload"), {
        stats: { statSftpPath },
      }),
    ).resolves.toBe(0);
  });

  it("does not count missing local download targets as conflicts when stat rejects not found", async () => {
    const statLocalPath = vi
      .fn()
      .mockRejectedValue(new Error("本地文件系统操作失败: 路径不存在"));

    await expect(
      countSftpTransferConflicts(transferRequest("download"), {
        stats: { statLocalPath },
      }),
    ).resolves.toBe(0);
  });

  it("rejects non-missing local stat errors during conflict checks", async () => {
    const statLocalPath = vi.fn().mockRejectedValue(new Error("permission"));

    await expect(
      countSftpTransferConflicts(transferRequest("download"), {
        stats: { statLocalPath },
      }),
    ).rejects.toThrow("permission");
  });

  it("rejects non-missing remote stat errors during conflict checks", async () => {
    const statSftpPath = vi.fn().mockRejectedValue(new Error("connection closed"));

    await expect(
      countSftpTransferConflicts(transferRequest("upload"), {
        stats: { statSftpPath },
      }),
    ).rejects.toThrow("connection closed");
  });

  it("counts local download conflicts when local stat exists", async () => {
    const statSftpPath = vi.fn();
    const statLocalPath = vi.fn().mockResolvedValue(localStat(true));

    await expect(
      countSftpTransferConflicts(transferRequest("download"), {
        localRootPath: "/Users/me",
        stats: { statLocalPath, statSftpPath },
      }),
    ).resolves.toBe(1);

    expect(statLocalPath).toHaveBeenCalledWith({
      path: "/Users/me/release.tgz",
      rootPath: "/Users/me",
    });
    expect(statSftpPath).not.toHaveBeenCalled();
  });

  it("summarizes conflicts across batch plan items", async () => {
    const batchPlan: SftpTransferActionBatchPlan = {
      completionStatus: null,
      items: [
        {
          queuedStatus: { kind: "info", message: "upload" },
          request: transferRequest("upload", {
            remotePath: "/var/www/upload.txt",
          }),
        },
        {
          queuedStatus: { kind: "info", message: "download conflict" },
          request: transferRequest("download", {
            localPath: "/Users/me/existing.txt",
          }),
        },
        {
          queuedStatus: { kind: "info", message: "download missing" },
          request: transferRequest("download", {
            localPath: "/Users/me/missing.txt",
          }),
        },
      ],
    };
    const statSftpPath = vi.fn().mockResolvedValue(remoteStat("/var/www/upload.txt"));
    const statLocalPath = vi
      .fn()
      .mockResolvedValueOnce(localStat(true, "/Users/me/existing.txt"))
      .mockResolvedValueOnce(localStat(false, "/Users/me/missing.txt"));

    await expect(
      countSftpTransferConflicts(batchPlan, {
        stats: { statLocalPath, statSftpPath },
      }),
    ).resolves.toBe(2);
  });

  it("limits concurrent stat checks and reports progress", async () => {
    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];
    const progress: Array<{ checked: number; conflicts: number; total: number }> = [];
    const statSftpPath = vi.fn(
      () =>
        new Promise<SftpPathStat>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          pending.push(() => {
            active -= 1;
            resolve(remoteStat());
          });
        }),
    );
    const requests = Array.from({ length: 5 }, (_, index) =>
      transferRequest("upload", { remotePath: `/var/www/${index}.tgz` }),
    );

    const conflicts = countSftpTransferConflicts(requests, {
      concurrency: 2,
      onProgress: ({ checked, conflicts, total }) => {
        progress.push({ checked, conflicts, total });
      },
      stats: { statSftpPath },
    });

    expect(statSftpPath).toHaveBeenCalledTimes(2);
    while (pending.length > 0) {
      pending.shift()?.();
      await nextMicrotask();
    }

    await expect(conflicts).resolves.toBe(5);
    expect(maxActive).toBe(2);
    expect(progress[progress.length - 1]).toEqual({
      checked: 5,
      conflicts: 5,
      total: 5,
    });
  });

  it("stops queued stat checks after preflight cancellation", async () => {
    const abortController = new AbortController();
    let releaseFirstStat: (() => void) | undefined;
    const statSftpPath = vi.fn(
      () =>
        new Promise<SftpPathStat>((resolve) => {
          releaseFirstStat = () => resolve(remoteStat());
        }),
    );
    const requests = Array.from({ length: 4 }, (_, index) =>
      transferRequest("upload", { remotePath: `/var/www/${index}.tgz` }),
    );

    const conflicts = countSftpTransferConflicts(requests, {
      concurrency: 1,
      signal: abortController.signal,
      stats: { statSftpPath },
    });

    expect(statSftpPath).toHaveBeenCalledTimes(1);
    abortController.abort();
    releaseFirstStat?.();

    let caughtError: unknown;
    try {
      await conflicts;
    } catch (error) {
      caughtError = error;
    }
    expect(isSftpTransferConflictPreflightCanceledError(caughtError)).toBe(
      true,
    );
    expect(statSftpPath).toHaveBeenCalledTimes(1);
  });

  it("counts remote copy conflicts against target host and path", async () => {
    const statSftpPath = vi.fn().mockResolvedValue(remoteStat("/deploy/release.tgz"));
    const statLocalPath = vi.fn();

    await expect(
      countSftpTransferConflicts({
        destinationRemotePath: "/deploy",
        requests: [remoteCopyRequest()],
        statusMessage: "copy",
        targetDescription: "远程复制",
      }, {
        stats: { statLocalPath, statSftpPath },
      }),
    ).resolves.toBe(1);

    expect(statSftpPath).toHaveBeenCalledWith({
      hostId: "stage-api",
      path: "/deploy/release.tgz",
    });
    expect(statLocalPath).not.toHaveBeenCalled();
  });

  it("counts archive download conflicts against the target local zip path", async () => {
    const statLocalPath = vi.fn().mockResolvedValue(localStat(true, "/Users/me/releases.zip"));
    const statSftpPath = vi.fn();

    await expect(
      countSftpTransferConflicts(archiveDownloadRequest(), {
        localRootPath: "/Users/me",
        stats: { statLocalPath, statSftpPath },
      }),
    ).resolves.toBe(1);

    expect(statLocalPath).toHaveBeenCalledWith({
      path: "/Users/me/releases.zip",
      rootPath: "/Users/me",
    });
    expect(statSftpPath).not.toHaveBeenCalled();
  });

  it("counts archive upload conflicts against the target remote zip path", async () => {
    const statSftpPath = vi.fn().mockResolvedValue(remoteStat("/var/www/releases.zip"));
    const statLocalPath = vi.fn();

    await expect(
      countSftpTransferConflicts(archiveUploadRequest(), {
        stats: { statLocalPath, statSftpPath },
      }),
    ).resolves.toBe(1);

    expect(statSftpPath).toHaveBeenCalledWith({
      hostId: "prod-api",
      path: "/var/www/releases.zip",
    });
    expect(statLocalPath).not.toHaveBeenCalled();
  });
});
