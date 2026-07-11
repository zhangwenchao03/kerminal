import { describe, expect, it } from "vitest";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";
import {
  buildSftpTransferQueuePanelModel,
  formatSftpTransferQueueCounts,
  SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT,
} from "../../../../src/features/sftp/sftpTransferQueuePanelModel";

function transfer(
  id: string,
  status: SftpTransferSummary["status"] = "queued",
): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 100,
    direction: "download",
    hostId: "host-1",
    id,
    kind: "file",
    localPath: `C:\\Downloads\\${id}.log`,
    operation: "download",
    remotePath: `/srv/${id}.log`,
    source: {
      hostId: "host-1",
      hostLabel: "host-1",
      kind: "remote",
      path: `/srv/${id}.log`,
    },
    status,
    target: {
      kind: "local",
      path: `C:\\Downloads\\${id}.log`,
    },
    totalBytes: 100,
    transportMode: "singleHostSftp",
    updatedAt: 100,
  };
}

describe("sftpTransferQueuePanelModel", () => {
  it("summarizes active and failed transfers", () => {
    const model = buildSftpTransferQueuePanelModel({
      historyExpanded: false,
      transfers: [
        transfer("running", "running"),
        transfer("queued", "queued"),
        transfer("failed", "failed"),
        transfer("succeeded", "succeeded"),
        transfer("canceled", "canceled"),
      ],
    });

    expect(model.activeCount).toBe(2);
    expect(model.failedCount).toBe(1);
    expect(model.historyCount).toBe(3);
    expect(model.totalCount).toBe(5);
    expect(
      formatSftpTransferQueueCounts({
        activeCount: model.activeCount,
        failedCount: model.failedCount,
        historyCount: model.historyCount,
      }),
    ).toBe("2 活动 · 1 失败 · 3 历史");
    expect(model.visibleTransfers.map((item) => item.id)).toEqual([
      "running",
      "queued",
      "failed",
    ]);
  });

  it("collapses overflowing history to the visible transfer limit", () => {
    const transfers = [
      transfer("one"),
      transfer("two"),
      transfer("three"),
      transfer("four"),
    ];

    const model = buildSftpTransferQueuePanelModel({
      historyExpanded: false,
      transfers,
    });

    expect(model.hasOverflowHistory).toBe(true);
    expect(model.hiddenTransferCount).toBe(1);
    expect(model.visibleTransfers.map((item) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(model.visibleTransfers).not.toBe(transfers);
  });

  it("shows the full queue when history is expanded", () => {
    const transfers = [
      transfer("one"),
      transfer("two"),
      transfer("three"),
      transfer("four"),
    ];

    const model = buildSftpTransferQueuePanelModel({
      historyExpanded: true,
      transfers,
    });

    expect(model.hasOverflowHistory).toBe(true);
    expect(model.hiddenTransferCount).toBe(1);
    expect(model.visibleTransfers).toEqual(transfers);
  });

  it("does not report overflow at the collapsed transfer limit", () => {
    const transfers = Array.from(
      { length: SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT },
      (_, index) => transfer(`transfer-${index}`),
    );

    const model = buildSftpTransferQueuePanelModel({
      historyExpanded: false,
      transfers,
    });

    expect(model.hasOverflowHistory).toBe(false);
    expect(model.hiddenTransferCount).toBe(0);
    expect(model.visibleTransfers).toEqual(transfers);
  });
});
