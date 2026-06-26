import {
  useCallback,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  selectLocalDirectory,
  selectLocalFile,
  selectSaveFile,
} from "../../../lib/fileDialogApi";
import {
  classifySftpLocalPaths,
  enqueueSftpClipboardDownload,
  readSftpLocalFileClipboard,
  type SftpEntry,
  type SftpTransferConflictPolicy,
  type SftpTransferKind,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import {
  buildSftpWorkbenchClipboardPastePlan,
  type SftpWorkbenchClipboard,
} from "../sftpTransferClipboardModel";
import { mergeTransferSnapshot } from "../sftpTransferModel";
import { useSftpManagedTransferQueue } from "../useSftpManagedTransferQueue";
import {
  isEditableKeyboardTarget,
  isFileManagerShortcut,
  writeClipboardText,
} from "./sftpDragDropModel";
import { isDownloadableFileEntry } from "./sftpEntryModel";
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
import { buildSftpArchiveDownloadPlan, buildSftpArchiveDownloadPreparation, buildSftpArchiveUploadPlan, buildBatchDownloadTransferPlan, buildDirectoryDownloadTransferPlan, buildDirectoryUploadTransferPlan, buildDownloadSelectionPlan, buildDownloadTransferPlan, buildFileUploadTransferPlan, buildLocalPathBatchUploadPlan, buildSftpClipboardDownloadPlan, buildSftpLocalClipboardUploadPlan } from "./sftpTransferActionPlan";
import { buildWorkbenchClipboardUploadItems, runSftpTransferActionItems, runSftpTransferBatchPlan } from "./sftpTransferActionRunner";
import { withSftpTransferViewScope } from "./sftpTransferScopeModel";
import { useSftpRemoteDownloadDragActions } from "./useSftpRemoteDownloadDragActions";
import { useSftpRemoteCopyTaskRunner } from "./useSftpRemoteCopyTaskRunner";
import { useSftpTransferConflictPrompt } from "./useSftpTransferConflictPrompt";
import { useSftpTransferTaskRunner } from "./useSftpTransferTaskRunner";
import { runSftpArchiveDownloadPlanWithPreflight, runSftpArchiveUploadPlanWithPreflight, visiblePostTransferStatus } from "./useSftpTransferActions.helpers";
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
  const { cancelTransfer, clearFinishedTransfers } = useSftpManagedTransferQueue({
    onCancelSuccess: () =>
      setOperationStatus({ kind: "info", message: "已请求取消传输。" }),
    onClearSuccess: () =>
      setOperationStatus({ kind: "info", message: "已清理完成的传输任务。" }),
    onError: (nextError) =>
      setOperationStatus({ kind: "error", message: errorMessage(nextError) }),
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
  });

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
      const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
        buildFileUploadTransferPlan({
          conflictPolicy,
          hostId: fileTarget.hostId,
          localPath,
          targetRemotePath,
        });
      await runWithConflictPreflight({
        input: buildPlan(),
        run: async (conflictPolicy) => {
          await runTransferTask(buildPlan(conflictPolicy));
        },
      });
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
      const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
        buildDirectoryUploadTransferPlan({
          conflictPolicy,
          hostId: fileTarget.hostId,
          localPath,
          targetRemotePath,
        });
      await runWithConflictPreflight({
        input: buildPlan(),
        run: async (conflictPolicy) => {
          await runTransferTask(buildPlan(conflictPolicy));
        },
      });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
    }
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
        const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
          buildLocalPathBatchUploadPlan({
            conflictPolicy,
            fileTargetKind: fileTarget.kind,
            hostId: fileTarget.hostId,
            localPaths,
            sourceLabel: "拖拽",
            targetRemotePath,
          });
        await runWithConflictPreflight({
          errorMessagePrefix: "拖拽上传失败",
          input: buildPlan(),
          run: async (conflictPolicy) => {
            const plan = buildPlan(conflictPolicy);
            await runSftpTransferBatchPlan(plan, runTransferTask);
            setOperationStatus(
              visiblePostTransferStatus(plan.completionStatus),
            );
          },
        });
      } catch (nextError) {
        setOperationStatus({
          kind: "error",
          message: `拖拽上传失败：${errorMessage(nextError)}`,
        });
      }
    },
    [currentPath, fileTarget, runTransferTask, runWithConflictPreflight],
  );

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
        const plan = buildDirectoryDownloadTransferPlan({
          entry,
          hostId: fileTarget.hostId,
          selectedDirectory,
        });
        if (plan) {
          await runWithConflictPreflight({
            input: plan,
            localRootPath: selectedDirectory,
            run: async (conflictPolicy) => {
              const nextPlan = buildDirectoryDownloadTransferPlan({
                conflictPolicy,
                entry,
                hostId: fileTarget.hostId,
                selectedDirectory,
              });
              if (nextPlan) {
                await runTransferTask(nextPlan);
              }
            },
          });
        }
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
      const plan = buildDownloadTransferPlan({
        entry,
        hostId: fileTarget.hostId,
        localPath,
      });
      if (plan) {
        await runWithConflictPreflight({
          input: plan,
          run: async (conflictPolicy) => {
            const nextPlan = buildDownloadTransferPlan({
              conflictPolicy,
              entry,
              hostId: fileTarget.hostId,
              localPath,
            });
            if (nextPlan) {
              await runTransferTask(nextPlan);
            }
          },
        });
      }
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

    const selectionPlan = buildDownloadSelectionPlan({
      emptyMessage,
      entries: entriesToDownload,
    });
    if (selectionPlan.kind === "empty") {
      setOperationStatus(selectionPlan.status);
      return;
    }
    if (selectionPlan.kind === "single") {
      await downloadEntry(selectionPlan.entry);
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
      const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
        buildBatchDownloadTransferPlan({
          conflictPolicy,
          entries: selectionPlan.entries,
          fileTargetKind: fileTarget.kind,
          hostId: fileTarget.hostId,
          selectedDirectory,
        });
      await runWithConflictPreflight({
        errorMessagePrefix: "批量下载失败",
        input: buildPlan(),
        localRootPath: selectedDirectory,
        run: async (conflictPolicy) => {
          const plan = buildPlan(conflictPolicy);
          await runSftpTransferBatchPlan(plan, runTransferTask);
          setOperationStatus(visiblePostTransferStatus(plan.completionStatus));
        },
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

  const downloadEntryAsArchive = async (entry: SftpEntry) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    const preparation = buildSftpArchiveDownloadPreparation(entry);
    if (preparation.kind === "unsupported") {
      setOperationStatus(preparation.status);
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    let errorMessagePrefix = "下载为 ZIP 失败";
    try {
      const targetLocalPath = await selectSaveFile(
        preparation.defaultLocalFileName,
      );
      if (!targetLocalPath) {
        return;
      }
      const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
        buildSftpArchiveDownloadPlan({
          conflictPolicy,
          entry,
          hostId: fileTarget.hostId,
          targetLocalPath,
        });
      const plan = buildPlan();
      if (plan.kind === "unsupported") {
        setOperationStatus(plan.status);
        return;
      }
      errorMessagePrefix = plan.errorMessagePrefix;
      await runSftpArchiveDownloadPlanWithPreflight({
        buildPlan,
        refreshTransfers,
        runWithConflictPreflight,
        setOperationStatus,
        setTransfers,
        viewScope,
      });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `${errorMessagePrefix}：${errorMessage(nextError)}`,
      });
    }
  };

  const downloadEntryToLocalClipboard = async (entry: SftpEntry) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    const plan = buildSftpClipboardDownloadPlan({
      entry,
      hostId: fileTarget.hostId,
    });
    if (plan.kind === "unsupported") {
      setOperationStatus(plan.status);
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const summary = await enqueueSftpClipboardDownload(
        withSftpTransferViewScope(plan.request, viewScope),
      );
      setTransfers((current) => mergeTransferSnapshot(current, summary));
      setOperationStatus(null);
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `${plan.errorMessagePrefix}：${errorMessage(nextError)}`,
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
    let errorMessagePrefix = "上传为 ZIP 失败";
    try {
      const sourceLocalPath =
        kind === "directory"
          ? await selectLocalDirectory()
          : await selectLocalFile();
      if (!sourceLocalPath) {
        return;
      }
      const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
        buildSftpArchiveUploadPlan({
          conflictPolicy,
          destinationRemotePath,
          hostId: fileTarget.hostId,
          kind,
          sourceLocalPath,
        });
      const plan = buildPlan();
      errorMessagePrefix = plan.errorMessagePrefix;
      await runSftpArchiveUploadPlanWithPreflight({
        buildPlan,
        refreshTransfers,
        runWithConflictPreflight,
        setOperationStatus,
        setTransfers,
        viewScope,
      });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `${errorMessagePrefix}：${errorMessage(nextError)}`,
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
      copySelectedRemoteItem();
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
