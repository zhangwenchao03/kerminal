/**
 * SFTP 后台传输队列的纯展示模型。
 *
 * @author kongweiguang
 */

import type { SftpTransferEndpoint, SftpTransferSummary } from "../../lib/sftpApi";
import { fileNameFromPath, formatFileSize } from "./sftpFileUtils";

/**
 * 按用户关注优先级排序后台传输任务。
 */
export function sortTransfers(transfers: SftpTransferSummary[]) {
  return [...transfers].sort((left, right) => {
    const statusRank =
      transferStatusRank(left.status) - transferStatusRank(right.status);
    if (statusRank !== 0) {
      return statusRank;
    }
    return right.createdAt - left.createdAt;
  });
}

/**
 * 按传输 ID 替换或追加单个任务快照。
 */
export function upsertTransfer(
  transfers: SftpTransferSummary[],
  summary: SftpTransferSummary,
) {
  const nextTransfers = transfers.filter(
    (transfer) => transfer.id !== summary.id,
  );
  nextTransfers.push(summary);
  return nextTransfers;
}

function transferStatusRank(status: SftpTransferSummary["status"]) {
  if (status === "running") {
    return 0;
  }
  if (status === "queued") {
    return 1;
  }
  if (status === "failed") {
    return 2;
  }
  if (status === "canceled") {
    return 3;
  }
  return 4;
}

/**
 * 判断传输任务是否已经进入终态。
 */
export function isFinishedTransfer(transfer: SftpTransferSummary) {
  return (
    transfer.status === "succeeded" ||
    transfer.status === "failed" ||
    transfer.status === "canceled"
  );
}

/**
 * 统计仍会占用队列或用户注意力的传输任务。
 */
export function activeTransferCount(transfers: SftpTransferSummary[]) {
  return transfers.filter(
    (transfer) => transfer.status === "running" || transfer.status === "queued",
  ).length;
}

/**
 * 计算传输进度百分比；未知总大小的运行任务保留可见进度。
 */
export function transferProgressPercent(transfer: SftpTransferSummary) {
  if (transfer.status === "succeeded") {
    return 100;
  }
  const totalBytes = transfer.totalBytes ?? 0;
  if (totalBytes <= 0) {
    return transfer.status === "running" ? 8 : 0;
  }
  return Math.min(
    100,
    Math.max(0, (transfer.bytesTransferred / totalBytes) * 100),
  );
}

/**
 * 获取传输任务的主标题。
 */
export function transferTitle(transfer: SftpTransferSummary) {
  const path =
    transfer.source?.path ??
    (transfer.direction === "upload" ? transfer.localPath : transfer.remotePath);
  return fileNameFromPath(
    path,
    transfer.kind === "directory" ? "folder" : "file",
  );
}

/**
 * 获取传输任务百分比文本。
 */
export function transferPercentLabel(transfer: SftpTransferSummary) {
  if (transfer.status === "succeeded") {
    return "100%";
  }
  const totalBytes = transfer.totalBytes ?? 0;
  if (totalBytes <= 0) {
    return transfer.status === "running" ? "..." : "0%";
  }
  return `${Math.round(transferProgressPercent(transfer))}%`;
}

/**
 * 获取上传或下载方向摘要。
 */
export function transferPathSummary(transfer: SftpTransferSummary) {
  if (transfer.source && transfer.target) {
    return `${transferEndpointLabel(transfer.source)} -> ${transferEndpointLabel(transfer.target)}`;
  }
  return transfer.direction === "upload"
    ? `${transfer.localPath} -> ${transfer.remotePath}`
    : `${transfer.remotePath} -> ${transfer.localPath}`;
}

/**
 * 获取传输状态中文标签。
 */
export function transferStatusLabel(status: SftpTransferSummary["status"]) {
  if (status === "queued") {
    return "排队";
  }
  if (status === "running") {
    return "传输中";
  }
  if (status === "succeeded") {
    return "完成";
  }
  if (status === "failed") {
    return "失败";
  }
  return "已取消";
}

/**
 * 获取传输队列折叠态摘要。
 */
export function transferStatusSummary({
  activeCount,
  completedCount,
  failedCount,
  totalCount,
  transfer,
}: {
  activeCount: number;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  transfer: SftpTransferSummary;
}) {
  if (activeCount > 0) {
    const finishedText =
      completedCount > 0 ? `，${completedCount} 项已结束` : "";
    return `后台传输 ${activeCount} 项${finishedText}`;
  }
  if (failedCount > 0) {
    return `${failedCount} 项传输失败，可从任务记录重试或清理`;
  }
  if (completedCount > 0) {
    return `${completedCount} 项传输完成`;
  }
  if (totalCount > 1) {
    return `${totalCount} 项传输任务`;
  }
  return transferPathSummary(transfer);
}

function transferEndpointLabel(endpoint: SftpTransferEndpoint) {
  if (endpoint.kind === "local") {
    return endpoint.path;
  }
  return `${endpoint.hostLabel || endpoint.hostId}:${endpoint.path}`;
}

/**
 * 获取传输状态 badge 的主题安全样式。
 */
export function transferStatusClassName(status: SftpTransferSummary["status"]) {
  if (status === "running") {
    return "border-sky-300/35 bg-sky-500/10 text-sky-700 dark:text-sky-100";
  }
  if (status === "queued") {
    return "border-amber-300/35 bg-amber-500/10 text-amber-700 dark:text-amber-100";
  }
  if (status === "succeeded") {
    return "border-emerald-300/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100";
  }
  if (status === "failed") {
    return "border-rose-300/35 bg-rose-500/10 text-rose-700 dark:text-rose-100";
  }
  return "border-zinc-300/40 bg-zinc-500/10 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300";
}

/**
 * 获取已传输字节和总字节展示文本。
 */
export function formatTransferBytes(transfer: SftpTransferSummary) {
  const totalBytes = transfer.totalBytes ?? 0;
  if (totalBytes <= 0) {
    return `${formatFileSize(transfer.bytesTransferred)} / -`;
  }
  return `${formatFileSize(transfer.bytesTransferred)} / ${formatFileSize(totalBytes)}`;
}
