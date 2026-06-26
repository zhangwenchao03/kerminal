import { useEffect, useRef } from "react";
import {
  currentDesktopNotificationVisibility,
  sendDesktopNotification,
  type DesktopNotificationSendResult,
} from "../../lib/desktopNotificationApi";
import type {
  DesktopNotificationSettings,
  DesktopNotificationVisibility,
} from "../../lib/desktopNotificationPolicy";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import {
  buildSftpTransferNotificationEvent,
  selectNewSftpNotificationTransfers,
  sftpTransferStatusSnapshot,
  terminalSftpTransferIds,
} from "./sftpTransferNotificationModel";

export interface UseSftpTransferNotificationsOptions {
  active?: boolean;
  desktopNotifications: DesktopNotificationSettings;
  hostLabelById?: ReadonlyMap<string, string>;
  notificationKeyPrefix?: string;
  sendNotification?: typeof sendDesktopNotification;
  transfers: SftpTransferSummary[];
  visibility?: () => DesktopNotificationVisibility;
}

export function useSftpTransferNotifications({
  active = true,
  desktopNotifications,
  hostLabelById,
  notificationKeyPrefix,
  sendNotification = sendDesktopNotification,
  transfers,
  visibility = currentDesktopNotificationVisibility,
}: UseSftpTransferNotificationsOptions) {
  const initializedAtMsRef = useRef(Date.now());
  const lastSentAtByKeyRef = useRef<Record<string, number | undefined>>({});
  const notifiedTransferIdsRef = useRef<Set<string>>(new Set());
  const previousStatusesRef = useRef(sftpTransferStatusSnapshot([]));

  useEffect(() => {
    if (!active) {
      previousStatusesRef.current = sftpTransferStatusSnapshot(transfers);
      return;
    }

    const newTransfers = selectNewSftpNotificationTransfers(transfers, {
      initializedAtMs: initializedAtMsRef.current,
      notifiedTransferIds: notifiedTransferIdsRef.current,
      previousStatuses: previousStatusesRef.current,
    });
    const event = buildSftpTransferNotificationEvent(newTransfers, {
      hostLabelById,
      notificationKeyPrefix,
    });

    for (const transferId of terminalSftpTransferIds(transfers)) {
      notifiedTransferIdsRef.current.add(transferId);
    }
    previousStatusesRef.current = sftpTransferStatusSnapshot(transfers);

    if (!event) {
      return;
    }

    void sendNotification({
      event,
      lastSentAtByKey: lastSentAtByKeyRef.current,
      settings: desktopNotifications,
      visibility: visibility(),
    }).catch((): DesktopNotificationSendResult => ({
      reason: "transport-error",
      requestedPermission: false,
      sent: false,
    }));
  }, [
    active,
    desktopNotifications,
    hostLabelById,
    notificationKeyPrefix,
    sendNotification,
    transfers,
    visibility,
  ]);
}
