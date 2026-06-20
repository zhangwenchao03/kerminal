import { invoke, isTauri } from "@tauri-apps/api/core";

export type WorkflowScope = "any" | "local" | "ssh";

export interface CommandWorkflowStep {
  id: string;
  title: string;
  command: string;
  description?: string | null;
  scope?: WorkflowScope | null;
  requiresConfirmation: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommandWorkflow {
  id: string;
  title: string;
  description?: string | null;
  tags: string[];
  scope: WorkflowScope;
  steps: CommandWorkflowStep[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowListRequest {
  query?: string;
  scope?: WorkflowScope;
  tag?: string;
}

export interface WorkflowStepInput {
  id?: string;
  title: string;
  command: string;
  description?: string;
  scope?: WorkflowScope;
  requiresConfirmation?: boolean;
}

export interface WorkflowCreateRequest {
  title: string;
  description?: string;
  tags?: string[];
  scope?: WorkflowScope;
  steps: WorkflowStepInput[];
}

export interface WorkflowUpdateRequest extends WorkflowCreateRequest {
  id: string;
  sortOrder: number;
}

interface NormalizedWorkflowCreateRequest {
  title: string;
  description?: string;
  tags: string[];
  scope: WorkflowScope;
  steps: NormalizedWorkflowStepInput[];
}

interface NormalizedWorkflowUpdateRequest
  extends NormalizedWorkflowCreateRequest {
  id: string;
  sortOrder: number;
}

interface NormalizedWorkflowStepInput {
  id?: string;
  title: string;
  command: string;
  description?: string;
  scope?: WorkflowScope;
  requiresConfirmation: boolean;
}

const browserPreviewWorkflows = new Map<string, CommandWorkflow>(
  [
    previewWorkflow({
      description: "本地项目常用检查链路。",
      id: "workflow-preview-local-check",
      scope: "local",
      steps: [
        {
          command: "git status --short",
          id: "workflow-preview-local-check-step-1",
          requiresConfirmation: false,
          title: "检查仓库状态",
        },
        {
          command: "npm run check",
          id: "workflow-preview-local-check-step-2",
          requiresConfirmation: true,
          title: "运行质量门禁",
        },
      ],
      tags: ["daily", "quality"],
      title: "本地质量检查",
    }),
    previewWorkflow({
      description: "SSH 主机快速巡检。",
      id: "workflow-preview-ssh-health",
      scope: "ssh",
      steps: [
        {
          command: "uptime",
          id: "workflow-preview-ssh-health-step-1",
          requiresConfirmation: false,
          title: "查看负载",
        },
        {
          command: "df -h",
          id: "workflow-preview-ssh-health-step-2",
          requiresConfirmation: false,
          title: "查看磁盘",
        },
      ],
      tags: ["ssh", "ops"],
      title: "服务器巡检",
    }),
  ].map((workflow) => [workflow.id, workflow]),
);

export async function listWorkflows(
  request: WorkflowListRequest = {},
): Promise<CommandWorkflow[]> {
  const normalized = normalizeListRequest(request);

  if (!isTauri()) {
    return browserPreviewList(normalized);
  }

  return invoke<CommandWorkflow[]>("workflow_list", { request: normalized });
}

export async function createWorkflow(
  request: WorkflowCreateRequest,
): Promise<CommandWorkflow> {
  const normalized = normalizeCreateRequest(request);

  if (!isTauri()) {
    const workflow = previewWorkflow({
      ...normalized,
      id: `workflow-preview-${Date.now().toString(36)}`,
      sortOrder: browserPreviewWorkflows.size * 10 + 10,
      steps: normalized.steps.map((step, index) => ({
        ...step,
        id: step.id ?? `workflow-preview-step-${Date.now().toString(36)}-${index}`,
      })),
    });
    browserPreviewWorkflows.set(workflow.id, workflow);
    return workflow;
  }

  return invoke<CommandWorkflow>("workflow_create", { request: normalized });
}

export async function updateWorkflow(
  request: WorkflowUpdateRequest,
): Promise<CommandWorkflow> {
  const normalized = normalizeUpdateRequest(request);

  if (!isTauri()) {
    const existing = browserPreviewWorkflows.get(normalized.id);
    const workflow = previewWorkflow({
      ...(existing ?? { id: normalized.id }),
      ...normalized,
      steps: normalized.steps.map((step, index) => ({
        ...step,
        id:
          step.id ??
          existing?.steps[index]?.id ??
          `workflow-preview-step-${Date.now().toString(36)}-${index}`,
      })),
      updatedAt: new Date().toISOString(),
    });
    browserPreviewWorkflows.set(workflow.id, workflow);
    return workflow;
  }

  return invoke<CommandWorkflow>("workflow_update", { request: normalized });
}

export async function deleteWorkflow(workflowId: string): Promise<boolean> {
  if (!isTauri()) {
    return browserPreviewWorkflows.delete(workflowId);
  }

  return invoke<boolean>("workflow_delete", { workflowId });
}

function normalizeListRequest(
  request: WorkflowListRequest,
): WorkflowListRequest {
  return {
    ...(request.query?.trim() ? { query: request.query.trim() } : {}),
    ...(request.scope ? { scope: request.scope } : {}),
    ...(request.tag?.trim() ? { tag: request.tag.trim() } : {}),
  };
}

function normalizeCreateRequest(
  request: WorkflowCreateRequest,
): NormalizedWorkflowCreateRequest {
  return {
    description: request.description?.trim() || undefined,
    scope: request.scope ?? "any",
    steps: normalizeSteps(request.steps),
    tags: normalizeTags(request.tags ?? []),
    title: request.title,
  };
}

function normalizeUpdateRequest(
  request: WorkflowUpdateRequest,
): NormalizedWorkflowUpdateRequest {
  return {
    ...normalizeCreateRequest(request),
    id: request.id,
    sortOrder: request.sortOrder,
  };
}

function normalizeSteps(steps: WorkflowStepInput[]) {
  return steps
    .map((step) => ({
      ...(step.id?.trim() ? { id: step.id.trim() } : {}),
      command: step.command,
      description: step.description?.trim() || undefined,
      ...(step.scope ? { scope: step.scope } : {}),
      requiresConfirmation: step.requiresConfirmation ?? false,
      title: step.title,
    }))
    .filter((step) => step.title.trim() || step.command.trim());
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function browserPreviewList(request: WorkflowListRequest) {
  const query = request.query?.trim().toLowerCase();
  const tag = request.tag?.trim().toLowerCase();

  return Array.from(browserPreviewWorkflows.values())
    .filter((workflow) => !request.scope || workflow.scope === request.scope)
    .filter((workflow) =>
      tag ? workflow.tags.some((item) => item.toLowerCase() === tag) : true,
    )
    .filter((workflow) =>
      query ? workflowMatchesQuery(workflow, query) : true,
    )
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.title.localeCompare(right.title),
    );
}

function workflowMatchesQuery(workflow: CommandWorkflow, query: string) {
  return (
    workflow.title.toLowerCase().includes(query) ||
    (workflow.description ?? "").toLowerCase().includes(query) ||
    workflow.tags.some((tag) => tag.toLowerCase().includes(query)) ||
    workflow.steps.some(
      (step) =>
        step.title.toLowerCase().includes(query) ||
        step.command.toLowerCase().includes(query) ||
        (step.description ?? "").toLowerCase().includes(query),
    )
  );
}

function previewWorkflow(
  input: Pick<CommandWorkflow, "id" | "scope" | "tags" | "title"> &
    Partial<
      Pick<
        CommandWorkflow,
        "createdAt" | "description" | "sortOrder" | "updatedAt"
      >
    > & {
      steps: Array<
        Pick<
          CommandWorkflowStep,
          "command" | "id" | "requiresConfirmation" | "title"
        > &
          Partial<Pick<CommandWorkflowStep, "description" | "scope" | "sortOrder">>
      >;
    },
): CommandWorkflow {
  const now = new Date().toISOString();
  return {
    createdAt: input.createdAt ?? now,
    description: input.description ?? null,
    id: input.id,
    scope: input.scope,
    sortOrder: input.sortOrder ?? 10,
    steps: input.steps.map((step, index) => ({
      command: step.command,
      createdAt: input.createdAt ?? now,
      description: step.description ?? null,
      id: step.id,
      requiresConfirmation: step.requiresConfirmation,
      scope: step.scope ?? null,
      sortOrder: step.sortOrder ?? (index + 1) * 10,
      title: step.title,
      updatedAt: input.updatedAt ?? now,
    })),
    tags: input.tags,
    title: input.title,
    updatedAt: input.updatedAt ?? now,
  };
}
