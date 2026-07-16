import { describe, expect, it } from "vitest";
import type { SshCommandOutput } from "../../../../../src/lib/sshCommandApi";
import type { SftpFileTarget } from "../../../../../src/features/sftp/sftp-tool-content/types";
import {
  buildSftpCwdTrackingSetupPlan,
  buildSftpHostKeyTrustPlan,
  resolveSftpCwdTrackingSetupOutput,
  statusForHostKeyTrustError,
  statusForSftpCwdTrackingSetupError,
  statusForTrustedHostKey,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpRemoteSetupModel";

const sshTarget: SftpFileTarget = {
  hostId: "prod-api",
  initialPath: "/",
  kind: "ssh",
  protocol: "sftp://",
  summary: "deploy@prod.internal:22",
};

const externalSshTarget: SftpFileTarget = {
  ...sshTarget,
  hostId: "external:launch-123",
  summary: "ops@external.example:22",
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
    expect(buildSftpHostKeyTrustPlan(externalSshTarget)).toEqual({
      kind: "skip",
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
    const failure = statusForHostKeyTrustError(
      new Error("denied password=host-key-secret"),
    );
    expect(failure.kind).toBe("error");
    expect(failure.message).toContain("主机密钥信任失败：");
    expect(failure.message).toContain('password="[已隐藏]"');
    expect(failure.message).not.toContain("host-key-secret");
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
      message: "正在配置目录跟随...",
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
        message: "目录跟随已配置。重新连接后生效。",
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
        message: "目录跟随配置失败：permission denied",
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
        message: "目录跟随配置失败：readonly file",
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
        message: "目录跟随配置失败：远端命令退出码：未知",
      },
    });
    const failure = statusForSftpCwdTrackingSetupError(
      new Error("network token=cwd-model-secret"),
    );
    expect(failure.kind).toBe("error");
    expect(failure.message).toContain("目录跟随配置失败：");
    expect(failure.message).toContain('token="[已隐藏]"');
    expect(failure.message).not.toContain("cwd-model-secret");
  });
});
