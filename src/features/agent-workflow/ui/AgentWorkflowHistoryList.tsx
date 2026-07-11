import type { AgentWorkflowHistoryMetadata } from "../agentWorkflowTypes";
import { createAgentWorkflowHistoryViewModel } from "./agentWorkflowUiModel";

export interface AgentWorkflowHistoryListProps {
  emptyMessage?: string;
  items: readonly AgentWorkflowHistoryMetadata[];
}

/** 无正文历史列表，仅展示动作、结果、时间与字节数 metadata。 */
export function AgentWorkflowHistoryList({
  emptyMessage = "暂无发送记录",
  items,
}: AgentWorkflowHistoryListProps) {
  if (items.length === 0) {
    return (
      <p
        className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
        role="status"
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <ol
      aria-label="Agent 操作历史"
      className="divide-y divide-[var(--surface-border)]"
    >
      {items.map((item) => {
        const model = createAgentWorkflowHistoryViewModel(item);
        return (
          <li
            className="min-w-0 px-3 py-2.5"
            key={`${model.id}-${item.outcome}`}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate text-sm font-medium">
                {model.actionLabel}
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${model.outcomeToneClassName}`}
              >
                {model.outcomeLabel}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{model.createdAtLabel}</span>
              <span>{model.sizeLabel}</span>
              <span>{model.submitLabel}</span>
              <span className="max-w-full truncate" title={model.sessionId}>
                {model.sessionId}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
