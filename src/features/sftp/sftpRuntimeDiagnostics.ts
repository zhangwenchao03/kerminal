import type { RuntimeSftpSnapshot } from "../terminal/terminalRuntimeDiagnostics";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import {
  DEFAULT_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY,
  type SftpTransferConflictPreflightProgress,
} from "./sftp-tool-content/sftpTransferConflictPreflight";
import { resolveSftpTransferRetry } from "./sftpTransferRetryPolicy";

let latestTransfers: SftpTransferSummary[] = [];
let latestPreflight: SftpTransferConflictPreflightProgress | null = null;
let prunedCompletedEstimate = 0;

export function updateSftpRuntimeDiagnosticsTransfers(
  transfers: SftpTransferSummary[],
) {
  const previousCompleted = latestTransfers.filter(isCompletedTransfer).length;
  latestTransfers = transfers;
  const nextCompleted = transfers.filter(isCompletedTransfer).length;
  if (previousCompleted > nextCompleted) {
    prunedCompletedEstimate += previousCompleted - nextCompleted;
  }
}

export function updateSftpRuntimeDiagnosticsPreflight(
  progress: SftpTransferConflictPreflightProgress | null,
) {
  latestPreflight = progress;
}

export function getSftpRuntimeDiagnosticsSnapshot(): RuntimeSftpSnapshot {
  const activeTransfers = latestTransfers.filter(
    (transfer) => transfer.status === "queued" || transfer.status === "running",
  );
  const completedTransfers = latestTransfers.filter(isCompletedTransfer);
  const failedRecent = latestTransfers.filter(
    (transfer) => transfer.status === "failed",
  );
  const retryableFailed = failedRecent.filter(
    (transfer) => resolveSftpTransferRetry(transfer).canRetry,
  );

  return {
    preflight: latestPreflight
      ? {
          active: latestPreflight.inFlight,
          cancelRequested: false,
          completed: latestPreflight.checked,
          concurrencyLimit: DEFAULT_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY,
          failed: 0,
          queued: latestPreflight.queued,
        }
      : undefined,
    transfers: {
      activeTransfers: activeTransfers.length,
      failedRecent: failedRecent.length,
      prunedCompleted: prunedCompletedEstimate,
      recentCompleted: completedTransfers.length,
      retryableFailedRecent: retryableFailed.length,
    },
  };
}

export function resetSftpRuntimeDiagnosticsForTests() {
  latestTransfers = [];
  latestPreflight = null;
  prunedCompletedEstimate = 0;
}

function isCompletedTransfer(transfer: SftpTransferSummary) {
  return (
    transfer.status === "succeeded" ||
    transfer.status === "failed" ||
    transfer.status === "canceled"
  );
}
