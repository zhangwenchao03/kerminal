/**
 * SFTP remote copy queue facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../../lib/sftpApi";
import type { SftpRemoteCopyPlan } from "./sftpRemoteTransferModel";
import { useSftpRemoteCopyTaskRunner } from "./useSftpRemoteCopyTaskRunner";

const sftpApiMock = vi.hoisted(() => ({
  enqueueSftpRemoteCopy: vi.fn(),
}));

vi.mock("../../../lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/sftpApi")>(
    "../../../lib/sftpApi",
  );
  return {
    ...actual,
    enqueueSftpRemoteCopy: sftpApiMock.enqueueSftpRemoteCopy,
  };
});

const remoteCopyPlan: SftpRemoteCopyPlan = {
  destinationRemotePath: "/backup",
  requests: [
    {
      kind: "file",
      sourceHostId: "host-left",
      sourceRemotePath: "/srv/app.log",
      targetHostId: "host-right",
      targetRemotePath: "/backup/app.log",
    },
    {
      kind: "directory",
      sourceHostId: "host-left",
      sourceRemotePath: "/srv/conf",
      targetHostId: "host-right",
      targetRemotePath: "/backup/conf",
    },
  ],
  statusMessage: "已加入跨主机传输队列：Left Host app.log、conf -> /backup",
  targetDescription: "跨主机传输",
};

describe("useSftpRemoteCopyTaskRunner", () => {
  beforeEach(() => {
    sftpApiMock.enqueueSftpRemoteCopy.mockReset();
  });

  it("queues every remote copy request and refreshes the transfer list once", async () => {
    const firstSummary = transferSummary({
      createdAt: 1,
      id: "transfer-old",
      remotePath: "/backup/app.log",
    });
    const secondSummary = transferSummary({
      createdAt: 3,
      id: "transfer-new",
      kind: "directory",
      remotePath: "/backup/conf",
    });
    sftpApiMock.enqueueSftpRemoteCopy
      .mockResolvedValueOnce(firstSummary)
      .mockResolvedValueOnce(secondSummary);

    const transfersRef = {
      current: [
        transferSummary({
          createdAt: 2,
          id: "existing",
          remotePath: "/backup/old.log",
        }),
      ],
    };
    const setOperationStatus = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSftpRemoteCopyTaskRunner({
        refreshTransfers,
        setOperationStatus,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.runRemoteCopyTask(remoteCopyPlan);
    });

    expect(sftpApiMock.enqueueSftpRemoteCopy).toHaveBeenNthCalledWith(
      1,
      remoteCopyPlan.requests[0],
    );
    expect(sftpApiMock.enqueueSftpRemoteCopy).toHaveBeenNthCalledWith(
      2,
      remoteCopyPlan.requests[1],
    );
    expect(setTransfers).toHaveBeenCalledTimes(2);
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-new",
      "existing",
      "transfer-old",
    ]);
    expect(setOperationStatus).toHaveBeenLastCalledWith(null);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
  });

  it("injects the active view scope into every remote copy request", async () => {
    sftpApiMock.enqueueSftpRemoteCopy
      .mockResolvedValueOnce(transferSummary({ id: "first" }))
      .mockResolvedValueOnce(transferSummary({ id: "second" }));

    const transfersRef = { current: [] as SftpTransferSummary[] };
    const { result } = renderHook(() =>
      useSftpRemoteCopyTaskRunner({
        refreshTransfers: vi.fn().mockResolvedValue(undefined),
        setOperationStatus: vi.fn(),
        setTransfers: createTransferSetter(transfersRef),
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await act(async () => {
      await result.current.runRemoteCopyTask(remoteCopyPlan);
    });

    expect(sftpApiMock.enqueueSftpRemoteCopy).toHaveBeenNthCalledWith(1, {
      ...remoteCopyPlan.requests[0],
      viewScope: "sftp-workbench:tab-a",
    });
    expect(sftpApiMock.enqueueSftpRemoteCopy).toHaveBeenNthCalledWith(2, {
      ...remoteCopyPlan.requests[1],
      viewScope: "sftp-workbench:tab-a",
    });
  });

  it("reports an empty plan without enqueueing or refreshing", async () => {
    const setOperationStatus = vi.fn();
    const setTransfers = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSftpRemoteCopyTaskRunner({
        refreshTransfers,
        setOperationStatus,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.runRemoteCopyTask({
        ...remoteCopyPlan,
        requests: [],
      });
    });

    expect(sftpApiMock.enqueueSftpRemoteCopy).not.toHaveBeenCalled();
    expect(setTransfers).not.toHaveBeenCalled();
    expect(refreshTransfers).not.toHaveBeenCalled();
    expect(setOperationStatus).toHaveBeenCalledWith({
      kind: "info",
      message: "没有可入队的远程传输项目。",
    });
  });

  it("keeps queued summaries and reports a prefixed failure when enqueue fails", async () => {
    const firstSummary = transferSummary({ id: "transfer-queued" });
    sftpApiMock.enqueueSftpRemoteCopy
      .mockResolvedValueOnce(firstSummary)
      .mockRejectedValueOnce(new Error("connection lost"));

    const transfersRef = { current: [] as SftpTransferSummary[] };
    const setOperationStatus = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSftpRemoteCopyTaskRunner({
        refreshTransfers,
        setOperationStatus,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.runRemoteCopyTask(remoteCopyPlan);
    });

    expect(setTransfers).toHaveBeenCalledTimes(1);
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-queued",
    ]);
    expect(refreshTransfers).not.toHaveBeenCalled();
    expect(setOperationStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: "跨主机传输入队失败：connection lost",
    });
  });
});

function createTransferSetter(transfersRef: { current: SftpTransferSummary[] }) {
  return vi.fn((value: SetStateAction<SftpTransferSummary[]>) => {
    transfersRef.current =
      typeof value === "function" ? value(transfersRef.current) : value;
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
    hostId: "host-right",
    id: "transfer-1",
    kind: "file",
    localPath: "",
    remotePath: "/backup/app.log",
    status: "queued",
    updatedAt: 1,
    ...overrides,
  };
}
