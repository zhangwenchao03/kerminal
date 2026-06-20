import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type {
  AiCommandExecutionVisibility,
  AiChatResponse,
  AiChatStreamStep,
} from "../../../lib/aiAgentApi";
import type {
  AiToolAuditExport,
  AiToolPendingInvocation,
  AiToolInvocationStatus,
} from "../../../lib/aiToolInvocationApi";
import type { AppSettings } from "../../settings/settingsModel";
import type { SettingsSectionId } from "../../settings/SettingsToolContent";
import { isToolId, type Machine, type TerminalPane, type TerminalSplitDirection, type TerminalTab, type ToolId } from "../../workspace/types";
import type { AddTerminalTabOptions } from "../../workspace/workspaceStore";

export type LoadState = "idle" | "loading" | "error";
export type AuditActionState = "idle" | "exporting" | "clearing";
export type ChatState = "idle" | "sending";
export type ChatMessageRole = "assistant" | "user";
export type ChatMessageStatus = "complete" | "error" | "streaming";

export const AUDIT_PANEL_LIMIT = 20;
export const AUDIT_EXPORT_LIMIT = 100;
export const CONVERSATION_STORAGE_KEY = "kerminal.ai.conversations.v1";
export const COMMAND_VISIBILITY_STORAGE_KEY = "kerminal.ai.command-visibility.v1";
export const MAX_CONVERSATIONS = 24;
export const MAX_MESSAGES_PER_CONVERSATION = 80;
export const TRANSCRIPT_MESSAGE_LIMIT = 10;
export const TRANSCRIPT_CHAR_LIMIT = 6000;

export interface AiToolContentProps {
  activeTab?: TerminalTab;
  availableTabs?: TerminalTab[];
  defaultRemoteGroupId?: string;
  defaultRemoteHostId?: string;
  focusedPane?: TerminalPane;
  onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
  onFocusTab?: (tabId: string) => void;
  onOpenTool?: (toolId: ToolId) => void;
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void;
  onOpenSshTerminal?: (hostId: string) => void;
  onRemoteHostCreated?: () => void | Promise<void>;
  onSettingsChange?: (settings: AppSettings) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  selectedMachine?: Machine;
  settings?: AppSettings;
}

export interface ConversationState {
  activeConversationId: string;
  conversations: AiConversation[];
}

export interface AiConversation {
  createdAt: number;
  id: string;
  messages: AiChatMessage[];
  title: string;
  updatedAt: number;
}

export interface AiChatMessage {
  content: string;
  contextUsed?: boolean;
  createdAt: number;
  id: string;
  model?: string;
  processSteps?: AiChatStreamStep[];
  providerName?: string;
  responseRedacted?: boolean;
  role: ChatMessageRole;
  status?: ChatMessageStatus;
  toolCount?: number;
  pendingInvocations?: AiToolPendingInvocation[];
}

export function loadConversationState(): ConversationState {
  const fallback = createInitialConversationState();
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.conversations)) {
      return fallback;
    }

    const conversations = parsed.conversations
      .map(normalizeConversation)
      .filter((conversation): conversation is AiConversation => Boolean(conversation))
      .filter(hasConversationHistoryContent)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_CONVERSATIONS);

    if (conversations.length === 0) {
      return fallback;
    }

    const requestedActiveId =
      typeof parsed.activeConversationId === "string"
        ? parsed.activeConversationId
        : conversations[0].id;
    return {
      activeConversationId: conversations.some(
        (conversation) => conversation.id === requestedActiveId,
      )
        ? requestedActiveId
        : conversations[0].id,
      conversations,
    };
  } catch {
    return fallback;
  }
}

export function loadCommandVisibility(): AiCommandExecutionVisibility {
  if (typeof window === "undefined") {
    return "terminal";
  }

  try {
    const value = window.localStorage.getItem(COMMAND_VISIBILITY_STORAGE_KEY);
    return value === "background" ? "background" : "terminal";
  } catch {
    return "terminal";
  }
}

export function persistCommandVisibility(value: AiCommandExecutionVisibility) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMMAND_VISIBILITY_STORAGE_KEY, value);
  } catch {
    // 命令显示模式是体验偏好，无法保存时不影响当前对话。
  }
}

export function persistConversationState(state: ConversationState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const conversations = limitConversations(state.conversations).filter(
      hasConversationHistoryContent,
    );
    if (conversations.length === 0) {
      window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
      return;
    }
    const activeConversationId = conversations.some(
      (conversation) => conversation.id === state.activeConversationId,
    )
      ? state.activeConversationId
      : conversations[0].id;

    window.localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify({
        activeConversationId,
        conversations: conversations.map(serializeConversation),
      }),
    );
  } catch {
    // 本地历史是体验增强项，存储不可用时不影响当前对话。
  }
}

export function createInitialConversationState(): ConversationState {
  const conversation = createConversation();
  return {
    activeConversationId: conversation.id,
    conversations: [conversation],
  };
}

export function createConversation(): AiConversation {
  const now = Date.now();
  return {
    createdAt: now,
    id: `chat-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    messages: [],
    title: "新对话",
    updatedAt: now,
  };
}

export function createChatMessage(
  role: ChatMessageRole,
  content: string,
  createdAt = Date.now(),
): AiChatMessage {
  return {
    content,
    createdAt,
    id: `${role}-${createdAt.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    role,
  };
}

export function createAssistantDraftMessage(createdAt = Date.now()): AiChatMessage {
  return {
    ...createChatMessage("assistant", "", createdAt),
    processSteps: [],
    status: "streaming",
  };
}

export function completeAssistantMessage(
  draft: AiChatMessage,
  response: AiChatResponse,
): AiChatMessage {
  return {
    ...draft,
    contextUsed: response.contextUsed,
    content: response.message,
    model: response.model,
    processSteps: draft.processSteps,
    providerName: response.providerName,
    responseRedacted: response.responseRedacted,
    status: "complete",
    toolCount: response.toolCount,
    pendingInvocations: response.pendingInvocations,
  };
}

export function aiChatMessageToThreadMessage(
  message: AiChatMessage,
): ThreadMessageLike {
  return {
    content: [{ text: message.content, type: "text" }],
    createdAt: new Date(message.createdAt),
    id: message.id,
    metadata: {
      custom: {
        kerminalMessageId: message.id,
      },
    },
    role: message.role,
    ...(message.role === "assistant"
      ? { status: assistantUiMessageStatus(message.status) }
      : {}),
  };
}

export function assistantUiMessageStatus(
  status: ChatMessageStatus | undefined,
): ThreadMessageLike["status"] {
  if (status === "streaming") {
    return { type: "running" };
  }
  if (status === "error") {
    return { reason: "error", type: "incomplete" };
  }
  return { reason: "stop", type: "complete" };
}

export function extractAppendMessageText(message: AppendMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export function updateConversation(
  state: ConversationState,
  conversationId: string,
  update: (conversation: AiConversation) => AiConversation,
): ConversationState {
  const conversations = state.conversations.map((conversation) =>
    conversation.id === conversationId ? update(conversation) : conversation,
  );
  return {
    activeConversationId: conversationId,
    conversations: limitConversations(conversations),
  };
}

export function updateConversationMessage(
  state: ConversationState,
  conversationId: string,
  messageId: string,
  update: (message: AiChatMessage) => AiChatMessage,
): ConversationState {
  return updateConversation(state, conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.id === messageId ? update(message) : message,
    ),
    updatedAt: Date.now(),
  }));
}

export function upsertProcessStep(
  steps: AiChatStreamStep[] | undefined,
  nextStep: AiChatStreamStep,
) {
  const next = [...(steps ?? [])];
  const existingIndex = next.findIndex((step) => step.id === nextStep.id);
  if (existingIndex >= 0) {
    next[existingIndex] = nextStep;
  } else {
    next.push(nextStep);
  }
  return next.sort(
    (left, right) => processStepOrder(left.id) - processStepOrder(right.id),
  );
}

export function processStepOrder(stepId: AiChatStreamStep["id"]) {
  const order: Record<AiChatStreamStep["id"], number> = {
    complete: 4,
    context: 1,
    prepare: 0,
    provider: 2,
    render: 3,
  };
  return order[stepId];
}

export function limitConversations(conversations: AiConversation[]) {
  const limited: AiConversation[] = [];
  let draftIncluded = false;

  for (const conversation of [...conversations].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )) {
    if (isBlankConversation(conversation)) {
      if (draftIncluded) {
        continue;
      }
      draftIncluded = true;
    }
    limited.push(conversation);
    if (limited.length >= MAX_CONVERSATIONS) {
      break;
    }
  }

  return limited;
}

export function limitMessages(messages: AiChatMessage[]) {
  return messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
}

export function buildConversationPrompt(previousMessages: AiChatMessage[], message: string) {
  if (previousMessages.length === 0) {
    return message;
  }

  const transcript = previousMessages
    .slice(-TRANSCRIPT_MESSAGE_LIMIT)
    .map((item) => `${item.role === "user" ? "用户" : "AI"}: ${item.content}`)
    .join("\n\n")
    .slice(-TRANSCRIPT_CHAR_LIMIT);

  return [
    "请基于以下本地会话历史继续回答。不要重复历史内容，优先处理最后一个用户问题。",
    "",
    "<history>",
    transcript,
    "</history>",
    "",
    `用户最新问题: ${message}`,
  ].join("\n");
}

export function buildConversationTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= 24) {
    return normalized || "新对话";
  }
  return `${normalized.slice(0, 24)}...`;
}

export function normalizeConversation(value: unknown): AiConversation | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  const messages = Array.isArray(value.messages)
    ? value.messages
        .map(normalizeMessage)
        .filter((message): message is AiChatMessage => Boolean(message))
    : [];

  return {
    createdAt,
    id: value.id,
    messages: limitMessages(messages),
    title: typeof value.title === "string" ? value.title : "历史对话",
    updatedAt,
  };
}

export function normalizeMessage(value: unknown): AiChatMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.content !== "string" ||
    (value.role !== "assistant" && value.role !== "user")
  ) {
    return null;
  }

  return {
    content: value.content,
    contextUsed:
      typeof value.contextUsed === "boolean" ? value.contextUsed : undefined,
    createdAt: normalizeTimestamp(value.createdAt),
    id: value.id,
    model: typeof value.model === "string" ? value.model : undefined,
    providerName:
      typeof value.providerName === "string" ? value.providerName : undefined,
    responseRedacted:
      typeof value.responseRedacted === "boolean"
        ? value.responseRedacted
        : undefined,
    role: value.role,
    status: value.role === "assistant" ? "complete" : undefined,
    toolCount: typeof value.toolCount === "number" ? value.toolCount : undefined,
  };
}

export function serializeConversation(conversation: AiConversation) {
  return {
    ...conversation,
    messages: conversation.messages.map(({ pendingInvocations, ...message }) => message),
  };
}

export function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

export function isBlankConversation(conversation: AiConversation) {
  return conversation.messages.length === 0;
}

export function hasConversationHistoryContent(conversation: AiConversation) {
  return conversation.messages.some((message) => message.content.trim().length > 0);
}

export function normalizeHistorySearchQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function conversationMatchesHistoryQuery(
  conversation: AiConversation,
  normalizedQuery: string,
) {
  const searchableText = [
    conversation.title,
    formatHistoryDate(conversation.createdAt),
    formatHistoryDate(conversation.updatedAt),
    ...conversation.messages.flatMap((message) => [
      message.content,
      message.model ?? "",
      message.providerName ?? "",
      message.role === "user" ? "用户" : "AI",
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}

export function formatHistoryDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatHistoryTime(timestamp: number) {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return "刚刚";
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes} 分钟前`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours} 小时前`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays} 天前`;
}

export function compactId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function statusLabel(status: AiToolInvocationStatus) {
  const labels: Record<AiToolInvocationStatus, string> = {
    failed: "失败",
    pending: "待确认",
    rejected: "已拒绝",
    succeeded: "已执行",
  };
  return labels[status];
}

export function statusTone(status: AiToolInvocationStatus) {
  const tones: Record<AiToolInvocationStatus, string> = {
    failed:
      "border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-100",
    pending:
      "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-100",
    rejected:
      "border-zinc-400/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200",
    succeeded:
      "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
  };
  return tones[status];
}

export function downloadAiAuditExport(exported: AiToolAuditExport) {
  const blob = new Blob([JSON.stringify(exported, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kerminal-ai-audit-${exported.exportedAt}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function applyClientAction(
  action: AiToolPendingInvocation["clientAction"],
  handlers: {
    onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
    onFocusTab?: (tabId: string) => void;
    onOpenTool?: (toolId: ToolId) => void;
    onOpenSshTerminal?: (hostId: string) => void;
    onSplitPane?: (direction: TerminalSplitDirection) => void;
  },
) {
  if (!action) {
    return;
  }

  if (action.kind === "workspaceSplitPane") {
    if (action.direction === "horizontal" || action.direction === "vertical") {
      handlers.onSplitPane?.(action.direction);
    }
    return;
  }
  if (action.kind === "workspaceFocusTab") {
    if (action.tabId) {
      handlers.onFocusTab?.(action.tabId);
    }
    return;
  }
  if (
    action.kind === "workspaceOpenTool" &&
    typeof action.toolId === "string" &&
    isToolId(action.toolId)
  ) {
    handlers.onOpenTool?.(action.toolId);
    return;
  }
  if (action.kind === "terminalCreate") {
    handlers.onCreateTerminal?.({
      args: action.args ?? undefined,
      cwd: action.cwd ?? undefined,
      env: action.env ?? undefined,
      shell: action.shell ?? undefined,
      title: action.title ?? undefined,
    });
    return;
  }
  if (action.kind === "sshConnect") {
    if (action.hostId) {
      handlers.onOpenSshTerminal?.(action.hostId);
    }
  }
}
