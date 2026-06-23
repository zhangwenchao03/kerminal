import {
  AlertTriangle,
  Check,
  Circle,
  RefreshCw,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import type { AiAgentRunSnapshot } from "../../../lib/aiAgentRunApi";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import {
  aiAgentRunStepStatusTone,
  buildAiAgentRunViewModel,
} from "./aiToolContentModel";

export type AiRunActionState = "cancelling" | "idle" | "retrying";

export function AiRunTimeline({
  actionState,
  error,
  finalMessage,
  onCancel,
  onRetry,
  snapshot,
}: {
  actionState: AiRunActionState;
  error: string | null;
  finalMessage: string | null;
  onCancel: () => void;
  onRetry: () => void;
  snapshot: AiAgentRunSnapshot | null;
}) {
  if (!snapshot && !error) {
    return null;
  }

  const view = snapshot
    ? buildAiAgentRunViewModel({ finalMessage, snapshot })
    : null;
  const busy = actionState !== "idle";

  return (
    <section
      aria-label="Agent run 状态"
      className="kerminal-muted-surface rounded-2xl border border-sky-400/20 p-3 shadow-sm shadow-sky-950/5 dark:shadow-black/20"
    >
      {error ? (
        <div
          className="mb-3 rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {view ? (
        <div className="space-y-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Agent run
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                {view.runId}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-xs",
                view.statusTone,
              )}
            >
              {view.statusLabel}
            </span>
          </div>

          {view.items.length > 0 ? (
            <ol className="space-y-2">
              {view.items.map((item) => (
                <li className="flex min-w-0 gap-2 text-xs" key={item.id}>
                  <AgentRunStepIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-medium text-zinc-800 dark:text-zinc-100">
                        {item.label}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[11px]",
                          aiAgentRunStepStatusTone(item.status),
                        )}
                      >
                        {agentRunStepStatusLabel(item.status)}
                      </span>
                    </div>
                    {item.detail ? (
                      <div className="mt-0.5 break-words font-mono text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                        {item.detail}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              暂无可见步骤
            </div>
          )}

          {view.finalMessage ? (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm leading-6 text-emerald-800 dark:text-emerald-100">
              {view.finalMessage}
            </div>
          ) : null}

          {view.canCancel || view.canRetry ? (
            <div className="flex flex-wrap gap-2">
              {view.canCancel ? (
                <Button
                  className="gap-2"
                  disabled={busy}
                  onClick={onCancel}
                  size="sm"
                  variant="secondary"
                >
                  {actionState === "cancelling" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  取消 run
                </Button>
              ) : null}
              {view.canRetry ? (
                <Button
                  className="gap-2"
                  disabled={busy}
                  onClick={onRetry}
                  size="sm"
                >
                  {actionState === "retrying" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  重试上一步
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AgentRunStepIcon({
  status,
}: {
  status: AiAgentRunSnapshot["steps"][number]["status"];
}) {
  if (status === "succeeded") {
    return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  }
  if (status === "failed" || status === "blocked") {
    return (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
    );
  }
  if (status === "running") {
    return (
      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
    );
  }
  if (status === "cancelled") {
    return <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />;
}

function agentRunStepStatusLabel(
  status: AiAgentRunSnapshot["steps"][number]["status"],
) {
  const labels: Record<AiAgentRunSnapshot["steps"][number]["status"], string> =
    {
      blocked: "已阻塞",
      cancelled: "已取消",
      failed: "失败",
      pending: "等待中",
      running: "运行中",
      succeeded: "完成",
      waitingApproval: "待确认",
    };
  return labels[status];
}
