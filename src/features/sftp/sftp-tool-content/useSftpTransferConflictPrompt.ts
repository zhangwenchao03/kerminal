import { useCallback, useState } from "react";
import type { SftpTransferConflictPolicy } from "../../../lib/sftpApi";
import {
  countSftpTransferConflicts,
  type SftpTransferConflictPreflightInput,
} from "./sftpTransferConflictPreflight";

type PendingTransferConflict = {
  conflictCount: number;
  errorMessagePrefix?: string;
  run: (policy?: SftpTransferConflictPolicy) => Promise<void>;
};

export type SftpTransferConflictPromptState = {
  conflictCount: number;
};

export function useSftpTransferConflictPrompt({
  onError,
}: {
  onError: (nextError: unknown, errorMessagePrefix?: string) => void;
}) {
  const [pendingConflict, setPendingConflict] =
    useState<PendingTransferConflict | null>(null);

  const runWithConflictPreflight = useCallback(
    async ({
      errorMessagePrefix,
      input,
      localRootPath,
      run,
    }: {
      errorMessagePrefix?: string;
      input: SftpTransferConflictPreflightInput;
      localRootPath?: string;
      run: (policy?: SftpTransferConflictPolicy) => Promise<void>;
    }) => {
      const conflictCount = await countSftpTransferConflicts(input, {
        localRootPath,
      });
      if (conflictCount > 0) {
        setPendingConflict({
          conflictCount,
          errorMessagePrefix,
          run,
        });
        return;
      }
      await run();
    },
    [],
  );

  const closeTransferConflictDialog = useCallback(() => {
    setPendingConflict(null);
  }, []);

  const confirmTransferConflictPolicy = useCallback(
    async (policy: SftpTransferConflictPolicy) => {
      const conflict = pendingConflict;
      if (!conflict) {
        return;
      }
      setPendingConflict(null);
      try {
        await conflict.run(policy);
      } catch (nextError) {
        onError(nextError, conflict.errorMessagePrefix);
      }
    },
    [onError, pendingConflict],
  );

  return {
    closeTransferConflictDialog,
    confirmTransferConflictPolicy,
    pendingTransferConflict: pendingConflict
      ? { conflictCount: pendingConflict.conflictCount }
      : null,
    runWithConflictPreflight,
  };
}
