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
  getDialogActionBlocker,
  type SftpDialogOperation,
} from "./sftpDialogModel";
import {
  defaultRenamePath,
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
      toPath: defaultRenamePath(entry),
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

  const openDeleteDialog = (entry: SftpEntry) => {
    setContextMenu(null);
    setDialogStatus(null);
    setDialogAction({
      entry,
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
      await runDialogOperation(plan.operation);
      await loadDirectory(plan.reloadPath);
      setOperationStatus(plan.successStatus);
      setDialogAction(null);
    } catch (nextError) {
      setDialogStatus({
        kind: "error",
        message: errorMessage(nextError),
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
