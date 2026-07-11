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
import type { SftpFileTarget, SftpStatus } from "./types";

type UseSftpTransferTaskRunnerArgs = {
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  loadDirectory: (path: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  viewScope?: string | null;
};

export function useSftpTransferTaskRunner({
  currentPath,
  fileTarget,
  loadDirectory,
  refreshTransfers,
  setOperationStatus,
  setTransfers,
  viewScope,
}: UseSftpTransferTaskRunnerArgs) {
  const runTransferTask = useCallback(
    async (transferPlan: SftpTransferActionItem) => {
      const executionPlan = buildSftpTransferTaskExecutionPlan({
        currentPath,
        fileTarget,
        transferPlan,
      });
      if (executionPlan.kind === "noop") {
        return;
      }
      if (executionPlan.kind === "sshQueue") {
        const summary = await enqueueSftpTransfer(
          withSftpTransferViewScope(executionPlan.request, viewScope),
        );
        setTransfers((current) =>
          mergeTransferSnapshot(current, sanitizeSftpTransferSummary(summary)),
        );
        setOperationStatus(null);
        void refreshTransfers();
        return;
      }

      if (!fileTarget || fileTarget.kind !== "dockerContainer") {
        return;
      }

      const transferId = createDockerDirectTransferId();
      const createdAt = Date.now();
      const updateDockerTransferSnapshot = (
        status: "running" | "succeeded" | "failed",
        error?: string,
      ) => {
        setTransfers((current) =>
          mergeTransferSnapshot(
            current,
            buildDockerDirectTransferSummary({
              createdAt,
              direction: executionPlan.direction,
              error,
              fileTarget,
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
            await loadDirectory(executionPlan.refreshRemotePath);
          }
        } else {
          await downloadDockerContainerPath(executionPlan.containerRequest);
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
      currentPath,
      fileTarget,
      loadDirectory,
      refreshTransfers,
      setOperationStatus,
      setTransfers,
      viewScope,
    ],
  );

  return { runTransferTask };
}

function createDockerDirectTransferId() {
  return `docker-direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
