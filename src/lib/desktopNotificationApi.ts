import { isTauri } from "@tauri-apps/api/core";
import type { Options as TauriNotificationOptions } from "@tauri-apps/plugin-notification";

import {
  buildDesktopNotificationPayload,
  shouldSendDesktopNotification,
  type DesktopNotificationDecisionReason,
  type DesktopNotificationEvent,
  type DesktopNotificationPermission,
  type DesktopNotificationPermissionPrompt,
  type DesktopNotificationSettings,
  type DesktopNotificationVisibility,
} from "./desktopNotificationPolicy";

export interface DesktopNotificationTransport {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  sendNotification: (options: TauriNotificationOptions | string) => void;
}

export interface DesktopNotificationRequest {
  event: DesktopNotificationEvent;
  lastSentAtByKey?: Record<string, number | undefined>;
  nowMs?: number;
  permission?: DesktopNotificationPermission;
  permissionPrompt?: DesktopNotificationPermissionPrompt;
  settings: DesktopNotificationSettings;
  transport?: DesktopNotificationTransport;
  visibility: DesktopNotificationVisibility;
}

export type DesktopNotificationSendReason =
  | DesktopNotificationDecisionReason
  | "not-tauri"
  | "transport-error";

export interface DesktopNotificationSendResult {
  notificationKey?: string;
  permission?: DesktopNotificationPermission;
  reason: DesktopNotificationSendReason;
  requestedPermission: boolean;
  sent: boolean;
}

export async function sendDesktopNotification(
  request: DesktopNotificationRequest,
): Promise<DesktopNotificationSendResult> {
  if (!request.transport && !isTauri()) {
    return {
      reason: "not-tauri",
      requestedPermission: false,
      sent: false,
    };
  }

  const transport = request.transport ?? (await loadTauriNotificationTransport());
  if (!transport) {
    return {
      reason: "not-tauri",
      requestedPermission: false,
      sent: false,
    };
  }

  try {
    const initialPermission =
      request.permission ?? (await readNotificationPermission(transport));
    const initialDecision = shouldSendDesktopNotification(request.event, {
      lastSentAtByKey: request.lastSentAtByKey,
      nowMs: request.nowMs ?? Date.now(),
      permission: initialPermission,
      permissionPrompt: request.permissionPrompt,
      settings: request.settings,
      visibility: request.visibility,
    });

    if (!initialDecision.send && initialDecision.shouldRequestPermission) {
      const requestedPermission = normalizePermission(
        await transport.requestPermission(),
      );
      if (requestedPermission !== "granted") {
        return {
          notificationKey: initialDecision.notificationKey,
          permission: requestedPermission,
          reason: requestedPermission === "denied"
            ? "permission-denied"
            : "permission-required",
          requestedPermission: true,
          sent: false,
        };
      }

      const retryDecision = shouldSendDesktopNotification(request.event, {
        lastSentAtByKey: request.lastSentAtByKey,
        nowMs: request.nowMs ?? Date.now(),
        permission: "granted",
        permissionPrompt: request.permissionPrompt,
        settings: request.settings,
        visibility: request.visibility,
      });
      return await sendIfAllowed(
        request,
        transport,
        retryDecision,
        true,
        "granted",
      );
    }

    return await sendIfAllowed(
      request,
      transport,
      initialDecision,
      false,
      initialPermission,
    );
  } catch {
    return {
      reason: "transport-error",
      requestedPermission: false,
      sent: false,
    };
  }
}

export function currentDesktopNotificationVisibility(): DesktopNotificationVisibility {
  if (typeof document === "undefined") {
    return "foreground";
  }

  if (document.visibilityState === "hidden" || document.hidden) {
    return "hidden";
  }

  return "foreground";
}

async function sendIfAllowed(
  request: DesktopNotificationRequest,
  transport: DesktopNotificationTransport,
  decision: ReturnType<typeof shouldSendDesktopNotification>,
  requestedPermission: boolean,
  permission: DesktopNotificationPermission,
): Promise<DesktopNotificationSendResult> {
  if (!decision.send) {
    return {
      notificationKey: decision.notificationKey,
      permission,
      reason: decision.reason,
      requestedPermission,
      sent: false,
    };
  }

  const payload = buildDesktopNotificationPayload(request.event);
  transport.sendNotification(payload);
  if (request.lastSentAtByKey) {
    request.lastSentAtByKey[decision.notificationKey] = request.nowMs ?? Date.now();
  }

  return {
    notificationKey: decision.notificationKey,
    permission,
    reason: decision.reason,
    requestedPermission,
    sent: true,
  };
}

async function loadTauriNotificationTransport(): Promise<DesktopNotificationTransport | null> {
  if (!isTauri()) {
    return null;
  }

  const plugin = await import("@tauri-apps/plugin-notification");
  return {
    isPermissionGranted: plugin.isPermissionGranted,
    requestPermission: plugin.requestPermission,
    sendNotification: plugin.sendNotification,
  };
}

async function readNotificationPermission(
  transport: DesktopNotificationTransport,
): Promise<DesktopNotificationPermission> {
  return (await transport.isPermissionGranted()) ? "granted" : "default";
}

function normalizePermission(
  permission: NotificationPermission,
): DesktopNotificationPermission {
  if (permission === "granted" || permission === "denied") {
    return permission;
  }

  return "default";
}
