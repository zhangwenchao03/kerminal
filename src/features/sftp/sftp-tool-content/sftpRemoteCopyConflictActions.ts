import type { SftpTransferConflictPolicy } from "../../../lib/sftpApi";
import type { SftpClipboard } from "./types";
import {
  buildSftpClipboardPastePlan,
  buildSftpTargetTransferPlan,
  type SftpRemoteCopyPlan,
} from "./sftpRemoteTransferModel";
import type { SftpRemoteTransferTarget } from "./types";
import type { SftpEntry } from "../../../lib/sftpApi";

export type RunRemoteCopyPlan = (plan: SftpRemoteCopyPlan) => Promise<void>;

export type RunRemoteCopyWithPreflight = (options: {
  input: SftpRemoteCopyPlan;
  run: (policy?: SftpTransferConflictPolicy) => Promise<void>;
}) => Promise<void>;

export async function runClipboardRemoteCopyWithPreflight({
  clipboard,
  destinationRemotePath,
  runRemoteCopyTask,
  runWithConflictPreflight,
  targetHostId,
}: {
  clipboard: SftpClipboard;
  destinationRemotePath: string;
  runRemoteCopyTask: RunRemoteCopyPlan;
  runWithConflictPreflight: RunRemoteCopyWithPreflight;
  targetHostId: string;
}) {
  const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
    buildSftpClipboardPastePlan({
      clipboard,
      conflictPolicy,
      destinationRemotePath,
      targetHostId,
    });

  await runWithConflictPreflight({
    input: buildPlan(),
    run: async (conflictPolicy) => {
      await runRemoteCopyTask(buildPlan(conflictPolicy));
    },
  });
}

export async function runRemoteCopyPlanWithPreflight({
  plan,
  runRemoteCopyTask,
  runWithConflictPreflight,
}: {
  plan: SftpRemoteCopyPlan;
  runRemoteCopyTask: RunRemoteCopyPlan;
  runWithConflictPreflight: RunRemoteCopyWithPreflight;
}) {
  await runWithConflictPreflight({
    input: plan,
    run: async (conflictPolicy) => {
      await runRemoteCopyTask(remoteCopyPlanWithConflictPolicy(plan, conflictPolicy));
    },
  });
}

export async function runTargetRemoteCopyWithPreflight({
  entries,
  runRemoteCopyTask,
  runWithConflictPreflight,
  sourceHostId,
  transferTarget,
}: {
  entries: SftpEntry[];
  runRemoteCopyTask: RunRemoteCopyPlan;
  runWithConflictPreflight: RunRemoteCopyWithPreflight;
  sourceHostId: string;
  transferTarget: SftpRemoteTransferTarget;
}) {
  const buildPlan = (conflictPolicy?: SftpTransferConflictPolicy) =>
    buildSftpTargetTransferPlan({
      conflictPolicy,
      entries,
      sourceHostId,
      transferTarget,
    });

  await runWithConflictPreflight({
    input: buildPlan(),
    run: async (conflictPolicy) => {
      await runRemoteCopyTask(buildPlan(conflictPolicy));
    },
  });
}

function remoteCopyPlanWithConflictPolicy(
  plan: SftpRemoteCopyPlan,
  conflictPolicy?: SftpTransferConflictPolicy,
): SftpRemoteCopyPlan {
  if (conflictPolicy === undefined) {
    return plan;
  }
  return {
    ...plan,
    requests: plan.requests.map((request) => ({
      ...request,
      conflictPolicy,
    })),
  };
}
