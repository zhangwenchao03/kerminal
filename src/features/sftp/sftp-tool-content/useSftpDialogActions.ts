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
import { getDialogActionBlocker } from "./sftpDialogModel";
import {
  defaultRenamePath,
  errorMessage,
  joinRemotePath,
  modeFromPermissions,
  resolveRemoteInputPath,
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
      if (dialogAction.kind === "mkdir") {
        const path = resolveRemoteInputPath(currentPath, dialogAction.path);
        if (fileTarget.kind === "ssh") {
          await createSftpDirectory({
            hostId: fileTarget.hostId,
            path,
          });
        } else {
          await createDockerContainerDirectory({
            containerId: fileTarget.containerId,
            hostId: fileTarget.hostId,
            path,
            runtime: fileTarget.runtime,
          });
        }
        await loadDirectory(currentPath);
        setOperationStatus({ kind: "success", message: `目录已创建：${path}` });
      }

      if (dialogAction.kind === "rename") {
        const toPath = resolveRemoteInputPath(currentPath, dialogAction.toPath);
        if (fileTarget.kind === "ssh") {
          await renameSftpPath({
            fromPath: dialogAction.entry.path,
            hostId: fileTarget.hostId,
            toPath,
          });
        } else {
          await renameDockerContainerPath({
            containerId: fileTarget.containerId,
            fromPath: dialogAction.entry.path,
            hostId: fileTarget.hostId,
            runtime: fileTarget.runtime,
            toPath,
          });
        }
        await loadDirectory(currentPath);
        setOperationStatus({
          kind: "success",
          message: `已重命名：${dialogAction.entry.path} -> ${toPath}`,
        });
      }

      if (dialogAction.kind === "chmod") {
        if (fileTarget.kind === "ssh") {
          await chmodSftpPath({
            hostId: fileTarget.hostId,
            mode: dialogAction.mode.trim(),
            path: dialogAction.entry.path,
          });
        } else {
          await chmodDockerContainerPath({
            containerId: fileTarget.containerId,
            hostId: fileTarget.hostId,
            mode: dialogAction.mode.trim(),
            path: dialogAction.entry.path,
            runtime: fileTarget.runtime,
          });
        }
        await loadDirectory(currentPath);
        setOperationStatus({
          kind: "success",
          message: `权限已修改：${dialogAction.entry.path}`,
        });
      }

      if (dialogAction.kind === "delete") {
        if (fileTarget.kind === "ssh") {
          await deleteSftpPath({
            directory: dialogAction.entry.kind === "directory",
            hostId: fileTarget.hostId,
            path: dialogAction.entry.path,
          });
        } else {
          await deleteDockerContainerPath({
            containerId: fileTarget.containerId,
            directory: dialogAction.entry.kind === "directory",
            hostId: fileTarget.hostId,
            path: dialogAction.entry.path,
            runtime: fileTarget.runtime,
          });
        }
        await loadDirectory(currentPath);
        setOperationStatus({
          kind: "success",
          message: `已删除：${dialogAction.entry.path}`,
        });
      }

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
