/**
 * SFTP remote download drag facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type {
  DragEvent as ReactDragEvent,
  MutableRefObject,
} from "react";
import { describe, expect, it, vi } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import {
  SFTP_REMOTE_DRAG_PAYLOAD_MIME,
  parseSftpRemoteDragPayload,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpRemoteTransferModel";
import { useSftpRemoteDownloadDragActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpRemoteDownloadDragActions";

type DragEventStub = ReactDragEvent<HTMLElement> & {
  dataTransfer: {
    dropEffect: string;
    effectAllowed: string;
    setData: ReturnType<typeof vi.fn>;
  };
  preventDefault: ReturnType<typeof vi.fn>;
};

type DownloadEntriesToLocalTarget = (
  entriesToDownload: SftpEntry[],
  emptyMessage: string,
) => Promise<void>;

describe("useSftpRemoteDownloadDragActions", () => {
  it("starts dragging the selected transferable batch without changing selection", () => {
    const fileEntry = remoteEntry({
      name: "app.log",
      path: "/srv/app.log",
    });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });
    const { remoteDragEntriesRef, result, setters } = renderDragHook({
      selectedEntryPaths: new Set([fileEntry.path, directoryEntry.path]),
      transferableSelectedEntries: [fileEntry, directoryEntry],
    });
    const event = createDragEvent();

    act(() => {
      result.current.startRemoteEntryDrag(event, fileEntry);
    });

    expect(remoteDragEntriesRef.current).toEqual([fileEntry, directoryEntry]);
    expect(event.dataTransfer.effectAllowed).toBe("copy");
    expect(event.dataTransfer.setData).toHaveBeenNthCalledWith(
      1,
      "text/plain",
      `${fileEntry.path}\n${directoryEntry.path}`,
    );
    expect(setters.setSelectedEntryPath).not.toHaveBeenCalled();
    expect(setters.setSelectedEntryPaths).not.toHaveBeenCalled();
    expect(setters.setRemoteDownloadDragActive).toHaveBeenCalledWith(true);
    expect(setters.setRemoteDownloadDropActive).toHaveBeenCalledWith(false);
  });

  it("writes text and cross-pane remote payload MIME", () => {
    const fileEntry = remoteEntry({
      name: "app.log",
      path: "/srv/app.log",
    });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });
    const { result } = renderDragHook({
      selectedEntryPaths: new Set([fileEntry.path, directoryEntry.path]),
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
      transferableSelectedEntries: [fileEntry, directoryEntry],
    });
    const event = createDragEvent();

    act(() => {
      result.current.startRemoteEntryDrag(event, fileEntry);
    });

    expect(event.dataTransfer.setData).toHaveBeenCalledWith(
      "text/plain",
      `${fileEntry.path}\n${directoryEntry.path}`,
    );
    const remotePayloadCall = event.dataTransfer.setData.mock.calls.find(
      ([type]) => type === SFTP_REMOTE_DRAG_PAYLOAD_MIME,
    );
    expect(parseSftpRemoteDragPayload(remotePayloadCall?.[1] ?? "")).toEqual({
      entries: [
        { kind: "file", name: "app.log", path: "/srv/app.log" },
        { kind: "directory", name: "conf", path: "/srv/conf" },
      ],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });
  });

  it("omits the cross-pane remote payload when source host metadata is unavailable", () => {
    const entry = remoteEntry({ name: "app.log", path: "/srv/app.log" });
    const { result } = renderDragHook({
      selectedEntryPaths: new Set([entry.path]),
      transferableSelectedEntries: [entry],
    });
    const event = createDragEvent();

    act(() => {
      result.current.startRemoteEntryDrag(event, entry);
    });

    expect(event.dataTransfer.setData).not.toHaveBeenCalledWith(
      SFTP_REMOTE_DRAG_PAYLOAD_MIME,
      expect.any(String),
    );
  });

  it("selects an unselected entry before starting its drag session", () => {
    const entry = remoteEntry({
      name: "release.tgz",
      path: "/srv/release.tgz",
    });
    const existingSelection = remoteEntry({
      name: "old.log",
      path: "/srv/old.log",
    });
    const { remoteDragEntriesRef, result, setters } = renderDragHook({
      selectedEntryPaths: new Set([existingSelection.path]),
      transferableSelectedEntries: [existingSelection],
    });
    const event = createDragEvent();

    act(() => {
      result.current.startRemoteEntryDrag(event, entry);
    });

    expect(remoteDragEntriesRef.current).toEqual([entry]);
    expect(setters.setSelectedEntryPath).toHaveBeenCalledWith(entry.path);
    expect(selectedPathsFromSetter(setters.setSelectedEntryPaths)).toEqual([
      entry.path,
    ]);
    expect(event.dataTransfer.setData).toHaveBeenCalledWith(
      "text/plain",
      entry.path,
    );
  });

  it("drags a selected entry itself when the transferable selection is empty", () => {
    const entry = remoteEntry({
      name: "selected.log",
      path: "/srv/selected.log",
    });
    const { remoteDragEntriesRef, result, setters } = renderDragHook({
      selectedEntryPaths: new Set([entry.path]),
      transferableSelectedEntries: [],
    });
    const event = createDragEvent();

    act(() => {
      result.current.startRemoteEntryDrag(event, entry);
    });

    expect(remoteDragEntriesRef.current).toEqual([entry]);
    expect(setters.setSelectedEntryPath).not.toHaveBeenCalled();
    expect(setters.setSelectedEntryPaths).not.toHaveBeenCalled();
    expect(event.dataTransfer.setData).toHaveBeenCalledWith(
      "text/plain",
      entry.path,
    );
  });

  it("blocks unsupported remote entries without activating drag state", () => {
    const unsupportedEntry = remoteEntry({
      kind: "other",
      name: "socket",
      path: "/srv/app.sock",
    });
    const { remoteDragEntriesRef, result, setters } = renderDragHook();
    const event = createDragEvent();

    act(() => {
      result.current.startRemoteEntryDrag(event, unsupportedEntry);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.dataTransfer.setData).not.toHaveBeenCalled();
    expect(remoteDragEntriesRef.current).toEqual([]);
    expect(setters.setRemoteDownloadDragActive).not.toHaveBeenCalled();
    expect(setters.setRemoteDownloadDropActive).not.toHaveBeenCalled();
    expect(setters.setSelectedEntryPath).not.toHaveBeenCalled();
    expect(setters.setSelectedEntryPaths).not.toHaveBeenCalled();
  });

  it("ignores local drop-zone events when no remote drag session is active", () => {
    const { downloadEntriesToLocalTarget, result, setters } = renderDragHook();
    const enterEvent = createDragEvent();
    const overEvent = createDragEvent();
    const dropEvent = createDragEvent();

    act(() => {
      result.current.handleRemoteDownloadDragEnter(enterEvent);
      result.current.handleRemoteDownloadDragOver(overEvent);
      result.current.handleRemoteDownloadDrop(dropEvent);
    });

    expect(enterEvent.preventDefault).not.toHaveBeenCalled();
    expect(overEvent.preventDefault).not.toHaveBeenCalled();
    expect(overEvent.dataTransfer.dropEffect).toBe("none");
    expect(dropEvent.preventDefault).not.toHaveBeenCalled();
    expect(setters.setRemoteDownloadDragActive).not.toHaveBeenCalled();
    expect(setters.setRemoteDownloadDropActive).not.toHaveBeenCalled();
    expect(downloadEntriesToLocalTarget).not.toHaveBeenCalled();
  });

  it("marks the local drop zone active and downloads the drag entries on drop", () => {
    const fileEntry = remoteEntry({
      name: "app.log",
      path: "/srv/app.log",
    });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });
    const entriesToDownload = [fileEntry, directoryEntry];
    const { downloadEntriesToLocalTarget, remoteDragEntriesRef, result, setters } =
      renderDragHook({
        remoteDragEntries: entriesToDownload,
      });
    const enterEvent = createDragEvent();
    const overEvent = createDragEvent();
    const dropEvent = createDragEvent();

    act(() => {
      result.current.handleRemoteDownloadDragEnter(enterEvent);
      result.current.handleRemoteDownloadDragOver(overEvent);
      result.current.handleRemoteDownloadDrop(dropEvent);
    });

    expect(enterEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(overEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(overEvent.dataTransfer.dropEffect).toBe("copy");
    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(remoteDragEntriesRef.current).toEqual([]);
    expect(setters.setRemoteDownloadDropActive).toHaveBeenNthCalledWith(
      1,
      true,
    );
    expect(setters.setRemoteDownloadDropActive).toHaveBeenNthCalledWith(
      2,
      true,
    );
    expect(setters.setRemoteDownloadDropActive).toHaveBeenLastCalledWith(
      false,
    );
    expect(setters.setRemoteDownloadDragActive).toHaveBeenCalledWith(false);
    expect(downloadEntriesToLocalTarget).toHaveBeenCalledWith(
      entriesToDownload,
      "请先拖拽可下载的远程项目。",
    );
  });

  it("clears drag state before the local download promise settles", () => {
    const entry = remoteEntry();
    const pendingDownload = createDeferred<void>();
    const downloadEntriesToLocalTarget = vi.fn<DownloadEntriesToLocalTarget>(
      () => pendingDownload.promise,
    );
    const { remoteDragEntriesRef, result, setters } = renderDragHook({
      downloadEntriesToLocalTarget,
      remoteDragEntries: [entry],
    });
    const dropEvent = createDragEvent();

    act(() => {
      result.current.handleRemoteDownloadDrop(dropEvent);
    });

    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(remoteDragEntriesRef.current).toEqual([]);
    expect(setters.setRemoteDownloadDragActive).toHaveBeenCalledWith(false);
    expect(setters.setRemoteDownloadDropActive).toHaveBeenCalledWith(false);
    expect(downloadEntriesToLocalTarget).toHaveBeenCalledWith(
      [entry],
      "请先拖拽可下载的远程项目。",
    );

    pendingDownload.resolve();
  });

  it("keeps the drop zone active when drag leave stays inside the zone", () => {
    const dropZone = document.createElement("div");
    const nestedTarget = document.createElement("span");
    const outsideTarget = document.createElement("span");
    dropZone.appendChild(nestedTarget);
    const { result, setters } = renderDragHook();

    act(() => {
      result.current.handleRemoteDownloadDragLeave(
        createDragEvent({
          currentTarget: dropZone,
          relatedTarget: nestedTarget,
        }),
      );
    });

    expect(setters.setRemoteDownloadDropActive).not.toHaveBeenCalled();

    act(() => {
      result.current.handleRemoteDownloadDragLeave(
        createDragEvent({
          currentTarget: dropZone,
          relatedTarget: outsideTarget,
        }),
      );
    });

    expect(setters.setRemoteDownloadDropActive).toHaveBeenCalledWith(false);

    act(() => {
      result.current.handleRemoteDownloadDragLeave(
        createDragEvent({
          currentTarget: dropZone,
          relatedTarget: null,
        }),
      );
    });

    expect(setters.setRemoteDownloadDropActive).toHaveBeenCalledTimes(2);
    expect(setters.setRemoteDownloadDropActive).toHaveBeenLastCalledWith(false);
  });

  it("clears drag state when the remote drag session finishes", () => {
    const entry = remoteEntry();
    const { remoteDragEntriesRef, result, setters } = renderDragHook({
      remoteDragEntries: [entry],
    });

    act(() => {
      result.current.finishRemoteEntryDrag();
    });

    expect(remoteDragEntriesRef.current).toEqual([]);
    expect(setters.setRemoteDownloadDragActive).toHaveBeenCalledWith(false);
    expect(setters.setRemoteDownloadDropActive).toHaveBeenCalledWith(false);
  });
});

function renderDragHook({
  downloadEntriesToLocalTarget = vi.fn<DownloadEntriesToLocalTarget>(
    async () => undefined,
  ),
  remoteDragEntries = [],
  selectedEntryPaths = new Set<string>(),
  transferableSelectedEntries = [],
  sourceHostId,
  sourceHostLabel,
}: {
  downloadEntriesToLocalTarget?: DownloadEntriesToLocalTarget;
  remoteDragEntries?: SftpEntry[];
  selectedEntryPaths?: ReadonlySet<string>;
  sourceHostId?: string;
  sourceHostLabel?: string;
  transferableSelectedEntries?: SftpEntry[];
} = {}) {
  const remoteDragEntriesRef: MutableRefObject<SftpEntry[]> = {
    current: remoteDragEntries,
  };
  const setters = {
    setRemoteDownloadDragActive: vi.fn(),
    setRemoteDownloadDropActive: vi.fn(),
    setSelectedEntryPath: vi.fn(),
    setSelectedEntryPaths: vi.fn(),
  };
  const hook = renderHook(() =>
    useSftpRemoteDownloadDragActions({
      downloadEntriesToLocalTarget,
      remoteDragEntriesRef,
      selectedEntryPaths,
      setRemoteDownloadDragActive: setters.setRemoteDownloadDragActive,
      setRemoteDownloadDropActive: setters.setRemoteDownloadDropActive,
      setSelectedEntryPath: setters.setSelectedEntryPath,
      setSelectedEntryPaths: setters.setSelectedEntryPaths,
      sourceHostId,
      sourceHostLabel,
      transferableSelectedEntries,
    }),
  );

  return {
    downloadEntriesToLocalTarget,
    remoteDragEntriesRef,
    result: hook.result,
    setters,
  };
}

function createDragEvent({
  currentTarget = document.createElement("div"),
  relatedTarget = null,
}: {
  currentTarget?: HTMLElement;
  relatedTarget?: EventTarget | null;
} = {}): DragEventStub {
  return {
    currentTarget,
    dataTransfer: {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    },
    preventDefault: vi.fn(),
    relatedTarget,
  } as unknown as DragEventStub;
}

function selectedPathsFromSetter(
  setSelectedEntryPaths: ReturnType<typeof vi.fn>,
) {
  const selectedPaths = setSelectedEntryPaths.mock.calls[0]?.[0];
  return selectedPaths instanceof Set ? Array.from(selectedPaths) : [];
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function remoteEntry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const path = overrides.path ?? "/srv/app.log";
  return {
    kind: "file",
    name: path.split("/").pop() ?? "app.log",
    path,
    raw: `-rw-r--r-- ${path}`,
    ...overrides,
  };
}
