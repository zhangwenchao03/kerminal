import { describe, expect, it } from "vitest";
import type { SftpEntry, SftpLocalPathInfo } from "../../../lib/sftpApi";
import {
  buildDownloadSelectionPlan,
  buildSftpArchiveDownloadPlan,
  buildSftpArchiveDownloadPreparation,
  buildSftpArchiveUploadPlan,
  buildSftpClipboardDownloadPlan,
  buildBatchDownloadTransferPlan,
  buildDirectoryDownloadTransferPlan,
  buildDirectoryUploadTransferPlan,
  buildDockerContainerTransferRequest,
  buildDownloadTransferPlan,
  buildFileUploadTransferPlan,
  buildLocalPathBatchUploadPlan,
  buildLocalPathUploadTransferPlan,
  buildSftpLocalClipboardUploadPlan,
  sftpArchiveDownloadFileNameFor,
  shouldRefreshAfterDockerUpload,
  statusForDockerDirectTransfer,
} from "./sftpTransferActionPlan";
import type { SftpFileTarget } from "./types";

function entry(
  path: string,
  kind: SftpEntry["kind"],
  name = path.split("/").filter(Boolean).pop() ?? path,
): SftpEntry {
  return {
    kind,
    name,
    path,
    raw: `${kind} ${path}`,
  };
}

const containerTarget: Extract<SftpFileTarget, { kind: "dockerContainer" }> = {
  containerId: "container-api",
  hostId: "prod-api",
  initialPath: "/app",
  kind: "dockerContainer",
  protocol: "container://",
  runtime: "docker",
  summary: "docker:prod-api:api",
};

describe("sftpTransferActionPlan", () => {
  it("builds SSH upload requests for picked files and directories", () => {
    expect(
      buildFileUploadTransferPlan({
        hostId: "prod-api",
        localPath: "/Users/me/release.tgz",
        targetRemotePath: "/var/www",
      }),
    ).toEqual({
      queuedStatus: {
        kind: "info",
        message: "已加入上传队列：release.tgz",
      },
      request: {
        direction: "upload",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/release.tgz",
        remotePath: "/var/www/release.tgz",
      },
    });

    expect(
      buildDirectoryUploadTransferPlan({
        hostId: "prod-api",
        localPath: "/Users/me/dist",
        targetRemotePath: "/",
      }),
    ).toEqual({
      queuedStatus: {
        kind: "info",
        message: "已加入文件夹上传队列：dist",
      },
      request: {
        direction: "upload",
        hostId: "prod-api",
        kind: "directory",
        localPath: "/Users/me/dist",
        remotePath: "/dist",
      },
    });
  });

  it("passes upload conflict policies through transfer requests", () => {
    expect(
      buildFileUploadTransferPlan({
        conflictPolicy: "skip",
        hostId: "prod-api",
        localPath: "/Users/me/release.tgz",
        targetRemotePath: "/var/www",
      }).request.conflictPolicy,
    ).toBe("skip");

    expect(
      buildDirectoryUploadTransferPlan({
        conflictPolicy: "rename",
        hostId: "prod-api",
        localPath: "/Users/me/dist",
        targetRemotePath: "/var/www",
      }).request.conflictPolicy,
    ).toBe("rename");

    expect(
      buildLocalPathUploadTransferPlan({
        conflictPolicy: "skip",
        hostId: "prod-api",
        localPath: { kind: "file", path: "/Users/me/app.tar" },
        sourceLabel: "拖拽",
        targetRemotePath: "/var/www",
      }).request.conflictPolicy,
    ).toBe("skip");
  });

  it("plans dropped local uploads with SSH queue and Docker completion wording", () => {
    const localPaths: SftpLocalPathInfo[] = [
      { kind: "file", path: "/Users/me/release.tgz" },
      { kind: "directory", path: "/Users/me/dist" },
    ];

    expect(
      buildLocalPathBatchUploadPlan({
        fileTargetKind: "ssh",
        hostId: "prod-api",
        localPaths: [],
        sourceLabel: "拖拽",
        targetRemotePath: "/opt",
      }),
    ).toEqual({
      completionStatus: null,
      items: [],
    });

    expect(
      buildLocalPathBatchUploadPlan({
        fileTargetKind: "ssh",
        hostId: "prod-api",
        localPaths,
        sourceLabel: "拖拽",
        targetRemotePath: "/opt",
      }),
    ).toMatchObject({
      completionStatus: {
        kind: "info",
        message: "已加入拖拽上传队列：2 个本地项目 -> /opt",
      },
      items: [
        {
          queuedStatus: {
            kind: "info",
            message: "已加入拖拽上传队列：release.tgz",
          },
          request: {
            direction: "upload",
            kind: "file",
            remotePath: "/opt/release.tgz",
          },
        },
        {
          queuedStatus: {
            kind: "info",
            message: "已加入拖拽上传队列：dist",
          },
          request: {
            direction: "upload",
            kind: "directory",
            remotePath: "/opt/dist",
          },
        },
      ],
    });

    expect(
      buildLocalPathBatchUploadPlan({
        fileTargetKind: "dockerContainer",
        hostId: "prod-api",
        localPaths,
        sourceLabel: "拖拽",
        targetRemotePath: "/app",
      }).completionStatus,
    ).toEqual({
      kind: "success",
      message: "已完成拖拽上传：2 个本地项目 -> /app",
    });
  });

  it("passes batch and clipboard upload conflict policies through transfer requests", () => {
    const localPaths: SftpLocalPathInfo[] = [
      { kind: "file", path: "/Users/me/release.tgz" },
      { kind: "directory", path: "/Users/me/dist" },
    ];

    expect(
      buildLocalPathBatchUploadPlan({
        conflictPolicy: "rename",
        fileTargetKind: "ssh",
        hostId: "prod-api",
        localPaths,
        sourceLabel: "拖拽",
        targetRemotePath: "/opt",
      }).items.map((item) => item.request.conflictPolicy),
    ).toEqual(["rename", "rename"]);

    const clipboardPlan = buildSftpLocalClipboardUploadPlan({
      conflictPolicy: "skip",
      fileTargetKind: "ssh",
      hostId: "prod-api",
      localPaths,
      targetRemotePath: "/opt",
    });

    expect(clipboardPlan.kind).toBe("upload");
    if (clipboardPlan.kind !== "upload") {
      throw new Error("expected upload plan");
    }
    expect(
      clipboardPlan.batchPlan.items.map((item) => item.request.conflictPolicy),
    ).toEqual(["skip", "skip"]);
  });

  it("plans local file clipboard uploads and empty clipboard status", () => {
    expect(
      buildSftpLocalClipboardUploadPlan({
        fileTargetKind: "ssh",
        hostId: "prod-api",
        localPaths: [],
        targetRemotePath: "/opt",
      }),
    ).toEqual({
      kind: "empty",
      status: {
        kind: "info",
        message: "SFTP 剪贴板为空，系统剪贴板也没有本地文件。",
      },
    });

    const plan = buildSftpLocalClipboardUploadPlan({
      fileTargetKind: "ssh",
      hostId: "prod-api",
      localPaths: [
        { kind: "file", path: "/Users/me/release.tgz" },
        { kind: "directory", path: "/Users/me/dist" },
      ],
      targetRemotePath: "/opt",
    });

    expect(plan.kind).toBe("upload");
    if (plan.kind !== "upload") {
      throw new Error("expected upload plan");
    }
    expect(plan.batchPlan.completionStatus).toEqual({
      kind: "info",
      message: "已加入剪贴板上传队列：2 个本地项目 -> /opt",
    });
    expect(plan.batchPlan.items).toMatchObject([
      {
        queuedStatus: {
          kind: "info",
          message: "已加入剪贴板上传队列：release.tgz",
        },
        request: {
          direction: "upload",
          kind: "file",
          remotePath: "/opt/release.tgz",
        },
      },
      {
        queuedStatus: {
          kind: "info",
          message: "已加入剪贴板上传队列：dist",
        },
        request: {
          direction: "upload",
          kind: "directory",
          remotePath: "/opt/dist",
        },
      },
    ]);
  });

  it("builds download requests and filters unsupported entries from batches", () => {
    expect(
      buildDownloadSelectionPlan({
        emptyMessage: "请先选择可下载的远程项目。",
        entries: [],
      }),
    ).toEqual({
      kind: "empty",
      status: {
        kind: "info",
        message: "请先选择可下载的远程项目。",
      },
    });

    expect(
      buildDownloadSelectionPlan({
        emptyMessage: "请先选择可下载的远程项目。",
        entries: [
          entry("/run/app.sock", "other", "app.sock"),
        ],
      }),
    ).toEqual({
      kind: "empty",
      status: {
        kind: "info",
        message: "请先选择可下载的远程项目。",
      },
    });

    expect(
      buildDownloadSelectionPlan({
        emptyMessage: "请先选择可下载的远程项目。",
        entries: [
          entry("/var/log/current", "symlink", "current"),
          entry("/run/app.sock", "other", "app.sock"),
        ],
      }),
    ).toEqual({
      entry: entry("/var/log/current", "symlink", "current"),
      kind: "single",
    });

    expect(
      buildDownloadSelectionPlan({
        emptyMessage: "请先选择可下载的远程项目。",
        entries: [
          entry("/var/log", "directory", "log"),
          entry("/var/log/app.log", "file", "app.log"),
          entry("/run/app.sock", "other", "app.sock"),
        ],
      }),
    ).toEqual({
      entries: [
        entry("/var/log", "directory", "log"),
        entry("/var/log/app.log", "file", "app.log"),
      ],
      kind: "batch",
    });

    expect(
      buildDownloadTransferPlan({
        entry: entry("/var/log/app.log", "file", "app.log"),
        hostId: "prod-api",
        localPath: "/Users/me/Downloads/app.log",
      }),
    ).toEqual({
      queuedStatus: {
        kind: "info",
        message: "已加入下载队列：/var/log/app.log",
      },
      request: {
        direction: "download",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/Downloads/app.log",
        remotePath: "/var/log/app.log",
      },
    });

    expect(
      buildDownloadTransferPlan({
        entry: entry("/var/log/current", "symlink", "current"),
        hostId: "prod-api",
        localPath: "/Users/me/Downloads/current",
      }),
    ).toMatchObject({
      request: {
        direction: "download",
        kind: "file",
        localPath: "/Users/me/Downloads/current",
        remotePath: "/var/log/current",
      },
    });

    expect(
      buildDownloadTransferPlan({
        entry: entry("/var/socket", "other", "socket"),
        hostId: "prod-api",
        localPath: "/Users/me/Downloads/socket",
      }),
    ).toBeNull();

    expect(
      buildBatchDownloadTransferPlan({
        entries: [
          entry("/var/log", "directory", "log"),
          entry("/var/log/app.log", "file", "app.log"),
          entry("/var/socket", "other", "socket"),
        ],
        fileTargetKind: "ssh",
        hostId: "prod-api",
        selectedDirectory: "/Users/me/Downloads",
      }),
    ).toEqual({
      completionStatus: {
        kind: "info",
        message: "已加入批量下载队列：2 个远程项目 -> /Users/me/Downloads",
      },
      items: [
        {
          queuedStatus: {
            kind: "info",
            message: "已加入文件夹下载队列：/var/log",
          },
          request: {
            direction: "download",
            hostId: "prod-api",
            kind: "directory",
            localPath: "/Users/me/Downloads/log",
            remotePath: "/var/log",
          },
        },
        {
          queuedStatus: {
            kind: "info",
            message: "已加入下载队列：/var/log/app.log",
          },
          request: {
            direction: "download",
            hostId: "prod-api",
            kind: "file",
            localPath: "/Users/me/Downloads/app.log",
            remotePath: "/var/log/app.log",
          },
        },
      ],
    });

    expect(
      buildBatchDownloadTransferPlan({
        entries: [
          entry("/var/socket", "other", "socket"),
        ],
        fileTargetKind: "ssh",
        hostId: "prod-api",
        selectedDirectory: "/Users/me/Downloads",
      }),
    ).toEqual({
      completionStatus: null,
      items: [],
    });

    expect(
      buildDirectoryDownloadTransferPlan({
        entry: entry("/var/log", "directory", "log"),
        hostId: "prod-api",
        selectedDirectory: "C:\\Users\\me\\Downloads\\",
      })?.request.localPath,
    ).toBe("C:\\Users\\me\\Downloads\\log");
  });

  it("passes download conflict policies through transfer requests", () => {
    expect(
      buildDownloadTransferPlan({
        conflictPolicy: "skip",
        entry: entry("/var/log/app.log", "file", "app.log"),
        hostId: "prod-api",
        localPath: "/Users/me/Downloads/app.log",
      })?.request.conflictPolicy,
    ).toBe("skip");

    expect(
      buildDirectoryDownloadTransferPlan({
        conflictPolicy: "rename",
        entry: entry("/var/log", "directory", "log"),
        hostId: "prod-api",
        selectedDirectory: "/Users/me/Downloads",
      })?.request.conflictPolicy,
    ).toBe("rename");
  });

  it("passes batch download conflict policies through transfer requests", () => {
    expect(
      buildBatchDownloadTransferPlan({
        conflictPolicy: "rename",
        entries: [
          entry("/var/log", "directory", "log"),
          entry("/var/log/app.log", "file", "app.log"),
        ],
        fileTargetKind: "ssh",
        hostId: "prod-api",
        selectedDirectory: "/Users/me/Downloads",
      }).items.map((item) => item.request.conflictPolicy),
    ).toEqual(["rename", "rename"]);
  });

  it("plans archive download, local clipboard download, and archive upload requests", () => {
    const remoteFile = entry("/var/log/app.log", "file", "app.log");
    const unsupported = entry("/var/socket", "other", "socket");

    expect(sftpArchiveDownloadFileNameFor(remoteFile)).toBe("app.log.zip");
    expect(buildSftpArchiveDownloadPreparation(remoteFile)).toEqual({
      defaultLocalFileName: "app.log.zip",
      kind: "ready",
    });
    expect(buildSftpArchiveDownloadPreparation(unsupported)).toEqual({
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持下载为 ZIP。",
      },
    });
    expect(
      buildSftpArchiveDownloadPlan({
        conflictPolicy: "rename",
        entry: remoteFile,
        hostId: "prod-api",
        targetLocalPath: "C:\\Users\\me\\Downloads\\app.log.zip",
      }),
    ).toEqual({
      errorMessagePrefix: "下载为 ZIP 失败",
      kind: "ready",
      queuedStatus: {
        kind: "info",
        message: "已加入 ZIP 下载队列：/var/log/app.log",
      },
      request: {
        conflictPolicy: "rename",
        hostId: "prod-api",
        kind: "file",
        sourceRemotePath: "/var/log/app.log",
        targetLocalPath: "C:\\Users\\me\\Downloads\\app.log.zip",
      },
    });
    expect(
      buildSftpArchiveDownloadPlan({
        entry: unsupported,
        hostId: "prod-api",
        targetLocalPath: "C:\\Users\\me\\Downloads\\socket.zip",
      }),
    ).toEqual({
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持下载为 ZIP。",
      },
    });

    expect(
      buildSftpClipboardDownloadPlan({
        entry: remoteFile,
        hostId: "prod-api",
      }),
    ).toEqual({
      errorMessagePrefix: "下载到本地剪贴板失败",
      kind: "ready",
      queuedStatus: {
        kind: "info",
        message: "已加入本地剪贴板下载队列：/var/log/app.log",
      },
      request: {
        hostId: "prod-api",
        kind: "file",
        sourceRemotePath: "/var/log/app.log",
      },
    });
    expect(
      buildSftpClipboardDownloadPlan({
        entry: unsupported,
        hostId: "prod-api",
      }),
    ).toEqual({
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持下载到本地剪贴板。",
      },
    });

    expect(
      buildSftpArchiveUploadPlan({
        conflictPolicy: "skip",
        destinationRemotePath: "/opt/releases",
        hostId: "prod-api",
        kind: "directory",
        sourceLocalPath: "/Users/me/dist",
      }),
    ).toEqual({
      errorMessagePrefix: "上传为 ZIP 失败",
      queuedStatus: {
        kind: "info",
        message: "已加入 ZIP 上传队列：dist -> /opt/releases/dist.zip",
      },
      request: {
        conflictPolicy: "skip",
        hostId: "prod-api",
        kind: "directory",
        sourceLocalPath: "/Users/me/dist",
        targetRemotePath: "/opt/releases/dist.zip",
      },
    });
  });

  it("plans Docker direct transfer requests, statuses, and refresh boundaries", () => {
    const upload = buildFileUploadTransferPlan({
      hostId: "prod-api",
      localPath: "/Users/me/release.tgz",
      targetRemotePath: "/app",
    }).request;
    const download = {
      direction: "download" as const,
      hostId: "prod-api",
      kind: "file" as const,
      localPath: "/Users/me/Downloads/package.json",
      remotePath: "/app/package.json",
    };

    expect(buildDockerContainerTransferRequest(containerTarget, upload)).toEqual({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/app/release.tgz",
      runtime: "docker",
    });
    expect(statusForDockerDirectTransfer(upload, "running")).toEqual({
      kind: "info",
      message: "正在上传：release.tgz",
    });
    expect(statusForDockerDirectTransfer(upload, "success")).toEqual({
      kind: "success",
      message: "已上传：release.tgz",
    });
    expect(statusForDockerDirectTransfer(download, "running")).toEqual({
      kind: "info",
      message: "正在下载：/app/package.json",
    });
    expect(statusForDockerDirectTransfer(download, "success")).toEqual({
      kind: "success",
      message: "已下载：/app/package.json",
    });
    expect(shouldRefreshAfterDockerUpload(upload, "/app")).toBe(true);
    expect(shouldRefreshAfterDockerUpload(upload, "/")).toBe(false);
    expect(shouldRefreshAfterDockerUpload(download, "/app")).toBe(false);
  });

  it("keeps Docker directory and batch plans as direct transfer operations", () => {
    const directoryUpload = buildDirectoryUploadTransferPlan({
      hostId: "prod-api",
      localPath: "/Users/me/dist",
      targetRemotePath: "/app",
    }).request;
    const batchDownload = buildBatchDownloadTransferPlan({
      entries: [
        entry("/app/logs", "directory", "logs"),
        entry("/app/package.json", "file", "package.json"),
      ],
      fileTargetKind: "dockerContainer",
      hostId: "prod-api",
      selectedDirectory: "/Users/me/Downloads",
    });
    const droppedUpload = buildLocalPathBatchUploadPlan({
      fileTargetKind: "dockerContainer",
      hostId: "prod-api",
      localPaths: [
        { kind: "file", path: "/Users/me/release.tgz" },
        { kind: "directory", path: "/Users/me/dist" },
      ],
      sourceLabel: "拖拽",
      targetRemotePath: "/app",
    });

    expect(buildDockerContainerTransferRequest(containerTarget, directoryUpload)).toEqual({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/dist",
      remotePath: "/app/dist",
      runtime: "docker",
    });
    expect(batchDownload).toMatchObject({
      completionStatus: {
        kind: "success",
        message: "已完成批量下载：2 个远程项目 -> /Users/me/Downloads",
      },
      items: [
        { request: { direction: "download", kind: "directory" } },
        { request: { direction: "download", kind: "file" } },
      ],
    });
    expect(
      batchDownload.items.map((item) =>
        buildDockerContainerTransferRequest(containerTarget, item.request),
      ),
    ).toEqual([
      {
        containerId: "container-api",
        hostId: "prod-api",
        kind: "directory",
        localPath: "/Users/me/Downloads/logs",
        remotePath: "/app/logs",
        runtime: "docker",
      },
      {
        containerId: "container-api",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/Downloads/package.json",
        remotePath: "/app/package.json",
        runtime: "docker",
      },
    ]);
    expect(droppedUpload.completionStatus).toEqual({
      kind: "success",
      message: "已完成拖拽上传：2 个本地项目 -> /app",
    });
  });
});
