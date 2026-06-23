/**
 * SFTP managed transfer queue facade tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import { useSftpManagedTransferQueue } from "./useSftpManagedTransferQueue";

const sftpApiMock = vi.hoisted(() => ({
  cancelSftpTransfer: vi.fn(),
  clearCompletedSftpTransfers: vi.fn(),
}));

vi.mock("../../lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/sftpApi")>(
    "../../lib/sftpApi",
  );
  return {
    ...actual,
    cancelSftpTransfer: sftpApiMock.cancelSftpTransfer,
    clearCompletedSftpTransfers: sftpApiMock.clearCompletedSftpTransfers,
  };
});

describe("useSftpManagedTransferQueue", () => {
  beforeEach(() => {
    sftpApiMock.cancelSftpTransfer.mockReset();
    sftpApiMock.clearCompletedSftpTransfers.mockReset();
  });

  it("upserts a canceled transfer, reports success, and refreshes the queue", async () => {
    const canceledTransfer = transferSummary({
      cancelRequested: true,
      id: "transfer-running",
      status: "canceled",
      updatedAt: 5,
    });
    sftpApiMock.cancelSftpTransfer.mockResolvedValue(canceledTransfer);
    const transfersRef = {
      current: [
        transferSummary({ createdAt: 10, id: "transfer-new" }),
        transferSummary({ createdAt: 1, id: "transfer-running" }),
      ],
    };
    const onCancelSuccess = vi.fn();
    const onError = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onCancelSuccess,
        onError,
        refreshTransfers,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.cancelTransfer("transfer-running");
    });

    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith({
      transferId: "transfer-running",
    });
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-new",
      "transfer-running",
    ]);
    expect(transfersRef.current[1]).toMatchObject({
      cancelRequested: true,
      status: "canceled",
    });
    expect(onCancelSuccess).toHaveBeenCalledWith(canceledTransfer);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports cancel failures without mutating or refreshing the queue", async () => {
    sftpApiMock.cancelSftpTransfer.mockRejectedValue(new Error("offline"));
    const transfersRef = { current: [transferSummary()] };
    const onCancelSuccess = vi.fn();
    const onError = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onCancelSuccess,
        onError,
        refreshTransfers,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.cancelTransfer("transfer-running");
    });

    expect(setTransfers).not.toHaveBeenCalled();
    expect(onCancelSuccess).not.toHaveBeenCalled();
    expect(refreshTransfers).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(new Error("offline"));
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-1",
    ]);
  });

  it("replaces the queue with sorted clear-completed results", async () => {
    const remainingRunningTransfer = transferSummary({
      createdAt: 1,
      id: "transfer-running",
      status: "running",
    });
    const newerQueuedTransfer = transferSummary({
      createdAt: 10,
      id: "transfer-queued",
      status: "queued",
    });
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([
      remainingRunningTransfer,
      newerQueuedTransfer,
    ]);
    const transfersRef = {
      current: [
        transferSummary({ id: "transfer-finished", status: "succeeded" }),
      ],
    };
    const onClearSuccess = vi.fn();
    const onError = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onClearSuccess,
        onError,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.clearFinishedTransfers();
    });

    expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalledTimes(1);
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-running",
      "transfer-queued",
    ]);
    expect(onClearSuccess).toHaveBeenCalledWith(transfersRef.current);
    expect(onError).not.toHaveBeenCalled();
  });

  it("scopes cancel and clear mutations to the active transfer view", async () => {
    const canceledTransfer = transferSummary({
      id: "transfer-running",
      status: "canceled",
      viewScope: "sftp-workbench:tab-a",
    });
    sftpApiMock.cancelSftpTransfer.mockResolvedValue(canceledTransfer);
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([]);
    const transfersRef = {
      current: [transferSummary({ id: "transfer-running" })],
    };
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        setTransfers,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await act(async () => {
      await result.current.cancelTransfer("transfer-running");
      await result.current.clearFinishedTransfers();
    });

    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith({
      transferId: "transfer-running",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalledWith({
      viewScope: "sftp-workbench:tab-a",
    });
  });

  it("reports clear failures without replacing the queue", async () => {
    sftpApiMock.clearCompletedSftpTransfers.mockRejectedValue(
      new Error("clear failed"),
    );
    const transfersRef = { current: [transferSummary()] };
    const onClearSuccess = vi.fn();
    const onError = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onClearSuccess,
        onError,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.clearFinishedTransfers();
    });

    expect(setTransfers).not.toHaveBeenCalled();
    expect(onClearSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(new Error("clear failed"));
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-1",
    ]);
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
    localPath: "/tmp/source.log",
    remotePath: "/srv/source.log",
    status: "queued",
    updatedAt: 1,
    ...overrides,
  };
}
