import type { SftpTransferSummary } from "../../lib/sftpApi";
import {
  activeTransferCount,
  isFinishedTransfer,
  sortTransfers,
} from "./sftpTransferModel";

export const SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT = 3;

export interface SftpTransferQueuePanelModel {
  activeCount: number;
  failedCount: number;
  hasOverflowHistory: boolean;
  hiddenTransferCount: number;
  historyCount: number;
  totalCount: number;
  visibleTransfers: SftpTransferSummary[];
}

export function buildSftpTransferQueuePanelModel({
  collapsedLimit = SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT,
  historyExpanded,
  transfers,
}: {
  collapsedLimit?: number;
  historyExpanded: boolean;
  transfers: SftpTransferSummary[];
}): SftpTransferQueuePanelModel {
  const safeCollapsedLimit = Math.max(0, collapsedLimit);
  const orderedTransfers = sortTransfers(transfers);
  const hasOverflowHistory = orderedTransfers.length > safeCollapsedLimit;

  return {
    activeCount: activeTransferCount(orderedTransfers),
    failedCount: orderedTransfers.filter((transfer) => transfer.status === "failed")
      .length,
    hasOverflowHistory,
    hiddenTransferCount: Math.max(
      0,
      orderedTransfers.length - safeCollapsedLimit,
    ),
    historyCount: orderedTransfers.filter(isFinishedTransfer).length,
    totalCount: orderedTransfers.length,
    visibleTransfers:
      hasOverflowHistory && !historyExpanded
        ? orderedTransfers.slice(0, safeCollapsedLimit)
        : orderedTransfers,
  };
}

/**
 * 只输出一套活动、失败和历史计数，避免同一区域重复徽标。
 */
export function formatSftpTransferQueueCounts({
  activeCount,
  failedCount,
  historyCount,
}: Pick<
  SftpTransferQueuePanelModel,
  "activeCount" | "failedCount" | "historyCount"
>) {
  const parts: string[] = [];
  if (activeCount > 0) {
    parts.push(`${activeCount} 活动`);
  }
  if (failedCount > 0) {
    parts.push(`${failedCount} 失败`);
  }
  if (historyCount > 0) {
    parts.push(`${historyCount} 历史`);
  }
  return parts.length > 0 ? parts.join(" · ") : "暂无任务";
}
