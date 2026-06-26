import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopNotificationSettings } from "../../lib/desktopNotificationPolicy";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import { useSftpTransferNotifications } from "./useSftpTransferNotifications";

const enabledNotifications: DesktopNotificationSettings = {
  backgroundOnly: false,
  enabled: true,
  importantOnly: false,
  minDurationMs: 10_000,
  throttleMs: 30_000,
};

describe("useSftpTransferNotifications", () => {
  it("sends one notification when a running transfer fails", async () => {
    const sendNotification = vi.fn().mockResolvedValue({
      reason: "will-send",
      requestedPermission: false,
      sent: true,
    });
    const { rerender } = render(
      <Harness
        sendNotification={sendNotification}
        transfers={[transfer({ id: "upload-1", status: "running" })]}
      />,
    );

    expect(sendNotification).not.toHaveBeenCalled();

    rerender(
      <Harness
        sendNotification={sendNotification}
        transfers={[transfer({ id: "upload-1", status: "failed" })]}
      />,
    );

    await waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          failedCount: 1,
          hostLabel: "prod",
          kind: "sftp.transfer.failed",
          notificationKey: "scope-a:failed:prod",
        },
        settings: enabledNotifications,
        visibility: "hidden",
      }),
    );
  });

  it("does not notify old terminal transfers from the initial queue load", async () => {
    const sendNotification = vi.fn();

    render(
      <Harness
        sendNotification={sendNotification}
        transfers={[
          transfer({
            createdAt: 1_000,
            id: "old-download",
            status: "succeeded",
          }),
        ]}
      />,
    );

    await waitFor(() => expect(sendNotification).not.toHaveBeenCalled());
  });
});

function Harness({
  sendNotification,
  transfers,
}: {
  sendNotification: Parameters<
    typeof useSftpTransferNotifications
  >[0]["sendNotification"];
  transfers: SftpTransferSummary[];
}) {
  useSftpTransferNotifications({
    desktopNotifications: enabledNotifications,
    hostLabelById: new Map([["host-1", "prod"]]),
    notificationKeyPrefix: "scope-a",
    sendNotification,
    transfers,
    visibility: () => "hidden",
  });
  return null;
}

function transfer(
  overrides: Partial<SftpTransferSummary> & { id: string },
): SftpTransferSummary {
  const { id, ...rest } = overrides;
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: Date.now(),
    direction: "upload",
    hostId: "host-1",
    id,
    kind: "file",
    localPath: "C:\\tmp\\artifact.txt",
    remotePath: "/tmp/artifact.txt",
    status: "queued",
    updatedAt: Date.now(),
    ...rest,
  };
}
