import { useCallback, useEffect, useRef, useState } from "react";
import type { SftpTransferConflictPolicy } from "../../../lib/sftpApi";
import {
  countSftpTransferConflicts,
  isSftpTransferConflictPreflightCanceledError,
  type SftpTransferConflictPreflightProgress,
  type SftpTransferConflictPreflightInput,
} from "./sftpTransferConflictPreflight";
import { updateSftpRuntimeDiagnosticsPreflight } from "../sftpRuntimeDiagnostics";

const SFTP_TRANSFER_CONFLICT_PROGRESS_MIN_TOTAL = 8;

type PendingTransferConflict = {
  conflictCount: number;
  errorMessagePrefix?: string;
  run: (policy?: SftpTransferConflictPolicy) => Promise<void>;
};

export function useSftpTransferConflictPrompt({
  onError,
  onProgress,
  progressMinTotal = SFTP_TRANSFER_CONFLICT_PROGRESS_MIN_TOTAL,
}: {
  onError: (nextError: unknown, errorMessagePrefix?: string) => void;
  onProgress?: (progress: SftpTransferConflictPreflightProgress | null) => void;
  progressMinTotal?: number;
}) {
  const [pendingConflict, setPendingConflict] =
    useState<PendingTransferConflict | null>(null);
  const preflightAbortRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);

  onErrorRef.current = onError;
  onProgressRef.current = onProgress;

  useEffect(
    () => () => {
      preflightAbortRef.current?.abort();
      updateSftpRuntimeDiagnosticsPreflight(null);
    },
    [],
  );

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
      preflightAbortRef.current?.abort();
      const abortController = new AbortController();
      preflightAbortRef.current = abortController;
      let didShowProgress = false;
      const reportProgress = (
        progress: SftpTransferConflictPreflightProgress,
      ) => {
        if (progress.total < progressMinTotal) {
          return;
        }
        didShowProgress = true;
        updateSftpRuntimeDiagnosticsPreflight(progress);
        onProgressRef.current?.(progress);
      };
      const clearProgress = () => {
        if (!didShowProgress) {
          return;
        }
        didShowProgress = false;
        updateSftpRuntimeDiagnosticsPreflight(null);
        onProgressRef.current?.(null);
      };
      try {
        const conflictCount = await countSftpTransferConflicts(input, {
          localRootPath,
          onProgress: reportProgress,
          signal: abortController.signal,
        });
        if (preflightAbortRef.current !== abortController) {
          return;
        }
        clearProgress();
        if (conflictCount > 0) {
          setPendingConflict({
            conflictCount,
            errorMessagePrefix,
            run,
          });
          return;
        }
        await run();
      } catch (error) {
        if (isSftpTransferConflictPreflightCanceledError(error)) {
          clearProgress();
          return;
        }
        clearProgress();
        throw error;
      } finally {
        if (preflightAbortRef.current === abortController) {
          preflightAbortRef.current = null;
        }
      }
    },
    [progressMinTotal],
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
        onErrorRef.current(nextError, conflict.errorMessagePrefix);
      }
    },
    [pendingConflict],
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
