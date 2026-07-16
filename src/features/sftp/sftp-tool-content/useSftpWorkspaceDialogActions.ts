import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { SftpEntry } from "../../../lib/sftpApi";
import type { RemoteTargetRef } from "../../../lib/targetModel";
import type { OpenWorkspaceFileTabOptions } from "../../workspace/state/index";
import {
  buildOpenWorkspaceEditorDialog,
} from "./sftpWorkspaceDialogModel";
import type {
  SftpBrowserMode,
} from "./sftpBrowserModeModel";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "./types";

type UseSftpWorkspaceDialogActionsArgs = {
  fileTarget: SftpFileTarget | null;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setBrowserMode: Dispatch<SetStateAction<SftpBrowserMode>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  workspaceTarget: RemoteTargetRef | null;
};

export function useSftpWorkspaceDialogActions({
  fileTarget,
  onOpenWorkspaceFileTab,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setBrowserMode,
  setOperationStatus,
  workspaceTarget,
}: UseSftpWorkspaceDialogActionsArgs) {
  const clearWorkspaceActionState = useCallback(() => {
    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
  }, [setContextMenu, setDialogAction, setDialogStatus, setOperationStatus]);

  const openWorkspaceDirectory = useCallback(
    (path: string) => {
      if (!fileTarget) {
        return;
      }

      clearWorkspaceActionState();
      setBrowserMode("workspace");
      setOperationStatus({
        kind: "info",
        message: `已切到文件工作区：${path}`,
      });
    },
    [clearWorkspaceActionState, fileTarget, setBrowserMode, setOperationStatus],
  );

  const openEditorEntry = useCallback(
    (entry: SftpEntry) => {
      const plan = buildOpenWorkspaceEditorDialog({
        entry,
        nonce: Date.now(),
      });
      if (plan.kind === "unsupported") {
        setOperationStatus(plan.status);
        return;
      }

      if (!workspaceTarget && !fileTarget) {
        return;
      }

      clearWorkspaceActionState();
      if (workspaceTarget && onOpenWorkspaceFileTab) {
        onOpenWorkspaceFileTab({
          access: "editable",
          path: entry.path,
          rootPath: plan.dialog.rootPath,
          source:
            workspaceTarget.kind === "dockerContainer" ? "container" : "sftp",
          target: workspaceTarget,
        });
        return;
      }

      setOperationStatus({
        kind: "error",
        message: "中间文件 Tab 尚未接入，无法打开文件。",
      });
    },
    [
      clearWorkspaceActionState,
      fileTarget,
      onOpenWorkspaceFileTab,
      setOperationStatus,
      workspaceTarget,
    ],
  );

  return {
    openEditorEntry,
    openWorkspaceDirectory,
    resetWorkspaceDialog: clearWorkspaceActionState,
  };
}
