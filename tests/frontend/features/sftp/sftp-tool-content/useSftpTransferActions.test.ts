/**
 * SFTP transfer actions facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  Dispatch,
  DragEvent as ReactDragEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpEntry, SftpTransferSummary } from "../../../../../src/lib/sftpApi";
import type {
  SftpClipboard,
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpLocalTransferTarget,
  SftpRemoteTransferTarget,
  SftpStatus,
  SftpTransferTarget,
} from "../../../../../src/features/sftp/sftp-tool-content/types";
import { SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME } from "../../../../../src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel";
import { SFTP_REMOTE_DRAG_PAYLOAD_MIME } from "../../../../../src/features/sftp/sftp-tool-content/sftpRemoteTransferModel";
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

  it("does not transfer selected entries without an SSH source target or transfer target", async () => {
    const selectedEntry = remoteEntry();

    const noFileTarget = renderTransferActionsHook({
      fileTarget: null,
      transferableSelectedEntries: [selectedEntry],
      transferTarget: transferTarget(),
    });
    await act(async () => {
      await noFileTarget.result.current.transferSelectedEntriesToTarget();
    });

    const dockerSource = renderTransferActionsHook({
      fileTarget: dockerFileTarget(),
      transferableSelectedEntries: [selectedEntry],
      transferTarget: transferTarget(),
    });
    await act(async () => {
      await dockerSource.result.current.transferSelectedEntriesToTarget();
    });

    const noTransferTarget = renderTransferActionsHook({
      fileTarget: sshFileTarget(),
      transferableSelectedEntries: [selectedEntry],
      transferTarget: undefined,
    });
    await act(async () => {
      await noTransferTarget.result.current.transferSelectedEntriesToTarget();
    });

    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expect(transferTaskRunnerMock.runTransferTask).not.toHaveBeenCalled();
    expect(noFileTarget.setters.setOperationStatus).not.toHaveBeenCalled();
    expect(dockerSource.setters.setContextMenu).not.toHaveBeenCalled();
    expect(noTransferTarget.setters.setContextMenu).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
  });

  it("reports an empty transfer selection without closing transient UI", async () => {
    const { result, setters } = renderTransferActionsHook({
      transferableSelectedEntries: [],
      transferTarget: transferTarget(),
    });

    await act(async () => {
      await result.current.transferSelectedEntriesToTarget();
    });

    expect(setters.setOperationStatus).toHaveBeenCalledWith({
      kind: "info",
      message: "请先选择要传输的远程项目。",
    });
    expect(setters.setContextMenu).not.toHaveBeenCalled();
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expect(transferTaskRunnerMock.runTransferTask).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
  });

  it("clears transient UI before queueing selected entries for the transfer target", async () => {
    const calls: string[] = [];
    remoteCopyTaskRunnerMock.runRemoteCopyTask.mockImplementation(async () => {
      calls.push("runRemoteCopyTask");
    });
    const appLog = remoteEntry({
      name: "app.log",
      path: "/srv/app.log",
    });
    const confDirectory = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });
    const { result } = renderTransferActionsHook({
      calls,
      fileTarget: sshFileTarget({ hostId: "host-left" }),
      transferableSelectedEntries: [appLog, confDirectory],
      transferTarget: transferTarget({
        hostId: "host-right",
        hostLabel: "Right Host",
        remotePath: "/backup//",
      }),
    });

    await act(async () => {
      await result.current.transferSelectedEntriesToTarget();
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setOperationStatus:null",
      "runRemoteCopyTask",
    ]);
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).toHaveBeenCalledWith({
      destinationRemotePath: "/backup",
      requests: [
        {
          conflictPolicy: "overwrite",
          kind: "file",
          sourceHostId: "host-left",
          sourceRemotePath: "/srv/app.log",
          targetHostId: "host-right",
          targetRemotePath: "/backup/app.log",
        },
        {
          conflictPolicy: "overwrite",
          kind: "directory",
          sourceHostId: "host-left",
          sourceRemotePath: "/srv/conf",
          targetHostId: "host-right",
          targetRemotePath: "/backup/conf",
        },
      ],
      statusMessage: "已加入传输队列：app.log、conf -> Right Host /backup",
      targetDescription: "传输",
    });
    expect(transferTaskRunnerMock.runTransferTask).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
  });

  it("downloads selected entries directly into a local transfer target", async () => {
    const calls: string[] = [];
    transferTaskRunnerMock.runTransferTask.mockImplementation(async () => {
      calls.push("runTransferTask");
    });
    const appLog = remoteEntry({
      name: "app.log",
      path: "/srv/app.log",
    });
    const confDirectory = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
      raw: "drwxr-xr-x 2 root root 4096 Jun 21 10:00 conf",
      size: 0,
    });
    const { result } = renderTransferActionsHook({
      calls,
      fileTarget: sshFileTarget({ hostId: "host-left" }),
      transferableSelectedEntries: [appLog, confDirectory],
      transferTarget: localTransferTarget({ localPath: "C:/Users/24052" }),
    });

    await act(async () => {
      await result.current.transferSelectedEntriesToTarget();
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setOperationStatus:null",
      "runTransferTask",
      "runTransferTask",
      "setOperationStatus:null",
    ]);
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenNthCalledWith(1, {
      queuedStatus: {
        kind: "info",
        message: "已加入下载队列：/srv/app.log",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "download",
        hostId: "host-left",
        kind: "file",
        localPath: "C:/Users/24052/app.log",
        remotePath: "/srv/app.log",
      },
    });
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenNthCalledWith(2, {
      queuedStatus: {
        kind: "info",
        message: "已加入文件夹下载队列：/srv/conf",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "download",
        hostId: "host-left",
        kind: "directory",
        localPath: "C:/Users/24052/conf",
        remotePath: "/srv/conf",
      },
    });
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
  });

  it("downloads selected entries as a batch through the transfer runner", async () => {
    const calls: string[] = [];
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue("C:/downloads");
    transferTaskRunnerMock.runTransferTask.mockImplementation(async () => {
      calls.push("runTransferTask");
    });
    const appLog = remoteEntry({
      name: "app.log",
      path: "/srv/app.log",
    });
    const confDirectory = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
      raw: "drwxr-xr-x 2 root root 4096 Jun 21 10:00 conf",
      size: 0,
    });
    const { result } = renderTransferActionsHook({
      calls,
      fileTarget: sshFileTarget({ hostId: "host-left" }),
      transferableSelectedEntries: [appLog, confDirectory],
    });

    await act(async () => {
      await result.current.downloadSelectedEntries();
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:null",
      "runTransferTask",
      "runTransferTask",
      "setOperationStatus:null",
    ]);
    expect(fileDialogApiMock.selectLocalDirectory).toHaveBeenCalledTimes(1);
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenNthCalledWith(1, {
      queuedStatus: {
        kind: "info",
        message: "已加入下载队列：/srv/app.log",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "download",
        hostId: "host-left",
        kind: "file",
        localPath: "C:/downloads/app.log",
        remotePath: "/srv/app.log",
      },
    });
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenNthCalledWith(2, {
      queuedStatus: {
        kind: "info",
        message: "已加入文件夹下载队列：/srv/conf",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "download",
        hostId: "host-left",
        kind: "directory",
        localPath: "C:/downloads/conf",
        remotePath: "/srv/conf",
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

  it("pastes an SFTP clipboard with the remote copy runner", async () => {
    const calls: string[] = [];
    remoteCopyTaskRunnerMock.runRemoteCopyTask.mockImplementation(async () => {
      calls.push("runRemoteCopyTask");
    });
    const { result, setters } = renderTransferActionsHook({
      calls,
      fileTarget: sshFileTarget({
        hostId: "host-right",
        summary: "Right Host",
      }),
      sftpClipboard: {
        copiedAt: 1782054300000,
        entries: [
          {
            kind: "file",
            name: "app.log",
            path: "/srv/app.log",
          },
          {
            kind: "directory",
            name: "conf",
            path: "/srv/conf",
          },
        ],
        sourceHostId: "host-left",
        sourceHostLabel: "Left Host",
      },
    });

    await act(async () => {
      await result.current.pasteSftpClipboard("/dest");
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setOperationStatus:null",
      "runRemoteCopyTask",
    ]);
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).toHaveBeenCalledWith({
      destinationRemotePath: "/dest",
      requests: [
        {
          conflictPolicy: "overwrite",
          kind: "file",
          sourceHostId: "host-left",
          sourceRemotePath: "/srv/app.log",
          targetHostId: "host-right",
          targetRemotePath: "/dest/app.log",
        },
        {
          conflictPolicy: "overwrite",
          kind: "directory",
          sourceHostId: "host-left",
          sourceRemotePath: "/srv/conf",
          targetHostId: "host-right",
          targetRemotePath: "/dest/conf",
        },
      ],
      statusMessage:
        "已加入跨主机传输队列：Left Host app.log、conf -> /dest",
      targetDescription: "跨主机传输",
    });
    expect(setters.setDialogAction).not.toHaveBeenCalled();
    expect(setters.setDialogStatus).not.toHaveBeenCalled();
    expect(transferTaskRunnerMock.runTransferTask).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
  });

  it("queues a remote copy when a cross-pane remote drag payload is dropped", async () => {
    const calls: string[] = [];
    const { remoteDragEntriesRef, result } = renderTransferActionsHook({
      calls,
      currentPath: "/dest",
      fileTarget: sshFileTarget({
        hostId: "host-right",
        summary: "Right Host",
      }),
    });
    const dragOverEvent = createRemotePayloadDragEvent({
      entries: [
        { kind: "file", name: "app.log", path: "/srv/app.log" },
        { kind: "directory", name: "conf", path: "/srv/conf" },
      ],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });
    const dropEvent = createRemotePayloadDragEvent({
      entries: [
        { kind: "file", name: "app.log", path: "/srv/app.log" },
        { kind: "directory", name: "conf", path: "/srv/conf" },
      ],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });

    act(() => {
      result.current.handleRemoteDownloadDragOver(dragOverEvent);
      result.current.handleRemoteDownloadDrop(dropEvent);
    });

    expect(dragOverEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(dragOverEvent.dataTransfer.dropEffect).toBe("copy");
    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(remoteDragEntriesRef.current).toEqual([]);
    expect(calls).toEqual([
      "setRemoteDownloadDropActive:value",
      "setRemoteDownloadDragActive:value",
      "setRemoteDownloadDropActive:value",
      "setContextMenu:null",
      "setOperationStatus:null",
    ]);
    await waitFor(() => expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).toHaveBeenCalledWith({
      destinationRemotePath: "/dest",
      requests: [
        {
          conflictPolicy: "overwrite",
          kind: "file",
          sourceHostId: "host-left",
          sourceRemotePath: "/srv/app.log",
          targetHostId: "host-right",
          targetRemotePath: "/dest/app.log",
        },
        {
          conflictPolicy: "overwrite",
          kind: "directory",
          sourceHostId: "host-left",
          sourceRemotePath: "/srv/conf",
          targetHostId: "host-right",
          targetRemotePath: "/dest/conf",
        },
      ],
      statusMessage:
        "已加入跨主机传输队列：Left Host app.log、conf -> /dest",
      targetDescription: "跨主机传输",
    }));
    expect(transferTaskRunnerMock.runTransferTask).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
  });

  it("uploads workbench local drag payloads into the current remote directory", async () => {
    sftpApiMock.classifySftpLocalPaths.mockResolvedValue([
      { kind: "file", path: "C:/tmp/release.tgz" },
      { kind: "directory", path: "C:/tmp/dist" },
    ]);
    const { result, setters } = renderTransferActionsHook({
      currentPath: "/dest",
      fileTarget: sshFileTarget({ hostId: "host-right" }),
    });
    const dragOverEvent = createLocalPayloadDragEvent({
      entries: [
        { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
        { kind: "directory", name: "dist", path: "C:/tmp/dist" },
      ],
      source: "local",
    });
    const dropEvent = createLocalPayloadDragEvent({
      entries: [
        { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
        { kind: "directory", name: "dist", path: "C:/tmp/dist" },
      ],
      source: "local",
    });

    act(() => {
      result.current.handleRemoteDownloadDragOver(dragOverEvent);
      result.current.handleRemoteDownloadDrop(dropEvent);
    });

    expect(dragOverEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(dragOverEvent.dataTransfer.dropEffect).toBe("copy");
    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(dropEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(setters.setDragDropActive).toHaveBeenCalledWith(true);
    expect(setters.setDragDropActive).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(transferTaskRunnerMock.runTransferTask).toHaveBeenCalledTimes(2),
    );
    expect(sftpApiMock.classifySftpLocalPaths).toHaveBeenCalledWith({
      paths: ["C:/tmp/release.tgz", "C:/tmp/dist"],
    });
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenNthCalledWith(1, {
      queuedStatus: {
        kind: "info",
        message: "已加入拖拽上传队列：release.tgz",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "host-right",
        kind: "file",
        localPath: "C:/tmp/release.tgz",
        remotePath: "/dest/release.tgz",
      },
    });
    expect(transferTaskRunnerMock.runTransferTask).toHaveBeenNthCalledWith(2, {
      queuedStatus: {
        kind: "info",
        message: "已加入拖拽上传队列：dist",
      },
      request: {
       conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "host-right",
        kind: "directory",
        localPath: "C:/tmp/dist",
        remotePath: "/dest/dist",
      },
    });
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectLocalDirectory).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectLocalFile).not.toHaveBeenCalled();
    expect(fileDialogApiMock.selectSaveFile).not.toHaveBeenCalled();
  });

  it("rejects workbench local drag payloads on non SSH targets with a reason", () => {
    const { result, setters } = renderTransferActionsHook({
      fileTarget: dockerFileTarget(),
    });
    const dragOverEvent = createLocalPayloadDragEvent({
      entries: [
        { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
      ],
      source: "local",
    });
    const dropEvent = createLocalPayloadDragEvent({
      entries: [
        { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
      ],
      source: "local",
    });

    act(() => {
      result.current.handleRemoteDownloadDragEnter(dragOverEvent);
      result.current.handleRemoteDownloadDragOver(dragOverEvent);
      result.current.handleRemoteDownloadDrop(dropEvent);
    });

    expect(dragOverEvent.preventDefault).toHaveBeenCalled();
    expect(dragOverEvent.dataTransfer.dropEffect).toBe("none");
    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(dropEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(setters.setDragDropActive).toHaveBeenCalledWith(false);
    expect(setters.setOperationStatus).toHaveBeenCalledWith({
      kind: "error",
      message: "本机文件只能拖放到 SSH/SFTP 远端目录。",
    });
    expect(sftpApiMock.classifySftpLocalPaths).not.toHaveBeenCalled();
    expect(transferTaskRunnerMock.runTransferTask).not.toHaveBeenCalled();
    expect(remoteCopyTaskRunnerMock.runRemoteCopyTask).not.toHaveBeenCalled();
    expectNoPickerOrArchiveSideEffects();
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
}

function expectNoPickerOrArchiveSideEffects() {
  expect(fileDialogApiMock.selectLocalDirectory).not.toHaveBeenCalled();
  expect(fileDialogApiMock.selectLocalFile).not.toHaveBeenCalled();
  expect(fileDialogApiMock.selectSaveFile).not.toHaveBeenCalled();
  expect(sftpApiMock.classifySftpLocalPaths).not.toHaveBeenCalled();
  expect(sftpApiMock.enqueueSftpArchiveDownload).not.toHaveBeenCalled();
  expect(sftpApiMock.enqueueSftpArchiveUpload).not.toHaveBeenCalled();
  expect(sftpApiMock.enqueueSftpClipboardDownload).not.toHaveBeenCalled();
  expect(sftpApiMock.readSftpLocalFileClipboard).not.toHaveBeenCalled();
}

function sshFileTarget(
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

function dockerFileTarget(
  overrides: Partial<Extract<SftpFileTarget, { kind: "dockerContainer" }>> = {},
): Extract<SftpFileTarget, { kind: "dockerContainer" }> {
  return {
    containerId: "container-api",
    containerName: "api",
    hostId: "host-left",
    initialPath: "/srv",
    kind: "dockerContainer",
    protocol: "container://",
    runtime: "docker",
    summary: "docker:api",
    ...overrides,
  };
}

function transferTarget(
  overrides: Partial<SftpRemoteTransferTarget> = {},
): SftpRemoteTransferTarget {
  return {
    kind: "remote",
    hostId: "host-right",
    hostLabel: "Right Host",
    remotePath: "/backup",
    side: "right",
    ...overrides,
  };
}

function localTransferTarget(
  overrides: Partial<SftpLocalTransferTarget> = {},
): SftpLocalTransferTarget {
  return {
    kind: "local",
    localPath: "C:/downloads",
    side: "left",
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

function createRemotePayloadDragEvent(payload: unknown) {
  const serializedPayload = JSON.stringify(payload);
  return {
    dataTransfer: {
      dropEffect: "none",
      getData: vi.fn((type: string) =>
        type === SFTP_REMOTE_DRAG_PAYLOAD_MIME ? serializedPayload : "",
      ),
      types: [SFTP_REMOTE_DRAG_PAYLOAD_MIME],
    },
    preventDefault: vi.fn(),
  } as unknown as ReactDragEvent<HTMLElement>;
}

function createLocalPayloadDragEvent(payload: unknown) {
  const serializedPayload = JSON.stringify(payload);
  return {
    dataTransfer: {
      dropEffect: "none",
      getData: vi.fn((type: string) =>
        type === SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME ? serializedPayload : "",
      ),
      types: [SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME],
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactDragEvent<HTMLElement>;
}
