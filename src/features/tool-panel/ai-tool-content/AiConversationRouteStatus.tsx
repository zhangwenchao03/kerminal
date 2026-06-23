import {
  AlertTriangle,
  MessageSquare,
  Monitor,
  Server,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import type { AiConversation } from "./aiToolContentModel";
import {
  AI_TERMINAL_SESSION_NOT_READY_ERROR,
  isAiTerminalContextReadinessBlocked,
} from "./aiTargetResolution";
import type { AiTerminalContextSnapshot } from "../../../lib/aiContextApi";
import { ContextUsageIndicator } from "./AiToolContentParts";
import type { LoadState } from "./aiToolContentModel";

type ConversationTargetRef = Record<string, unknown>;

interface RoutePresentation {
  conversationLabel?: string;
  detailLabel: string;
  icon: LucideIcon;
  readinessWarning?: string;
  scopeLabel: string;
  slotLabel: string;
  targetLabel: string;
}

export function AiConversationRouteStatus({
  activeConversation,
  contextError,
  contextSnapshot,
  contextState = "idle",
  slot,
  terminalSessionReady,
}: {
  activeConversation?: AiConversation;
  contextError?: string | null;
  contextSnapshot?: AiTerminalContextSnapshot | null;
  contextState?: LoadState;
  slot: AiConversationSlotDescriptor;
  terminalSessionReady?: boolean;
}) {
  const status = buildAiConversationRoutePresentation(
    slot,
    activeConversation,
    terminalSessionReady,
  );
  const Icon = status.icon;

  return (
    <div
      aria-label="AI 会话绑定目标"
      className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300"
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] text-sky-700 dark:text-sky-100">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 font-medium text-zinc-800 dark:text-zinc-100">
              AI 当前绑定
            </span>
            <span className="rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              {status.scopeLabel}
            </span>
          </div>
          <div className="mt-1 truncate font-medium text-zinc-900 dark:text-zinc-50">
            {status.targetLabel}
          </div>
        </div>
        <span
          className="hidden max-w-[9rem] shrink-0 truncate rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] px-2 py-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 sm:inline"
          title={status.slotLabel}
        >
          {status.slotLabel}
        </span>
        <ContextUsageIndicator
          error={contextError ?? null}
          snapshot={contextSnapshot ?? null}
          state={contextState}
        />
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-zinc-500 dark:text-zinc-400">
        <span className="min-w-0 truncate">{status.detailLabel}</span>
        {status.conversationLabel ? (
          <span className="min-w-0 truncate">{status.conversationLabel}</span>
        ) : null}
      </div>
      {status.readinessWarning ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-400/10 px-2.5 py-2 text-amber-800 dark:border-amber-400/30 dark:bg-amber-300/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{status.readinessWarning}</span>
        </div>
      ) : null}
    </div>
  );
}

export function buildAiConversationRoutePresentation(
  slot: AiConversationSlotDescriptor,
  activeConversation?: AiConversation,
  terminalSessionReady?: boolean,
): RoutePresentation {
  const targetRef = parseTargetRef(slot.targetRefJson);
  const targetKind = stringValue(targetRef.kind) ?? "none";
  const targetLabel = resolveTargetLabel(slot, targetRef, targetKind);
  const conversationTitle = activeConversation?.title?.trim();
  const readinessWarning =
    terminalSessionReady === false &&
    isAiTerminalContextReadinessBlocked({
      focusedPane: targetKind === "pane" ? targetRef : undefined,
      terminalSessionReady,
    })
      ? AI_TERMINAL_SESSION_NOT_READY_ERROR
      : undefined;

  return {
    conversationLabel: conversationTitle
      ? `当前对话 ${conversationTitle}`
      : undefined,
    detailLabel: resolveDetailLabel(targetRef),
    icon: iconForTargetKind(targetKind),
    readinessWarning,
    scopeLabel: resolveScopeLabel(slot, targetKind),
    slotLabel: `槽位 ${slot.slotKey}`,
    targetLabel,
  };
}

function parseTargetRef(json: string): ConversationTargetRef {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolveTargetLabel(
  slot: AiConversationSlotDescriptor,
  targetRef: ConversationTargetRef,
  targetKind: string,
) {
  if (targetKind === "pane") {
    return (
      stringValue(targetRef.paneTitle) ??
      stringValue(targetRef.paneId) ??
      slot.createRequest.title ??
      "未命名窗格"
    );
  }

  if (targetKind === "tab") {
    return (
      stringValue(targetRef.tabTitle) ??
      stringValue(targetRef.tabId) ??
      slot.createRequest.title ??
      "未命名标签页"
    );
  }

  if (targetKind === "host") {
    return (
      stringValue(targetRef.machineName) ??
      stringValue(targetRef.machineId) ??
      slot.createRequest.title ??
      "未命名主机"
    );
  }

  return "未绑定终端上下文";
}

function resolveDetailLabel(targetRef: ConversationTargetRef) {
  const parts = [
    labeledValue("主机", targetRef.machineName ?? targetRef.machineId),
    labeledValue("标签", targetRef.tabTitle ?? targetRef.tabId),
    labeledValue("窗格", targetRef.paneTitle ?? targetRef.paneId),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : "普通 AI 会话，不读取主机或终端";
}

function resolveScopeLabel(
  slot: AiConversationSlotDescriptor,
  targetKind: string,
) {
  if (slot.routeMode === "noContextChat" || targetKind === "none") {
    return "普通会话";
  }

  if (targetKind === "pane") {
    return "窗格会话";
  }

  if (targetKind === "tab") {
    return "标签页会话";
  }

  if (targetKind === "host") {
    return "主机会话";
  }

  if (slot.createRequest.scopeKind === "followFocus") {
    return "跟随焦点";
  }

  return "工作区会话";
}

function iconForTargetKind(targetKind: string): LucideIcon {
  if (targetKind === "pane") {
    return Terminal;
  }

  if (targetKind === "tab") {
    return Monitor;
  }

  if (targetKind === "host") {
    return Server;
  }

  return MessageSquare;
}

function labeledValue(label: string, value: unknown) {
  const text = stringValue(value);
  return text ? `${label} ${text}` : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is ConversationTargetRef {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
