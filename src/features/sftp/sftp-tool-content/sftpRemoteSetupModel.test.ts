import { describe, expect, it } from "vitest";
import type { SshCommandOutput } from "../../../lib/sshCommandApi";
import type { SftpFileTarget } from "./types";
import {
  buildSftpCwdTrackingSetupPlan,
  buildSftpHostKeyTrustPlan,
  resolveSftpCwdTrackingSetupOutput,
  statusForHostKeyTrustError,
  statusForSftpCwdTrackingSetupError,
  statusForTrustedHostKey,
} from "./sftpRemoteSetupModel";

const sshTarget: SftpFileTarget = {
  hostId: "prod-api",
  initialPath: "/",
  kind: "ssh",
  protocol: "sftp://",
  summary: "deploy@prod.internal:22",
};

const dockerTarget: SftpFileTarget = {
  containerId: "container-api",
  hostId: "prod-api",
  initialPath: "/app",
  kind: "dockerContainer",
  protocol: "container://",
  runtime: "docker",
  summary: "prod-api / api",
};

function sshOutput(overrides: Partial<SshCommandOutput>): SshCommandOutput {
  return {
    durationMs: 18,
    exitCode: 0,
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    maxOutputBytes: 4096,
    port: 22,
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
    stdout: "",
    stdoutBytes: 0,
    stdoutTruncated: false,
    success: true,
    username: "deploy",
    ...overrides,
  };
}

describe("sftpRemoteSetupModel", () => {
  it("builds host key trust only for SSH targets", () => {
    expect(buildSftpHostKeyTrustPlan(sshTarget)).toEqual({
      kind: "trust",
      request: { hostId: "prod-api" },
    });
    expect(buildSftpHostKeyTrustPlan(dockerTarget)).toEqual({ kind: "skip" });
    expect(buildSftpHostKeyTrustPlan(null)).toEqual({ kind: "skip" });
  });

  it("formats host key trust statuses", () => {
    expect(
      statusForTrustedHostKey({
        host: "prod.internal",
        hostId: "prod-api",
        knownHostsPath: "/home/deploy/.ssh/known_hosts",
        port: 22,
      }),
    ).toEqual({
      kind: "success",
      message: "已信任主机密钥：prod.internal:22",
    });
    expect(statusForHostKeyTrustError(new Error("denied"))).toEqual({
      kind: "error",
      message: "信任主机密钥失败：denied",
    });
  });

  it("builds cwd tracking setup command only for SSH targets", () => {
    const plan = buildSftpCwdTrackingSetupPlan(sshTarget);
    expect(plan.kind).toBe("execute");
    if (plan.kind !== "execute") {
      return;
    }
    expect(plan.request).toMatchObject({
      hostId: "prod-api",
      maxOutputBytes: 4096,
      timeoutSeconds: 15,
    });
    expect(plan.request.command).toContain("1337;CurrentDir");
    expect(plan.request.command).toContain("add-zsh-hook precmd __kerminal_cwd");
    expect(plan.startStatus).toEqual({
      kind: "info",
      message: "正在写入远端 shell 配置...",
    });

    expect(buildSftpCwdTrackingSetupPlan(dockerTarget)).toEqual({
      kind: "skip",
    });
  });

  it("resolves cwd tracking setup command output", () => {
    expect(resolveSftpCwdTrackingSetupOutput(sshOutput({}))).toEqual({
      kind: "success",
      status: {
        kind: "success",
        message: "已写入远端配置。重新登录或 source 对应 shell 配置后生效。",
      },
    });

    expect(
      resolveSftpCwdTrackingSetupOutput(
        sshOutput({
          exitCode: 1,
          stderr: "permission denied",
          success: false,
        }),
      ),
    ).toEqual({
      kind: "failed",
      status: {
        kind: "error",
        message: "自动设置失败：permission denied",
      },
    });
  });

  it("falls back to stdout or exit code for cwd setup failures", () => {
    expect(
      resolveSftpCwdTrackingSetupOutput(
        sshOutput({
          exitCode: 2,
          stdout: "readonly file",
          success: false,
        }),
      ),
    ).toEqual({
      kind: "failed",
      status: {
        kind: "error",
        message: "自动设置失败：readonly file",
      },
    });

    expect(
      resolveSftpCwdTrackingSetupOutput(
        sshOutput({
          exitCode: null,
          success: false,
        }),
      ),
    ).toEqual({
      kind: "failed",
      status: {
        kind: "error",
        message: "自动设置失败：远端命令退出码：未知",
      },
    });
    expect(statusForSftpCwdTrackingSetupError(new Error("network"))).toEqual({
      kind: "error",
      message: "自动设置失败：network",
    });
  });
});
