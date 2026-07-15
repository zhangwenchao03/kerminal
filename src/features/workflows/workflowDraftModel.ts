import type { WorkflowScope } from "../../lib/workflowApi";

export interface DraftWorkflowStep {
  id: string;
  command: string;
  description: string;
  requiresConfirmation: boolean;
  scope: WorkflowScope | "";
  title: string;
}

export type DraftWorkflowStepAction =
  | { kind: "add"; id: string }
  | { kind: "remove"; stepId: string }
  | {
      kind: "update";
      patch: Partial<Omit<DraftWorkflowStep, "id">>;
      stepId: string;
    };

/** 工作流编辑器的纯 draft reducer，不承担保存、确认或终端发送副作用。 */
export function reduceDraftWorkflowSteps(
  steps: DraftWorkflowStep[],
  action: DraftWorkflowStepAction,
): DraftWorkflowStep[] {
  if (action.kind === "update") {
    return steps.map((step) =>
      step.id === action.stepId ? { ...step, ...action.patch } : step,
    );
  }
  if (action.kind === "remove") {
    return steps.length <= 1
      ? steps
      : steps.filter((step) => step.id !== action.stepId);
  }
  return [
    ...steps,
    {
      command: "",
      description: "",
      id: action.id,
      requiresConfirmation: false,
      scope: "",
      title: `步骤 ${steps.length + 1}`,
    },
  ];
}

/** 将可编辑 draft 收敛为持久化 adapter 接受的步骤结构。 */
export function presentDraftWorkflowSteps(steps: DraftWorkflowStep[]) {
  return steps
    .map((step) => ({
      command: step.command,
      description: step.description || undefined,
      requiresConfirmation: step.requiresConfirmation,
      scope: step.scope || undefined,
      title: step.title,
    }))
    .filter((step) => step.title.trim() || step.command.trim());
}

export function initialDraftWorkflowSteps(): DraftWorkflowStep[] {
  return [
    {
      command: "git status --short",
      description: "确认仓库状态",
      id: "draft-step-1",
      requiresConfirmation: false,
      scope: "",
      title: "检查仓库状态",
    },
    {
      command: "npm run check",
      description: "运行完整质量门禁",
      id: "draft-step-2",
      requiresConfirmation: true,
      scope: "",
      title: "运行质量门禁",
    },
  ];
}
