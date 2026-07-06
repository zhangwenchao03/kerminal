/**
 * SFTP remote setup decision model.
 *
 * @author kongweiguang
 */

import type { SshCommandOutput, SshCommandRequest } from "../../../lib/sshCommandApi";
import type {
  SftpHostKeyTrustSummary,
  SftpTrustHostKeyRequest,
} from "../../../lib/sftpApi";
import { buildSftpCwdTrackingSetupScript } from "./sftpCwdTrackingScript";
import { errorMessage } from "./sftpPathModel";
import type { SftpFileTarget, SftpStatus } from "./types";

const EXTERNAL_TARGET_PREFIX = "external:";

export type SftpHostKeyTrustPlan =
  | { kind: "skip" }
  | { kind: "trust"; request: SftpTrustHostKeyRequest };

export type SftpCwdTrackingSetupPlan =
  | { kind: "skip" }
  | {
      kind: "execute";
      request: SshCommandRequest;
      startStatus: SftpStatus;
    };

export type SftpCwdTrackingSetupResult =
  | { kind: "success"; status: SftpStatus }
  | { kind: "failed"; status: SftpStatus };

export function buildSftpHostKeyTrustPlan(
  fileTarget: SftpFileTarget | null,
): SftpHostKeyTrustPlan {
  if (!fileTarget || fileTarget.kind !== "ssh") {
    return { kind: "skip" };
  }
  if (fileTarget.hostId.startsWith(EXTERNAL_TARGET_PREFIX)) {
    return { kind: "skip" };
  }

  return {
    kind: "trust",
    request: { hostId: fileTarget.hostId },
  };
}

export function statusForTrustedHostKey(
  summary: SftpHostKeyTrustSummary,
): SftpStatus {
  return {
    kind: "success",
    message: `已信任主机密钥：${summary.host}:${summary.port}`,
  };
}

export function statusForHostKeyTrustError(error: unknown): SftpStatus {
  return {
    kind: "error",
    message: `信任主机密钥失败：${errorMessage(error)}`,
  };
}

export function buildSftpCwdTrackingSetupPlan(
  fileTarget: SftpFileTarget | null,
): SftpCwdTrackingSetupPlan {
  if (!fileTarget || fileTarget.kind !== "ssh") {
    return { kind: "skip" };
  }

  return {
    kind: "execute",
    request: {
      command: buildSftpCwdTrackingSetupScript(),
      hostId: fileTarget.hostId,
      maxOutputBytes: 4096,
      timeoutSeconds: 15,
    },
    startStatus: {
      kind: "info",
      message: "正在写入远端 shell 配置...",
    },
  };
}

export function resolveSftpCwdTrackingSetupOutput(
  output: SshCommandOutput,
): SftpCwdTrackingSetupResult {
  if (output.success) {
    return {
      kind: "success",
      status: {
        kind: "success",
        message: "已写入远端配置。重新登录或 source 对应 shell 配置后生效。",
      },
    };
  }

  return {
    kind: "failed",
    status: statusForSftpCwdTrackingSetupError(
      failedSftpCwdTrackingSetupReason(output),
    ),
  };
}

export function statusForSftpCwdTrackingSetupError(error: unknown): SftpStatus {
  return {
    kind: "error",
    message: `自动设置失败：${errorMessage(error)}`,
  };
}

function failedSftpCwdTrackingSetupReason(output: SshCommandOutput) {
  const details = (output.stderr || output.stdout).trim();
  return details || `远端命令退出码：${output.exitCode ?? "未知"}`;
}
