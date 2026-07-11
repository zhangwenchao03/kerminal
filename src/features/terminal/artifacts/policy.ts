// @author kongweiguang

import type {
  TerminalArtifactActionMetadata,
  TerminalArtifactCandidate,
  TerminalArtifactKind,
  TerminalArtifactPathStyle,
  TerminalArtifactSensitivity,
  TerminalArtifactTargetIdentity,
} from "./types";

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);
const SECRET_LIKE_RE =
  /(?:^|[/\\._-])(?:id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys|known_hosts|\.?env(?:\.[^/\\]+)?|credentials?|secrets?|tokens?|private[-_]?key)(?:$|[/\\._-])/i;
const PRIVATE_KEY_RE = /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/i;
const AUTHORIZATION_BEARER_RE = /\bauthorization\s*:\s*bearer\s+\S+/i;
const CLI_SECRET_FLAG_RE =
  /(?:^|\s)--(?:api[-_]?key|access[-_]?key|password|passwd|secret|secret[-_]?key|token)(?:=|\s+)(?:"[^"]+"|'[^']+'|\S+)/i;
const AWS_ACCESS_KEY_RE = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;
const AWS_SECRET_RE =
  /\bAWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/i;

/** 只允许可交给系统浏览器的显式 Web scheme。 */
export function isAllowedTerminalArtifactUrl(value: string) {
  try {
    return ALLOWED_URL_SCHEMES.has(new URL(value).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/** 跨平台路径样式判定不访问宿主文件系统，远端路径保持其原始语义。 */
export function resolveTerminalArtifactPathStyle(
  value: string,
): TerminalArtifactPathStyle {
  if (/^\\\\[^\\]+\\[^\\]+/.test(value)) {
    return "unc";
  }
  if (/^[a-z]:[\\/]/i.test(value)) {
    return "windows";
  }
  if (/^(?:~\/|\/)/.test(value)) {
    return "posix";
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return "uri";
  }
  return "none";
}

/** 敏感策略只做阻断和降权，不尝试保存或脱敏终端正文。 */
export function classifyTerminalArtifactSensitivity(
  value: string,
  source?: TerminalArtifactCandidate["source"],
): TerminalArtifactSensitivity {
  if (PRIVATE_KEY_RE.test(value) || /(?:password|passwd)\s*[:=]\s*\S+/i.test(value)) {
    return "blocked";
  }
  // 命令块可能完整携带请求头、CLI 参数或云凭据，采用比路径和 URL 更严格的阻断策略。
  if (
    source === "command-block" &&
    (AUTHORIZATION_BEARER_RE.test(value) ||
      CLI_SECRET_FLAG_RE.test(value) ||
      AWS_ACCESS_KEY_RE.test(value) ||
      AWS_SECRET_RE.test(value))
  ) {
    return "blocked";
  }
  return SECRET_LIKE_RE.test(value) ? "sensitive" : "normal";
}

export function terminalArtifactActions(
  candidate: TerminalArtifactCandidate,
  target: TerminalArtifactTargetIdentity,
  sensitivity: TerminalArtifactSensitivity,
): readonly TerminalArtifactActionMetadata[] {
  const copy: TerminalArtifactActionMetadata = {
    enabled: sensitivity !== "blocked",
    id: "copy",
    requiresConfirmation: false,
    ...(sensitivity === "blocked"
      ? { disabledReason: "疑似包含凭据或私钥正文" }
      : {}),
  };
  if (sensitivity === "blocked") {
    return [copy];
  }
  if (candidate.kind === "url" || candidate.kind === "link") {
    return [
      {
        enabled: isAllowedTerminalArtifactUrl(candidate.value),
        id: "open",
        requiresConfirmation: false,
        ...(!isAllowedTerminalArtifactUrl(candidate.value)
          ? { disabledReason: "URL scheme 不在允许列表中" }
          : {}),
      },
      copy,
    ];
  }
  if (candidate.kind === "command") {
    return [
      copy,
      {
        enabled: true,
        id: "rerun-command",
        requiresConfirmation: true,
      },
    ];
  }
  const local = target.kind === "local";
  return [
    copy,
    {
      enabled: local,
      id: "reveal",
      requiresConfirmation: false,
      ...(!local ? { disabledReason: "远端路径不能由本机文件管理器打开" } : {}),
    },
    {
      enabled: true,
      id: "open-terminal",
      requiresConfirmation: false,
    },
  ];
}

export function artifactKindForPath(value: string): TerminalArtifactKind {
  return /\.(?:log|out|trace)(?:\.\d+)?$/i.test(value) ? "log" : "path";
}
