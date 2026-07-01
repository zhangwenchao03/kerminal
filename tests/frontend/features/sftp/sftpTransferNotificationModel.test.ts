import { describe, expect, it } from "vitest";
import type {
  SftpTransferStatus,
  SftpTransferSummary,
} from "../../../../src/lib/sftpApi";
import {
  buildSftpTransferNotificationEvent,
  selectNewSftpNotificationTransfers,
  sftpTransferStatusSnapshot,
  terminalSftpTransferIds,
} from "../../../../src/features/sftp/sftpTransferNotificationModel";

describe("sftpTransferNotificationModel", () => {
  it("selects transfers that newly transition into a notifiable terminal state", () => {
    const running = transfer({ id: "running", status: "running" });
    const failed = transfer({ id: "failed", status: "failed" });
    const previousStatuses = new Map<string, SftpTransferStatus>([
      ["failed", "running"],
      ["old-success", "succeeded"],
    ]);

    expect(
      selectNewSftpNotificationTransfers(
        [
          running,
          failed,
          transfer({ id: "old-success", status: "succeeded" }),
          transfer({ id: "canceled", status: "canceled" }),
        ],
        {
          initializedAtMs: 2_000,
          previousStatuses,
        },
      ).map((item) => item.id),
    ).toEqual(["failed"]);
  });

  it("skips old finished transfers loaded from history", () => {
    expect(
      selectNewSftpNotificationTransfers(
        [transfer({ createdAt: 1_000, id: "old-success", status: "succeeded" })],
        {
          initializedAtMs: 2_000,
          previousStatuses: new Map(),
        },
      ),
    ).toEqual([]);
  });

  it("selects terminal transfers created after notification tracking starts", () => {
    expect(
      selectNewSftpNotificationTransfers(
        [transfer({ createdAt: 3_000, id: "new-success", status: "succeeded" })],
        {
          initializedAtMs: 2_000,
          previousStatuses: new Map(),
        },
      ).map((item) => item.id),
    ).toEqual(["new-success"]);
  });

  it("builds a failed transfer notification without leaking paths", () => {
    const event = buildSftpTransferNotificationEvent(
      [
        transfer({
          hostId: "host-a",
          id: "failed",
          localPath: "C:\\Users\\kong\\secret.txt",
          remotePath: "/home/kong/secret.txt",
          status: "failed",
        }),
      ],
      {
        hostLabelById: new Map([["host-a", "prod-box"]]),
        notificationKeyPrefix: "scope-1",
      },
    );

    expect(event).toEqual({
      failedCount: 1,
      hostLabel: "prod-box",
      kind: "sftp.transfer.failed",
      notificationKey: "scope-1:failed:prod-box",
    });
    expect(JSON.stringify(event)).not.toContain("secret.txt");
  });

  it("builds an aggregate completion notification with duration", () => {
    expect(
      buildSftpTransferNotificationEvent(
        [
          transfer({
            createdAt: 1_000,
            id: "a",
            status: "succeeded",
            updatedAt: 6_000,
          }),
          transfer({
            createdAt: 2_000,
            id: "b",
            status: "succeeded",
            updatedAt: 7_000,
          }),
        ],
        {
          hostLabelById: new Map([["host-1", "build-host"]]),
        },
      ),
    ).toEqual({
      durationMs: 6_000,
      failedCount: 0,
      hostLabel: "build-host",
      kind: "sftp.batch.completed",
      notificationKey: undefined,
      succeededCount: 2,
      totalCount: 2,
    });
  });

  it("builds status snapshots and terminal ids for hook state", () => {
    const transfers = [
      transfer({ id: "queued", status: "queued" }),
      transfer({ id: "failed", status: "failed" }),
      transfer({ id: "canceled", status: "canceled" }),
    ];

    expect([...sftpTransferStatusSnapshot(transfers)]).toEqual([
      ["queued", "queued"],
      ["failed", "failed"],
      ["canceled", "canceled"],
    ]);
    expect(terminalSftpTransferIds(transfers)).toEqual(["failed", "canceled"]);
  });
});

function transfer(
  overrides: Partial<SftpTransferSummary> & { id: string },
): SftpTransferSummary {
  const { id, ...rest } = overrides;
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 1_000,
    direction: "download",
    hostId: "host-1",
    id,
    kind: "file",
    localPath: "C:\\tmp\\artifact.txt",
    operation: "download",
    remotePath: "/tmp/artifact.txt",
    source: {
      hostId: "host-1",
      hostLabel: "host-1",
      kind: "remote",
      path: "/tmp/artifact.txt",
    },
    status: "queued",
    target: {
      kind: "local",
      path: "C:\\tmp\\artifact.txt",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1_000,
    ...rest,
  };
}
