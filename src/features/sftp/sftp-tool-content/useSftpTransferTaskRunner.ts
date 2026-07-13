/**
 * Facade hook for SFTP transfer execution strategies.
 *
 * @author kongweiguang
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  downloadDockerContainerPath,
  uploadDockerContainerPath,
} from "../../../lib/containerFilesApi";
import {
  enqueueSftpTransfer,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { technicalDetailFromUnknown } from "../../../lib/userFacingMessage";
import { mergeTransferSnapshot } from "../sftpTransferModel";
import { sanitizeSftpTransferSummary } from "../useSftpTransferQueueSync";
import { buildDockerDirectTransferSummary } from "./sftpDockerDirectTransferModel";
import type { SftpTransferActionItem } from "./sftpTransferActionPlan";
import { withSftpTransferViewScope } from "./sftpTransferScopeModel";
import { buildSftpTransferTaskExecutionPlan } from "./sftpTransferTaskRunnerModel";
import {
  createSftpTargetBindingSnapshot,
  type SftpTargetBindingToken,
  type SftpTargetBoundDirectoryLoader,
} from "./useSftpTargetLifecycle";
import type { SftpFileTarget, SftpStatus } from "./types";

type UseSftpTransferTaskRunnerArgs = {
  captureTarget?: (
    expectedTarget?: SftpFileTarget | null,
  ) => SftpTargetBindingToken | null;
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  isTargetBindingCurrent?: (binding: SftpTargetBindingToken | null) => boolean;
  loadDirectory: SftpTargetBoundDirectoryLoader;
  refreshTransfers: () => Promise<void>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  viewScope?: string | null;
};

/** 以动作发起时的目标快照执行传输，并拒绝旧代次完成回调。 */
export function useSftpTransferTaskRunner({
  captureTarget,
  currentPath,
  fileTarget,
  isTargetBindingCurrent,
  loadDirectory,
  refreshTransfers,
  setOperationStatus,
  setTransfers,
  viewScope,
}: UseSftpTransferTaskRunnerArgs) {
  const runTransferTask = useCallback(
    async (transferPlan: SftpTransferActionItem) => {
      const binding = captureTransferBinding(
        fileTarget,
        captureTarget ?? loadDirectory.captureTarget,
      );
      if (!binding) {
        return;
      }
      const bindingIsCurrent = () =>
        transferBindingIsCurrent(
          binding,
          isTargetBindingCurrent ?? loadDirectory.isTargetBindingCurrent,
        );
      const hasTargetLifecycle = Boolean(
        captureTarget ?? loadDirectory.captureTarget,
      );
      const executionPlan = buildSftpTransferTaskExecutionPlan({
        currentPath,
        fileTarget: binding.target,
        transferPlan,
      });
      if (executionPlan.kind === "noop") {
        return;
      }
      if (executionPlan.kind === "sshQueue") {
        const summary = await enqueueSftpTransfer(
          withSftpTransferViewScope(executionPlan.request, viewScope),
        );
        if (!bindingIsCurrent()) {
          return;
        }
        setTransfers((current) =>
          mergeTransferSnapshot(current, sanitizeSftpTransferSummary(summary)),
        );
        setOperationStatus(null);
        void refreshTransfers();
        return;
      }

      const operationTarget = binding.target;
      if (operationTarget.kind !== "dockerContainer") {
        return;
      }

      const transferId = createDockerDirectTransferId();
      const createdAt = Date.now();
      const updateDockerTransferSnapshot = (
        status: "running" | "succeeded" | "failed",
        error?: string,
      ) => {
        if (!bindingIsCurrent()) {
          return;
        }
        setTransfers((current) =>
          mergeTransferSnapshot(
            current,
            buildDockerDirectTransferSummary({
              createdAt,
              direction: executionPlan.direction,
              error,
              fileTarget: operationTarget,
              id: transferId,
              request: executionPlan.containerRequest,
              status,
              updatedAt: Date.now(),
              viewScope,
            }),
          ),
        );
      };

      setOperationStatus(null);
      updateDockerTransferSnapshot("running");
      try {
        if (executionPlan.direction === "upload") {
          await uploadDockerContainerPath(executionPlan.containerRequest);
          if (executionPlan.refreshRemotePath) {
            await (hasTargetLifecycle
              ? loadDirectory(executionPlan.refreshRemotePath, binding)
              : loadDirectory(executionPlan.refreshRemotePath));
          }
        } else {
          await downloadDockerContainerPath(executionPlan.containerRequest);
        }
        if (!bindingIsCurrent()) {
          return;
        }
        updateDockerTransferSnapshot("succeeded");
      } catch (nextError) {
        updateDockerTransferSnapshot(
          "failed",
          technicalDetailFromUnknown(nextError),
        );
        throw nextError;
      }
    },
    [
      captureTarget,
      currentPath,
      fileTarget,
      isTargetBindingCurrent,
      loadDirectory,
      refreshTransfers,
      setOperationStatus,
      setTransfers,
      viewScope,
    ],
  );

  return { runTransferTask };
}

function captureTransferBinding(
  target: SftpFileTarget | null,
  captureTarget?: (
    expectedTarget?: SftpFileTarget | null,
  ) => SftpTargetBindingToken | null,
) {
  if (captureTarget) {
    return captureTarget(target);
  }
  return target ? createSftpTargetBindingSnapshot(target) : null;
}

function transferBindingIsCurrent(
  binding: SftpTargetBindingToken,
  isCurrent?: (binding: SftpTargetBindingToken | null) => boolean,
) {
  return isCurrent ? isCurrent(binding) : true;
}

function createDockerDirectTransferId() {
  return `docker-direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
