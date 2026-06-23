/**
 * SFTP 后台传输展示模型测试。
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import { fileNameFromPath, formatFileSize } from "./sftpFileUtils";
import {
  activeTransferCount,
  canCancelTransfer,
  canClearFinishedTransfers,
  formatTransferBytes,
  isFinishedTransfer,
  mergeTransferSnapshot,
  replaceTransferQueue,
  sortTransfers,
  transferPathSummary,
  transferPercentLabel,
  transferProgressPercent,
  transferStatusLabel,
  transferStatusSummary,
  transferTitle,
  upsertTransfer,
} from "./sftpTransferModel";

function transfer(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 100,
    direction: "download",
    hostId: "host-1",
    id: "transfer-1",
    kind: "file",
    localPath: "C:\\Downloads\\archive.zip",
    remotePath: "/srv/archive.zip",
    status: "queued",
    totalBytes: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe("sftpTransferModel", () => {
  it("sorts active transfers ahead of failed and completed items", () => {
    const sorted = sortTransfers([
      transfer({ createdAt: 1, id: "old-success", status: "succeeded" }),
      transfer({ createdAt: 3, id: "new-running", status: "running" }),
      transfer({ createdAt: 2, id: "failed", status: "failed" }),
      transfer({ createdAt: 4, id: "queued", status: "queued" }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "new-running",
      "queued",
      "failed",
      "old-success",
    ]);
  });

  it("replaces an existing transfer snapshot by id", () => {
    const original = transfer({ bytesTransferred: 20, id: "same" });
    const replacement = transfer({
      bytesTransferred: 80,
      id: "same",
      status: "running",
    });

    expect(upsertTransfer([original], replacement)).toEqual([replacement]);
  });

  it("merges a transfer snapshot without mutating the existing queue", () => {
    const original = transfer({
      bytesTransferred: 20,
      createdAt: 3,
      id: "same",
      status: "queued",
    });
    const newerRunning = transfer({
      createdAt: 1,
      id: "newer-running",
      status: "running",
    });
    const replacement = transfer({
      bytesTransferred: 80,
      createdAt: 2,
      id: "same",
      status: "failed",
    });
    const queue = [original, newerRunning];

    const merged = mergeTransferSnapshot(queue, replacement);

    expect(queue).toEqual([original, newerRunning]);
    expect(merged.map((item) => item.id)).toEqual(["newer-running", "same"]);
    expect(merged[1]).toBe(replacement);
  });

  it("sorts replacement queue results without mutating the backend result", () => {
    const running = transfer({
      createdAt: 1,
      id: "running",
      status: "running",
    });
    const queued = transfer({
      createdAt: 5,
      id: "queued",
      status: "queued",
    });
    const backendQueue = [queued, running];

    const replaced = replaceTransferQueue(backendQueue);

    expect(backendQueue).toEqual([queued, running]);
    expect(replaced.map((item) => item.id)).toEqual(["running", "queued"]);
  });

  it("calculates percent boundaries for unknown, overrun, and completed totals", () => {
    expect(
      transferProgressPercent(
        transfer({ bytesTransferred: 50, status: "running", totalBytes: 0 }),
      ),
    ).toBe(8);
    expect(
      transferProgressPercent(transfer({ bytesTransferred: 150, totalBytes: 100 })),
    ).toBe(100);
    expect(
      transferProgressPercent(
        transfer({ bytesTransferred: 0, status: "succeeded", totalBytes: 0 }),
      ),
    ).toBe(100);
  });

  it("keeps archive zip writing visible after the remote download reaches its byte total", () => {
    const archiving = transfer({
      bytesTransferred: 100,
      operation: "archiveDownload",
      phase: "archiving",
      status: "running",
      totalBytes: 100,
    });

    expect(transferProgressPercent(archiving)).toBe(96);
    expect(transferPercentLabel(archiving)).toBe("压缩中");
    expect(transferStatusLabel(archiving.status, archiving.phase)).toBe("压缩中");
  });

  it("formats status, title, path, percent, and byte summaries", () => {
    const running = transfer({
      bytesTransferred: 1536,
      direction: "upload",
      localPath: "C:\\logs\\app.log",
      remotePath: "/var/log/app.log",
      status: "running",
      totalBytes: 3072,
    });

    expect(transferTitle(running)).toBe("app.log");
    expect(transferPercentLabel(running)).toBe("50%");
    expect(transferPathSummary(running)).toBe("C:\\logs\\app.log -> /var/log/app.log");
    expect(transferStatusLabel("running")).toBe("传输中");
    expect(formatTransferBytes(running)).toBe("1.5 KB / 3.0 KB");
  });

  it("prefers structured source and target endpoints for cross-host tasks", () => {
    const remoteCopy = transfer({
      direction: "upload",
      localPath: "sftp://host-left/tmp/app.log",
      operation: "remoteCopy",
      remotePath: "/var/log/app.log",
      source: {
        hostId: "host-left",
        hostLabel: "left",
        kind: "remote",
        path: "/tmp/app.log",
      },
      target: {
        hostId: "host-right",
        hostLabel: "right",
        kind: "remote",
        path: "/var/log/app.log",
      },
      transportMode: "clientBridge",
    });

    expect(transferTitle(remoteCopy)).toBe("app.log");
    expect(transferPathSummary(remoteCopy)).toBe(
      "left:/tmp/app.log -> right:/var/log/app.log",
    );
  });

  it("labels legacy snake_case remote endpoints without showing undefined", () => {
    const archiveDownload = transfer({
      operation: "archiveDownload",
      source: {
        host_id: "source-host",
        host_label: "dev",
        kind: "remote",
        path: "/bwy/app/abc/.codex/jdk-21.0.2",
      } as unknown as SftpTransferSummary["source"],
      target: {
        kind: "local",
        path: "C:\\Users\\24052\\Downloads\\jdk-21.0.2.zip",
      },
    });

    expect(transferPathSummary(archiveDownload)).toBe(
      "dev:/bwy/app/abc/.codex/jdk-21.0.2 -> C:\\Users\\24052\\Downloads\\jdk-21.0.2.zip",
    );
  });

  it("falls back from placeholder endpoint labels before rendering paths", () => {
    const archiveDownload = transfer({
      operation: "archiveDownload",
      source: {
        host_id: "source-host",
        host_label: "undefined",
        hostLabel: "null",
        kind: "remote",
        path: "/bwy/app/abc/.codex/jdk-21.0.2",
      } as unknown as SftpTransferSummary["source"],
      target: {
        kind: "local",
        path: "C:\\Users\\24052\\Downloads\\jdk-21.0.2.zip",
      },
    });

    expect(transferPathSummary(archiveDownload)).toBe(
      "source-host:/bwy/app/abc/.codex/jdk-21.0.2 -> C:\\Users\\24052\\Downloads\\jdk-21.0.2.zip",
    );
  });

  it("summarizes queue state by active, failed, completed, and fallback order", () => {
    const completed = transfer({ status: "succeeded" });

    expect(
      transferStatusSummary({
        activeCount: 2,
        completedCount: 1,
        failedCount: 0,
        totalCount: 3,
        transfer: completed,
      }),
    ).toBe("后台传输 2 项，1 项已结束");
    expect(
      transferStatusSummary({
        activeCount: 0,
        completedCount: 0,
        failedCount: 1,
        totalCount: 1,
        transfer: completed,
      }),
    ).toBe("1 项传输失败，可从任务记录重试或清理");
    expect(
      transferStatusSummary({
        activeCount: 0,
        completedCount: 1,
        failedCount: 0,
        totalCount: 1,
        transfer: completed,
      }),
    ).toBe("1 项传输完成");
  });

  it("classifies active and finished transfer counts", () => {
    const transfers = [
      transfer({ id: "queued", status: "queued" }),
      transfer({ id: "running", status: "running" }),
      transfer({ id: "failed", status: "failed" }),
      transfer({ id: "canceled", status: "canceled" }),
    ];

    expect(activeTransferCount(transfers)).toBe(2);
    expect(transfers.filter(isFinishedTransfer).map((item) => item.id)).toEqual([
      "failed",
      "canceled",
    ]);
  });

  it("allows cancel only for queued or running transfers without a pending cancel request", () => {
    expect(canCancelTransfer(transfer({ status: "queued" }))).toBe(true);
    expect(canCancelTransfer(transfer({ status: "running" }))).toBe(true);
    expect(
      canCancelTransfer(
        transfer({ cancelRequested: true, status: "queued" }),
      ),
    ).toBe(false);
    expect(
      canCancelTransfer(
        transfer({ cancelRequested: true, status: "running" }),
      ),
    ).toBe(false);
    expect(canCancelTransfer(transfer({ status: "succeeded" }))).toBe(false);
    expect(canCancelTransfer(transfer({ status: "failed" }))).toBe(false);
    expect(canCancelTransfer(transfer({ status: "canceled" }))).toBe(false);
  });

  it("allows clearing only when the transfer queue contains finished tasks", () => {
    expect(
      canClearFinishedTransfers([
        transfer({ id: "queued", status: "queued" }),
        transfer({ id: "running", status: "running" }),
      ]),
    ).toBe(false);
    expect(
      canClearFinishedTransfers([
        transfer({ id: "queued", status: "queued" }),
        transfer({ id: "succeeded", status: "succeeded" }),
      ]),
    ).toBe(true);
    expect(
      canClearFinishedTransfers([transfer({ id: "failed", status: "failed" })]),
    ).toBe(true);
    expect(
      canClearFinishedTransfers([
        transfer({ id: "canceled", status: "canceled" }),
      ]),
    ).toBe(true);
  });

  it("formats file names and sizes used by transfer labels", () => {
    expect(fileNameFromPath("C:\\Users\\kong\\Downloads\\report.zip")).toBe(
      "report.zip",
    );
    expect(fileNameFromPath("/tmp/", "folder")).toBe("folder");
    expect(formatFileSize(42)).toBe("42 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
