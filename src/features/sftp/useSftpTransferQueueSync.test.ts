/**
 * SFTP transfer queue sync facade tests.
 *
 * @author kongweiguang
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import { useSftpTransferQueueSync } from "./useSftpTransferQueueSync";

const sftpApiMock = vi.hoisted(() => ({
  listSftpTransfers: vi.fn(),
}));

vi.mock("../../lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/sftpApi")>(
    "../../lib/sftpApi",
  );
  return {
    ...actual,
    listSftpTransfers: sftpApiMock.listSftpTransfers,
  };
});

describe("useSftpTransferQueueSync", () => {
  beforeEach(() => {
    sftpApiMock.listSftpTransfers.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll while inactive", async () => {
    renderHook(() => useSftpTransferQueueSync({ active: false }));

    await flushEffects();

    expect(sftpApiMock.listSftpTransfers).not.toHaveBeenCalled();
  });

  it("loads and sorts the transfer queue on mount", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      transferSummary({ createdAt: 1, id: "older" }),
      transferSummary({ createdAt: 10, id: "newer" }),
    ]);

    const { result } = renderHook(() =>
      useSftpTransferQueueSync({ active: true }),
    );

    await waitFor(() => {
      expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
        "newer",
        "older",
      ]);
    });
    expect(result.current.queueError).toBeNull();
  });

  it("loads only the active view scope when a queue scope is provided", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      transferSummary({
        id: "current-scope",
        viewScope: "sftp-workbench:tab-a",
      }),
    ]);

    const { result } = renderHook(() =>
      useSftpTransferQueueSync({
        active: true,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await waitFor(() => {
      expect(sftpApiMock.listSftpTransfers).toHaveBeenCalledWith({
        viewScope: "sftp-workbench:tab-a",
      });
      expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
        "current-scope",
      ]);
    });
  });

  it("keeps the current queue and reports polling failures", async () => {
    vi.useFakeTimers();
    sftpApiMock.listSftpTransfers
      .mockResolvedValueOnce([transferSummary({ id: "running" })])
      .mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() =>
      useSftpTransferQueueSync({ active: true, pollIntervalMs: 1000 }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
      "running",
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.queueError).toBe("offline");
    expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
      "running",
    ]);
  });

  it("merges transfer events and unlistens on cleanup", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([]);
    const unlisten = vi.fn();
    let updateHandler: ((transfer: SftpTransferSummary) => void) | undefined;
    const eventChannelAvailable = () => true;
    const listenToUpdates = vi.fn(async (handler) => {
      updateHandler = handler;
      return unlisten;
    });

    const { result, unmount } = renderHook(() =>
      useSftpTransferQueueSync({
        active: true,
        eventChannelAvailable,
        listenToUpdates,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await waitFor(() => {
      expect(listenToUpdates).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    act(() => {
      updateHandler?.(transferSummary({ id: "event-transfer", updatedAt: 5 }));
    });
    expect(result.current.transfers).toEqual([]);

    act(() => {
      updateHandler?.(
        transferSummary({
          id: "event-transfer",
          updatedAt: 5,
          viewScope: "sftp-workbench:tab-a",
        }),
      );
    });

    expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
      "event-transfer",
    ]);

    unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
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
