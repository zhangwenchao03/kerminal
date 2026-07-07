/**
 * SFTP transfer task strategy facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../../../../src/lib/sftpApi";
import type { SftpTransferActionItem } from "../../../../../src/features/sftp/sftp-tool-content/sftpTransferActionPlan";
import type { SftpFileTarget } from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpTransferTaskRunner } from "../../../../../src/features/sftp/sftp-tool-content/useSftpTransferTaskRunner";

const containerFilesApiMock = vi.hoisted(() => ({
  downloadDockerContainerPath: vi.fn(),
  uploadDockerContainerPath: vi.fn(),
}));
const sftpApiMock = vi.hoisted(() => ({
  enqueueSftpTransfer: vi.fn(),
}));

vi.mock("../../../../../src/lib/containerFilesApi", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../../src/lib/containerFilesApi")>(
      "../../../../../src/lib/containerFilesApi",
    );
  return {
    ...actual,
    downloadDockerContainerPath: containerFilesApiMock.downloadDockerContainerPath,
    uploadDockerContainerPath: containerFilesApiMock.uploadDockerContainerPath,
  };
});

vi.mock("../../../../../src/lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../../src/lib/sftpApi")>(
    "../../../../../src/lib/sftpApi",
  );
  return {
    ...actual,
    enqueueSftpTransfer: sftpApiMock.enqueueSftpTransfer,
  };
});

const uploadTransferPlan: SftpTransferActionItem = {
  queuedStatus: {
    kind: "info",
    message: "已加入上传队列：release.tgz",
  },
  request: {
    conflictPolicy: "overwrite",
    direction: "upload",
    hostId: "prod-api",
    kind: "file",
    localPath: "/Users/me/release.tgz",
    remotePath: "/app/release.tgz",
  },
};

const sshTarget: Extract<SftpFileTarget, { kind: "ssh" }> = {
  hostId: "prod-api",
  initialPath: "/app",
  kind: "ssh",
  protocol: "sftp://",
  summary: "deploy@prod",
};

const containerTarget: Extract<SftpFileTarget, { kind: "dockerContainer" }> = {
  containerId: "container-api",
  containerName: "api",
  hostId: "prod-api",
  initialPath: "/app",
  kind: "dockerContainer",
  protocol: "container://",
  runtime: "docker",
  summary: "docker:prod-api:api",
};

describe("useSftpTransferTaskRunner", () => {
  beforeEach(() => {
    containerFilesApiMock.downloadDockerContainerPath.mockReset();
    containerFilesApiMock.uploadDockerContainerPath.mockReset();
    sftpApiMock.enqueueSftpTransfer.mockReset();
  });

  it("queues SSH transfers and refreshes transfer summaries", async () => {
    const queuedSummary = transferSummary({ id: "queued-upload" });
    sftpApiMock.enqueueSftpTransfer.mockResolvedValue(queuedSummary);

    const transfersRef = { current: [] as SftpTransferSummary[] };
    const setOperationStatus = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);
    const loadDirectory = vi.fn().mockResolvedValue(undefined);
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSftpTransferTaskRunner({
        currentPath: "/app",
        fileTarget: sshTarget,
        loadDirectory,
        refreshTransfers,
        setOperationStatus,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.runTransferTask(uploadTransferPlan);
    });

    expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenCalledWith(
      uploadTransferPlan.request,
    );
    expect(containerFilesApiMock.uploadDockerContainerPath).not.toHaveBeenCalled();
    expect(containerFilesApiMock.downloadDockerContainerPath).not.toHaveBeenCalled();
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "queued-upload",
    ]);
    expect(setOperationStatus).toHaveBeenLastCalledWith(null);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it("injects the active view scope into queued SSH transfers", async () => {
    sftpApiMock.enqueueSftpTransfer.mockResolvedValue(
      transferSummary({ id: "queued-upload" }),
    );

    const transfersRef = { current: [] as SftpTransferSummary[] };
    const { result } = renderHook(() =>
      useSftpTransferTaskRunner({
        currentPath: "/app",
        fileTarget: sshTarget,
        loadDirectory: vi.fn().mockResolvedValue(undefined),
        refreshTransfers: vi.fn().mockResolvedValue(undefined),
        setOperationStatus: vi.fn(),
        setTransfers: createTransferSetter(transfersRef),
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await act(async () => {
      await result.current.runTransferTask(uploadTransferPlan);
    });

    expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenCalledWith({
      ...uploadTransferPlan.request,
      viewScope: "sftp-workbench:tab-a",
    });
  });

  it("runs Docker uploads directly and refreshes the current directory after success", async () => {
    containerFilesApiMock.uploadDockerContainerPath.mockResolvedValue(undefined);

    const setOperationStatus = vi.fn();
    const transferSnapshots: SftpTransferSummary[][] = [];
    const transfersRef = { current: [] as SftpTransferSummary[] };
    const setTransfers = createTransferSetter(transfersRef, transferSnapshots);
    const loadDirectory = vi.fn().mockResolvedValue(undefined);
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSftpTransferTaskRunner({
        currentPath: "/app",
        fileTarget: containerTarget,
        loadDirectory,
        refreshTransfers,
        setOperationStatus,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.runTransferTask(uploadTransferPlan);
    });

    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(containerFilesApiMock.uploadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/app/release.tgz",
      runtime: "docker",
    });
    expect(loadDirectory).toHaveBeenCalledWith("/app");
    expect(refreshTransfers).not.toHaveBeenCalled();
    expect(setOperationStatus).toHaveBeenCalledWith(null);
    expect(setTransfers).toHaveBeenCalledTimes(2);
    expect(transferSnapshots[0][0]).toMatchObject({
      currentItem: "release.tgz",
      direction: "upload",
      hostId: "container:prod-api:container-api",
      operation: "upload",
      phase: "uploading",
      remotePath: "/app/release.tgz",
      status: "running",
      target: {
        hostId: "container:prod-api:container-api",
        hostLabel: "api",
        kind: "remote",
        path: "/app/release.tgz",
      },
      totalBytes: null,
      transportMode: "clientBridge",
    });
    expect(transfersRef.current[0]).toMatchObject({
      currentItem: "release.tgz",
      direction: "upload",
      hostId: "container:prod-api:container-api",
      operation: "upload",
      phase: null,
      status: "succeeded",
      totalBytes: null,
      transportMode: "clientBridge",
    });
    expect(transfersRef.current[0].id).toBe(transferSnapshots[0][0].id);
  });

  it("keeps Docker upload failures visible to the caller without success cleanup", async () => {
    containerFilesApiMock.uploadDockerContainerPath.mockRejectedValue(
      new Error("copy failed"),
    );

    const setOperationStatus = vi.fn();
    const transferSnapshots: SftpTransferSummary[][] = [];
    const transfersRef = { current: [] as SftpTransferSummary[] };
    const setTransfers = createTransferSetter(transfersRef, transferSnapshots);
    const loadDirectory = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSftpTransferTaskRunner({
        currentPath: "/app",
        fileTarget: containerTarget,
        loadDirectory,
        refreshTransfers: vi.fn().mockResolvedValue(undefined),
        setOperationStatus,
        setTransfers,
      }),
    );

    await expect(
      act(async () => {
        await result.current.runTransferTask(uploadTransferPlan);
      }),
    ).rejects.toThrow("copy failed");

    expect(loadDirectory).not.toHaveBeenCalled();
    expect(setOperationStatus).toHaveBeenCalledWith(null);
    expect(setTransfers).toHaveBeenCalledTimes(2);
    expect(transferSnapshots[0][0]).toMatchObject({
      currentItem: "release.tgz",
      direction: "upload",
      phase: "uploading",
      status: "running",
    });
    expect(transfersRef.current[0]).toMatchObject({
      currentItem: "release.tgz",
      direction: "upload",
      error: "copy failed",
      phase: null,
      status: "failed",
    });
    expect(transfersRef.current[0].id).toBe(transferSnapshots[0][0].id);
  });
});

function createTransferSetter(
  transfersRef: { current: SftpTransferSummary[] },
  snapshots: SftpTransferSummary[][] = [],
) {
  return vi.fn((value: SetStateAction<SftpTransferSummary[]>) => {
    transfersRef.current =
      typeof value === "function" ? value(transfersRef.current) : value;
    snapshots.push(transfersRef.current);
  });
}

function transferSummary(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 1,
    direction: "upload",
    hostId: "prod-api",
    id: "transfer-1",
    kind: "file",
    localPath: "/Users/me/release.tgz",
    operation: "upload",
    remotePath: "/app/release.tgz",
    source: {
      kind: "local",
      path: "/Users/me/release.tgz",
    },
    status: "queued",
    target: {
      hostId: "prod-api",
      hostLabel: "prod-api",
      kind: "remote",
      path: "/app/release.tgz",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}
