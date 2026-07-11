import type { Dispatch, SetStateAction } from "react";
import {
  chmodDockerContainerPath,
  createDockerContainerDirectory,
  deleteDockerContainerPath,
  renameDockerContainerPath,
} from "../../../lib/containerFilesApi";
import {
  chmodSftpPath,
  createSftpDirectory,
  deleteSftpPath,
  renameSftpPath,
  type SftpEntry,
} from "../../../lib/sftpApi";
import {
  buildSftpDialogActionPlan,
  dedupeDeleteEntries,
  getDialogActionBlocker,
  type SftpDialogOperation,
} from "./sftpDialogModel";
import {
  errorMessage,
  joinRemotePath,
  modeFromPermissions,
} from "./sftpPathModel";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "./types";

type UseSftpDialogActionsArgs = {
  currentPath: string;
  dialogAction: SftpDialogAction | null;
  fileTarget: SftpFileTarget | null;
  loadDirectory: (path: string) => Promise<void>;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogBusy: Dispatch<SetStateAction<boolean>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
};

export function useSftpDialogActions({
  currentPath,
  dialogAction,
  fileTarget,
  loadDirectory,
  setContextMenu,
  setDialogAction,
  setDialogBusy,
  setDialogStatus,
  setOperationStatus,
}: UseSftpDialogActionsArgs) {
  const runDialogOperation = async (operation: SftpDialogOperation) => {
    if (operation.targetKind === "ssh") {
      if (operation.kind === "mkdir") {
        await createSftpDirectory(operation.request);
        return;
      }
      if (operation.kind === "rename") {
        await renameSftpPath(operation.request);
        return;
      }
      if (operation.kind === "chmod") {
        await chmodSftpPath(operation.request);
        return;
      }
      await deleteSftpPath(operation.request);
      return;
    }

    if (operation.kind === "mkdir") {
      await createDockerContainerDirectory(operation.request);
      return;
    }
    if (operation.kind === "rename") {
      await renameDockerContainerPath(operation.request);
      return;
    }
    if (operation.kind === "chmod") {
      await chmodDockerContainerPath(operation.request);
      return;
    }
    await deleteDockerContainerPath(operation.request);
  };

  const runDialogOperations = async (operations: SftpDialogOperation[]) => {
    const failures: string[] = [];
    for (const operation of operations) {
      try {
        await runDialogOperation(operation);
      } catch (nextError) {
        failures.push(`${dialogOperationPath(operation)}：${errorMessage(nextError)}`);
      }
    }
    return failures;
  };

  const openNewDirectoryDialog = () => {
    setContextMenu(null);
    setDialogStatus(null);
    setDialogAction({
      kind: "mkdir",
      path: joinRemotePath(currentPath, "new-folder"),
    });
  };

  const openRenameDialog = (entry: SftpEntry) => {
    setContextMenu(null);
    setDialogStatus(null);
    setDialogAction({
      entry,
      kind: "rename",
      newName: entry.name,
    });
  };

  const openChmodDialog = (entry: SftpEntry) => {
    setContextMenu(null);
    setDialogStatus(null);
    setDialogAction({
      entry,
      kind: "chmod",
      mode: modeFromPermissions(entry.permissions),
    });
  };

  const openDeleteDialog = (entries: SftpEntry[]) => {
    setContextMenu(null);
    setDialogStatus(null);
    if (entries.length === 0) {
      setOperationStatus({ kind: "info", message: "请先选择要删除的远程项目。" });
      return;
    }
    setDialogAction({
      entries: dedupeDeleteEntries(entries),
      kind: "delete",
    });
  };

  const submitDialogAction = async () => {
    if (!dialogAction || !fileTarget) {
      return;
    }

    const blocker = getDialogActionBlocker(dialogAction, currentPath);
    if (blocker) {
      setDialogStatus({ kind: "error", message: blocker });
      return;
    }

    setDialogBusy(true);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const plan = buildSftpDialogActionPlan({
        action: dialogAction,
        currentPath,
        fileTarget,
      });
      const failures = await runDialogOperations(plan.operations);
      if (failures.length > 0) {
        const successCount = plan.operations.length - failures.length;
        setOperationStatus({
          kind: "error",
          message: failures.join("\n"),
        });
        setDialogStatus({
          kind: "error",
          message:
            successCount > 0
              ? `已完成 ${successCount} 项，${failures.length} 项未处理。请检查权限或目标位置后重试。`
              : "文件操作未完成。请检查名称、权限或目标位置后重试。",
        });
        if (successCount > 0) {
          await loadDirectory(plan.reloadPath);
        }
        return;
      }
      await loadDirectory(plan.reloadPath);
      setOperationStatus(plan.successStatus);
      setDialogAction(null);
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
      setDialogStatus({
        kind: "error",
        message: "文件操作未完成。请检查名称、权限或目标位置后重试。",
      });
    } finally {
      setDialogBusy(false);
    }
  };

  return {
    openChmodDialog,
    openDeleteDialog,
    openNewDirectoryDialog,
    openRenameDialog,
    submitDialogAction,
  };
}

function dialogOperationPath(operation: SftpDialogOperation) {
  if (operation.kind === "mkdir") {
    return operation.request.path;
  }
  if (operation.kind === "rename") {
    return operation.request.fromPath;
  }
  return operation.request.path;
}
