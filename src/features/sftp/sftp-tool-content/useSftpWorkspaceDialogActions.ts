import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { SftpEntry } from "../../../lib/sftpApi";
import {
  buildOpenWorkspaceDirectoryDialog,
  buildOpenWorkspaceEditorDialog,
  resolveWorkspaceDialogCloseDecision,
} from "./sftpWorkspaceDialogModel";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
  SftpWorkspaceDialog,
} from "./types";

type UseSftpWorkspaceDialogActionsArgs = {
  fileTarget: SftpFileTarget | null;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
};

export function useSftpWorkspaceDialogActions({
  fileTarget,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setOperationStatus,
}: UseSftpWorkspaceDialogActionsArgs) {
  const [workspaceDialog, setWorkspaceDialog] =
    useState<SftpWorkspaceDialog | null>(null);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceCloseBlocked, setWorkspaceCloseBlocked] = useState(false);
  const [workspaceCloseConfirmationOpen, setWorkspaceCloseConfirmationOpen] =
    useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);

  const resetWorkspaceState = useCallback(() => {
    setWorkspaceDialog(null);
    setWorkspaceDirty(false);
    setWorkspaceCloseBlocked(false);
    setWorkspaceCloseConfirmationOpen(false);
    setWorkspaceExpanded(false);
  }, []);

  const clearWorkspaceActionState = useCallback(() => {
    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    setWorkspaceDirty(false);
    setWorkspaceCloseBlocked(false);
    setWorkspaceCloseConfirmationOpen(false);
    setWorkspaceExpanded(false);
  }, [setContextMenu, setDialogAction, setDialogStatus, setOperationStatus]);

  const openWorkspaceDirectory = useCallback(
    (path: string) => {
      if (!fileTarget) {
        return;
      }

      clearWorkspaceActionState();
      setWorkspaceDialog(buildOpenWorkspaceDirectoryDialog(path));
    },
    [clearWorkspaceActionState, fileTarget],
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

      if (!fileTarget) {
        return;
      }

      clearWorkspaceActionState();
      setWorkspaceDialog(plan.dialog);
    },
    [clearWorkspaceActionState, fileTarget, setOperationStatus],
  );

  const closeWorkspaceDialog = useCallback(() => {
    const decision = resolveWorkspaceDialogCloseDecision({
      confirmed: !workspaceDirty,
      dirty: workspaceDirty,
    });
    if (decision.kind === "blocked") {
      setWorkspaceCloseBlocked(true);
      setWorkspaceCloseConfirmationOpen(true);
      return;
    }
    resetWorkspaceState();
  }, [resetWorkspaceState, workspaceDirty]);

  const cancelWorkspaceCloseConfirmation = useCallback(() => {
    setWorkspaceCloseConfirmationOpen(false);
    setWorkspaceCloseBlocked(true);
  }, []);

  const confirmWorkspaceDialogClose = useCallback(() => {
    resetWorkspaceState();
  }, [resetWorkspaceState]);

  return {
    cancelWorkspaceCloseConfirmation,
    closeWorkspaceDialog,
    confirmWorkspaceDialogClose,
    openEditorEntry,
    openWorkspaceDirectory,
    resetWorkspaceDialog: resetWorkspaceState,
    setWorkspaceCloseBlocked,
    setWorkspaceDirty,
    setWorkspaceExpanded,
    workspaceCloseConfirmationOpen,
    workspaceCloseBlocked,
    workspaceDialog,
    workspaceDirty,
    workspaceExpanded,
  };
}
