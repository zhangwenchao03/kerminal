import type { DesktopNotificationEvent } from "../../lib/desktopNotificationPolicy";
import type {
  SftpTransferStatus,
  SftpTransferSummary,
} from "../../lib/sftpApi";

export interface SelectNewSftpNotificationTransfersOptions {
  initializedAtMs: number;
  notifiedTransferIds?: ReadonlySet<string>;
  previousStatuses?: ReadonlyMap<string, SftpTransferStatus>;
}

export interface BuildSftpTransferNotificationEventOptions {
  hostLabelById?: ReadonlyMap<string, string>;
  notificationKeyPrefix?: string;
}

export function selectNewSftpNotificationTransfers(
  transfers: SftpTransferSummary[],
  {
    initializedAtMs,
    notifiedTransferIds,
    previousStatuses,
  }: SelectNewSftpNotificationTransfersOptions,
) {
  return transfers.filter((transfer) => {
    if (!isNotifiableSftpTransferStatus(transfer.status)) {
      return false;
    }
    if (notifiedTransferIds?.has(transfer.id)) {
      return false;
    }

    const previousStatus = previousStatuses?.get(transfer.id);
    if (previousStatus && !isTerminalSftpTransferStatus(previousStatus)) {
      return true;
    }

    return !previousStatus && transfer.createdAt >= initializedAtMs;
  });
}

export function buildSftpTransferNotificationEvent(
  transfers: SftpTransferSummary[],
  options: BuildSftpTransferNotificationEventOptions = {},
): DesktopNotificationEvent | null {
  const notifiableTransfers = transfers.filter((transfer) =>
    isNotifiableSftpTransferStatus(transfer.status),
  );
  if (notifiableTransfers.length === 0) {
    return null;
  }

  const failedTransfers = notifiableTransfers.filter(
    (transfer) => transfer.status === "failed",
  );
  const hostLabel = resolveSftpNotificationHostLabel(
    notifiableTransfers,
    options.hostLabelById,
  );
  const notificationKeySuffix = hostLabel ?? "unknown";

  if (failedTransfers.length > 0) {
    return {
      failedCount: failedTransfers.length,
      hostLabel,
      kind: "sftp.transfer.failed",
      notificationKey: options.notificationKeyPrefix
        ? `${options.notificationKeyPrefix}:failed:${notificationKeySuffix}`
        : undefined,
    };
  }

  return {
    durationMs: durationMsForTransfers(notifiableTransfers),
    failedCount: 0,
    hostLabel,
    kind: "sftp.batch.completed",
    notificationKey: options.notificationKeyPrefix
      ? `${options.notificationKeyPrefix}:completed:${notificationKeySuffix}`
      : undefined,
    succeededCount: notifiableTransfers.length,
    totalCount: notifiableTransfers.length,
  };
}

export function sftpTransferStatusSnapshot(transfers: SftpTransferSummary[]) {
  return new Map(
    transfers.map((transfer) => [transfer.id, transfer.status] as const),
  );
}

export function terminalSftpTransferIds(transfers: SftpTransferSummary[]) {
  return transfers
    .filter((transfer) => isTerminalSftpTransferStatus(transfer.status))
    .map((transfer) => transfer.id);
}

function isNotifiableSftpTransferStatus(status: SftpTransferStatus) {
  return status === "succeeded" || status === "failed";
}

function isTerminalSftpTransferStatus(status: SftpTransferStatus) {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function resolveSftpNotificationHostLabel(
  transfers: SftpTransferSummary[],
  hostLabelById?: ReadonlyMap<string, string>,
) {
  const labels = new Set<string>();
  for (const transfer of transfers) {
    const label =
      hostLabelById?.get(transfer.hostId) ??
      remoteEndpointHostLabel(transfer.target) ??
      remoteEndpointHostLabel(transfer.source);
    if (label) {
      labels.add(label);
    }
  }

  if (labels.size === 1) {
    return [...labels][0];
  }
  if (labels.size > 1) {
    return `${labels.size} hosts`;
  }
  return undefined;
}

function remoteEndpointHostLabel(endpoint: SftpTransferSummary["source"]) {
  return endpoint?.kind === "remote" ? endpoint.hostLabel : undefined;
}

function durationMsForTransfers(transfers: SftpTransferSummary[]) {
  const timestamps = transfers.flatMap((transfer) => [
    transfer.createdAt,
    transfer.updatedAt,
  ]);
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return undefined;
  }

  return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
}
