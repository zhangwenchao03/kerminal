import { createAgentWorkflowBadgeViewModel } from "./agentWorkflowUiModel";
import type { AgentWorkflowRuntimeStatus } from "../agentWorkflowTypes";

export interface AgentWorkflowStatusBadgeProps {
  className?: string;
  status: AgentWorkflowRuntimeStatus;
}

/** Agent Workflow 统一状态标识。 */
export function AgentWorkflowStatusBadge({
  className = "",
  status,
}: AgentWorkflowStatusBadgeProps) {
  const model = createAgentWorkflowBadgeViewModel(status);
  return (
    <span
      aria-label={`Agent 状态：${model.label}`}
      className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-medium ${model.toneClassName} ${className}`}
      data-status={model.status}
      role="status"
    >
      {model.label}
    </span>
  );
}
