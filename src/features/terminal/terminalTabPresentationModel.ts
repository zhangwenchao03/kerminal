import {
  resolveTerminalPaneAttention,
  type TerminalPaneAttention,
} from "./terminalPaneActivityModel";
import type { TerminalPaneChromeSnapshot } from "./terminalChromeRuntimeStore";

/** Tab chrome 使用的低干扰连接进度，不属于 attention 优先级。 */
export type TerminalTabConnectionProgress =
  | "connecting"
  | "reconnecting"
  | "none";

/** Tab 或折叠组标题消费的纯展示模型。 */
export interface TerminalTabPresentation {
  attention: TerminalPaneAttention;
  attentionCount: number;
  progress: TerminalTabConnectionProgress;
  progressCount: number;
  statusLabel: string;
}

const ATTENTION_PRIORITY: readonly TerminalPaneAttention[] = [
  "error",
  "disconnected",
  "warning",
  "bell",
  "followPaused",
  "unread",
  "none",
];

const EMPTY_PRESENTATION: Readonly<TerminalTabPresentation> =
  Object.freeze({
    attention: "none",
    attentionCount: 0,
    progress: "none",
    progressCount: 0,
    statusLabel: "",
  });

/**
 * 聚合一个 Tab 的 pane 快照。
 * 只统计最高 attention 对应的 pane；连接进度仅在没有 attention 时展示。
 */
export function resolveTerminalTabPresentation(
  panes: readonly TerminalPaneChromeSnapshot[],
): TerminalTabPresentation {
  const attentions = panes.map(resolveTerminalPaneAttention);
  const attention = resolveHighestAttention(attentions);
  if (attention !== "none") {
    const attentionCount = attentions.filter(
      (candidate) => candidate === attention,
    ).length;
    return {
      attention,
      attentionCount,
      progress: "none",
      progressCount: 0,
      statusLabel: buildStatusLabel(attention, attentionCount, "pane"),
    };
  }

  const progress = resolveHighestProgress(
    panes.map((pane) => resolvePaneProgress(pane)),
  );
  if (progress === "none") {
    return { ...EMPTY_PRESENTATION };
  }
  const progressCount = panes.filter(
    (pane) => resolvePaneProgress(pane) === progress,
  ).length;
  return {
    attention: "none",
    attentionCount: 0,
    progress,
    progressCount,
    statusLabel: buildStatusLabel(progress, progressCount, "pane"),
  };
}

/**
 * 聚合 Tab group 标题状态。
 * 展开时由各 Tab 自己展示；折叠时统计命中最高状态的 Tab 数。
 */
export function resolveTerminalTabGroupPresentation(
  tabs: readonly TerminalTabPresentation[],
  expanded: boolean,
): TerminalTabPresentation {
  if (expanded || tabs.length === 0) {
    return { ...EMPTY_PRESENTATION };
  }

  const attention = resolveHighestAttention(tabs.map((tab) => tab.attention));
  if (attention !== "none") {
    const attentionCount = tabs.filter(
      (tab) => tab.attention === attention,
    ).length;
    return {
      attention,
      attentionCount,
      progress: "none",
      progressCount: 0,
      statusLabel: buildStatusLabel(attention, attentionCount, "tab"),
    };
  }

  const progress = resolveHighestProgress(tabs.map((tab) => tab.progress));
  if (progress === "none") {
    return { ...EMPTY_PRESENTATION };
  }
  const progressCount = tabs.filter((tab) => tab.progress === progress).length;
  return {
    attention: "none",
    attentionCount: 0,
    progress,
    progressCount,
    statusLabel: buildStatusLabel(progress, progressCount, "tab"),
  };
}

/** 为组件或上层 aria-label 生成简短、非颜色依赖的状态标签。 */
export function buildTerminalTabAttentionLabel(
  attention: TerminalPaneAttention,
  count = 1,
): string {
  return attention === "none"
    ? ""
    : buildStatusLabel(attention, count, "pane");
}

/** 为组件或上层 aria-label 生成连接进度短标签。 */
export function buildTerminalTabProgressLabel(
  progress: TerminalTabConnectionProgress,
  count = 1,
): string {
  return progress === "none"
    ? ""
    : buildStatusLabel(progress, count, "pane");
}

function resolveHighestAttention(
  attentions: readonly TerminalPaneAttention[],
): TerminalPaneAttention {
  return (
    ATTENTION_PRIORITY.find((attention) => attentions.includes(attention)) ??
    "none"
  );
}

function resolvePaneProgress(
  pane: TerminalPaneChromeSnapshot,
): TerminalTabConnectionProgress {
  if (pane.connectionState === "reconnecting") {
    return "reconnecting";
  }
  if (pane.connectionState === "connecting") {
    return "connecting";
  }
  return "none";
}

function resolveHighestProgress(
  progresses: readonly TerminalTabConnectionProgress[],
): TerminalTabConnectionProgress {
  if (progresses.includes("reconnecting")) {
    return "reconnecting";
  }
  if (progresses.includes("connecting")) {
    return "connecting";
  }
  return "none";
}

function buildStatusLabel(
  state: Exclude<TerminalPaneAttention, "none"> | Exclude<
    TerminalTabConnectionProgress,
    "none"
  >,
  count: number,
  target: "pane" | "tab",
): string {
  const stateLabel = {
    bell: "终端响铃",
    connecting: "正在连接",
    disconnected: "连接已断开",
    error: "终端错误",
    followPaused: "有新输出，已暂停跟随",
    reconnecting: "正在重新连接",
    unread: "有未读输出",
    warning: "连接警告",
  }[state];
  if (count <= 1) {
    return stateLabel;
  }
  const targetLabel = target === "pane" ? "窗格" : "标签页";
  return `${count} 个${targetLabel}：${stateLabel}`;
}
