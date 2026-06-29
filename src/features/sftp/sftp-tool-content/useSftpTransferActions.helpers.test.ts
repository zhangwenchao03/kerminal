import { describe, expect, it, vi } from "vitest";
import type {
  SftpArchiveDownloadRequest,
  SftpArchiveUploadRequest,
  SftpTransferSummary,
} from "../../../lib/sftpApi";
import {
  runSftpArchiveDownloadPlanWithPreflight,
  runSftpArchiveUploadPlanWithPreflight,
} from "./useSftpTransferActions.helpers";

const sftpApiMock = vi.hoisted(() => ({
  enqueueSftpArchiveDownload: vi.fn(),
  enqueueSftpArchiveUpload: vi.fn(),
}));

vi.mock("../../../lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/sftpApi")>(
    "../../../lib/sftpApi",
  );
  return {
    ...actual,
    enqueueSftpArchiveDownload: sftpApiMock.enqueueSftpArchiveDownload,
    enqueueSftpArchiveUpload: sftpApiMock.enqueueSftpArchiveUpload,
  };
});

describe("useSftpTransferActions helpers", () => {
  it("replays archive downloads with the confirmed conflict policy", async () => {
    const setOperationStatus = vi.fn();
    const setTransfers = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    sftpApiMock.enqueueSftpArchiveDownload.mockResolvedValue(
      transferSummary({ id: "archive-download" }),
    );
    const runWithConflictPreflight = vi
      .fn()
      .mockImplementation(async ({ run }) => run("rename"));

    await runSftpArchiveDownloadPlanWithPreflight({
      buildPlan: (conflictPolicy) => ({
        errorMessagePrefix: "下载为 ZIP 失败",
        kind: "ready",
        queuedStatus: { kind: "info", message: "queued" },
        request: archiveDownloadRequest(conflictPolicy),
      }),
      refreshTransfers,
      runWithConflictPreflight,
      setOperationStatus,
      setTransfers,
      viewScope: "sftp-workbench:tab-a",
    });

    expect(runWithConflictPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessagePrefix: "下载为 ZIP 失败",
        input: archiveDownloadRequest(),
      }),
    );
    expect(sftpApiMock.enqueueSftpArchiveDownload).toHaveBeenCalledWith({
      ...archiveDownloadRequest("rename"),
      viewScope: "sftp-workbench:tab-a",
    });
    expect(setOperationStatus).toHaveBeenCalledWith(null);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
    expect(setTransfers).toHaveBeenCalledTimes(1);
  });

  it("replays archive uploads with the confirmed conflict policy", async () => {
    const setOperationStatus = vi.fn();
    const setTransfers = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    sftpApiMock.enqueueSftpArchiveUpload.mockResolvedValue(
      transferSummary({ id: "archive-upload" }),
    );
    const runWithConflictPreflight = vi
      .fn()
      .mockImplementation(async ({ run }) => run("skip"));

    await runSftpArchiveUploadPlanWithPreflight({
      buildPlan: (conflictPolicy) => ({
        errorMessagePrefix: "上传为 ZIP 失败",
        queuedStatus: { kind: "info", message: "queued" },
        request: archiveUploadRequest(conflictPolicy),
      }),
      refreshTransfers,
      runWithConflictPreflight,
      setOperationStatus,
      setTransfers,
      viewScope: "sftp-workbench:tab-b",
    });

    expect(runWithConflictPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessagePrefix: "上传为 ZIP 失败",
        input: archiveUploadRequest(),
      }),
    );
    expect(sftpApiMock.enqueueSftpArchiveUpload).toHaveBeenCalledWith({
      ...archiveUploadRequest("skip"),
      viewScope: "sftp-workbench:tab-b",
    });
    expect(setOperationStatus).toHaveBeenCalledWith(null);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
    expect(setTransfers).toHaveBeenCalledTimes(1);
  });
});

function archiveDownloadRequest(
  conflictPolicy: SftpArchiveDownloadRequest["conflictPolicy"] = "overwrite",
): SftpArchiveDownloadRequest {
  return {
    conflictPolicy,
    hostId: "prod-api",
    kind: "file",
    sourceRemotePath: "/srv/app.log",
    targetLocalPath: "C:/downloads/app.log.zip",
  };
}

function archiveUploadRequest(
  conflictPolicy: SftpArchiveUploadRequest["conflictPolicy"] = "overwrite",
): SftpArchiveUploadRequest {
  return {
    conflictPolicy,
    hostId: "prod-api",
    kind: "directory",
    sourceLocalPath: "C:/tmp/dist",
    targetRemotePath: "/srv/dist.zip",
  };
}

function transferSummary(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 1,
    direction: "download",
    hostId: "prod-api",
    id: "transfer-1",
    kind: "file",
    localPath: "C:/downloads/app.log.zip",
    operation: "download",
    remotePath: "/srv/app.log",
    source: {
      hostId: "prod-api",
      hostLabel: "prod-api",
      kind: "remote",
      path: "/srv/app.log",
    },
    status: "queued",
    target: {
      kind: "local",
      path: "C:/downloads/app.log.zip",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}
