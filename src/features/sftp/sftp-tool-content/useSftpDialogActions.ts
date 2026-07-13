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
import {
  createSftpTargetBindingSnapshot,
  type SftpTargetBindingToken,
  type SftpTargetBoundDirectoryLoader,
} from "./useSftpTargetLifecycle";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "./types";

type UseSftpDialogActionsArgs = {
  captureTarget?: (
    expectedTarget?: SftpFileTarget | null,
  ) => SftpTargetBindingToken | null;
  currentPath: string;
  dialogAction: SftpDialogAction | null;
  fileTarget: SftpFileTarget | null;
  isTargetBindingCurrent?: (binding: SftpTargetBindingToken | null) => boolean;
  loadDirectory: SftpTargetBoundDirectoryLoader;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogBusy: Dispatch<SetStateAction<boolean>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
};

/** 冻结提交时的远端目标，并阻止旧目标操作完成后回写当前界面。 */
export function useSftpDialogActions({
  captureTarget,
  currentPath,
  dialogAction,
  fileTarget,
  isTargetBindingCurrent,
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

  const captureDialogTarget = () => {
    if (captureTarget) {
      return captureTarget(fileTarget);
    }
    return fileTarget ? createSftpTargetBindingSnapshot(fileTarget) : null;
  };

  const bindingIsCurrent = (binding: SftpTargetBindingToken | null) =>
    isTargetBindingCurrent ? isTargetBindingCurrent(binding) : Boolean(binding);

  const reloadDirectory = (path: string, binding: SftpTargetBindingToken) =>
    captureTarget ? loadDirectory(path, binding) : loadDirectory(path);

  const runDialogOperations = async (operations: SftpDialogOperation[]) => {
    const failures: string[] = [];
    for (const operation of operations) {
      try {
        await runDialogOperation(operation);
      } catch (nextError) {
        failures.push(
          `${dialogOperationPath(operation)}：${errorMessage(nextError)}`,
        );
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
      setOperationStatus({
        kind: "info",
        message: "请先选择要删除的远程项目。",
      });
      return;
    }
    setDialogAction({
      entries: dedupeDeleteEntries(entries),
      kind: "delete",
    });
  };

  const submitDialogAction = async () => {
    const binding = captureDialogTarget();
    if (!dialogAction || !binding) {
      return;
    }

    // 对话框可能跨越多个 await，动作、路径和目标必须在提交瞬间一起冻结。
    const action = dialogAction;
    const operationPath = currentPath;
    const blocker = getDialogActionBlocker(action, operationPath);
    if (blocker) {
      setDialogStatus({ kind: "error", message: blocker });
      return;
    }

    setDialogBusy(true);
    setDialogStatus(null);
    setOperationStatus(null);
    try {
      const plan = buildSftpDialogActionPlan({
        action,
        currentPath: operationPath,
        fileTarget: binding.target,
      });
      const failures = await runDialogOperations(plan.operations);
      if (!bindingIsCurrent(binding)) {
        return;
      }
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
          await reloadDirectory(plan.reloadPath, binding);
        }
        return;
      }
      await reloadDirectory(plan.reloadPath, binding);
      if (!bindingIsCurrent(binding)) {
        return;
      }
      setOperationStatus(plan.successStatus);
      setDialogAction(null);
    } catch (nextError) {
      if (!bindingIsCurrent(binding)) {
        return;
      }
      setOperationStatus({
        kind: "error",
        message: errorMessage(nextError),
      });
      setDialogStatus({
        kind: "error",
        message: "文件操作未完成。请检查名称、权限或目标位置后重试。",
      });
    } finally {
      if (bindingIsCurrent(binding)) {
        setDialogBusy(false);
      }
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
