export interface AgentPromptQueueItem {
  createdAt: string;
  id: string;
  submit: boolean;
  text: string;
}

export type AgentWorkflowStatus = "running" | "waitingForUser";

export type AgentPromptHistoryAction =
  | "branch"
  | "commandBlock"
  | "context"
  | "pasted"
  | "sent"
  | "queued"
  | "ranQueued"
  | "selection";

export interface AgentPromptHistoryItem {
  action: AgentPromptHistoryAction;
  createdAt: string;
  id: string;
  submit: boolean;
  text: string;
}

export interface CreateAgentPromptQueueItemInput {
  id: string;
  now: Date;
  submit?: boolean;
  text: string;
}

export interface CreateAgentPromptHistoryItemInput
  extends CreateAgentPromptQueueItemInput {
  action: AgentPromptHistoryAction;
}

export interface AgentPromptDequeued {
  item: AgentPromptQueueItem | null;
  queue: AgentPromptQueueItem[];
}

export interface AgentWorkflowStatusView {
  detail: string;
  label: string;
  tone: "running" | "waiting";
}

export const AGENT_PROMPT_HISTORY_LIMIT = 20;

export function canSendAgentPrompt(text: string) {
  return text.trim().length > 0;
}

export function createAgentPromptQueueItem({
  id,
  now,
  submit = true,
  text,
}: CreateAgentPromptQueueItemInput): AgentPromptQueueItem {
  return {
    createdAt: now.toISOString(),
    id,
    submit,
    text: normalizeAgentPromptText(text),
  };
}

export function createAgentPromptHistoryItem({
  action,
  id,
  now,
  submit = true,
  text,
}: CreateAgentPromptHistoryItemInput): AgentPromptHistoryItem {
  return {
    action,
    createdAt: now.toISOString(),
    id,
    submit,
    text: normalizeAgentPromptText(text),
  };
}

export function enqueueAgentPrompt(
  queue: AgentPromptQueueItem[],
  item: AgentPromptQueueItem,
) {
  return [...queue, item];
}

export function dequeueAgentPrompt(
  queue: AgentPromptQueueItem[],
): AgentPromptDequeued {
  const [item, ...rest] = queue;
  return {
    item: item ?? null,
    queue: rest,
  };
}

export function appendAgentPromptHistory(
  history: AgentPromptHistoryItem[],
  item: AgentPromptHistoryItem,
  limit = AGENT_PROMPT_HISTORY_LIMIT,
) {
  if (limit <= 0) {
    return [];
  }
  return [item, ...history].slice(0, limit);
}

export function toggleAgentWorkflowStatus(
  status: AgentWorkflowStatus,
): AgentWorkflowStatus {
  return status === "waitingForUser" ? "running" : "waitingForUser";
}

export function resolveAgentWorkflowStatusView(
  status: AgentWorkflowStatus,
): AgentWorkflowStatusView {
  if (status === "waitingForUser") {
    return {
      detail: "Agent session is explicitly marked as waiting for user input.",
      label: "等待人工",
      tone: "waiting",
    };
  }
  return {
    detail: "Agent terminal session is marked as running.",
    label: "运行中",
    tone: "running",
  };
}

export function normalizeAgentPromptText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}
