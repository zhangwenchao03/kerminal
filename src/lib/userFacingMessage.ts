export type UserFacingMessageSeverity =
  | "info"
  | "success"
  | "warning"
  | "error";

/**
 * 普通界面使用的消息模型。
 *
 * `title`、`detail` 和 `recoveryAction` 面向用户；原始异常只能进入经过脱敏的
 * `technicalDetail`，并由界面通过渐进披露按需展示。
 */
export interface UserFacingMessage {
  title: string;
  detail?: string;
  recoveryAction?: string;
  technicalDetail?: string;
  severity: UserFacingMessageSeverity;
}

export interface BuildUserFacingErrorOptions {
  title: string;
  detail?: string;
  recoveryAction?: string;
  severity?: Extract<UserFacingMessageSeverity, "error" | "warning">;
}

const MAX_TECHNICAL_DETAIL_LENGTH = 8_000;

/**
 * 把未知异常转换为稳定的用户摘要，同时保留脱敏后的排障细节。
 */
export function buildUserFacingError(
  error: unknown,
  options: BuildUserFacingErrorOptions,
): UserFacingMessage {
  const technicalDetail = technicalDetailFromUnknown(error);
  return {
    detail: options.detail,
    recoveryAction: options.recoveryAction,
    severity: options.severity ?? "error",
    technicalDetail,
    title: options.title,
  };
}

/**
 * 提取并脱敏技术错误信息；空值不会生成无意义的详情入口。
 */
export function technicalDetailFromUnknown(
  error: unknown,
): string | undefined {
  const rawDetail = rawTechnicalDetail(error).trim();
  if (!rawDetail) {
    return undefined;
  }
  return redactSensitiveTechnicalDetail(rawDetail).slice(
    0,
    MAX_TECHNICAL_DETAIL_LENGTH,
  );
}

/**
 * 对可能包含凭据的技术文本做保守脱敏。
 */
export function redactSensitiveTechnicalDetail(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      "[私钥内容已隐藏]",
    )
    .replace(
      /(\b(?:authorization|proxy-authorization)\b["']?\s*[:=]\s*["']?bearer\s+)[^"'\s,;}\]]+/gi,
      "$1[已隐藏]",
    )
    .replace(
      /(["']?\b(?:password|passwd|passphrase|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?secret|client[_-]?secret|key[_-]?passphrase|inline[_-]?private[_-]?key|private[_-]?key)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi,
      '$1"[已隐藏]"',
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+(@)/gi,
      "$1[已隐藏]$2",
    );
}

function rawTechnicalDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === null || error === undefined) {
    return "";
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}
