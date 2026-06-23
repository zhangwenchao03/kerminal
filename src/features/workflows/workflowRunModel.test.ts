import { describe, expect, it } from "vitest";
import type {
  CommandWorkflow,
  CommandWorkflowStep,
  WorkflowScope,
} from "../../lib/workflowApi";
import type { TerminalPane } from "../workspace/types";
import {
  buildWorkflowRunState,
  completeWorkflowStepExecution,
  getWorkflowRunPreview,
  prepareWorkflowStepExecution,
  updateWorkflowRunConfirmation,
  updateWorkflowRunVariable,
} from "./workflowRunModel";

describe("workflowRunModel", () => {
  it("extracts variables once and initializes run values", () => {
    const workflow = workflowFixture({
      steps: [
        stepFixture({ command: "echo {{name}} {{env}}", id: "step-1" }),
        stepFixture({ command: "deploy {{name}}", id: "step-2" }),
      ],
    });

    const state = buildWorkflowRunState(workflow);
    const preview = getWorkflowRunPreview(workflow, state, localPaneFixture());

    expect(preview.variables).toEqual(["name", "env"]);
    expect(preview.values).toEqual({ env: "", name: "" });
  });

  it("blocks execution until required variables are filled", () => {
    const workflow = workflowFixture({
      steps: [stepFixture({ command: "echo {{target}}" })],
    });
    const state = buildWorkflowRunState(workflow);

    const plan = prepareWorkflowStepExecution(
      workflow,
      state,
      localPaneFixture(),
    );

    expect(plan).toMatchObject({
      kind: "blocked",
      state: {
        error: "请先填写变量：{{target}}",
        sending: false,
      },
    });
  });

  it("blocks execution when the focused pane does not satisfy scope", () => {
    const workflow = workflowFixture({
      scope: "ssh",
      steps: [stepFixture({ command: "uptime" })],
    });
    const state = buildWorkflowRunState(workflow);

    const plan = prepareWorkflowStepExecution(
      workflow,
      state,
      localPaneFixture(),
    );

    expect(plan).toMatchObject({
      kind: "blocked",
      state: {
        error: "该步骤仅适用于 SSH 终端，请先聚焦 SSH 分屏。",
      },
    });
  });

  it("requires explicit confirmation for guarded steps", () => {
    const workflow = workflowFixture({
      steps: [
        stepFixture({
          command: "npm run check",
          id: "confirm-step",
          requiresConfirmation: true,
        }),
      ],
    });
    const state = buildWorkflowRunState(workflow);

    expect(
      prepareWorkflowStepExecution(workflow, state, localPaneFixture()),
    ).toMatchObject({
      kind: "blocked",
      state: {
        error: "该步骤需要先勾选确认后再执行。",
      },
    });

    const confirmedState = updateWorkflowRunConfirmation(
      state,
      "confirm-step",
      true,
    );

    expect(
      prepareWorkflowStepExecution(workflow, confirmedState, localPaneFixture()),
    ).toMatchObject({
      command: "npm run check",
      kind: "ready",
    });
  });

  it("renders normalized values and reports readiness consistently", () => {
    const workflow = workflowFixture({
      steps: [stepFixture({ command: "echo {{target}}" })],
    });
    const state = updateWorkflowRunVariable(
      buildWorkflowRunState(workflow),
      "target",
      "prod",
    );

    const preview = getWorkflowRunPreview(workflow, state, localPaneFixture());
    const plan = prepareWorkflowStepExecution(
      workflow,
      state,
      localPaneFixture(),
    );

    expect(preview).toMatchObject({
      canExecute: true,
      missingVariables: [],
      nextRenderedCommand: "echo prod",
    });
    expect(plan).toMatchObject({
      command: "echo prod",
      kind: "ready",
      values: { target: "prod" },
    });
  });

  it("announces intermediate and final completion states", () => {
    const workflow = workflowFixture({
      steps: [
        stepFixture({ command: "echo one", id: "step-1" }),
        stepFixture({ command: "echo two", id: "step-2" }),
      ],
    });
    const state = buildWorkflowRunState(workflow);

    const intermediate = completeWorkflowStepExecution({
      focusedPaneTitle: "Local",
      state,
      values: state.values,
      workflow,
    });
    const final = completeWorkflowStepExecution({
      focusedPaneTitle: "Local",
      state: intermediate,
      values: intermediate.values,
      workflow,
    });

    expect(intermediate).toMatchObject({
      nextStepIndex: 1,
      status: "已发送步骤 1 到 Local。",
    });
    expect(final).toMatchObject({
      nextStepIndex: 2,
      status: "工作流已发送完毕，共 2 步。",
    });
  });
});

function workflowFixture({
  scope = "local",
  steps,
}: {
  scope?: WorkflowScope;
  steps: CommandWorkflowStep[];
}): CommandWorkflow {
  return {
    createdAt: "2026-06-21T00:00:00.000Z",
    description: null,
    id: "workflow-1",
    scope,
    sortOrder: 10,
    steps,
    tags: [],
    title: "Workflow",
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

function stepFixture({
  command,
  id = "step-1",
  requiresConfirmation = false,
  scope = null,
}: {
  command: string;
  id?: string;
  requiresConfirmation?: boolean;
  scope?: WorkflowScope | null;
}): CommandWorkflowStep {
  return {
    command,
    createdAt: "2026-06-21T00:00:00.000Z",
    description: null,
    id,
    requiresConfirmation,
    scope,
    sortOrder: 10,
    title: id,
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

function localPaneFixture(): TerminalPane {
  return {
    id: "pane-1",
    lines: [],
    machineId: "local",
    mode: "local",
    prompt: "$",
    status: "online",
    title: "Local",
  };
}
