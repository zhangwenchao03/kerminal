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
import { mergeTransferSnapshot } from "../sftpTransferModel";
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
        setTransfers((current) => mergeTransferSnapshot(current, summary));
        setOperationStatus(null);
        void refreshTransfers();
        return;
      }

      setOperationStatus(executionPlan.runningStatus);
      if (executionPlan.direction === "upload") {
        await uploadDockerContainerPath(executionPlan.containerRequest);
        if (executionPlan.refreshRemotePath) {
          await loadDirectory(executionPlan.refreshRemotePath);
        }
        setOperationStatus(executionPlan.successStatus);
        return;
      }

      await downloadDockerContainerPath(executionPlan.containerRequest);
      setOperationStatus(executionPlan.successStatus);
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
