import type {
  WorkspaceContextDiagnostic,
  WorkspaceContextFreshness,
  WorkspaceContextSourceState,
} from "./workspaceContextTypes";

const sourceStatusDiagnostic = {
  error: {
    code: "source-error",
    severity: "error",
    summary: "上下文来源读取失败，当前信息可能不完整。",
  },
  loading: {
    code: "source-loading",
    severity: "info",
    summary: "上下文来源仍在加载，当前信息可能暂不完整。",
  },
  stale: {
    code: "source-stale",
    severity: "warning",
    summary: "上下文来源已过期，使用前应重新确认当前目标。",
  },
  unavailable: {
    code: "source-unavailable",
    severity: "warning",
    summary: "上下文来源当前不可用，相关信息已降级。",
  },
} as const;

/**
 * 将来源状态转换为可解释诊断。诊断只描述来源和恢复语义，
 * 不拼接原始错误、路径或会话正文。
 */
export function buildSourceDiagnostics(
  sources: readonly WorkspaceContextSourceState[],
): WorkspaceContextDiagnostic[] {
  return sources.flatMap((source) => {
    if (source.status === "available") {
      return [];
    }
    const descriptor = sourceStatusDiagnostic[source.status];
    return [{
      id: source.diagnosticId ?? `source:${source.source}:${source.status}`,
      code: descriptor.code,
      recoverable: true,
      severity: descriptor.severity,
      source: source.source,
      summary: descriptor.summary,
    }];
  });
}

/**
 * 部分失败优先于陈旧：只要来源仍在加载、不可用或报错，projection 就是
 * partial；只有来源都可读取但至少一个过期时才标记 stale。
 */
export function resolveWorkspaceContextFreshness(
  sources: readonly WorkspaceContextSourceState[],
): WorkspaceContextFreshness {
  const hasPartialSource = sources.some((source) =>
    source.status === "loading"
    || source.status === "unavailable"
    || source.status === "error"
  );
  const state = hasPartialSource
    ? "partial"
    : sources.some((source) => source.status === "stale")
      ? "stale"
      : "fresh";

  return { sources, state };
}
