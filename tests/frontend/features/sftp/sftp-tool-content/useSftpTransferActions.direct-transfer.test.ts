/**
 * SFTP transfer actions facade hook tests.
 *
 * @author kongweiguang
 */
import { act, renderHook } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpEntry, SftpTransferSummary } from "../../../../../src/lib/sftpApi";
import type { SftpClipboard, SftpContextMenuState, SftpDialogAction, SftpFileTarget, SftpStatus, SftpTransferTarget } from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpTransferActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpTransferActions";

type SetterMock<T> = ReturnType<typeof vi.fn> &
  Dispatch<SetStateAction<T>>;

const fileDialogApiMock = vi.hoisted(() => ({
  selectLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
  selectSaveFile: vi.fn(),
}));

const sftpApiMock = vi.hoisted(() => ({
  classifySftpLocalPaths: vi.fn(),
  enqueueSftpArchiveDownload: vi.fn(),
  enqueueSftpArchiveUpload: vi.fn(),
  enqueueSftpClipboardDownload: vi.fn(),
  readSftpLocalFileClipboard: vi.fn(),
  statSftpPath: vi.fn(),
}));

const localFilesApiMock = vi.hoisted(() => ({ statLocalPath: vi.fn() }));

const managedTransferQueueMock = vi.hoisted(() => ({
  cancelTransfer: vi.fn(),
  clearFinishedTransfers: vi.fn(),
  retryTransfer: vi.fn(),
}));

const remoteCopyTaskRunnerMock = vi.hoisted(() => ({
  runRemoteCopyTask: vi.fn(),
}));

const transferTaskRunnerMock = vi.hoisted(() => ({
  runTransferTask: vi.fn(),
}));

vi.mock("../../../../../src/lib/fileDialogApi", () => ({
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
  selectLocalFile: fileDialogApiMock.selectLocalFile,
  selectSaveFile: fileDialogApiMock.selectSaveFile,
}));

vi.mock("../../../../../src/lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../../src/lib/sftpApi")>(
    "../../../../../src/lib/sftpApi",
  );
  return {
    ...actual,
    classifySftpLocalPaths: sftpApiMock.classifySftpLocalPaths,
    enqueueSftpArchiveDownload: sftpApiMock.enqueueSftpArchiveDownload,
    enqueueSftpArchiveUpload: sftpApiMock.enqueueSftpArchiveUpload,
    enqueueSftpClipboardDownload: sftpApiMock.enqueueSftpClipboardDownload,
    readSftpLocalFileClipboard: sftpApiMock.readSftpLocalFileClipboard,
    statSftpPath: sftpApiMock.statSftpPath,
  };
});

vi.mock("../../../../../src/lib/localFilesApi", () => ({
  statLocalPath: localFilesApiMock.statLocalPath,
}));

vi.mock("../../../../../src/features/sftp/useSftpManagedTransferQueue", () => ({
  useSftpManagedTransferQueue: () => ({
    cancelTransfer: managedTransferQueueMock.cancelTransfer,
    clearFinishedTransfers: managedTransferQueueMock.clearFinishedTransfers,
    retryTransfer: managedTransferQueueMock.retryTransfer,
  }),
}));

vi.mock("../../../../../src/features/sftp/sftp-tool-content/useSftpRemoteCopyTaskRunner", () => ({
  useSftpRemoteCopyTaskRunner: () => ({
    runRemoteCopyTask: remoteCopyTaskRunnerMock.runRemoteCopyTask,
  }),
}));

vi.mock("../../../../../src/features/sftp/sftp-tool-content/useSftpTransferTaskRunner", () => ({
  useSftpTransferTaskRunner: () => ({
    runTransferTask: transferTaskRunnerMock.runTransferTask,
  }),
}));

describe("useSftpTransferActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue(null);
    fileDialogApiMock.selectLocalFile.mockResolvedValue(null);
    fileDialogApiMock.selectSaveFile.mockResolvedValue(null);
    sftpApiMock.classifySftpLocalPaths.mockResolvedValue([]);
    sftpApiMock.readSftpLocalFileClipboard.mockResolvedValue([]);
    sftpApiMock.statSftpPath.mockRejectedValue(new Error("not found"));
    localFilesApiMock.statLocalPath.mockResolvedValue({
      exists: false, path: "C:/downloads/missing", readonly: false,
    });
    remoteCopyTaskRunnerMock.runRemoteCopyTask.mockResolvedValue(undefined);
    transferTaskRunnerMock.runTransferTask.mockResolvedValue(undefined);
  });

  it("uploads a selected local file through the transfer runner", async () => {
    const calls: string[] = [];
    fileDialogApiMock.selectLocalFile.mockResolvedValue("C:/tmp/release.tgz");
    transferTaskRunnerMock.runTransferTask.mockImplementation(async () => {
      calls.push("runTransferTask");
    });
    const { result } = renderTransferActionsHook({
      calls,
      fileTarget: sshFileTarget({ hostId: "host-left" }),
    });

    await act(async () => {
      await result.current.uploadLocalFile();
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:null",
      "runTransferTask",
    ]);
    expect(fileDialogApiMock.selectLocalFile).toHaveBeenCalledTimes(1);
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenCalledWith({
      queuedStatus: {
        kind: "info",
        message: "已加入上传队列：release.tgz",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "host-left",
        kind: "file",
        localPath: "C:/tmp/release.tgz",
        remotePath: "/srv/release.tgz",
      },
    });
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectLocalDirectory).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectSaveFile).not.toHaveBeenCalled();
    expect(sftpApiMock.classifySftpLocalPaths).not.toHaveBeenCalled();
    expect(sftpApiMock.enqueueSftpArchiveDownload).not.toHaveBeenCalled();
    expect(sftpApiMock.enqueueSftpArchiveUpload).not.toHaveBeenCalled();
    expect(sftpApiMock.enqueueSftpClipboardDownload).not.toHaveBeenCalled();
    expect(sftpApiMock.readSftpLocalFileClipboard).not.toHaveBeenCalled();
  });

  it("uploads a selected local directory through the transfer runner", async () => {
    const calls: string[] = [];
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue(
      "C:/tmp/release-dir",
    );
    transferTaskRunnerMock.runTransferTask.mockImplementation(async () => {
      calls.push("runTransferTask");
    });
    const { result } = renderTransferActionsHook({
      calls,
      fileTarget: sshFileTarget({ hostId: "host-left" }),
    });

    await act(async () => {
      await result.current.uploadLocalDirectory("/opt/releases");
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:null",
      "runTransferTask",
    ]);
    expect(fileDialogApiMock.selectLocalDirectory).toHaveBeenCalledTimes(1);
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenCalledWith({
      queuedStatus: {
        kind: "info",
        message: "已加入文件夹上传队列：release-dir",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "host-left",
        kind: "directory",
        localPath: "C:/tmp/release-dir",
        remotePath: "/opt/releases/release-dir",
      },
    });
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectLocalFile).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectSaveFile).not.toHaveBeenCalled();
    expect(sftpApiMock.classifySftpLocalPaths).not.toHaveBeenCalled();
    expect(sftpApiMock.enqueueSftpArchiveDownload).not.toHaveBeenCalled();
    expect(sftpApiMock.enqueueSftpArchiveUpload).not.toHaveBeenCalled();
    expect(sftpApiMock.enqueueSftpClipboardDownload).not.toHaveBeenCalled();
    expect(sftpApiMock.readSftpLocalFileClipboard).not.toHaveBeenCalled();
  });

  it("injects the active view scope into direct archive and clipboard queue requests", async () => {
    fileDialogApiMock.selectSaveFile.mockResolvedValue(
      "C:/downloads/app.log.zip",
    );
    fileDialogApiMock.selectLocalFile.mockResolvedValue("C:/tmp/release.tgz");
    sftpApiMock.enqueueSftpArchiveDownload.mockResolvedValue(
      transferSummary({ id: "archive-download" }),
    );
    sftpApiMock.enqueueSftpClipboardDownload.mockResolvedValue(
      transferSummary({ id: "clipboard-download" }),
    );
    sftpApiMock.enqueueSftpArchiveUpload.mockResolvedValue(
      transferSummary({ id: "archive-upload" }),
    );
    const { result } = renderTransferActionsHook({
      fileTarget: sshFileTarget({ hostId: "host-left" }),
      viewScope: "sftp-workbench:tab-a",
    });

    await act(async () => {
      await result.current.downloadEntryAsArchive(
        remoteEntry({ name: "app.log", path: "/srv/app.log" }),
      );
      await result.current.downloadEntryToLocalClipboard(
        remoteEntry({ name: "app.log", path: "/srv/app.log" }),
      );
      await result.current.uploadLocalArchive("file", "/srv/releases");
    });

    expect(sftpApiMock.enqueueSftpArchiveDownload).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      hostId: "host-left",
      kind: "file",
      sourceRemotePath: "/srv/app.log",
      targetLocalPath: "C:/downloads/app.log.zip",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(sftpApiMock.enqueueSftpClipboardDownload).toHaveBeenCalledWith({
      hostId: "host-left",
      kind: "file",
      sourceRemotePath: "/srv/app.log",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(sftpApiMock.enqueueSftpArchiveUpload).toHaveBeenCalledWith({
     conflictPolicy: "overwrite",
      hostId: "host-left",
      kind: "file",
      sourceLocalPath: "C:/tmp/release.tgz",
      targetRemotePath: "/srv/releases/release.tgz.zip",
      viewScope: "sftp-workbench:tab-a",
    });
  });

  it("sanitizes clipboard transfer failures before storing them", async () => {
    sftpApiMock.enqueueSftpClipboardDownload.mockResolvedValue(
      transferSummary({
        error: "secret=clipboard-summary-secret",
        id: "clipboard-failed",
        status: "failed",
      }),
    );
    const { result, setters } = renderTransferActionsHook({
      fileTarget: sshFileTarget({ hostId: "host-left" }),
    });

    await act(async () => {
      await result.current.downloadEntryToLocalClipboard(
        remoteEntry({ name: "app.log", path: "/srv/app.log" }),
      );
    });

    const update =
      setters.setTransfers.mock.calls[
        setters.setTransfers.mock.calls.length - 1
      ]?.[0] as
      | SetStateAction<SftpTransferSummary[]>
      | undefined;
    const transfers =
      typeof update === "function" ? update([]) : (update ?? []);
    expect(transfers[0]?.error).toContain('secret="[已隐藏]"');
    expect(transfers[0]?.error).not.toContain("clipboard-summary-secret");
  });



});

function renderTransferActionsHook({
  calls = [],
  currentPath = "/srv",
  fileTarget = sshFileTarget(),
  selectedEntries = [],
  selectedEntryPaths = new Set<string>(),
  sftpClipboard = null,
  transferableSelectedEntries = [remoteEntry()],
  transferTarget: nextTransferTarget,
  viewScope,
}: {
  calls?: string[];
  currentPath?: string;
  fileTarget?: SftpFileTarget | null;
  selectedEntries?: SftpEntry[];
  selectedEntryPaths?: Set<string>;
  sftpClipboard?: SftpClipboard | null;
  transferableSelectedEntries?: SftpEntry[];
  transferTarget?: SftpTransferTarget;
  viewScope?: string | null;
} = {}) {
  const remoteDragEntriesRef: MutableRefObject<SftpEntry[]> = {
    current: [],
  };
  const setters = createSetters(calls);
  const result = renderHook(() =>
    useSftpTransferActions({
      currentPath,
      fileTarget,
      loadDirectory: vi.fn().mockResolvedValue(undefined),
      refreshTransfers: vi.fn().mockResolvedValue(undefined),
      remoteDragEntriesRef,
      selectedEntries,
      selectedEntryPaths,
      setContextMenu: setters.setContextMenu,
      setDialogAction: setters.setDialogAction,
      setDialogStatus: setters.setDialogStatus,
      setDragDropActive: setters.setDragDropActive,
      setOperationStatus: setters.setOperationStatus,
      setRemoteDownloadDragActive: setters.setRemoteDownloadDragActive,
      setRemoteDownloadDropActive: setters.setRemoteDownloadDropActive,
      setSelectedEntryPath: setters.setSelectedEntryPath,
      setSelectedEntryPaths: setters.setSelectedEntryPaths,
      setSftpClipboard: setters.setSftpClipboard,
      setTransfers: setters.setTransfers,
      sftpClipboard,
      transferableSelectedEntries,
      transferTarget: nextTransferTarget ?? undefined,
      viewScope,
    }),
  );

  return {
    ...result,
    remoteDragEntriesRef,
    setters,
  };
}

function createSetters(calls: string[]) {
  return {
    setContextMenu: createSetter<SftpContextMenuState | null>(
      calls,
      "setContextMenu",
    ),
    setDialogAction: createSetter<SftpDialogAction | null>(
      calls,
      "setDialogAction",
    ),
    setDialogStatus: createSetter<SftpStatus | null>(calls, "setDialogStatus"),
    setDragDropActive: createSetter<boolean>(calls, "setDragDropActive"),
    setOperationStatus: createSetter<SftpStatus | null>(
      calls,
      "setOperationStatus",
    ),
    setRemoteDownloadDragActive: createSetter<boolean>(
      calls,
      "setRemoteDownloadDragActive",
    ),
    setRemoteDownloadDropActive: createSetter<boolean>(
      calls,
      "setRemoteDownloadDropActive",
    ),
    setSelectedEntryPath: createSetter<string | null>(
      calls,
      "setSelectedEntryPath",
    ),
    setSelectedEntryPaths: createSetter<Set<string>>(
      calls,
      "setSelectedEntryPaths",
    ),
    setSftpClipboard: vi.fn((clipboard: SftpClipboard | null) => {
      calls.push(`setSftpClipboard:${clipboard ? "value" : "null"}`);
    }),
    setTransfers: createSetter<SftpTransferSummary[]>(calls, "setTransfers"),
  };
}

function createSetter<T>(
  calls: string[],
  name: string,
): SetterMock<T> {
  return vi.fn((value: SetStateAction<T>) => {
    calls.push(`${name}:${value === null ? "null" : "value"}`);
  }) as unknown as SetterMock<T>;
}function sshFileTarget(
  overrides: Partial<Extract<SftpFileTarget, { kind: "ssh" }>> = {},
): Extract<SftpFileTarget, { kind: "ssh" }> {
  return {
    hostId: "host-left",
    initialPath: "/srv",
    kind: "ssh",
    protocol: "sftp://",
    summary: "Left Host",
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
    hostId: "host-left",
    id: "transfer-1",
    kind: "file",
    localPath: "C:/downloads/app.log",
    operation: "download",
    remotePath: "/srv/app.log",
    source: {
      hostId: "host-left",
      hostLabel: "host-left",
      kind: "remote",
      path: "/srv/app.log",
    },
    status: "queued",
    target: {
      kind: "local",
      path: "C:/downloads/app.log",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}

function remoteEntry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  return {
    kind: "file",
    modified: "2026-06-21T10:00:00Z",
    name: "app.log",
    path: "/srv/app.log",
    raw: "-rw-r--r-- 1 root root 1024 Jun 21 10:00 app.log",
    size: 1024,
    ...overrides,
  };
}
