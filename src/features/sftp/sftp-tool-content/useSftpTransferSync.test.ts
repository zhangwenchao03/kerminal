/**
 * SFTP transfer sync hook facade tests.
 *
 * @author kongweiguang
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../../lib/sftpApi";
import type { SftpFileTarget } from "./types";
import { useSftpTransferSync } from "./useSftpTransferSync";

const sftpApiMock = vi.hoisted(() => ({
  listSftpTransfers: vi.fn(),
}));

const dragDropModelMock = vi.hoisted(() => ({
  isRunningInTauriWebview: vi.fn(),
}));

const eventApiMock = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("../../../lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/sftpApi")>(
    "../../../lib/sftpApi",
  );
  return {
    ...actual,
    listSftpTransfers: sftpApiMock.listSftpTransfers,
  };
});

vi.mock("./sftpDragDropModel", async () => {
  const actual = await vi.importActual<typeof import("./sftpDragDropModel")>(
    "./sftpDragDropModel",
  );
  return {
    ...actual,
    isRunningInTauriWebview: dragDropModelMock.isRunningInTauriWebview,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventApiMock.listen,
}));

describe("useSftpTransferSync", () => {
  beforeEach(() => {
    sftpApiMock.listSftpTransfers.mockReset();
    dragDropModelMock.isRunningInTauriWebview.mockReset();
    dragDropModelMock.isRunningInTauriWebview.mockReturnValue(false);
    eventApiMock.listen.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll without an active SSH target", async () => {
    const loadDirectory = vi.fn();
    const { result } = renderHook(() =>
      useSftpTransferSync({
        active: true,
        currentPath: "/srv/app",
        fileTarget: null,
        loadDirectory,
      }),
    );

    await flushEffects();
    await act(async () => {
      await result.current.refreshTransfers();
    });

    expect(sftpApiMock.listSftpTransfers).not.toHaveBeenCalled();
    expect(result.current.transfers).toEqual([]);
    expect(result.current.visibleTransfers).toEqual([]);
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it("polls and exposes only transfers for the active SSH host", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      transferSummary({ createdAt: 1, hostId: "host-a", id: "older-a" }),
      transferSummary({ createdAt: 10, hostId: "host-b", id: "newer-b" }),
      transferSummary({ createdAt: 5, hostId: "host-a", id: "newer-a" }),
    ]);
    const loadDirectory = vi.fn();

    const { result } = renderHook(() =>
      useSftpTransferSync({
        active: true,
        currentPath: "/srv/app",
        fileTarget: sshFileTarget({ hostId: "host-a" }),
        loadDirectory,
      }),
    );

    await waitFor(() => {
      expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
        "newer-b",
        "newer-a",
        "older-a",
      ]);
    });
    expect(result.current.visibleTransfers.map((transfer) => transfer.id)).toEqual([
      "newer-a",
      "older-a",
    ]);
  });

  it("loads and exposes only transfers for the active view scope", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      transferSummary({
        hostId: "host-a",
        id: "current-scope",
        viewScope: "sftp-workbench:tab-a",
      }),
      transferSummary({
        hostId: "host-a",
        id: "other-scope",
        viewScope: "sftp-workbench:tab-b",
      }),
      transferSummary({ hostId: "host-a", id: "legacy-scope" }),
    ]);
    const loadDirectory = vi.fn();

    const { result } = renderHook(() =>
      useSftpTransferSync({
        active: true,
        currentPath: "/srv/app",
        fileTarget: sshFileTarget({ hostId: "host-a" }),
        loadDirectory,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await waitFor(() => {
      expect(sftpApiMock.listSftpTransfers).toHaveBeenCalledWith({
        viewScope: "sftp-workbench:tab-a",
      });
      expect(result.current.visibleTransfers.map((transfer) => transfer.id)).toEqual([
        "current-scope",
      ]);
    });
  });

  it("reloads the current directory once for a completed upload", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      transferSummary({
        direction: "upload",
        hostId: "host-a",
        id: "upload-1",
        remotePath: "/srv/app/release.zip",
        status: "succeeded",
        viewScope: "sftp-workbench:tab-a",
      }),
    ]);
    const loadDirectory = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSftpTransferSync({
        active: true,
        currentPath: "/srv/app",
        fileTarget: sshFileTarget({ hostId: "host-a" }),
        loadDirectory,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await waitFor(() => {
      expect(loadDirectory).toHaveBeenCalledTimes(1);
    });
    expect(loadDirectory).toHaveBeenCalledWith("/srv/app");

    await act(async () => {
      await result.current.refreshTransfers();
    });
    await flushEffects();

    expect(loadDirectory).toHaveBeenCalledTimes(1);
  });

  it("merges Tauri transfer events for the active host and unlistens on cleanup", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([]);
    dragDropModelMock.isRunningInTauriWebview.mockReturnValue(true);
    const unlisten = vi.fn();
    let eventHandler:
      | ((event: { payload: SftpTransferSummary }) => void)
      | undefined;
    eventApiMock.listen.mockImplementation(async (_eventName, handler) => {
      eventHandler = handler;
      return unlisten;
    });
    const loadDirectory = vi.fn();

    const { result, unmount } = renderHook(() =>
      useSftpTransferSync({
        active: true,
        currentPath: "/srv/app",
        fileTarget: sshFileTarget({ hostId: "host-a" }),
        loadDirectory,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await waitFor(() => {
      expect(eventApiMock.listen).toHaveBeenCalledWith(
        "sftp-transfer-updated",
        expect.any(Function),
      );
    });

    act(() => {
      eventHandler?.({
        payload: transferSummary({ hostId: "host-b", id: "other-host" }),
      });
    });
    expect(result.current.transfers).toEqual([]);

    act(() => {
      eventHandler?.({
        payload: transferSummary({
          hostId: "host-a",
          id: "other-scope",
          viewScope: "sftp-workbench:tab-b",
        }),
      });
    });
    expect(result.current.transfers).toEqual([]);

    act(() => {
      eventHandler?.({
        payload: transferSummary({
          hostId: "host-a",
          id: "active-host",
          updatedAt: 10,
          viewScope: "sftp-workbench:tab-a",
        }),
      });
    });

    expect(result.current.transfers.map((transfer) => transfer.id)).toEqual([
      "active-host",
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

function sshFileTarget(
  overrides: Partial<Extract<SftpFileTarget, { kind: "ssh" }>> = {},
): Extract<SftpFileTarget, { kind: "ssh" }> {
  return {
    hostId: "host-a",
    initialPath: "/srv",
    kind: "ssh",
    protocol: "sftp://",
    summary: "deploy@host-a:22",
    ...overrides,
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
    hostId: "host-a",
    id: "transfer-1",
    kind: "file",
    localPath: "C:/tmp/source.log",
    remotePath: "/srv/app/source.log",
    status: "queued",
    updatedAt: 1,
    ...overrides,
  };
}
