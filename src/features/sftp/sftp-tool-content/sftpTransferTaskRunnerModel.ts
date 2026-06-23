/**
 * SFTP transfer task execution strategy model.
 *
 * @author kongweiguang
 */

import type { DockerContainerTransferRequest } from "../../../lib/containerFilesApi";
import type { SftpManagedTransferRequest } from "../../../lib/sftpApi";
import {
  buildDockerContainerTransferRequest,
  shouldRefreshAfterDockerUpload,
  statusForDockerDirectTransfer,
  type SftpTransferActionItem,
} from "./sftpTransferActionPlan";
import type { SftpFileTarget, SftpStatus } from "./types";

export type SftpTransferTaskExecutionPlan =
  | {
      kind: "noop";
    }
  | {
      kind: "sshQueue";
      queuedStatus: SftpStatus;
      request: SftpManagedTransferRequest;
    }
  | {
      containerRequest: DockerContainerTransferRequest;
      direction: SftpManagedTransferRequest["direction"];
      kind: "dockerDirect";
      refreshRemotePath: string | null;
      runningStatus: SftpStatus;
      successStatus: SftpStatus;
    };

type BuildSftpTransferTaskExecutionPlanOptions = {
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  transferPlan: SftpTransferActionItem;
};

export function buildSftpTransferTaskExecutionPlan({
  currentPath,
  fileTarget,
  transferPlan,
}: BuildSftpTransferTaskExecutionPlanOptions): SftpTransferTaskExecutionPlan {
  if (!fileTarget) {
    return { kind: "noop" };
  }

  const { request } = transferPlan;
  if (fileTarget.kind === "ssh") {
    return {
      kind: "sshQueue",
      queuedStatus: transferPlan.queuedStatus,
      request,
    };
  }

  return {
    containerRequest: buildDockerContainerTransferRequest(fileTarget, request),
    direction: request.direction,
    kind: "dockerDirect",
    refreshRemotePath: shouldRefreshAfterDockerUpload(request, currentPath)
      ? currentPath
      : null,
    runningStatus: statusForDockerDirectTransfer(request, "running"),
    successStatus: statusForDockerDirectTransfer(request, "success"),
  };
}
