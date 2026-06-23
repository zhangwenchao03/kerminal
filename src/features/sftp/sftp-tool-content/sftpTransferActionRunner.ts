import type {
  SftpTransferConflictPolicy,
} from "../../../lib/sftpApi";
import type { ResolvedTransferPlan } from "../sftpTransferResolver";
import type {
  SftpTransferActionBatchPlan,
  SftpTransferActionItem,
} from "./sftpTransferActionPlan";

export type RunSftpTransferActionItem = (
  item: SftpTransferActionItem,
) => Promise<void>;

export async function runSftpTransferActionItems(
  items: SftpTransferActionItem[],
  runTransferTask: RunSftpTransferActionItem,
) {
  for (const item of items) {
    await runTransferTask(item);
  }
}

export async function runSftpTransferBatchPlan(
  plan: SftpTransferActionBatchPlan,
  runTransferTask: RunSftpTransferActionItem,
) {
  await runSftpTransferActionItems(plan.items, runTransferTask);
}

export function buildWorkbenchClipboardUploadItems({
  conflictPolicy,
  hostId,
  plan,
}: {
  conflictPolicy?: SftpTransferConflictPolicy;
  hostId: string;
  plan: ResolvedTransferPlan;
}): SftpTransferActionItem[] {
  return plan.tasks.flatMap((task) => {
    if (task.entryKind === "symlink") {
      return [];
    }
    return [
      {
        queuedStatus: {
          kind: "info",
          message: `已加入剪贴板上传队列：${task.entryName}`,
        },
        request: {
          ...(conflictPolicy !== undefined ? { conflictPolicy } : {}),
          direction: "upload",
          hostId,
          kind: task.entryKind,
          localPath: task.sourceEntryPath,
          remotePath: task.targetEntryPath,
        },
      },
    ];
  });
}
