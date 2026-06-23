/**
 * SFTP 传输同步的纯决策模型。
 *
 * @author kongweiguang
 */

import type { SftpTransferSummary } from "../../../lib/sftpApi";
import { mergeTransferSnapshot } from "../sftpTransferModel";
import { parentRemotePath } from "./sftpPathModel";

export type SftpTransferCompletionEffects = {
  completedTransferIds: Set<string>;
  reloadPath: string | null;
};

/**
 * 只展示当前 SSH 主机的后台传输任务。
 */
export function filterSftpTransfersForHost(
  transfers: SftpTransferSummary[],
  hostId: string | undefined,
  viewScope?: string | null,
) {
  return hostId
    ? transfers.filter(
        (transfer) =>
          transfer.hostId === hostId &&
          sftpTransferMatchesViewScope(transfer, viewScope),
      )
    : [];
}

/**
 * 合并 Tauri 事件里的单条传输快照，并忽略其它主机的事件。
 */
export function mergeSftpTransferUpdateForHost({
  hostId,
  transfer,
  transfers,
  viewScope,
}: {
  hostId: string | undefined;
  transfer: SftpTransferSummary;
  transfers: SftpTransferSummary[];
  viewScope?: string | null;
}) {
  if (
    !hostId ||
    transfer.hostId !== hostId ||
    !sftpTransferMatchesViewScope(transfer, viewScope)
  ) {
    return transfers;
  }
  return mergeTransferSnapshot(transfers, transfer);
}

export function sftpTransferMatchesViewScope(
  transfer: SftpTransferSummary,
  viewScope?: string | null,
) {
  return viewScope === undefined
    ? true
    : (transfer.viewScope ?? null) === viewScope;
}

/**
 * 计算终态传输对当前目录的副作用：去重记录完成 ID，且同一轮最多刷新一次目录。
 */
export function resolveSftpTransferCompletionEffects({
  completedTransferIds,
  currentPath,
  transfers,
}: {
  completedTransferIds: ReadonlySet<string>;
  currentPath: string;
  transfers: SftpTransferSummary[];
}): SftpTransferCompletionEffects {
  const nextCompletedTransferIds = new Set(completedTransferIds);
  let reloadPath: string | null = null;

  for (const transfer of transfers) {
    if (transfer.status === "succeeded") {
      const isNewCompletion = !nextCompletedTransferIds.has(transfer.id);
      nextCompletedTransferIds.add(transfer.id);
      if (
        isNewCompletion &&
        !reloadPath &&
        transfer.direction === "upload" &&
        parentRemotePath(transfer.remotePath) === currentPath
      ) {
        reloadPath = currentPath;
      }
      continue;
    }

    if (transfer.status === "failed" || transfer.status === "canceled") {
      nextCompletedTransferIds.add(transfer.id);
    }
  }

  return {
    completedTransferIds: nextCompletedTransferIds,
    reloadPath,
  };
}
