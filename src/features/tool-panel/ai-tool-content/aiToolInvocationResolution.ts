import {
  confirmAiToolInvocation,
  type AiToolAuditContext,
  type AiToolAuditRecord,
  type AiToolPendingInvocation,
} from "../../../lib/aiToolInvocationApi";
import type { AiAgentHarnessRunResult } from "../../../lib/aiAgentRunApi";
import { applyClientAction } from "./aiToolContentModel";
import type { AiToolContentProps } from "./aiToolContentModel";

const REMOTE_HOST_TREE_MUTATION_TOOL_IDS = new Set([
  "remote_host.create",
  "remote_host.ensure",
  "remote_host.group_create",
  "remote_host.group_update",
  "remote_host.group_delete",
  "remote_host.update",
  "remote_host.delete",
]);

export interface AiToolInvocationResolutionHandlers {
  onCreateTerminal?: AiToolContentProps["onCreateTerminal"];
  onFocusTab?: AiToolContentProps["onFocusTab"];
  onOpenTool?: AiToolContentProps["onOpenTool"];
  onOpenSshTerminal?: AiToolContentProps["onOpenSshTerminal"];
  onRemoteHostCreated?: AiToolContentProps["onRemoteHostCreated"];
  onSplitPane?: AiToolContentProps["onSplitPane"];
}

export async function resolveAiToolInvocation({
  approved,
  auditContext,
  handlers,
  invocation,
}: {
  approved: boolean;
  auditContext?: AiToolAuditContext | null;
  handlers: AiToolInvocationResolutionHandlers;
  invocation: AiToolPendingInvocation;
}): Promise<AiToolAuditRecord> {
  const audit = await confirmAiToolInvocation({
    approved,
    ...(auditContext ? { auditContext } : {}),
    invocationId: invocation.id,
  });

  if (approved && audit.status === "succeeded") {
    applyClientAction(invocation.clientAction, handlers);
    if (aiToolChangesRemoteHostTree(invocation.toolId)) {
      await handlers.onRemoteHostCreated?.();
    }
  }

  return audit;
}

export function aiToolChangesRemoteHostTree(toolId: string | null | undefined) {
  return REMOTE_HOST_TREE_MUTATION_TOOL_IDS.has(toolId?.trim() ?? "");
}

export function aiAgentRunResultChangesRemoteHostTree({
  ignoredAuditIds = [],
  result,
}: {
  ignoredAuditIds?: string[];
  result: AiAgentHarnessRunResult;
}) {
  const ignoredAuditIdSet = new Set(
    ignoredAuditIds.map((auditId) => auditId.trim()).filter(Boolean),
  );
  if (
    observationChangesRemoteHostTree({
      ignoredAuditIds: ignoredAuditIdSet,
      observation: result.lastObservation,
      toolId: toolIdFromObservation(result.lastObservation),
    })
  ) {
    return true;
  }

  return result.snapshot.steps.some((step) => {
    if (step.kind !== "observation" || step.status !== "succeeded") {
      return false;
    }
    return observationChangesRemoteHostTree({
      ignoredAuditIds: ignoredAuditIdSet,
      observation: step.observationJson,
      toolId: step.toolId,
    });
  });
}

function observationChangesRemoteHostTree({
  ignoredAuditIds,
  observation,
  toolId,
}: {
  ignoredAuditIds: Set<string>;
  observation: unknown;
  toolId: string | null | undefined;
}) {
  if (!aiToolChangesRemoteHostTree(toolId) || !isSucceededObservation(observation)) {
    return false;
  }

  const auditId = auditIdFromObservation(observation);
  return !auditId || !ignoredAuditIds.has(auditId);
}

function isSucceededObservation(observation: unknown) {
  if (!isRecord(observation)) {
    return false;
  }
  return observation.status === "succeeded";
}

function toolIdFromObservation(observation: unknown) {
  if (!isRecord(observation)) {
    return undefined;
  }
  const data = observation.data;
  if (!isRecord(data)) {
    return undefined;
  }
  return typeof data.toolId === "string" ? data.toolId : undefined;
}

function auditIdFromObservation(observation: unknown) {
  if (!isRecord(observation)) {
    return undefined;
  }
  if (typeof observation.auditId === "string") {
    return observation.auditId;
  }
  const data = observation.data;
  if (isRecord(data) && typeof data.auditId === "string") {
    return data.auditId;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
