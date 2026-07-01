/**
 * SFTP 传输同步模型测试。
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpTransferSummary } from "../../../../../src/lib/sftpApi";
import {
  filterSftpTransfersForHost,
  mergeSftpTransferUpdateForHost,
  resolveSftpTransferCompletionEffects,
  sftpTransferMatchesViewScope,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpTransferSyncModel";

function transfer(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  return {
    bytesTransferred: 10,
    cancelRequested: false,
    createdAt: 1,
    direction: "upload",
    hostId: "prod-api",
    id: "transfer-1",
    kind: "file",
    localPath: "/Users/me/release.tgz",
    operation: "upload",
    remotePath: "/opt/release.tgz",
    source: {
      kind: "local",
      path: "/Users/me/release.tgz",
    },
    status: "succeeded",
    target: {
      hostId: "prod-api",
      hostLabel: "prod-api",
      kind: "remote",
      path: "/opt/release.tgz",
    },
    totalBytes: 10,
    transportMode: "singleHostSftp",
    updatedAt: 2,
    ...overrides,
  };
}

describe("sftpTransferSyncModel", () => {
  it("filters visible transfers by active SSH host", () => {
    const prodTransfer = transfer({ id: "prod" });
    const stagingTransfer = transfer({
      hostId: "staging-api",
      id: "staging",
    });

    expect(
      filterSftpTransfersForHost([prodTransfer, stagingTransfer], "prod-api"),
    ).toEqual([prodTransfer]);
    expect(
      filterSftpTransfersForHost([prodTransfer, stagingTransfer], undefined),
    ).toEqual([]);
  });

  it("filters visible transfers by view scope inside the same host", () => {
    const currentTab = transfer({
      id: "current-tab",
      viewScope: "sftp-workbench:tab-a",
    });
    const otherTab = transfer({
      id: "other-tab",
      viewScope: "sftp-workbench:tab-b",
    });
    const unrelatedScopeTransfer = transfer({ id: "unrelated-scope-transfer" });

    expect(
      filterSftpTransfersForHost(
        [currentTab, otherTab, unrelatedScopeTransfer],
        "prod-api",
        "sftp-workbench:tab-a",
      ),
    ).toEqual([currentTab]);
    expect(
      filterSftpTransfersForHost(
        [currentTab, otherTab, unrelatedScopeTransfer],
        "prod-api",
        null,
      ),
    ).toEqual([unrelatedScopeTransfer]);
    expect(sftpTransferMatchesViewScope(otherTab, undefined)).toBe(true);
  });

  it("ignores transfer events from other hosts and upserts active host updates", () => {
    const current = [
      transfer({ id: "old", status: "running" }),
      transfer({ createdAt: 5, id: "newer", status: "queued" }),
    ];

    expect(
      mergeSftpTransferUpdateForHost({
        hostId: "prod-api",
        transfer: transfer({ hostId: "staging-api", id: "foreign" }),
        transfers: current,
      }),
    ).toBe(current);

    expect(
      mergeSftpTransferUpdateForHost({
        hostId: "prod-api",
        transfer: transfer({ id: "old", status: "succeeded" }),
        transfers: current,
      }).map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: "newer", status: "queued" },
      { id: "old", status: "succeeded" },
    ]);
  });

  it("ignores transfer events from another view scope on the active host", () => {
    const current = [transfer({ id: "existing", status: "running" })];

    expect(
      mergeSftpTransferUpdateForHost({
        hostId: "prod-api",
        transfer: transfer({
          id: "foreign-scope",
          viewScope: "sftp-workbench:tab-b",
        }),
        transfers: current,
        viewScope: "sftp-workbench:tab-a",
      }),
    ).toBe(current);

    expect(
      mergeSftpTransferUpdateForHost({
        hostId: "prod-api",
        transfer: transfer({
          id: "active-scope",
          viewScope: "sftp-workbench:tab-a",
        }),
        transfers: current,
        viewScope: "sftp-workbench:tab-a",
      }).map((item) => item.id),
    ).toEqual(["existing", "active-scope"]);
  });

  it("reloads the current directory once for new completed uploads", () => {
    const firstUpload = transfer({
      id: "upload-1",
      remotePath: "/opt/release.tgz",
    });
    const secondUpload = transfer({
      id: "upload-2",
      kind: "directory",
      remotePath: "/opt/dist",
    });

    const firstPass = resolveSftpTransferCompletionEffects({
      completedTransferIds: new Set(),
      currentPath: "/opt",
      transfers: [firstUpload, secondUpload],
    });

    expect(firstPass.reloadPath).toBe("/opt");
    expect([...firstPass.completedTransferIds].sort()).toEqual([
      "upload-1",
      "upload-2",
    ]);

    const repeatedPass = resolveSftpTransferCompletionEffects({
      completedTransferIds: firstPass.completedTransferIds,
      currentPath: "/opt",
      transfers: [firstUpload, secondUpload],
    });

    expect(repeatedPass.reloadPath).toBeNull();
    expect([...repeatedPass.completedTransferIds].sort()).toEqual([
      "upload-1",
      "upload-2",
    ]);
  });

  it("does not reload for downloads, failed transfers, or uploads in another directory", () => {
    const effects = resolveSftpTransferCompletionEffects({
      completedTransferIds: new Set(["known"]),
      currentPath: "/opt",
      transfers: [
        transfer({
          direction: "download",
          id: "download",
          remotePath: "/opt/release.tgz",
        }),
        transfer({ id: "failed", status: "failed" }),
        transfer({ id: "other-dir", remotePath: "/var/release.tgz" }),
        transfer({ id: "known", remotePath: "/opt/known.tgz" }),
      ],
    });

    expect(effects.reloadPath).toBeNull();
    expect([...effects.completedTransferIds].sort()).toEqual([
      "download",
      "failed",
      "known",
      "other-dir",
    ]);
  });
});
