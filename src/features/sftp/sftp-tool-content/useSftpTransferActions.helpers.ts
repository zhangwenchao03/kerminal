import {
  enqueueSftpArchiveDownload,
  enqueueSftpArchiveUpload,
  type SftpArchiveDownloadRequest,
  type SftpArchiveUploadRequest,
  type SftpTransferConflictPolicy,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { mergeTransferSnapshot } from "../sftpTransferModel";
import type {
  SftpArchiveUploadPlan,
  SftpRemoteQueuedRequestPlan,
} from "./sftpTransferActionPlan";
import type { SftpTransferConflictPreflightInput } from "./sftpTransferConflictPreflight";
import { withSftpTransferViewScope } from "./sftpTransferScopeModel";
import type { SftpStatus } from "./types";

type ArchiveActionPlan<TRequest> = {
  errorMessagePrefix: string;
  request: TRequest;
};

type RunArchivePlanWithPreflightOptions<TRequest, TPlan extends ArchiveActionPlan<TRequest>> = {
  buildPlan: (conflictPolicy?: SftpTransferConflictPolicy) => TPlan;
  enqueue: (request: TRequest) => Promise<SftpTransferSummary>;
  refreshTransfers: () => Promise<void>;
  runWithConflictPreflight: (options: {
    errorMessagePrefix?: string;
    input: SftpTransferConflictPreflightInput;
    run: (policy?: SftpTransferConflictPolicy) => Promise<void>;
  }) => Promise<void>;
  setOperationStatus: (status: SftpStatus | null) => void;
  setTransfers: (
    updater: (current: SftpTransferSummary[]) => SftpTransferSummary[],
  ) => void;
  viewScope?: string | null;
};

export function visiblePostTransferStatus(status: SftpStatus | null) {
  if (status?.kind === "info" && status.message.includes("队列")) {
    return null;
  }
  return status;
}

export async function runSftpArchiveDownloadPlanWithPreflight({
  buildPlan,
  ...options
}: Omit<
  RunArchivePlanWithPreflightOptions<
    SftpArchiveDownloadRequest,
    ArchiveActionPlan<SftpArchiveDownloadRequest>
  >,
  "buildPlan" | "enqueue"
> & {
  buildPlan: (
    conflictPolicy?: SftpTransferConflictPolicy,
  ) => SftpRemoteQueuedRequestPlan<SftpArchiveDownloadRequest>;
}) {
  const plan = buildPlan();
  if (plan.kind === "unsupported") {
    return;
  }
  await runArchivePlanWithPreflight({
    ...options,
    buildPlan: (conflictPolicy) => {
      const nextPlan = buildPlan(conflictPolicy);
      if (nextPlan.kind === "unsupported") {
        throw new Error("unsupported archive download");
      }
      return nextPlan;
    },
    enqueue: enqueueSftpArchiveDownload,
  });
}

export async function runSftpArchiveUploadPlanWithPreflight(
  options: Omit<
    RunArchivePlanWithPreflightOptions<
      SftpArchiveUploadRequest,
      SftpArchiveUploadPlan
    >,
    "enqueue"
  >,
) {
  await runArchivePlanWithPreflight({
    ...options,
    enqueue: enqueueSftpArchiveUpload,
  });
}

async function runArchivePlanWithPreflight<
  TRequest extends SftpArchiveDownloadRequest | SftpArchiveUploadRequest,
  TPlan extends ArchiveActionPlan<TRequest>,
>({
  buildPlan,
  enqueue,
  refreshTransfers,
  runWithConflictPreflight,
  setOperationStatus,
  setTransfers,
  viewScope,
}: RunArchivePlanWithPreflightOptions<TRequest, TPlan>) {
  const plan = buildPlan();
  await runWithConflictPreflight({
    errorMessagePrefix: plan.errorMessagePrefix,
    input: plan.request,
    run: async (conflictPolicy) => {
      const nextPlan = buildPlan(conflictPolicy);
      const summary = await enqueue(
        withSftpTransferViewScope(nextPlan.request, viewScope),
      );
      setTransfers((current) => mergeTransferSnapshot(current, summary));
      setOperationStatus(null);
      void refreshTransfers();
    },
  });
}
