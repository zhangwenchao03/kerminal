import {
  useCallback,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  readSftpLocalFileClipboard,
  type SftpEntry,
  type SftpTransferConflictPolicy,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import {
  buildSftpWorkbenchClipboardPastePlan,
  type SftpWorkbenchClipboard,
} from "../sftpTransferClipboardModel";
import { useSftpManagedTransferQueue } from "../useSftpManagedTransferQueue";
import {
  isEditableKeyboardTarget,
  isFileManagerShortcut,
  writeClipboardText,
} from "./sftpDragDropModel";
import { errorMessage } from "./sftpPathModel";
import {
  buildSftpClipboardPasteIntent,
  buildSftpRemoteClipboardCopyPlan,
  hasSftpRemoteDragPayloadType,
  parseSftpRemoteDragPayload,
  SFTP_REMOTE_DRAG_PAYLOAD_MIME,
} from "./sftpRemoteTransferModel";
import { runClipboardRemoteCopyWithPreflight, runRemoteCopyPlanWithPreflight, runTargetRemoteCopyWithPreflight } from "./sftpRemoteCopyConflictActions";
import {
  hasSftpLocalFileDragPayloadType,
  parseSftpLocalFileDragPayload,
  SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
} from "./sftpLocalUploadDropModel";
import { sftpCannotDropStatus } from "./sftpDropReasonModel";
import { buildBatchDownloadTransferPlan, buildSftpLocalClipboardUploadPlan } from "./sftpTransferActionPlan";
import { buildWorkbenchClipboardUploadItems, runSftpTransferActionItems, runSftpTransferBatchPlan } from "./sftpTransferActionRunner";
import { useSftpRemoteDownloadDragActions } from "./useSftpRemoteDownloadDragActions";
import { useSftpLocalTransferCommands } from "./useSftpLocalTransferCommands";
import { useSftpRemoteCopyTaskRunner } from "./useSftpRemoteCopyTaskRunner";
import { useSftpTransferConflictPrompt } from "./useSftpTransferConflictPrompt";
import { useSftpTransferTaskRunner } from "./useSftpTransferTaskRunner";
import { visiblePostTransferStatus } from "./useSftpTransferActions.helpers";
import type {
  SftpClipboard,
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
  SftpTransferTarget,
} from "./types";

type UseSftpTransferActionsArgs = {
  currentPath: string;
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
  viewScope?: string | null;
  workbenchClipboard?: SftpWorkbenchClipboard | null;
};

export function useSftpTransferActions({
  currentPath,
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
  viewScope,
  workbenchClipboard,
}: UseSftpTransferActionsArgs) {
  const { runTransferTask } = useSftpTransferTaskRunner({
    currentPath,
    fileTarget,
    loadDirectory,
    refreshTransfers,
    setOperationStatus,
    setTransfers,
    viewScope,
  });
  const { runRemoteCopyTask } = useSftpRemoteCopyTaskRunner({
    refreshTransfers,
    setOperationStatus,
    setTransfers,
    viewScope,
  });
  const { cancelTransfer, clearFinishedTransfers, retryTransfer } = useSftpManagedTransferQueue({
    onCancelSuccess: () => setOperationStatus({ kind: "info", message: "已请求取消传输。" }),
    onClearSuccess: () => setOperationStatus({ kind: "info", message: "已清理完成的传输任务。" }),
    onError: (nextError) => setOperationStatus({ kind: "error", message: errorMessage(nextError) }),
    onRetrySuccess: () => setOperationStatus({ kind: "info", message: "已重新加入传输队列；将优先尝试断点续传。" }),
    onRetryUnavailable: (message) => setOperationStatus({ kind: "error", message }),
    refreshTransfers,
    setTransfers,
    viewScope,
  });
  const {
    closeTransferConflictDialog,
    confirmTransferConflictPolicy,
    pendingTransferConflict,
    runWithConflictPreflight,
  } = useSftpTransferConflictPrompt({
    onError: (nextError, errorMessagePrefix) =>
      setOperationStatus({
        kind: "error",
        message: errorMessagePrefix
          ? `${errorMessagePrefix}：${errorMessage(nextError)}`
          : errorMessage(nextError),
      }),
    onProgress: (progress) => {
      if (!progress || progress.total === 0) {
        setOperationStatus(null);
        return;
      }
      setOperationStatus({
        kind: "info",
        message: `正在检查传输冲突 ${progress.checked}/${progress.total}。`,
      });
    },
  });

  const {
    downloadEntriesToLocalTarget,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadSelectedEntries,
    uploadLocalArchive,
    uploadDroppedLocalPaths,
    uploadLocalDirectory,
    uploadLocalFile,
  } = useSftpLocalTransferCommands({
    currentPath,
    fileTarget,
    refreshTransfers,
    runTransferTask,
    runWithConflictPreflight,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setOperationStatus,
    setTransfers,
    transferableSelectedEntries,
    viewScope,
  });

  const {
    finishRemoteEntryDrag,
    handleRemoteDownloadDragEnter,
    handleRemoteDownloadDragLeave,
    handleRemoteDownloadDragOver,
    handleRemoteDownloadDrop,
    startRemoteEntryDrag,
  } = useSftpRemoteDownloadDragActions({
    downloadEntriesToLocalTarget,
    remoteDragEntriesRef,
    selectedEntryPaths,
    setRemoteDownloadDragActive,
    setRemoteDownloadDropActive,
    setSelectedEntryPath,
    setSelectedEntryPaths,
    sourceHostId: fileTarget?.kind === "ssh" ? fileTarget.hostId : undefined,
    sourceHostLabel: fileTarget?.kind === "ssh" ? fileTarget.summary : undefined,
    transferableSelectedEntries,
  });

  const handleRemoteTransferDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (hasSftpLocalFileDragPayload(event)) {
        if (fileTarget?.kind === "ssh") {
          event.preventDefault();
          setDragDropActive(true);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
        setDragDropActive(false);
        setOperationStatus(
          sftpCannotDropStatus("localFileRequiresSshRemoteTarget"),
        );
        return;
      }
      if (hasSftpRemoteDragPayload(event) && fileTarget?.kind === "ssh") {
        event.preventDefault();
        setRemoteDownloadDropActive(true);
        return;
      }
      handleRemoteDownloadDragEnter(event);
    },
    [
      fileTarget,
      handleRemoteDownloadDragEnter,
      setDragDropActive,
      setOperationStatus,
      setRemoteDownloadDropActive,
    ],
  );

  const handleRemoteTransferDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (hasSftpLocalFileDragPayload(event)) {
        event.preventDefault();
        if (fileTarget?.kind === "ssh") {
          event.dataTransfer.dropEffect = "copy";
          setDragDropActive(true);
          return;
        }
        event.dataTransfer.dropEffect = "none";
        setDragDropActive(false);
        return;
      }
      if (hasSftpRemoteDragPayload(event) && fileTarget?.kind === "ssh") {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setRemoteDownloadDropActive(true);
        return;
      }
      handleRemoteDownloadDragOver(event);
    },
    [
      fileTarget,
      handleRemoteDownloadDragOver,
      setDragDropActive,
      setRemoteDownloadDropActive,
    ],
  );

  const handleRemoteTransferDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (hasSftpLocalFileDragPayload(event)) {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return;
        }
        setDragDropActive(false);
      }
      handleRemoteDownloadDragLeave(event);
    },
    [handleRemoteDownloadDragLeave, setDragDropActive],
  );

  const handleRemoteTransferDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (hasSftpLocalFileDragPayload(event) && fileTarget?.kind !== "ssh") {
        event.preventDefault();
        event.stopPropagation();
        setDragDropActive(false);
        setRemoteDownloadDragActive(false);
        setRemoteDownloadDropActive(false);
        setOperationStatus(
          sftpCannotDropStatus("localFileRequiresSshRemoteTarget"),
        );
        return;
      }
      if (fileTarget?.kind === "ssh" && hasSftpLocalFileDragPayload(event)) {
        event.preventDefault();
        event.stopPropagation();
        setDragDropActive(false);
        setRemoteDownloadDragActive(false);
        setRemoteDownloadDropActive(false);
        setContextMenu(null);
        setOperationStatus(null);
        const payload = parseSftpLocalFileDragPayload(
          event.dataTransfer.getData(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME),
        );
        if (!payload) {
          setOperationStatus({
            kind: "error",
            message: "无法识别拖拽的本地文件。",
          });
          return;
        }
        void uploadDroppedLocalPaths(
          payload.entries.map((entry) => entry.path),
          currentPath,
        );
        return;
      }
      if (fileTarget?.kind !== "ssh" || !hasSftpRemoteDragPayload(event)) {
        handleRemoteDownloadDrop(event);
        return;
      }

      const payload = parseSftpRemoteDragPayload(
        event.dataTransfer.getData(SFTP_REMOTE_DRAG_PAYLOAD_MIME),
      );
      if (!payload) {
        handleRemoteDownloadDrop(event);
        return;
      }

      event.preventDefault();
      remoteDragEntriesRef.current = [];
      setRemoteDownloadDragActive(false);
      setRemoteDownloadDropActive(false);
      setContextMenu(null);
      setOperationStatus(null);
      void runClipboardRemoteCopyWithPreflight({
        clipboard: {
          copiedAt: Date.now(),
          entries: payload.entries,
          sourceHostId: payload.sourceHostId,
          sourceHostLabel: payload.sourceHostLabel,
        },
        destinationRemotePath: currentPath,
        runRemoteCopyTask,
        runWithConflictPreflight,
        targetHostId: fileTarget.hostId,
      });
    },
    [
      currentPath,
      fileTarget,
      handleRemoteDownloadDrop,
      remoteDragEntriesRef,
      runRemoteCopyTask,
      runWithConflictPreflight,
      setContextMenu,
      setDragDropActive,
      setOperationStatus,
      setRemoteDownloadDragActive,
      setRemoteDownloadDropActive,
      uploadDroppedLocalPaths,
    ],
  );


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
    const plan = buildSftpRemoteClipboardCopyPlan({
      copiedAt: Date.now(),
      entry,
      selectedEntries,
      selectedEntryPaths,
      sourceHostId: fileTarget.hostId,
      sourceHostLabel: fileTarget.summary,
    });
    if (plan.kind !== "copy") {
      setOperationStatus(plan.status);
      return;
    }
    setContextMenu(null);
    setSftpClipboard(plan.clipboard);
    setOperationStatus(plan.status);
  };

  const copySelectedRemoteItemToLocalClipboard = () => {
    if (transferableSelectedEntries.length !== 1) {
      copySelectedRemoteItem();
      return;
    }
    setSftpClipboard(null);
    void downloadEntryToLocalClipboard(transferableSelectedEntries[0]);
  };

  const pasteSftpClipboard = async (destinationRemotePath = currentPath) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }
    if (workbenchClipboard?.kind === "local") {
      const pastePlan = buildSftpWorkbenchClipboardPastePlan({
        clipboard: workbenchClipboard,
        target: {
          hostId: fileTarget.hostId,
          hostLabel: fileTarget.summary,
          kind: "remote",
          path: destinationRemotePath,
        },
      });
      if (pastePlan.kind !== "transfer") {
        setOperationStatus(pastePlan.status);
        return;
      }
      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
      setOperationStatus(null);
      try {
        const buildItems = (conflictPolicy?: SftpTransferConflictPolicy) =>
          buildWorkbenchClipboardUploadItems({
            conflictPolicy,
            hostId: fileTarget.hostId,
            plan: pastePlan.plan,
          });
        await runWithConflictPreflight({
          errorMessagePrefix: "粘贴本机项目失败",
          input: buildItems(),
          run: async (conflictPolicy) => {
            await runSftpTransferActionItems(
              buildItems(conflictPolicy),
              runTransferTask,
            );
            setOperationStatus(visiblePostTransferStatus(pastePlan.status));
          },
        });
      } catch (nextError) {
        setOperationStatus({
          kind: "error",
          message: `粘贴本机项目失败：${errorMessage(nextError)}`,
        });
      }
      return;
    }
    const pasteIntent = buildSftpClipboardPasteIntent({
      clipboard: sftpClipboard,
      destinationRemotePath,
      targetHostId: fileTarget.hostId,
    });
    if (pasteIntent.kind === "localFileClipboard") {
      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
      setOperationStatus(null);
      try {
        const localPaths = await readSftpLocalFileClipboard();
        const uploadPlan = buildSftpLocalClipboardUploadPlan({
          fileTargetKind: fileTarget.kind,
          hostId: fileTarget.hostId,
          localPaths,
          targetRemotePath: destinationRemotePath,
        });
        if (uploadPlan.kind === "empty") {
          setOperationStatus(uploadPlan.status);
          return;
        }
        const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
          buildSftpLocalClipboardUploadPlan({
            conflictPolicy,
            fileTargetKind: fileTarget.kind,
            hostId: fileTarget.hostId,
            localPaths,
            targetRemotePath: destinationRemotePath,
          });
        await runWithConflictPreflight({
          errorMessagePrefix: pasteIntent.readFailureMessagePrefix,
          input: uploadPlan.batchPlan,
          run: async (conflictPolicy) => {
            const nextUploadPlan = buildPlan(conflictPolicy);
            if (nextUploadPlan.kind === "empty") {
              setOperationStatus(nextUploadPlan.status);
              return;
            }
            await runSftpTransferBatchPlan(
              nextUploadPlan.batchPlan,
              runTransferTask,
            );
            setOperationStatus(
              visiblePostTransferStatus(
                nextUploadPlan.batchPlan.completionStatus,
              ),
            );
          },
        });
      } catch (nextError) {
        setOperationStatus({
          kind: "error",
          message: `${pasteIntent.readFailureMessagePrefix}：${errorMessage(nextError)}`,
        });
      }
      return;
    }

    setContextMenu(null);
    setOperationStatus(null);
    await runRemoteCopyPlanWithPreflight({
      plan: pasteIntent.remoteCopyPlan,
      runRemoteCopyTask,
      runWithConflictPreflight,
    });
  };

  const transferSelectedEntriesToTarget = async () => {
    if (!fileTarget || !transferTarget) {
      return;
    }
    if (transferTarget.kind === "remote" && fileTarget.kind !== "ssh") {
      return;
    }
    if (transferableSelectedEntries.length === 0) {
      setOperationStatus({ kind: "info", message: "请先选择要传输的远程项目。" });
      return;
    }

    setContextMenu(null);
    setOperationStatus(null);
    if (transferTarget.kind === "local") {
      const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
        buildBatchDownloadTransferPlan({
          conflictPolicy,
          entries: transferableSelectedEntries,
          fileTargetKind: fileTarget.kind,
          hostId: fileTarget.hostId,
          selectedDirectory: transferTarget.localPath,
        });
      await runWithConflictPreflight({
        input: buildPlan(),
        localRootPath: transferTarget.localPath,
        run: async (conflictPolicy) => {
          const plan = buildPlan(conflictPolicy);
          await runSftpTransferBatchPlan(plan, runTransferTask);
          setOperationStatus(visiblePostTransferStatus(plan.completionStatus));
        },
      });
      return;
    }

    await runTargetRemoteCopyWithPreflight({
      entries: transferableSelectedEntries,
      runRemoteCopyTask,
      runWithConflictPreflight,
      sourceHostId: fileTarget.hostId,
      transferTarget,
    });
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
      copySelectedRemoteItemToLocalClipboard();
      return;
    }
    if (key === "v") {
      event.preventDefault();
      void pasteSftpClipboard();
    }
  };

  return {
    cancelTransfer,
    clearFinishedTransfers,
    closeTransferConflictDialog,
    confirmTransferConflictPolicy,
    copyRemotePath,
    copySelectedRemoteItem,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadSelectedEntries,
    finishRemoteEntryDrag,
    handleRemoteDownloadDragEnter: handleRemoteTransferDragEnter,
    handleRemoteDownloadDragLeave: handleRemoteTransferDragLeave,
    handleRemoteDownloadDragOver: handleRemoteTransferDragOver,
    handleRemoteDownloadDrop: handleRemoteTransferDrop,
    handleSftpKeyDown,
    pasteSftpClipboard,
    pendingTransferConflict,
    retryTransfer,
    startRemoteEntryDrag,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadLocalDirectory,
    uploadDroppedLocalPaths,
    uploadLocalFile,
  };
}

function hasSftpRemoteDragPayload(event: ReactDragEvent<HTMLElement>) {
  return hasSftpRemoteDragPayloadType(event.dataTransfer.types);
}

function hasSftpLocalFileDragPayload(event: ReactDragEvent<HTMLElement>) {
  return hasSftpLocalFileDragPayloadType(event.dataTransfer.types);
}
