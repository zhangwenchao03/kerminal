import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useCallback,
  useEffect,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  downloadDockerContainerPath,
  uploadDockerContainerPath,
} from "../../../lib/containerFilesApi";
import {
  selectLocalDirectory,
  selectLocalFile,
  selectSaveFile,
} from "../../../lib/fileDialogApi";
import {
  cancelSftpTransfer,
  classifySftpLocalPaths,
  clearCompletedSftpTransfers,
  enqueueSftpArchiveDownload,
  enqueueSftpArchiveUpload,
  enqueueSftpClipboardDownload,
  enqueueSftpRemoteCopy,
  enqueueSftpTransfer,
  readSftpLocalFileClipboard,
  type SftpEntry,
  type SftpLocalPathInfo,
  type SftpManagedTransferRequest,
  type SftpTransferKind,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import { sortTransfers, upsertTransfer } from "../sftpTransferModel";
import {
  isDragPositionInsideDropZone,
  isEditableKeyboardTarget,
  isFileManagerShortcut,
  isRunningInTauriWebview,
  unwrapDragDropPayload,
  writeClipboardText,
} from "./sftpDragDropModel";
import {
  isDownloadableFileEntry,
  transferKindFromEntry,
} from "./sftpEntryModel";
import {
  defaultArchiveFileName,
  defaultArchiveUploadRemotePath,
  defaultPastedRemotePath,
  defaultUploadRemotePath,
  errorMessage,
  joinLocalPath,
  normalizeRemotePath,
  parentRemotePath,
} from "./sftpPathModel";
import type {
  SftpClipboard,
  SftpClipboardEntry,
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
  SftpTransferTarget,
} from "./types";

type UseSftpTransferActionsArgs = {
  active: boolean;
  currentPath: string;
  dropZoneRef: RefObject<HTMLDivElement | null>;
  fileTarget: SftpFileTarget | null;
  loadDirectory: (path: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
  remoteDragEntriesRef: MutableRefObject<SftpEntry[]>;
  selectedEntries: SftpEntry[];
  selectedEntryPaths: Set<string>;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setDragDropActive: Dispatch<SetStateAction<boolean>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setRemoteDownloadDragActive: Dispatch<SetStateAction<boolean>>;
  setRemoteDownloadDropActive: Dispatch<SetStateAction<boolean>>;
  setSelectedEntryPath: Dispatch<SetStateAction<string | null>>;
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>;
  setSftpClipboard: (clipboard: SftpClipboard | null) => void;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  sftpClipboard: SftpClipboard | null;
  transferableSelectedEntries: SftpEntry[];
  transferTarget: SftpTransferTarget | undefined;
};

export function useSftpTransferActions({
  active,
  currentPath,
  dropZoneRef,
  fileTarget,
  loadDirectory,
  refreshTransfers,
  remoteDragEntriesRef,
  selectedEntries,
  selectedEntryPaths,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setDragDropActive,
  setOperationStatus,
  setRemoteDownloadDragActive,
  setRemoteDownloadDropActive,
  setSelectedEntryPath,
  setSelectedEntryPaths,
  setSftpClipboard,
  setTransfers,
  sftpClipboard,
  transferableSelectedEntries,
  transferTarget,
}: UseSftpTransferActionsArgs) {
  const runTransferTask = async (
    request: SftpManagedTransferRequest,
    message: string,
  ) => {
    if (!fileTarget) {
      return;
    }

    if (fileTarget.kind === "ssh") {
      const summary = await enqueueSftpTransfer(request);
      setTransfers((current) =>
        sortTransfers(upsertTransfer(current, summary)),
      );
      setOperationStatus({ kind: "info", message });
      void refreshTransfers();
      return;
    }

    setOperationStatus({
      kind: "info",
      message:
        request.direction === "upload"
          ? `正在上传：${fileNameFromPath(request.localPath, "upload")}`
          : `正在下载：${request.remotePath}`,
    });
    const containerRequest = {
      containerId: fileTarget.containerId,
      hostId: fileTarget.hostId,
      kind: request.kind,
      localPath: request.localPath,
      remotePath: request.remotePath,
      runtime: fileTarget.runtime,
    };
    if (request.direction === "upload") {
      await uploadDockerContainerPath(containerRequest);
      if (parentRemotePath(request.remotePath) === currentPath) {
        await loadDirectory(currentPath);
      }
      setOperationStatus({
        kind: "success",
        message: `已上传：${fileNameFromPath(request.localPath, "upload")}`,
      });
      return;
    }

    await downloadDockerContainerPath(containerRequest);
    setOperationStatus({
      kind: "success",
      message: `已下载：${request.remotePath}`,
    });
  };

  const uploadLocalFile = async (targetRemotePath = currentPath) => {
    if (!fileTarget) {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const localPath = await selectLocalFile();
      if (!localPath) {
        return;
      }
      const remotePath = defaultUploadRemotePath(targetRemotePath, localPath);
      await runTransferTask(
        {
          direction: "upload",
          hostId: fileTarget.hostId,
          kind: "file",
          localPath,
          remotePath,
        },
        `已加入上传队列：${fileNameFromPath(localPath, "upload.bin")}`,
      );
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
    }
  };

  const uploadLocalDirectory = async (targetRemotePath = currentPath) => {
    if (!fileTarget) {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const localPath = await selectLocalDirectory();
      if (!localPath) {
        return;
      }
      const remotePath = defaultUploadRemotePath(
        targetRemotePath,
        localPath,
        "upload-folder",
      );
      await runTransferTask(
        {
          direction: "upload",
          hostId: fileTarget.hostId,
          kind: "directory",
          localPath,
          remotePath,
        },
        `已加入文件夹上传队列：${fileNameFromPath(localPath, "upload-folder")}`,
      );
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
    }
  };

  const enqueueLocalPathUpload = async (
    localPath: SftpLocalPathInfo,
    targetRemotePath: string,
    sourceLabel: string,
  ) => {
    if (!fileTarget) {
      return;
    }

    const remotePath = defaultUploadRemotePath(
      targetRemotePath,
      localPath.path,
      localPath.kind === "directory" ? "upload-folder" : "upload.bin",
    );
    await runTransferTask(
      {
        direction: "upload",
        hostId: fileTarget.hostId,
        kind: localPath.kind,
        localPath: localPath.path,
        remotePath,
      },
      `已加入${sourceLabel}上传队列：${fileNameFromPath(localPath.path, "upload")}`,
    );
  };

  const uploadDroppedLocalPaths = useCallback(
    async (paths: string[], targetRemotePath = currentPath) => {
      if (
        !fileTarget ||
        paths.length === 0
      ) {
        return;
      }

      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
      setOperationStatus(null);
      try {
        const localPaths = await classifySftpLocalPaths({ paths });
        for (const localPath of localPaths) {
          await enqueueLocalPathUpload(localPath, targetRemotePath, "拖拽");
        }
        setOperationStatus({
          kind: fileTarget.kind === "ssh" ? "info" : "success",
          message:
            fileTarget.kind === "ssh"
              ? `已加入拖拽上传队列：${localPaths.length} 个本地项目 -> ${targetRemotePath}`
              : `已完成拖拽上传：${localPaths.length} 个本地项目 -> ${targetRemotePath}`,
        });
      } catch (nextError) {
        setOperationStatus({
          kind: "error",
          message: `拖拽上传失败：${errorMessage(nextError)}`,
        });
      }
    },
    [currentPath, fileTarget],
  );

  useEffect(() => {
    if (
      !active ||
      !fileTarget ||
      !isRunningInTauriWebview()
    ) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = unwrapDragDropPayload(event);
        if (disposed) {
          return;
        }
        if (payload.type === "leave") {
          setDragDropActive(false);
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setDragDropActive(
            isDragPositionInsideDropZone(payload, dropZoneRef.current),
          );
          return;
        }
        if (payload.type === "drop") {
          const insideDropZone = isDragPositionInsideDropZone(
            payload,
            dropZoneRef.current,
          );
          setDragDropActive(false);
          if (insideDropZone) {
            void uploadDroppedLocalPaths(payload.paths, currentPath);
          }
        }
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((nextError) => {
        if (!disposed) {
          setOperationStatus({
            kind: "error",
            message: `拖拽上传监听失败：${errorMessage(nextError)}`,
          });
        }
      });

    return () => {
      disposed = true;
      setDragDropActive(false);
      unlisten?.();
    };
  }, [active, currentPath, fileTarget, uploadDroppedLocalPaths]);

  const downloadEntry = async (entry: SftpEntry) => {
    if (!fileTarget) {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      if (entry.kind === "directory") {
        const selectedDirectory = await selectLocalDirectory();
        if (!selectedDirectory) {
          return;
        }
        const localPath = joinLocalPath(selectedDirectory, entry.name);
        await runTransferTask(
          {
            direction: "download",
            hostId: fileTarget.hostId,
            kind: "directory",
            localPath,
            remotePath: normalizeRemotePath(entry.path),
          },
          `已加入文件夹下载队列：${entry.path}`,
        );
        return;
      }

      if (!isDownloadableFileEntry(entry)) {
        setOperationStatus({
          kind: "info",
          message: "该类型暂不支持下载。",
        });
        return;
      }

      const localPath = await selectSaveFile(
        entry.name || fileNameFromPath(entry.path),
      );
      if (!localPath) {
        return;
      }
      await runTransferTask(
        {
          direction: "download",
          hostId: fileTarget.hostId,
          kind: "file",
          localPath,
          remotePath: normalizeRemotePath(entry.path),
        },
        `已加入下载队列：${entry.path}`,
      );
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
    }
  };

  const downloadEntriesToLocalTarget = async (
    entriesToDownload: SftpEntry[],
    emptyMessage: string,
  ) => {
    if (!fileTarget) {
      return;
    }

    const transferableEntries = entriesToDownload.filter((entry) =>
      transferKindFromEntry(entry),
    );
    if (transferableEntries.length === 0) {
      setOperationStatus({
        kind: "info",
        message: emptyMessage,
      });
      return;
    }
    if (transferableEntries.length === 1) {
      await downloadEntry(transferableEntries[0]);
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const selectedDirectory = await selectLocalDirectory();
      if (!selectedDirectory) {
        return;
      }
      for (const entry of transferableEntries) {
        const kind = transferKindFromEntry(entry);
        if (!kind) {
          continue;
        }
        await runTransferTask(
          {
            direction: "download",
            hostId: fileTarget.hostId,
            kind,
            localPath: joinLocalPath(
              selectedDirectory,
              entry.name || fileNameFromPath(entry.path),
            ),
            remotePath: normalizeRemotePath(entry.path),
          },
          `已加入下载队列：${entry.path}`,
        );
      }
      setOperationStatus({
        kind: fileTarget.kind === "ssh" ? "info" : "success",
        message:
          fileTarget.kind === "ssh"
            ? `已加入批量下载队列：${transferableEntries.length} 个远程项目 -> ${selectedDirectory}`
            : `已完成批量下载：${transferableEntries.length} 个远程项目 -> ${selectedDirectory}`,
      });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `批量下载失败：${errorMessage(nextError)}`,
      });
    }
  };

  const downloadSelectedEntries = async () => {
    await downloadEntriesToLocalTarget(
      transferableSelectedEntries,
      "请先选择可下载的远程项目。",
    );
  };

  const remoteDownloadEntriesFor = (entry: SftpEntry) => {
    if (!transferKindFromEntry(entry)) {
      return [];
    }
    if (selectedEntryPaths.has(entry.path) && transferableSelectedEntries.length) {
      return transferableSelectedEntries;
    }
    return [entry];
  };

  const startRemoteEntryDrag = (
    event: ReactDragEvent<HTMLElement>,
    entry: SftpEntry,
  ) => {
    const entriesToDrag = remoteDownloadEntriesFor(entry);
    if (entriesToDrag.length === 0) {
      event.preventDefault();
      return;
    }

    if (!selectedEntryPaths.has(entry.path)) {
      setSelectedEntryPath(entry.path);
      setSelectedEntryPaths(new Set([entry.path]));
    }

    remoteDragEntriesRef.current = entriesToDrag;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-kerminal-sftp-entry-paths",
      JSON.stringify(entriesToDrag.map((nextEntry) => nextEntry.path)),
    );
    event.dataTransfer.setData(
      "text/plain",
      entriesToDrag.map((nextEntry) => nextEntry.path).join("\n"),
    );
    setRemoteDownloadDragActive(true);
    setRemoteDownloadDropActive(false);
  };

  const finishRemoteEntryDrag = () => {
    remoteDragEntriesRef.current = [];
    setRemoteDownloadDragActive(false);
    setRemoteDownloadDropActive(false);
  };

  const handleRemoteDownloadDragEnter = (
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (remoteDragEntriesRef.current.length === 0) {
      return;
    }
    event.preventDefault();
    setRemoteDownloadDropActive(true);
  };

  const handleRemoteDownloadDragOver = (
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (remoteDragEntriesRef.current.length === 0) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setRemoteDownloadDropActive(true);
  };

  const handleRemoteDownloadDragLeave = (
    event: ReactDragEvent<HTMLElement>,
  ) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    setRemoteDownloadDropActive(false);
  };

  const handleRemoteDownloadDrop = (event: ReactDragEvent<HTMLElement>) => {
    const entriesToDownload = remoteDragEntriesRef.current;
    if (entriesToDownload.length === 0) {
      return;
    }
    event.preventDefault();
    remoteDragEntriesRef.current = [];
    setRemoteDownloadDragActive(false);
    setRemoteDownloadDropActive(false);
    void downloadEntriesToLocalTarget(
      entriesToDownload,
      "请先拖拽可下载的远程项目。",
    );
  };

  const downloadEntryAsArchive = async (entry: SftpEntry) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    const kind = transferKindFromEntry(entry);
    if (!kind) {
      setOperationStatus({
        kind: "info",
        message: "该类型暂不支持下载为 ZIP。",
      });
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const targetLocalPath = await selectSaveFile(
        defaultArchiveFileName(entry),
      );
      if (!targetLocalPath) {
        return;
      }
      const summary = await enqueueSftpArchiveDownload({
        hostId: fileTarget.hostId,
        kind,
        sourceRemotePath: normalizeRemotePath(entry.path),
        targetLocalPath,
      });
      setTransfers((current) =>
        sortTransfers(upsertTransfer(current, summary)),
      );
      setOperationStatus({
        kind: "info",
        message: `已加入 ZIP 下载队列：${entry.path}`,
      });
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `下载为 ZIP 失败：${errorMessage(nextError)}`,
      });
    }
  };

  const downloadEntryToLocalClipboard = async (entry: SftpEntry) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    const kind = transferKindFromEntry(entry);
    if (!kind) {
      setOperationStatus({
        kind: "info",
        message: "该类型暂不支持下载到本地剪贴板。",
      });
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const summary = await enqueueSftpClipboardDownload({
        hostId: fileTarget.hostId,
        kind,
        sourceRemotePath: normalizeRemotePath(entry.path),
      });
      setTransfers((current) =>
        sortTransfers(upsertTransfer(current, summary)),
      );
      setOperationStatus({
        kind: "info",
        message: `已加入本地剪贴板下载队列：${entry.path}`,
      });
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `下载到本地剪贴板失败：${errorMessage(nextError)}`,
      });
    }
  };

  const uploadLocalArchive = async (
    kind: SftpTransferKind,
    destinationRemotePath = currentPath,
  ) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const sourceLocalPath =
        kind === "directory"
          ? await selectLocalDirectory()
          : await selectLocalFile();
      if (!sourceLocalPath) {
        return;
      }
      const targetRemotePath = defaultArchiveUploadRemotePath(
        destinationRemotePath,
        sourceLocalPath,
      );
      const summary = await enqueueSftpArchiveUpload({
        hostId: fileTarget.hostId,
        kind,
        sourceLocalPath,
        targetRemotePath,
      });
      setTransfers((current) =>
        sortTransfers(upsertTransfer(current, summary)),
      );
      setOperationStatus({
        kind: "info",
        message: `已加入 ZIP 上传队列：${fileNameFromPath(sourceLocalPath, "archive")} -> ${targetRemotePath}`,
      });
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `上传为 ZIP 失败：${errorMessage(nextError)}`,
      });
    }
  };

  const copyRemotePath = async (path: string) => {
    setContextMenu(null);
    setOperationStatus(null);
    try {
      await writeClipboardText(path);
      setOperationStatus({ kind: "success", message: `已复制路径：${path}` });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
    }
  };

  const copySelectedRemoteItem = (entry: SftpEntry | null = null) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }
    const entriesToCopy =
      entry && selectedEntryPaths.has(entry.path) && selectedEntries.length > 1
        ? selectedEntries
        : entry
          ? [entry]
          : selectedEntries;
    if (entriesToCopy.length === 0) {
      setOperationStatus({ kind: "info", message: "请先选择一个远程项目。" });
      return;
    }
    const clipboardEntries = entriesToCopy
      .map((nextEntry) => {
        const kind = transferKindFromEntry(nextEntry);
        if (!kind) {
          return null;
        }
        return {
          kind,
          name: nextEntry.name,
          path: nextEntry.path,
        };
      })
      .filter((nextEntry): nextEntry is SftpClipboardEntry =>
        Boolean(nextEntry),
      );
    if (clipboardEntries.length === 0) {
      setOperationStatus({
        kind: "info",
        message: "该类型暂不支持复制到 SFTP 剪贴板。",
      });
      return;
    }
    setContextMenu(null);
    setSftpClipboard({
      copiedAt: Date.now(),
      entries: clipboardEntries,
      sourceHostId: fileTarget.hostId,
      sourceHostLabel: fileTarget.summary,
    });
    setOperationStatus({
      kind: "success",
      message:
        clipboardEntries.length === 1
          ? `已复制到 SFTP 剪贴板：${clipboardEntries[0].path}`
          : `已复制到 SFTP 剪贴板：${clipboardEntries.length} 个远程项目`,
    });
  };

  const pasteSftpClipboard = async (destinationRemotePath = currentPath) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }
    if (!sftpClipboard || sftpClipboard.entries.length === 0) {
      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
      setOperationStatus(null);
      try {
        const localPaths = await readSftpLocalFileClipboard();
        if (localPaths.length === 0) {
          setOperationStatus({
            kind: "info",
            message: "SFTP 剪贴板为空，系统剪贴板也没有本地文件。",
          });
          return;
        }
        for (const localPath of localPaths) {
          await enqueueLocalPathUpload(
            localPath,
            destinationRemotePath,
            "剪贴板",
          );
        }
        setOperationStatus({
          kind: "info",
          message: `已加入剪贴板上传队列：${localPaths.length} 个本地项目 -> ${destinationRemotePath}`,
        });
      } catch (nextError) {
        setOperationStatus({
          kind: "error",
          message: `读取系统文件剪贴板失败：${errorMessage(nextError)}`,
        });
      }
      return;
    }

    const sameHost = sftpClipboard.sourceHostId === fileTarget.hostId;
    const targetDescription = sameHost ? "远程复制" : "跨主机传输";
    const sourceDescription = sameHost
      ? "当前主机"
      : sftpClipboard.sourceHostLabel;
    const entryNames = sftpClipboard.entries
      .map((entry) => entry.name || fileNameFromPath(entry.path))
      .join("、");
    setContextMenu(null);
    setOperationStatus(null);
    try {
      for (const entry of sftpClipboard.entries) {
        const summary = await enqueueSftpRemoteCopy({
          kind: entry.kind,
          sourceHostId: sftpClipboard.sourceHostId,
          sourceRemotePath: entry.path,
          targetHostId: fileTarget.hostId,
          targetRemotePath: defaultPastedRemotePath(
            destinationRemotePath,
            entry,
            sftpClipboard.sourceHostId,
            fileTarget.hostId,
          ),
        });
        setTransfers((current) =>
          sortTransfers(upsertTransfer(current, summary)),
        );
      }
      setOperationStatus({
        kind: "info",
        message: `已加入${targetDescription}队列：${sourceDescription} ${entryNames} -> ${destinationRemotePath}`,
      });
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `${targetDescription}入队失败：${errorMessage(nextError)}`,
      });
    }
  };

  const transferSelectedEntriesToTarget = async () => {
    if (!fileTarget || fileTarget.kind !== "ssh" || !transferTarget) {
      return;
    }
    if (transferableSelectedEntries.length === 0) {
      setOperationStatus({ kind: "info", message: "请先选择要传输的远程项目。" });
      return;
    }

    setContextMenu(null);
    setOperationStatus(null);
    const destinationRemotePath = normalizeRemotePath(transferTarget.remotePath);
    const entryNames = transferableSelectedEntries
      .map((entry) => entry.name || fileNameFromPath(entry.path))
      .join("、");
    try {
      for (const entry of transferableSelectedEntries) {
        const kind = transferKindFromEntry(entry);
        if (!kind) {
          continue;
        }
        const summary = await enqueueSftpRemoteCopy({
          kind,
          sourceHostId: fileTarget.hostId,
          sourceRemotePath: entry.path,
          targetHostId: transferTarget.hostId,
          targetRemotePath: defaultPastedRemotePath(
            destinationRemotePath,
            {
              kind,
              name: entry.name,
              path: entry.path,
            },
            fileTarget.hostId,
            transferTarget.hostId,
          ),
        });
        setTransfers((current) => sortTransfers(upsertTransfer(current, summary)));
      }
      setOperationStatus({
        kind: "info",
        message: `已加入传输队列：${entryNames} -> ${transferTarget.hostLabel} ${destinationRemotePath}`,
      });
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `传输入队失败：${errorMessage(nextError)}`,
      });
    }
  };

  const handleSftpKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!isFileManagerShortcut(event)) {
      return;
    }
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "c") {
      event.preventDefault();
      copySelectedRemoteItem();
      return;
    }
    if (key === "v") {
      event.preventDefault();
      void pasteSftpClipboard();
    }
  };

  const cancelTransfer = async (transferId: string) => {
    try {
      const summary = await cancelSftpTransfer({ transferId });
      setTransfers((current) =>
        sortTransfers(upsertTransfer(current, summary)),
      );
      setOperationStatus({ kind: "info", message: "已请求取消传输。" });
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({ kind: "error", message: errorMessage(nextError) });
    }
  };

  const clearFinishedTransfers = async () => {
    try {
      const nextTransfers = await clearCompletedSftpTransfers();
      setTransfers(sortTransfers(nextTransfers));
      setOperationStatus({ kind: "info", message: "已清理完成的传输任务。" });
    } catch (nextError) {
      setOperationStatus({ kind: "error", message: errorMessage(nextError) });
    }
  };

  return {
    cancelTransfer,
    clearFinishedTransfers,
    copyRemotePath,
    copySelectedRemoteItem,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadSelectedEntries,
    finishRemoteEntryDrag,
    handleRemoteDownloadDragEnter,
    handleRemoteDownloadDragLeave,
    handleRemoteDownloadDragOver,
    handleRemoteDownloadDrop,
    handleSftpKeyDown,
    pasteSftpClipboard,
    startRemoteEntryDrag,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadLocalDirectory,
    uploadLocalFile,
  };
}
