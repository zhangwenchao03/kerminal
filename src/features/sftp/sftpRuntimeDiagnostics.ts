import type { SftpTransferSummary } from "../../lib/sftpApi";
import {
  DEFAULT_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY,
  type SftpTransferConflictPreflightProgress,
} from "./sftp-tool-content/sftpTransferConflictPreflight";
import { resolveSftpTransferRetry } from "./sftpTransferRetryPolicy";

/** SFTP 特性对外提供的运行时诊断摘要。 */
interface SftpRuntimeSnapshot {
  preflight?: {
    active: number;
    cancelRequested: boolean;
    completed: number;
    concurrencyLimit: number;
    failed: number;
    queued: number;
  };
  transfers: {
    activeTransfers: number;
    failedRecent: number;
    prunedCompleted: number;
    recentCompleted: number;
    retryableFailedRecent?: number;
  };
}

export interface SftpRuntimeDiagnostics {
  getSnapshot(): SftpRuntimeSnapshot;
  updatePreflight(progress: SftpTransferConflictPreflightProgress | null): void;
  updateTransfers(transfers: SftpTransferSummary[]): void;
}

/** 创建独立的 SFTP 诊断收集器，供测试和隔离运行时使用。 */
export function createSftpRuntimeDiagnostics(): SftpRuntimeDiagnostics {
  let latestTransfers: SftpTransferSummary[] = [];
  let latestPreflight: SftpTransferConflictPreflightProgress | null = null;
  let prunedCompletedEstimate = 0;

  return {
    updateTransfers(transfers) {
      const previousCompleted = latestTransfers.filter(isCompletedTransfer).length;
      latestTransfers = transfers;
      const nextCompleted = transfers.filter(isCompletedTransfer).length;
      if (previousCompleted > nextCompleted) {
        prunedCompletedEstimate += previousCompleted - nextCompleted;
      }
    },
    updatePreflight(progress) {
      latestPreflight = progress;
    },
    getSnapshot() {
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
              concurrencyLimit:
                DEFAULT_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY,
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
    },
  };
}

const sftpRuntimeDiagnostics = createSftpRuntimeDiagnostics();

/** 应用运行时共享的 SFTP 队列诊断入口。 */
export const updateSftpRuntimeDiagnosticsTransfers =
  sftpRuntimeDiagnostics.updateTransfers;
export const updateSftpRuntimeDiagnosticsPreflight =
  sftpRuntimeDiagnostics.updatePreflight;
export const getSftpRuntimeDiagnosticsSnapshot = sftpRuntimeDiagnostics.getSnapshot;

function isCompletedTransfer(transfer: SftpTransferSummary) {
  return (
    transfer.status === "succeeded" ||
    transfer.status === "failed" ||
    transfer.status === "canceled"
  );
}
