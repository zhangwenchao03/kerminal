import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../../lib/userFacingMessage";

/** 把 tmux 加载异常映射为可恢复的用户摘要。 */
export function formatTmuxLoadFailure(error: unknown) {
  const message = errorMessage(error);
  if (
    message.includes("session name 为空") ||
    message.includes("字段数量不匹配") ||
    message.includes("quoted 字段")
  ) {
    return "tmux 会话列表读取失败：目标 tmux 输出格式不兼容。请刷新重试；如果仍失败，请升级 tmux 或手动执行 tmux ls 检查。";
  }
  return formatTmuxActionFailure("读取 tmux 会话", error);
}

/** 把目标不可用原因转换为不暴露内部 executor 的用户文案。 */
export function formatTmuxTargetReason(reason: string) {
  if (reason.includes("Docker target")) {
    return "容器目标暂不支持 tmux。";
  }
  if (reason.includes("non-interactive tmux executor")) {
    return "当前目标不支持 tmux 操作。";
  }
  if (reason.includes("select a local or SSH target")) {
    return "请选择本机或 SSH 主机，或先聚焦终端。";
  }
  return reason;
}

/** 把 tmux 能力探测结果压缩为用户可理解的原因。 */
export function formatTmuxCapabilityReason(reason?: string) {
  const normalized = (reason ?? "").toLowerCase();
  if (
    normalized.includes("not found") ||
    normalized.includes("not installed") ||
    normalized.includes("path")
  ) {
    return "目标未安装 tmux，或 tmux 不在 PATH 中。";
  }
  if (normalized.includes("permission denied")) {
    return "当前用户没有执行 tmux 的权限。";
  }
  return "当前目标无法使用 tmux，请检查安装和连接状态。";
}

/** 按常见失败类别生成动作摘要，原始异常仍由技术详情承载。 */
export function formatTmuxActionFailure(action: string, error: unknown) {
  const normalized = errorMessage(error).toLowerCase();
  if (
    normalized.includes("duplicate session") ||
    normalized.includes("already exists")
  ) {
    return `${action}失败：同名会话已存在。`;
  }
  if (
    normalized.includes("tmux") &&
    (normalized.includes("not found") || normalized.includes("not installed"))
  ) {
    return `${action}失败：目标未安装 tmux，或 tmux 不在 PATH 中。`;
  }
  if (normalized.includes("permission denied")) {
    return `${action}失败：当前用户没有执行权限。`;
  }
  if (
    normalized.includes("connection") ||
    normalized.includes("disconnected") ||
    normalized.includes("missing-session")
  ) {
    return `${action}失败：目标连接不可用，请重新连接后重试。`;
  }
  return `${action}失败，请重试。`;
}

/** 构造不包含技术详情的本地校验消息。 */
export function tmuxNotice(title: string): UserFacingMessage {
  return {
    severity: "error",
    title,
  };
}

/** 构造包含脱敏技术详情的 tmux 运行错误。 */
export function tmuxFailure(
  error: unknown,
  title: string,
  recoveryAction = "请重试。",
): UserFacingMessage {
  return buildUserFacingError(error, {
    recoveryAction,
    title,
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
