/**
 * Facade hook for SFTP remote copy queue execution.
 *
 * @author kongweiguang
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  enqueueSftpRemoteCopy,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { mergeTransferSnapshot } from "../sftpTransferModel";
import { sanitizeSftpTransferSummary } from "../useSftpTransferQueueSync";
import {
  buildSftpRemoteCopyTaskExecutionPlan,
  statusForSftpRemoteCopyTaskFailure,
} from "./sftpRemoteCopyTaskRunnerModel";
import type { SftpRemoteCopyPlan } from "./sftpRemoteTransferModel";
import { withSftpTransferViewScope } from "./sftpTransferScopeModel";
import { errorMessage } from "./sftpPathModel";
import type { SftpStatus } from "./types";

type UseSftpRemoteCopyTaskRunnerArgs = {
  refreshTransfers: () => Promise<void>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  viewScope?: string | null;
};

export function useSftpRemoteCopyTaskRunner({
  refreshTransfers,
  setOperationStatus,
  setTransfers,
  viewScope,
}: UseSftpRemoteCopyTaskRunnerArgs) {
  const runRemoteCopyTask = useCallback(
    async (plan: SftpRemoteCopyPlan) => {
      const executionPlan = buildSftpRemoteCopyTaskExecutionPlan({ plan });
      if (executionPlan.kind === "empty") {
        setOperationStatus(executionPlan.status);
        return;
      }

      try {
        for (const request of executionPlan.requests) {
          const summary = await enqueueSftpRemoteCopy(
            withSftpTransferViewScope(request, viewScope),
          );
          setTransfers((current) =>
            mergeTransferSnapshot(
              current,
              sanitizeSftpTransferSummary(summary),
            ),
          );
        }
        setOperationStatus(executionPlan.successStatus);
        void refreshTransfers();
      } catch (nextError) {
        setOperationStatus(
          statusForSftpRemoteCopyTaskFailure({
            failureMessagePrefix: executionPlan.failureMessagePrefix,
            reason: errorMessage(nextError),
          }),
        );
      }
    },
    [refreshTransfers, setOperationStatus, setTransfers, viewScope],
  );

  return { runRemoteCopyTask };
}
