/**
 * SFTP transfer retry policy tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";
import { resolveSftpTransferRetry } from "../../../../src/features/sftp/sftpTransferRetryPolicy";

describe("resolveSftpTransferRetry", () => {
  it("rebuilds a managed upload or download request from a failed transfer", () => {
    const decision = resolveSftpTransferRetry(
      transferSummary({
        conflictPolicy: "rename",
        direction: "upload",
        status: "failed",
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    expect(decision).toMatchObject({
      canRetry: true,
      request: {
        conflictPolicy: "rename",
        direction: "upload",
        hostId: "host-left",
        kind: "file",
        localPath: "C:/downloads/app.log",
        remotePath: "/srv/app.log",
        viewScope: "sftp-workbench:tab-a",
      },
      statusMessage:
        "已重新加入传输队列；断点续传未默认启用，将按完整任务重试。",
    });
  });

  it("does not retry non-failed, remote-copy, or metadata-incomplete transfers", () => {
    expect(resolveSftpTransferRetry(transferSummary()).canRetry).toBe(false);
    expect(
      resolveSftpTransferRetry(
        transferSummary({
          conflictPolicy: "overwrite",
          operation: "remoteCopy",
          status: "failed",
        }),
      ),
    ).toMatchObject({
      canRetry: false,
      reason: "unsupportedOperation",
      statusMessage: "该传输类型暂不支持安全重试。",
    });
    expect(
      resolveSftpTransferRetry(
        transferSummary({
          conflictPolicy: undefined,
          status: "failed",
        }),
      ),
    ).toMatchObject({
      canRetry: false,
      reason: "missingConflictPolicy",
      statusMessage: "缺少原始冲突策略，不能安全重试。",
    });
  });
});

function transferSummary(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  const remotePath = overrides.remotePath ?? "/srv/app.log";
  const localPath = overrides.localPath ?? "C:/downloads/app.log";

  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 1,
    direction: "download",
    hostId: "host-left",
    id: "transfer-1",
    kind: "file",
    localPath,
    operation: "download",
    remotePath,
    source: {
      hostId: "host-left",
      hostLabel: "host-left",
      kind: "remote",
      path: remotePath,
    },
    status: "queued",
    target: {
      kind: "local",
      path: localPath,
    },
    totalBytes: 1024,
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}
