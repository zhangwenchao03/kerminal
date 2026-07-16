import type {
  AgentWorkflowHistoryMetadata,
  AgentWorkflowPreviewKind,
  AgentWorkflowRuntimeStatus,
  AgentWorkflowSendPreview,
} from "../agentWorkflowTypes";
import { resolveAgentWorkflowBadge } from "../agentWorkflowModel";

export interface AgentWorkflowBadgeViewModel {
  label: string;
  status: AgentWorkflowRuntimeStatus;
  toneClassName: string;
}

export interface AgentWorkflowPreviewViewModel {
  byteLabel: string;
  expiresAtLabel: string;
  expired: boolean;
  sourceLabel: string;
  warnings: string[];
}

export interface AgentWorkflowHistoryItemViewModel {
  actionLabel: string;
  createdAtLabel: string;
  id: string;
  outcomeLabel: string;
  outcomeToneClassName: string;
  sessionId: string;
  sizeLabel: string;
  submitLabel: string;
}

const badgeToneClassNames = {
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  running: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  stale: "border-zinc-400/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
  waiting:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
} as const;

const previewSourceLabels: Record<AgentWorkflowPreviewKind, string> = {
  artifact: "终端产物",
  commandBlock: "命令块",
  diagnostic: "诊断信息",
  selection: "终端选区",
};

const historyActionLabels: Record<
  AgentWorkflowHistoryMetadata["action"],
  string
> = {
  branch: "分支会话",
  commandBlock: "命令块",
  context: "上下文",
  pasted: "粘贴",
  queued: "加入队列",
  ranQueued: "执行队列",
  selection: "终端选区",
  sent: "发送",
};

const historyOutcomeLabels: Record<
  AgentWorkflowHistoryMetadata["outcome"],
  string
> = {
  cancelled: "已取消",
  expired: "已过期",
  failed: "失败",
  queued: "已排队",
  sent: "已发送",
};

/** 将运行状态收敛为无副作用的 UI 模型，所有入口共享同一状态语义。 */
export function createAgentWorkflowBadgeViewModel(
  status: AgentWorkflowRuntimeStatus,
): AgentWorkflowBadgeViewModel {
  const badge = resolveAgentWorkflowBadge(status);
  return {
    label: badge.label,
    status,
    toneClassName: badgeToneClassNames[badge.tone],
  };
}

/** 发送预览模型只派生展示信息，不复制或返回正文。 */
export function createAgentWorkflowPreviewViewModel(
  preview: AgentWorkflowSendPreview,
  now: Date,
): AgentWorkflowPreviewViewModel {
  const expiresAt = new Date(preview.expiresAt);
  const expired = now.getTime() >= expiresAt.getTime();
  const warnings: string[] = [];
  if (preview.redacted) {
    warnings.push("已隐藏疑似凭据");
  }
  if (preview.truncated) {
    warnings.push("内容已按安全上限截断");
  }
  if (expired) {
    warnings.push("预览已过期，请重新生成");
  }
  return {
    byteLabel: formatByteLength(preview.byteLength),
    expiresAtLabel: expired ? "已过期" : `有效至 ${formatDateTime(expiresAt)}`,
    expired,
    sourceLabel: previewSourceLabels[preview.kind],
    warnings,
  };
}

/** 历史记录只接受无正文 metadata，避免 UI 层重新引入 prompt 内容。 */
export function createAgentWorkflowHistoryViewModel(
  metadata: AgentWorkflowHistoryMetadata,
): AgentWorkflowHistoryItemViewModel {
  const failed = metadata.outcome === "failed";
  const pending = metadata.outcome === "queued";
  return {
    actionLabel: historyActionLabels[metadata.action],
    createdAtLabel: formatDateTime(new Date(metadata.createdAt)),
    id: metadata.id,
    outcomeLabel: historyOutcomeLabels[metadata.outcome],
    outcomeToneClassName: failed
      ? "text-red-600 dark:text-red-300"
      : pending
        ? "text-amber-700 dark:text-amber-300"
        : "text-zinc-600 dark:text-zinc-300",
    sessionId: metadata.sessionId,
    sizeLabel: formatByteLength(metadata.textBytes),
    submitLabel: metadata.submit ? "发送并执行" : "仅加入输入",
  };
}

function formatByteLength(byteLength: number) {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  return `${(byteLength / 1024).toFixed(byteLength < 10 * 1024 ? 1 : 0)} KiB`;
}

function formatDateTime(value: Date) {
  if (Number.isNaN(value.getTime())) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}
