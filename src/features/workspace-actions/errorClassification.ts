import { buildUserFacingError } from "../../lib/userFacingMessage";
import { WorkspaceActionNotFoundError } from "./registry";
import type { WorkspaceActionExecutionResult } from "./types";

export type WorkspaceActionErrorKind =
  | "not-found"
  | "aborted"
  | "execution-failed";

/** 将未知 executor 异常转换为稳定、脱敏的用户可见失败结果。 */
export function classifyWorkspaceActionError(
  error: unknown,
): Extract<WorkspaceActionExecutionResult, { kind: "failure" }> {
  if (error instanceof WorkspaceActionNotFoundError) {
    return {
      kind: "failure",
      errorKind: "not-found",
      error: buildUserFacingError(error, {
        title: "无法执行工作区动作",
        detail: "动作尚未注册或已被移除。",
        recoveryAction: "刷新界面后重试。",
      }),
    };
  }
  if (isAbortError(error)) {
    return {
      kind: "failure",
      errorKind: "aborted",
      error: buildUserFacingError(error, {
        title: "工作区动作已取消",
        severity: "warning",
      }),
    };
  }
  return {
    kind: "failure",
    errorKind: "execution-failed",
    error: buildUserFacingError(error, {
      title: "工作区动作执行失败",
      detail: "动作未完成，当前工作区状态未被核心层修改。",
      recoveryAction: "检查目标状态后重试。",
    }),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

