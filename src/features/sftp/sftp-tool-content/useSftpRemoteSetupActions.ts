/**
 * SFTP remote setup action facade.
 *
 * @author kongweiguang
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { executeSshCommand } from "../../../lib/sshCommandApi";
import { trustSftpHostKey } from "../../../lib/sftpApi";
import {
  buildSftpCwdTrackingSetupPlan,
  buildSftpHostKeyTrustPlan,
  resolveSftpCwdTrackingSetupOutput,
  statusForHostKeyTrustError,
  statusForSftpCwdTrackingSetupError,
  statusForTrustedHostKey,
} from "./sftpRemoteSetupModel";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "./types";

type UseSftpRemoteSetupActionsArgs = {
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  loadDirectory: (path: string) => Promise<void>;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
};

export function useSftpRemoteSetupActions({
  currentPath,
  fileTarget,
  loadDirectory,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setOperationStatus,
}: UseSftpRemoteSetupActionsArgs) {
  const [cwdTrackingSetupBusy, setCwdTrackingSetupBusy] = useState(false);
  const [hostKeyTrustBusy, setHostKeyTrustBusy] = useState(false);

  useEffect(() => {
    setHostKeyTrustBusy(false);
  }, [fileTarget]);

  const trustHostKey = useCallback(async () => {
    const plan = buildSftpHostKeyTrustPlan(fileTarget);
    if (plan.kind === "skip") {
      return;
    }

    setHostKeyTrustBusy(true);
    setOperationStatus(null);
    try {
      const summary = await trustSftpHostKey(plan.request);
      await loadDirectory(currentPath);
      setOperationStatus(statusForTrustedHostKey(summary));
    } catch (nextError) {
      setOperationStatus(statusForHostKeyTrustError(nextError));
    } finally {
      setHostKeyTrustBusy(false);
    }
  }, [currentPath, fileTarget, loadDirectory, setOperationStatus]);

  const setupRemoteCwdTracking = useCallback(async () => {
    const plan = buildSftpCwdTrackingSetupPlan(fileTarget);
    if (plan.kind === "skip") {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(plan.startStatus);
    setCwdTrackingSetupBusy(true);
    try {
      const output = await executeSshCommand(plan.request);
      setOperationStatus(resolveSftpCwdTrackingSetupOutput(output).status);
    } catch (nextError) {
      setOperationStatus(statusForSftpCwdTrackingSetupError(nextError));
    } finally {
      setCwdTrackingSetupBusy(false);
    }
  }, [
    fileTarget,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setOperationStatus,
  ]);

  return {
    cwdTrackingSetupBusy,
    hostKeyTrustBusy,
    setupRemoteCwdTracking,
    trustHostKey,
  };
}
