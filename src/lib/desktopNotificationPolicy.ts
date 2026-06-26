export type DesktopNotificationEventKind =
  | "agent.process.finished"
  | "mcp.server.failed"
  | "sftp.batch.completed"
  | "sftp.transfer.failed"
  | "updater.available";

export type DesktopNotificationImportance = "low" | "normal" | "high";

export type DesktopNotificationPermission =
  | "default"
  | "denied"
  | "granted";

export type DesktopNotificationVisibility =
  | "background"
  | "foreground"
  | "hidden"
  | "minimized";

export type DesktopNotificationPermissionPrompt =
  | "important-event"
  | "never"
  | "user-initiated";

export interface DesktopNotificationSettings {
  backgroundOnly?: boolean;
  enabled: boolean;
  importantOnly?: boolean;
  minDurationMs?: number;
  throttleMs?: number;
}

export type DesktopNotificationEvent =
  | {
      durationMs?: number;
      failedCount?: number;
      hostLabel?: string;
      importance?: DesktopNotificationImportance;
      kind: "sftp.batch.completed";
      notificationKey?: string;
      succeededCount?: number;
      totalCount: number;
    }
  | {
      failedCount: number;
      hostLabel?: string;
      importance?: DesktopNotificationImportance;
      kind: "sftp.transfer.failed";
      notificationKey?: string;
    }
  | {
      agentName: string;
      durationMs?: number;
      exitCode?: number | null;
      importance?: DesktopNotificationImportance;
      kind: "agent.process.finished";
      notificationKey?: string;
    }
  | {
      currentVersion?: string;
      importance?: DesktopNotificationImportance;
      kind: "updater.available";
      notificationKey?: string;
      version: string;
    }
  | {
      importance?: DesktopNotificationImportance;
      kind: "mcp.server.failed";
      notificationKey?: string;
      port?: number;
      reason?: string;
    };

export interface DesktopNotificationPolicyContext {
  lastSentAtByKey?: Record<string, number | undefined>;
  nowMs: number;
  permission: DesktopNotificationPermission;
  permissionPrompt?: DesktopNotificationPermissionPrompt;
  settings: DesktopNotificationSettings;
  visibility: DesktopNotificationVisibility;
}

export type DesktopNotificationDecisionReason =
  | "disabled"
  | "foreground-short-event"
  | "permission-denied"
  | "permission-required"
  | "permission-request-needed"
  | "settings-important-only"
  | "throttled"
  | "will-send";

export type DesktopNotificationDecision =
  | {
      notificationKey: string;
      reason: Exclude<DesktopNotificationDecisionReason, "will-send">;
      send: false;
      shouldRequestPermission: boolean;
    }
  | {
      notificationKey: string;
      reason: "will-send";
      send: true;
      shouldRequestPermission: false;
    };

export interface DesktopNotificationPayload {
  body?: string;
  title: string;
}

const DEFAULT_MIN_DURATION_MS = 10_000;
const DEFAULT_THROTTLE_MS = 30_000;
const MAX_TITLE_LENGTH = 72;
const MAX_BODY_LENGTH = 180;

export function shouldSendDesktopNotification(
  event: DesktopNotificationEvent,
  context: DesktopNotificationPolicyContext,
): DesktopNotificationDecision {
  const notificationKey = notificationKeyForEvent(event);
  const settings = context.settings;
  if (!settings.enabled) {
    return skipped(notificationKey, "disabled", false);
  }

  const importance = importanceForEvent(event);
  if (settings.importantOnly && importance !== "high") {
    return skipped(notificationKey, "settings-important-only", false);
  }

  if (context.permission === "denied") {
    return skipped(notificationKey, "permission-denied", false);
  }

  if (context.permission !== "granted") {
    const shouldRequestPermission = shouldRequestPermissionForEvent(
      event,
      context,
    );
    return skipped(
      notificationKey,
      shouldRequestPermission
        ? "permission-request-needed"
        : "permission-required",
      shouldRequestPermission,
    );
  }

  if (isForegroundShortEvent(event, context, importance)) {
    return skipped(notificationKey, "foreground-short-event", false);
  }

  const throttleMs = settings.throttleMs ?? DEFAULT_THROTTLE_MS;
  const lastSentAt = context.lastSentAtByKey?.[notificationKey];
  if (
    typeof lastSentAt === "number" &&
    throttleMs > 0 &&
    context.nowMs - lastSentAt < throttleMs
  ) {
    return skipped(notificationKey, "throttled", false);
  }

  return {
    notificationKey,
    reason: "will-send",
    send: true,
    shouldRequestPermission: false,
  };
}

export function buildDesktopNotificationPayload(
  event: DesktopNotificationEvent,
): DesktopNotificationPayload {
  const payload = buildRawPayload(event);
  return {
    body: payload.body
      ? sanitizeNotificationText(payload.body, MAX_BODY_LENGTH)
      : undefined,
    title: sanitizeNotificationText(payload.title, MAX_TITLE_LENGTH),
  };
}

export function notificationKeyForEvent(
  event: DesktopNotificationEvent,
): string {
  if (event.notificationKey) {
    return event.notificationKey;
  }

  switch (event.kind) {
    case "agent.process.finished":
      return `${event.kind}:${event.agentName}`;
    case "mcp.server.failed":
      return `${event.kind}:${event.port ?? "unknown"}`;
    case "sftp.batch.completed":
    case "sftp.transfer.failed":
      return `${event.kind}:${event.hostLabel ?? "unknown"}`;
    case "updater.available":
      return `${event.kind}:${event.version}`;
  }
}

export function sanitizeNotificationText(
  value: string,
  maxLength = MAX_BODY_LENGTH,
): string {
  const text = value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[redacted-private-key]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-token]")
    .replace(
      /\b(password|passwd|token|api[_-]?key|secret)\s*[:=]\s*[^,\s;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+\\[^\s,;]+/g, "[local-path]")
    .replace(/\b(?:\/Users|\/home)\/[^/\s]+\/[^\s,;]+/g, "[local-path]")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function buildRawPayload(
  event: DesktopNotificationEvent,
): DesktopNotificationPayload {
  switch (event.kind) {
    case "sftp.batch.completed": {
      const failedCount = event.failedCount ?? 0;
      const succeededCount =
        event.succeededCount ?? Math.max(0, event.totalCount - failedCount);
      return {
        body: `${succeededCount}/${event.totalCount} items transferred${targetSuffix(
          event.hostLabel,
        )}.`,
        title:
          failedCount > 0
            ? "SFTP transfer finished with failures"
            : "SFTP transfer completed",
      };
    }
    case "sftp.transfer.failed":
      return {
        body: `${event.failedCount} item${event.failedCount === 1 ? "" : "s"} failed${targetSuffix(
          event.hostLabel,
        )}.`,
        title: "SFTP transfer failed",
      };
    case "agent.process.finished": {
      const exit =
        typeof event.exitCode === "number"
          ? ` exited with code ${event.exitCode}`
          : " finished";
      return {
        body: `${event.agentName}${exit}.`,
        title: "Agent task finished",
      };
    }
    case "updater.available":
      return {
        body: event.currentVersion
          ? `Version ${event.version} is available. Current version is ${event.currentVersion}.`
          : `Version ${event.version} is available.`,
        title: "Kerminal update available",
      };
    case "mcp.server.failed":
      return {
        body: `Local MCP server failed${event.port ? ` on port ${event.port}` : ""}${
          event.reason ? `: ${event.reason}` : "."
        }`,
        title: "MCP server failed",
      };
  }
}

function shouldRequestPermissionForEvent(
  event: DesktopNotificationEvent,
  context: DesktopNotificationPolicyContext,
) {
  const permissionPrompt = context.permissionPrompt ?? "important-event";
  if (permissionPrompt === "never") {
    return false;
  }
  if (permissionPrompt === "user-initiated") {
    return true;
  }

  return (
    context.visibility !== "foreground" && importanceForEvent(event) === "high"
  );
}

function isForegroundShortEvent(
  event: DesktopNotificationEvent,
  context: DesktopNotificationPolicyContext,
  importance: DesktopNotificationImportance,
) {
  if (importance === "high") {
    return false;
  }
  if (context.visibility !== "foreground") {
    return false;
  }

  const minDurationMs =
    context.settings.minDurationMs ?? DEFAULT_MIN_DURATION_MS;
  const durationMs = "durationMs" in event ? (event.durationMs ?? 0) : 0;
  return durationMs < minDurationMs;
}

function importanceForEvent(
  event: DesktopNotificationEvent,
): DesktopNotificationImportance {
  if (event.importance) {
    return event.importance;
  }

  switch (event.kind) {
    case "mcp.server.failed":
    case "sftp.transfer.failed":
      return "high";
    case "agent.process.finished":
    case "sftp.batch.completed":
    case "updater.available":
      return "normal";
  }
}

function skipped(
  notificationKey: string,
  reason: Exclude<DesktopNotificationDecisionReason, "will-send">,
  shouldRequestPermission: boolean,
): DesktopNotificationDecision {
  return {
    notificationKey,
    reason,
    send: false,
    shouldRequestPermission,
  };
}

function targetSuffix(hostLabel?: string) {
  return hostLabel ? ` on ${hostLabel}` : "";
}
