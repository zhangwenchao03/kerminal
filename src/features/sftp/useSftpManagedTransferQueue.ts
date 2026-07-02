/**
 * Shared facade for SFTP managed transfer queue mutations.
 *
 * @author kongweiguang
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  cancelSftpTransfer,
  clearCompletedSftpTransfers,
  enqueueSftpTransfer,
  type SftpTransferSummary,
} from "../../lib/sftpApi";
import { resolveSftpTransferRetry } from "./sftpTransferRetryPolicy";
import { mergeTransferSnapshot, replaceTransferQueue } from "./sftpTransferModel";

type UseSftpManagedTransferQueueArgs = {
  onCancelSuccess?: (summary: SftpTransferSummary) => void;
  onClearSuccess?: (transfers: SftpTransferSummary[]) => void;
  onError?: (error: unknown) => void;
  onRetrySuccess?: (summary: SftpTransferSummary) => void;
  onRetryUnavailable?: (message: string) => void;
  refreshTransfers?: () => Promise<void>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  viewScope?: string | null;
};

export function useSftpManagedTransferQueue({
  onCancelSuccess,
  onClearSuccess,
  onError,
  onRetrySuccess,
  onRetryUnavailable,
  refreshTransfers,
  setTransfers,
  viewScope,
}: UseSftpManagedTransferQueueArgs) {
  const cancelTransfer = useCallback(
    async (transferId: string) => {
      try {
        const summary = await cancelSftpTransfer(
          viewScope === undefined ? { transferId } : { transferId, viewScope },
        );
        setTransfers((current) => mergeTransferSnapshot(current, summary));
        onCancelSuccess?.(summary);
        void refreshTransfers?.();
      } catch (error) {
        onError?.(error);
      }
    },
    [onCancelSuccess, onError, refreshTransfers, setTransfers, viewScope],
  );

  const clearFinishedTransfers = useCallback(async () => {
    try {
      const nextTransfers = replaceTransferQueue(
        await (viewScope === undefined
          ? clearCompletedSftpTransfers()
          : clearCompletedSftpTransfers({ viewScope })),
      );
      setTransfers(nextTransfers);
      onClearSuccess?.(nextTransfers);
    } catch (error) {
      onError?.(error);
    }
  }, [onClearSuccess, onError, setTransfers, viewScope]);

  const retryTransfer = useCallback(
    async (transfer: SftpTransferSummary) => {
      const decision = resolveSftpTransferRetry(transfer);
      if (!decision.canRetry) {
        onRetryUnavailable?.(decision.statusMessage);
        return;
      }

      try {
        const summary = await enqueueSftpTransfer(
          viewScope === undefined
            ? decision.request
            : { ...decision.request, viewScope },
        );
        setTransfers((current) => mergeTransferSnapshot(current, summary));
        onRetrySuccess?.(summary);
        void refreshTransfers?.();
      } catch (error) {
        onError?.(error);
      }
    },
    [
      onError,
      onRetrySuccess,
      onRetryUnavailable,
      refreshTransfers,
      setTransfers,
      viewScope,
    ],
  );

  return { cancelTransfer, clearFinishedTransfers, retryTransfer };
}
