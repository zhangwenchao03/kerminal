import type { TerminalRendererRegistrySnapshot } from "../../terminal/terminalRendererRegistry";

export interface TerminalRendererStatusView {
  badgeLabel: string;
  detail: string;
  tone: "normal" | "warning";
}

export function buildTerminalRendererStatusView(
  snapshot: TerminalRendererRegistrySnapshot,
): TerminalRendererStatusView {
  const failedPane = snapshot.panes.find((pane) => pane.fallbackReason);
  const recoverySummary =
    snapshot.recoveryCount > 0
      ? `已恢复 ${snapshot.recoveryCount} 次，atlas ${snapshot.atlasEpoch}`
      : `atlas ${snapshot.atlasEpoch}`;

  if (snapshot.suggestedFallback === "cpu" || failedPane?.fallbackReason) {
    return {
      badgeLabel: "自动回退",
      detail: failedPane?.fallbackReason
        ? `${recoverySummary}，最近回退：${failedPane.fallbackReason}`
        : `${recoverySummary}，建议使用 CPU`,
      tone: "warning",
    };
  }

  return {
    badgeLabel: "运行正常",
    detail: `${snapshot.effectiveGpuPanes} 个 GPU pane，${recoverySummary}`,
    tone: "normal",
  };
}
