import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  selectLocalDirectory,
  selectLocalFile,
  selectSaveFile,
} from "../../../lib/fileDialogApi";
import {
  classifySftpLocalPaths,
  enqueueSftpClipboardDownload,
  type SftpEntry,
  type SftpTransferConflictPolicy,
  type SftpTransferKind,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import { mergeTransferSnapshot } from "../sftpTransferModel";
import { isDownloadableFileEntry } from "./sftpEntryModel";
import { errorMessage } from "./sftpPathModel";
import {
  buildBatchDownloadTransferPlan,
  buildDirectoryDownloadTransferPlan,
  buildDirectoryUploadTransferPlan,
  buildDownloadSelectionPlan,
  buildDownloadTransferPlan,
  buildFileUploadTransferPlan,
  buildLocalPathBatchUploadPlan,
  buildSftpArchiveDownloadPlan,
  buildSftpArchiveDownloadPreparation,
  buildSftpArchiveUploadPlan,
  buildSftpClipboardDownloadPlan,
  type SftpTransferActionItem,
} from "./sftpTransferActionPlan";
import { runSftpTransferBatchPlan } from "./sftpTransferActionRunner";
import type { SftpTransferConflictPreflightInput } from "./sftpTransferConflictPreflight";
import { sanitizeSftpTransferSummary } from "../useSftpTransferQueueSync";
import { withSftpTransferViewScope } from "./sftpTransferScopeModel";
import {
  runSftpArchiveDownloadPlanWithPreflight,
  runSftpArchiveUploadPlanWithPreflight,
  visiblePostTransferStatus,
} from "./useSftpTransferActions.helpers";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "./types";

type RunTransferTask = (plan: SftpTransferActionItem) => Promise<void>;

type RunWithConflictPreflight = (options: {
  errorMessagePrefix?: string;
  input: SftpTransferConflictPreflightInput;
  localRootPath?: string;
  run: (policy?: SftpTransferConflictPolicy) => Promise<void>;
}) => Promise<void>;

interface UseSftpLocalTransferCommandsArgs {
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  runTransferTask: RunTransferTask;
  runWithConflictPreflight: RunWithConflictPreflight;
  refreshTransfers: () => Promise<void>;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  transferableSelectedEntries: SftpEntry[];
  viewScope?: string | null;
}

/**
 * 编排本地文件选择与 SFTP 上传、下载命令。
 * 传输执行和冲突确认仍由上层 runner 提供，以保持目标快照与队列作用域。
 */
export function useSftpLocalTransferCommands({
  currentPath,
  fileTarget,
  runTransferTask,
  runWithConflictPreflight,
  refreshTransfers,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setOperationStatus,
  setTransfers,
  transferableSelectedEntries,
  viewScope,
}: UseSftpLocalTransferCommandsArgs) {
  const clearTransientState = useCallback(() => {
    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
  }, [
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setOperationStatus,
  ]);

  const uploadLocalFile = async (targetRemotePath = currentPath) => {
    if (!fileTarget) {
      return;
    }

    clearTransientState();
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
      setOperationStatus({ kind: "error", message: errorMessage(nextError) });
    }
  };

  const uploadLocalDirectory = async (targetRemotePath = currentPath) => {
    if (!fileTarget) {
      return;
    }

    clearTransientState();
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
      setOperationStatus({ kind: "error", message: errorMessage(nextError) });
    }
  };

  const uploadDroppedLocalPaths = useCallback(
    async (paths: string[], targetRemotePath = currentPath) => {
      if (!fileTarget || paths.length === 0) {
        return;
      }

      clearTransientState();
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
            setOperationStatus(visiblePostTransferStatus(plan.completionStatus));
          },
        });
      } catch (nextError) {
        setOperationStatus({
          kind: "error",
          message: `拖拽上传失败：${errorMessage(nextError)}`,
        });
      }
    },
    [
      clearTransientState,
      currentPath,
      fileTarget,
      runTransferTask,
      runWithConflictPreflight,
      setOperationStatus,
    ],
  );

  const downloadEntry = async (entry: SftpEntry) => {
    if (!fileTarget) {
      return;
    }

    clearTransientState();
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
      setOperationStatus({ kind: "error", message: errorMessage(nextError) });
    }
  };

  const downloadEntryAsArchive = async (entry: SftpEntry) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    const preparation = buildSftpArchiveDownloadPreparation(entry);
    if (preparation.kind === "unsupported") {
      setOperationStatus(preparation.status);
      return;
    }

    clearTransientState();
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

    clearTransientState();
    try {
      const summary = await enqueueSftpClipboardDownload(
        withSftpTransferViewScope(plan.request, viewScope),
      );
      setTransfers((current) =>
        mergeTransferSnapshot(current, sanitizeSftpTransferSummary(summary)),
      );
      setOperationStatus(null);
      void refreshTransfers();
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `${plan.errorMessagePrefix}：${errorMessage(nextError)}`,
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

    clearTransientState();
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

  const uploadLocalArchive = async (
    kind: SftpTransferKind,
    destinationRemotePath = currentPath,
  ) => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    clearTransientState();
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

  return {
    downloadEntriesToLocalTarget,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadEntry,
    downloadSelectedEntries,
    uploadDroppedLocalPaths,
    uploadLocalDirectory,
    uploadLocalArchive,
    uploadLocalFile,
  };
}
