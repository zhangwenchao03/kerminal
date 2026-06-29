/**
 * SFTP remote copy queue execution model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpRemoteCopyPlan } from "./sftpRemoteTransferModel";
import {
  buildSftpRemoteCopyTaskExecutionPlan,
  statusForSftpRemoteCopyTaskFailure,
} from "./sftpRemoteCopyTaskRunnerModel";

const remoteCopyPlan: SftpRemoteCopyPlan = {
  destinationRemotePath: "/backup",
  requests: [
    {
      conflictPolicy: "overwrite",
      kind: "file",
      sourceHostId: "host-left",
      sourceRemotePath: "/srv/app.log",
      targetHostId: "host-right",
      targetRemotePath: "/backup/app.log",
    },
    {
      conflictPolicy: "overwrite",
      kind: "directory",
      sourceHostId: "host-left",
      sourceRemotePath: "/srv/conf",
      targetHostId: "host-right",
      targetRemotePath: "/backup/conf",
    },
  ],
  statusMessage: "已加入跨主机传输队列：Left Host app.log、conf -> /backup",
  targetDescription: "跨主机传输",
};

describe("sftpRemoteCopyTaskRunnerModel", () => {
  it("plans remote copy queue execution with success and failure statuses", () => {
    expect(
      buildSftpRemoteCopyTaskExecutionPlan({ plan: remoteCopyPlan }),
    ).toEqual({
      failureMessagePrefix: "跨主机传输入队失败",
      kind: "queue",
      requests: remoteCopyPlan.requests,
      successStatus: null,
    });
  });

  it("allows callers to override the failure message prefix", () => {
    expect(
      buildSftpRemoteCopyTaskExecutionPlan({
        failureMessagePrefix: "传输入队失败",
        plan: remoteCopyPlan,
      }),
    ).toMatchObject({
      failureMessagePrefix: "传输入队失败",
      kind: "queue",
    });
  });

  it("returns an explicit empty status when no request can be queued", () => {
    expect(
      buildSftpRemoteCopyTaskExecutionPlan({
        plan: {
          ...remoteCopyPlan,
          requests: [],
        },
      }),
    ).toEqual({
      kind: "empty",
      status: {
        kind: "info",
        message: "没有可入队的远程传输项目。",
      },
    });
  });

  it("formats remote copy queue failures with the resolved prefix", () => {
    expect(
      statusForSftpRemoteCopyTaskFailure({
        failureMessagePrefix: "传输入队失败",
        reason: "network timeout",
      }),
    ).toEqual({
      kind: "error",
      message: "传输入队失败：network timeout",
    });
  });
});
