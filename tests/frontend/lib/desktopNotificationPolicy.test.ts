import { describe, expect, it } from "vitest";

import {
  buildDesktopNotificationPayload,
  sanitizeNotificationText,
  shouldSendDesktopNotification,
  type DesktopNotificationEvent,
  type DesktopNotificationPolicyContext,
} from "../../../src/lib/desktopNotificationPolicy";

const baseEvent: DesktopNotificationEvent = {
  durationMs: 12_000,
  hostLabel: "prod-ssh",
  kind: "sftp.batch.completed",
  totalCount: 4,
};

function context(
  overrides: Partial<DesktopNotificationPolicyContext> = {},
): DesktopNotificationPolicyContext {
  return {
    nowMs: 100_000,
    permission: "granted",
    settings: {
      enabled: true,
      minDurationMs: 10_000,
      throttleMs: 30_000,
    },
    visibility: "hidden",
    ...overrides,
  };
}

describe("desktopNotificationPolicy", () => {
  it("does not send when desktop notifications are disabled", () => {
    const decision = shouldSendDesktopNotification(
      baseEvent,
      context({ settings: { enabled: false } }),
    );

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("disabled");
  });

  it("keeps foreground short low-value events inside the app UI", () => {
    const decision = shouldSendDesktopNotification(
      { ...baseEvent, durationMs: 5000 },
      context({ visibility: "foreground" }),
    );

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("foreground-short-event");
  });

  it("sends normal events when the app is hidden", () => {
    const decision = shouldSendDesktopNotification(
      baseEvent,
      context({ visibility: "hidden" }),
    );

    expect(decision.send).toBe(true);
    expect(decision.notificationKey).toBe("sftp.batch.completed:prod-ssh");
  });

  it("does not request permission again after denial", () => {
    const decision = shouldSendDesktopNotification(
      { failedCount: 1, kind: "sftp.transfer.failed" },
      context({ permission: "denied", visibility: "hidden" }),
    );

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("permission-denied");
    expect(decision.shouldRequestPermission).toBe(false);
  });

  it("marks important background events as permission request candidates", () => {
    const decision = shouldSendDesktopNotification(
      { failedCount: 1, kind: "sftp.transfer.failed" },
      context({ permission: "default", visibility: "background" }),
    );

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("permission-request-needed");
    expect(decision.shouldRequestPermission).toBe(true);
  });

  it("throttles repeated notifications by event key", () => {
    const decision = shouldSendDesktopNotification(
      baseEvent,
      context({
        lastSentAtByKey: {
          "sftp.batch.completed:prod-ssh": 90_000,
        },
      }),
    );

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("throttled");
  });

  it("builds payloads without leaking paths or secrets", () => {
    const payload = buildDesktopNotificationPayload({
      agentName:
        "codex password=hunter2 C:\\Users\\alice\\.ssh\\id_rsa token=abc123",
      exitCode: 0,
      kind: "agent.process.finished",
    });

    expect(payload.body).toContain("password=[redacted]");
    expect(payload.body).toContain("token=[redacted]");
    expect(payload.body).not.toContain("hunter2");
    expect(payload.body).not.toContain("alice");
    expect(payload.body).not.toContain("id_rsa");
  });

  it("redacts private key blocks from notification text", () => {
    const text = sanitizeNotificationText(
      "failed -----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY----- done",
    );

    expect(text).toBe("failed [redacted-private-key] done");
  });
});
