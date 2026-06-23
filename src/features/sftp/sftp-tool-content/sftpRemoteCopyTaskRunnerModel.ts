/**
 * SFTP remote copy queue execution model.
 *
 * @author kongweiguang
 */

import type { SftpRemoteCopyRequest } from "../../../lib/sftpApi";
import type { SftpRemoteCopyPlan } from "./sftpRemoteTransferModel";
import type { SftpStatus } from "./types";

export type SftpRemoteCopyTaskExecutionPlan =
  | {
      kind: "empty";
      status: SftpStatus;
    }
  | {
      failureMessagePrefix: string;
      kind: "queue";
      requests: SftpRemoteCopyRequest[];
      successStatus: SftpStatus | null;
    };

type BuildSftpRemoteCopyTaskExecutionPlanOptions = {
  failureMessagePrefix?: string;
  plan: SftpRemoteCopyPlan;
};

type SftpRemoteCopyTaskFailureStatusOptions = {
  failureMessagePrefix: string;
  reason: string;
};

export function buildSftpRemoteCopyTaskExecutionPlan({
  failureMessagePrefix,
  plan,
}: BuildSftpRemoteCopyTaskExecutionPlanOptions): SftpRemoteCopyTaskExecutionPlan {
  if (plan.requests.length === 0) {
    return {
      kind: "empty",
      status: {
        kind: "info",
        message: "没有可入队的远程传输项目。",
      },
    };
  }

  return {
    failureMessagePrefix: failureMessagePrefix ?? `${plan.targetDescription}入队失败`,
    kind: "queue",
    requests: [...plan.requests],
    successStatus: null,
  };
}

export function statusForSftpRemoteCopyTaskFailure({
  failureMessagePrefix,
  reason,
}: SftpRemoteCopyTaskFailureStatusOptions): SftpStatus {
  return {
    kind: "error",
    message: `${failureMessagePrefix}：${reason}`,
  };
}
