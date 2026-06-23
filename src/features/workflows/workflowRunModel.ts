import type {
  CommandWorkflow,
  CommandWorkflowStep,
} from "../../lib/workflowApi";
import type { CommandHistoryTarget } from "../../lib/commandHistoryApi";
import { extractSnippetVariables, renderSnippetCommand } from "../snippets/snippetVariables";
import type { TerminalPane } from "../workspace/types";

export interface WorkflowRunState {
  confirmedStepId: string | null;
  error: string | null;
  nextStepIndex: number;
  sending: boolean;
  status: string | null;
  values: Record<string, string>;
  workflowId: string;
}

export interface WorkflowRunPreview {
  blocker: string | null;
  canExecute: boolean;
  missingVariables: string[];
  nextRenderedCommand: string;
  nextStep: CommandWorkflowStep | null;
  values: Record<string, string>;
  variables: string[];
}

export type WorkflowStepExecutionPlan =
  | {
      kind: "blocked";
      state: WorkflowRunState;
    }
  | {
      kind: "complete";
      state: WorkflowRunState;
    }
  | {
      command: string;
      kind: "ready";
      values: Record<string, string>;
    };

export function buildWorkflowRunState(
  workflow: CommandWorkflow,
): WorkflowRunState {
  return {
    confirmedStepId: null,
    error: null,
    nextStepIndex: 0,
    sending: false,
    status: null,
    values: buildWorkflowVariableValues(extractWorkflowVariables(workflow)),
    workflowId: workflow.id,
  };
}

export function updateWorkflowRunVariable(
  state: WorkflowRunState,
  name: string,
  value: string,
): WorkflowRunState {
  return {
    ...state,
    error: null,
    status: null,
    values: {
      ...state.values,
      [name]: value,
    },
  };
}

export function updateWorkflowRunConfirmation(
  state: WorkflowRunState,
  stepId: string,
  checked: boolean,
): WorkflowRunState {
  return {
    ...state,
    confirmedStepId: checked ? stepId : null,
    error: null,
    status: null,
  };
}

export function getWorkflowRunPreview(
  workflow: CommandWorkflow,
  state: WorkflowRunState | null,
  focusedPane?: TerminalPane,
): WorkflowRunPreview {
  const variables = extractWorkflowVariables(workflow);
  const values = buildWorkflowVariableValues(variables, state?.values);
  const nextStep = state ? workflow.steps[state.nextStepIndex] ?? null : null;
  const nextRenderedCommand = nextStep
    ? renderSnippetCommand(nextStep.command, values).trim()
    : "";
  const blocker = nextStep
    ? getWorkflowStepBlocker(workflow, nextStep, focusedPane)
    : null;
  const missingVariables = nextStep
    ? extractSnippetVariables(nextStep.command).filter(
        (name) => !values[name]?.trim(),
      )
    : [];

  return {
    blocker,
    canExecute:
      Boolean(state) &&
      Boolean(nextStep) &&
      !state?.sending &&
      !blocker &&
      missingVariables.length === 0 &&
      Boolean(nextRenderedCommand) &&
      (!nextStep?.requiresConfirmation ||
        state?.confirmedStepId === nextStep.id),
    missingVariables,
    nextRenderedCommand,
    nextStep,
    values,
    variables,
  };
}

export function prepareWorkflowStepExecution(
  workflow: CommandWorkflow,
  state: WorkflowRunState,
  focusedPane?: TerminalPane,
): WorkflowStepExecutionPlan {
  const preview = getWorkflowRunPreview(workflow, state, focusedPane);
  const step = preview.nextStep;
  if (!step) {
    return {
      kind: "complete",
      state: {
        ...state,
        error: null,
        sending: false,
        status: "工作流步骤已全部发送。",
      },
    };
  }

  if (preview.blocker || preview.missingVariables.length > 0) {
    return {
      kind: "blocked",
      state: {
        ...state,
        error:
          preview.blocker ??
          `请先填写变量：${preview.missingVariables
            .map((name) => `{{${name}}}`)
            .join(", ")}`,
        sending: false,
        status: null,
        values: preview.values,
      },
    };
  }

  if (step.requiresConfirmation && state.confirmedStepId !== step.id) {
    return {
      kind: "blocked",
      state: {
        ...state,
        error: "该步骤需要先勾选确认后再执行。",
        sending: false,
        status: null,
        values: preview.values,
      },
    };
  }

  if (!preview.nextRenderedCommand) {
    return {
      kind: "blocked",
      state: {
        ...state,
        error: "步骤渲染后为空，无法发送。",
        sending: false,
        status: null,
        values: preview.values,
      },
    };
  }

  return {
    command: preview.nextRenderedCommand,
    kind: "ready",
    values: preview.values,
  };
}

export function startWorkflowStepExecution(
  state: WorkflowRunState,
  values: Record<string, string>,
): WorkflowRunState {
  return {
    ...state,
    error: null,
    sending: true,
    status: null,
    values,
  };
}

export function completeWorkflowStepExecution({
  focusedPaneTitle,
  state,
  values,
  workflow,
}: {
  focusedPaneTitle?: string;
  state: WorkflowRunState;
  values: Record<string, string>;
  workflow: CommandWorkflow;
}): WorkflowRunState {
  const nextStepIndex = state.nextStepIndex + 1;
  return {
    confirmedStepId: null,
    error: null,
    nextStepIndex,
    sending: false,
    status:
      nextStepIndex >= workflow.steps.length
        ? `工作流已发送完毕，共 ${workflow.steps.length} 步。`
        : `已发送步骤 ${state.nextStepIndex + 1} 到 ${
            focusedPaneTitle ?? "当前分屏"
          }。`,
    values,
    workflowId: workflow.id,
  };
}

export function failWorkflowStepExecution(
  state: WorkflowRunState,
  error: unknown,
  values: Record<string, string>,
): WorkflowRunState {
  return {
    ...state,
    error: error instanceof Error ? error.message : String(error),
    sending: false,
    status: null,
    values,
  };
}

export function extractWorkflowVariables(workflow: CommandWorkflow) {
  const variables = new Set<string>();
  for (const step of workflow.steps) {
    for (const variable of extractSnippetVariables(step.command)) {
      variables.add(variable);
    }
  }
  return Array.from(variables);
}

export function buildWorkflowVariableValues(
  variables: string[],
  values: Record<string, string> = {},
) {
  return Object.fromEntries(variables.map((name) => [name, values[name] ?? ""]));
}

function getWorkflowStepBlocker(
  workflow: CommandWorkflow,
  step: CommandWorkflowStep,
  focusedPane?: TerminalPane,
) {
  const target = getPaneCommandTarget(focusedPane);
  if (!target) {
    return "当前没有可发送的终端分屏。";
  }

  const scope = step.scope ?? workflow.scope;
  if (scope !== "any" && scope !== target) {
    return scope === "ssh"
      ? "该步骤仅适用于 SSH 终端，请先聚焦 SSH 分屏。"
      : "该步骤仅适用于本地终端，请先聚焦本地分屏。";
  }
  return null;
}

function getPaneCommandTarget(
  focusedPane?: TerminalPane,
): CommandHistoryTarget | null {
  if (focusedPane?.mode === "local") {
    return "local";
  }
  if (focusedPane?.mode === "ssh") {
    return "ssh";
  }
  return null;
}
