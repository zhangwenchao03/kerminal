import { beforeEach, describe, expect, it } from "vitest";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";
import {
  createSftpRuntimeDiagnostics,
  type SftpRuntimeDiagnostics,
} from "../../../../src/features/sftp/sftpRuntimeDiagnostics";

describe("sftpRuntimeDiagnostics", () => {
  let diagnostics: SftpRuntimeDiagnostics;

  beforeEach(() => {
    diagnostics = createSftpRuntimeDiagnostics();
  });

  it("summarizes transfer and preflight state without leaking paths", () => {
    diagnostics.updateTransfers([
      transfer({ id: "running", status: "running" }),
      transfer({ id: "done", status: "succeeded" }),
      transfer({ id: "failed", status: "failed" }),
    ]);
    diagnostics.updatePreflight({
      checked: 5,
      conflicts: 2,
      inFlight: 2,
      queued: 3,
      total: 10,
    });

    const snapshot = diagnostics.getSnapshot();

    expect(snapshot).toMatchObject({
      preflight: {
        active: 2,
        completed: 5,
        concurrencyLimit: 8,
        failed: 0,
        queued: 3,
      },
      transfers: {
        activeTransfers: 1,
        failedRecent: 1,
        recentCompleted: 2,
        retryableFailedRecent: 1,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("/secret");
    expect(JSON.stringify(snapshot)).not.toContain("host-secret");
  });

  it("tracks completed retention drops as a pruned estimate", () => {
    diagnostics.updateTransfers([
      transfer({ id: "a", status: "succeeded" }),
      transfer({ id: "b", status: "failed" }),
      transfer({ id: "c", status: "running" }),
    ]);
    diagnostics.updateTransfers([
      transfer({ id: "c", status: "running" }),
    ]);

    expect(diagnostics.getSnapshot().transfers).toMatchObject({
      activeTransfers: 1,
      prunedCompleted: 2,
      recentCompleted: 0,
    });
  });
});

function transfer({
  id,
  status,
}: {
  id: string;
  status: SftpTransferSummary["status"];
}): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    conflictPolicy: "overwrite",
    createdAt: 1,
    direction: "upload",
    hostId: "host-secret",
    id,
    kind: "file",
    localPath: "/secret/local.txt",
    operation: "upload",
    remotePath: "/secret/remote.txt",
    source: { kind: "local", path: "/secret/local.txt" },
    status,
    target: {
      hostId: "host-secret",
      hostLabel: "private",
      kind: "remote",
      path: "/secret/remote.txt",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1,
  };
}
