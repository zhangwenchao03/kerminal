import { invoke } from "@tauri-apps/api/core";

import type { AiToolAuditRecord, AiToolPendingInvocation } from "./aiToolInvocationApi";

export type AiAgentRunStatus =
  | "running"
  | "waitingApproval"
  | "completed"
  | "blocked"
  | "cancelled";

export type AiAgentRunStepKind =
  | "plan"
  | "model"
  | "toolCall"
  | "observation"
  | "approval"
  | "final"
  | "error";

export type AiAgentRunStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "waitingApproval"
  | "blocked"
  | "cancelled";

export interface AiAgentRun {
  id: string;
  goal: string;
  status: AiAgentRunStatus;
  conversationId?: string | null;
  conversationSlotJson?: string | null;
  iteration: number;
  maxIterations: number;
  maxToolCalls: number;
  createdAt: number;
  updatedAt: number;
}

export interface AiAgentRunStep {
  id: string;
  runId: string;
  kind: AiAgentRunStepKind;
  status: AiAgentRunStepStatus;
  toolId?: string | null;
  inputJson?: unknown;
  observationJson?: unknown;
  summary?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiAgentRunSnapshot {
  run: AiAgentRun;
  steps: AiAgentRunStep[];
}

export interface AiAgentRunLimits {
  maxIterations?: number | null;
  maxToolCalls?: number | null;
}

export interface AiAgentHarnessRunRequest {
  goal: string;
  limits?: AiAgentRunLimits;
  conversationId?: string | null;
  conversationSlotJson?: string | null;
}

export interface AiAgentHarnessRunResult {
  snapshot: AiAgentRunSnapshot;
  finalMessage?: string | null;
  pendingInvocation?: AiToolPendingInvocation | null;
  lastObservation?: unknown;
}

export interface AiAgentRunGetRequest {
  runId: string;
}

export interface AiAgentRunCancelRequest {
  runId: string;
}

export interface AiAgentRunRetryRequest {
  runId: string;
}

export interface AiAgentRunResumeRequest {
  runId: string;
  audit: AiToolAuditRecord;
}

export async function startAiAgentRun(
  request: AiAgentHarnessRunRequest,
): Promise<AiAgentHarnessRunResult> {
  return invoke<AiAgentHarnessRunResult>("ai_agent_run_start", {
    request: normalizeHarnessRunRequest(request),
  });
}

export async function getAiAgentRun(
  request: AiAgentRunGetRequest,
): Promise<AiAgentRunSnapshot> {
  return invoke<AiAgentRunSnapshot>("ai_agent_run_get", {
    request: normalizeRunIdRequest(request),
  });
}

export async function cancelAiAgentRun(
  request: AiAgentRunCancelRequest,
): Promise<AiAgentRunSnapshot> {
  return invoke<AiAgentRunSnapshot>("ai_agent_run_cancel", {
    request: normalizeRunIdRequest(request),
  });
}

export async function retryAiAgentRunLastStep(
  request: AiAgentRunRetryRequest,
): Promise<AiAgentHarnessRunResult> {
  return invoke<AiAgentHarnessRunResult>("ai_agent_run_retry_last_step", {
    request: normalizeRunIdRequest(request),
  });
}

export async function resumeAiAgentRun(
  request: AiAgentRunResumeRequest,
): Promise<AiAgentHarnessRunResult> {
  return invoke<AiAgentHarnessRunResult>("ai_agent_run_resume", {
    request: {
      ...request,
      runId: normalizeRunId(request.runId),
    },
  });
}

function normalizeHarnessRunRequest(
  request: AiAgentHarnessRunRequest,
): AiAgentHarnessRunRequest {
  const goal = request.goal.trim();
  if (!goal) {
    throw new Error("Agent 目标不能为空");
  }
  return {
    ...request,
    goal,
    conversationId: normalizeNullableText(request.conversationId),
    conversationSlotJson: normalizeNullableText(request.conversationSlotJson),
    limits: request.limits ?? {},
  };
}

function normalizeRunIdRequest<T extends { runId: string }>(request: T): T {
  return {
    ...request,
    runId: normalizeRunId(request.runId),
  };
}

function normalizeRunId(runId: string) {
  const normalized = runId.trim();
  if (!normalized) {
    throw new Error("Agent run id 不能为空");
  }
  return normalized;
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
