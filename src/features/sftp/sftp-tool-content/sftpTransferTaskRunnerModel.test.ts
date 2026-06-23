/**
 * SFTP transfer task execution strategy model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpTransferActionItem } from "./sftpTransferActionPlan";
import { buildSftpTransferTaskExecutionPlan } from "./sftpTransferTaskRunnerModel";
import type { SftpFileTarget } from "./types";

const transferPlan: SftpTransferActionItem = {
  queuedStatus: {
    kind: "info",
    message: "已加入上传队列：release.tgz",
  },
  request: {
    direction: "upload",
    hostId: "prod-api",
    kind: "file",
    localPath: "/Users/me/release.tgz",
    remotePath: "/app/release.tgz",
  },
};

const sshTarget: Extract<SftpFileTarget, { kind: "ssh" }> = {
  hostId: "prod-api",
  initialPath: "/app",
  kind: "ssh",
  protocol: "sftp://",
  summary: "deploy@prod",
};

const containerTarget: Extract<SftpFileTarget, { kind: "dockerContainer" }> = {
  containerId: "container-api",
  containerName: "api",
  hostId: "prod-api",
  initialPath: "/app",
  kind: "dockerContainer",
  protocol: "container://",
  runtime: "docker",
  summary: "docker:prod-api:api",
};

describe("buildSftpTransferTaskExecutionPlan", () => {
  it("returns noop when no file target is selected", () => {
    expect(
      buildSftpTransferTaskExecutionPlan({
        currentPath: "/app",
        fileTarget: null,
        transferPlan,
      }),
    ).toEqual({ kind: "noop" });
  });

  it("keeps SSH transfers on the queued SFTP path", () => {
    expect(
      buildSftpTransferTaskExecutionPlan({
        currentPath: "/app",
        fileTarget: sshTarget,
        transferPlan,
      }),
    ).toEqual({
      kind: "sshQueue",
      queuedStatus: transferPlan.queuedStatus,
      request: transferPlan.request,
    });
  });

  it("plans Docker uploads as direct container transfers and refreshes the current directory", () => {
    expect(
      buildSftpTransferTaskExecutionPlan({
        currentPath: "/app",
        fileTarget: containerTarget,
        transferPlan,
      }),
    ).toEqual({
      containerRequest: {
        containerId: "container-api",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/release.tgz",
        remotePath: "/app/release.tgz",
        runtime: "docker",
      },
      direction: "upload",
      kind: "dockerDirect",
      refreshRemotePath: "/app",
      runningStatus: {
        kind: "info",
        message: "正在上传：release.tgz",
      },
      successStatus: {
        kind: "success",
        message: "已上传：release.tgz",
      },
    });
  });

  it("does not refresh a container directory when upload lands outside the current path", () => {
    expect(
      buildSftpTransferTaskExecutionPlan({
        currentPath: "/var",
        fileTarget: containerTarget,
        transferPlan,
      }),
    ).toMatchObject({
      kind: "dockerDirect",
      refreshRemotePath: null,
    });
  });

  it("plans Docker downloads without a directory refresh", () => {
    const downloadPlan: SftpTransferActionItem = {
      queuedStatus: {
        kind: "info",
        message: "已加入下载队列：/app/package.json",
      },
      request: {
        direction: "download",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/Downloads/package.json",
        remotePath: "/app/package.json",
      },
    };

    expect(
      buildSftpTransferTaskExecutionPlan({
        currentPath: "/app",
        fileTarget: containerTarget,
        transferPlan: downloadPlan,
      }),
    ).toMatchObject({
      direction: "download",
      kind: "dockerDirect",
      refreshRemotePath: null,
      runningStatus: {
        kind: "info",
        message: "正在下载：/app/package.json",
      },
      successStatus: {
        kind: "success",
        message: "已下载：/app/package.json",
      },
    });
  });
});
