import type { SftpTransferSummary } from "../../lib/sftpApi";
import { activeTransferCount } from "./sftpTransferModel";

export const SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT = 3;

export interface SftpTransferQueuePanelModel {
  activeCount: number;
  failedCount: number;
  hasOverflowHistory: boolean;
  hiddenTransferCount: number;
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
  const hasOverflowHistory = transfers.length > safeCollapsedLimit;

  return {
    activeCount: activeTransferCount(transfers),
    failedCount: transfers.filter((transfer) => transfer.status === "failed")
      .length,
    hasOverflowHistory,
    hiddenTransferCount: Math.max(0, transfers.length - safeCollapsedLimit),
    totalCount: transfers.length,
    visibleTransfers:
      hasOverflowHistory && !historyExpanded
        ? transfers.slice(0, safeCollapsedLimit)
        : transfers,
  };
}
