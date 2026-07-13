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
import {
  createSftpTargetBindingSnapshot,
  sftpFileTargetBindingKey,
  type SftpTargetBindingToken,
  type SftpTargetBoundDirectoryLoader,
} from "./useSftpTargetLifecycle";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "./types";

type UseSftpRemoteSetupActionsArgs = {
  captureTarget?: (
    expectedTarget?: SftpFileTarget | null,
  ) => SftpTargetBindingToken | null;
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  isTargetBindingCurrent?: (binding: SftpTargetBindingToken | null) => boolean;
  loadDirectory: SftpTargetBoundDirectoryLoader;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
};

/** 对主机密钥和目录跟随设置应用统一的目标代次门禁。 */
export function useSftpRemoteSetupActions({
  captureTarget,
  currentPath,
  fileTarget,
  isTargetBindingCurrent,
  loadDirectory,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setOperationStatus,
}: UseSftpRemoteSetupActionsArgs) {
  const [cwdTrackingSetupBusy, setCwdTrackingSetupBusy] = useState(false);
  const [hostKeyTrustBusy, setHostKeyTrustBusy] = useState(false);
  const targetBindingKey = sftpFileTargetBindingKey(fileTarget);

  useEffect(() => {
    setCwdTrackingSetupBusy(false);
    setHostKeyTrustBusy(false);
  }, [targetBindingKey]);

  const captureSetupTarget = useCallback(() => {
    if (captureTarget) {
      return captureTarget(fileTarget);
    }
    return fileTarget ? createSftpTargetBindingSnapshot(fileTarget) : null;
  }, [captureTarget, fileTarget]);

  const bindingIsCurrent = useCallback(
    (binding: SftpTargetBindingToken | null) =>
      isTargetBindingCurrent
        ? isTargetBindingCurrent(binding)
        : Boolean(binding),
    [isTargetBindingCurrent],
  );

  const reloadDirectory = useCallback(
    (path: string, binding: SftpTargetBindingToken) =>
      captureTarget ? loadDirectory(path, binding) : loadDirectory(path),
    [captureTarget, loadDirectory],
  );

  const trustHostKey = useCallback(async () => {
    const binding = captureSetupTarget();
    if (!binding) {
      return;
    }
    const plan = buildSftpHostKeyTrustPlan(binding.target);
    if (plan.kind === "skip") {
      return;
    }

    setHostKeyTrustBusy(true);
    setOperationStatus(null);
    try {
      const summary = await trustSftpHostKey(plan.request);
      if (!bindingIsCurrent(binding)) {
        return;
      }
      await reloadDirectory(currentPath, binding);
      if (!bindingIsCurrent(binding)) {
        return;
      }
      setOperationStatus(statusForTrustedHostKey(summary));
    } catch (nextError) {
      if (!bindingIsCurrent(binding)) {
        return;
      }
      setOperationStatus(statusForHostKeyTrustError(nextError));
    } finally {
      if (bindingIsCurrent(binding)) {
        setHostKeyTrustBusy(false);
      }
    }
  }, [
    bindingIsCurrent,
    captureSetupTarget,
    currentPath,
    reloadDirectory,
    setOperationStatus,
  ]);

  const setupRemoteCwdTracking = useCallback(async () => {
    const binding = captureSetupTarget();
    if (!binding) {
      return;
    }
    const plan = buildSftpCwdTrackingSetupPlan(binding.target);
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
      if (!bindingIsCurrent(binding)) {
        return;
      }
      setOperationStatus(resolveSftpCwdTrackingSetupOutput(output).status);
    } catch (nextError) {
      if (!bindingIsCurrent(binding)) {
        return;
      }
      setOperationStatus(statusForSftpCwdTrackingSetupError(nextError));
    } finally {
      if (bindingIsCurrent(binding)) {
        setCwdTrackingSetupBusy(false);
      }
    }
  }, [
    bindingIsCurrent,
    captureSetupTarget,
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
