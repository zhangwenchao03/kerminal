import type { LocalDirectoryEntry } from "../../lib/fileDialogApi";
import { statSftpPath } from "../../lib/sftpApi";
import type { ResolvedTransferPlan } from "./sftpTransferResolver";

export function toManagedTransferKind(kind: LocalDirectoryEntry["kind"]) {
  if (kind === "file" || kind === "directory") {
    return kind;
  }
  return null;
}

export async function countRemoteUploadConflicts(
  hostId: string,
  plan: ResolvedTransferPlan,
) {
  const results = await Promise.all(
    plan.tasks.map(async (task) => {
      try {
        await statSftpPath({ hostId, path: task.targetEntryPath });
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
