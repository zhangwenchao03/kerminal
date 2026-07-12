import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  MessageSquare,
  Pencil,
  X,
} from "lucide-react";
import {
  AgentWorkflowHistoryList,
  AgentWorkflowSessionCommands,
  AgentWorkflowStatusBadge,
  type AgentWorkflowHistoryMetadata,
  type AgentWorkflowSessionSnapshot,
} from "../../agent-workflow";
import type { AgentSessionTargetRequest } from "../../../lib/agentLauncherApi";
import { cn } from "../../../lib/cn";
import { formatTargetChipLabel } from "./agentSessionTargetModel";

type ConversationScope = "current" | "all";

interface AgentConversationListProps {
  actionDisabled: boolean;
  currentTarget?: AgentSessionTargetRequest;
  historyMetadata: readonly AgentWorkflowHistoryMetadata[];
  onContinue: (sessionId: string) => void;
  onNewSession: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  renamingSessionId: string | null;
  sessions: readonly AgentWorkflowSessionSnapshot[];
}

/** Agent 对话列表只负责范围、标题编辑和展示，不直接访问持久化仓库。 */
export function AgentConversationList({
  actionDisabled,
  currentTarget,
  historyMetadata,
  onContinue,
  onNewSession,
  onRename,
  renamingSessionId,
  sessions,
}: AgentConversationListProps) {
  const [scope, setScope] = useState<ConversationScope>(
    currentTarget ? "current" : "all",
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const currentTargetKey =
    currentTarget?.targetRef ??
    currentTarget?.targetTerminalSessionId ??
    currentTarget?.paneId ??
    currentTarget?.tabId ??
    "";
  useEffect(() => {
    setScope(currentTargetKey ? "current" : "all");
  }, [currentTargetKey]);
  const currentSessions = useMemo(
    () => sessions.filter((session) => matchesCurrentTarget(session, currentTarget)),
    [currentTarget, sessions],
  );
  const visibleSessions = useMemo(
    () => sortSessions(scope === "current" ? currentSessions : sessions),
    [currentSessions, scope, sessions],
  );

  const beginEditing = (session: AgentWorkflowSessionSnapshot) => {
    setEditingSessionId(session.agentSessionId);
    setDraftTitle(session.title);
  };
  const cancelEditing = () => {
    setEditingSessionId(null);
    setDraftTitle("");
  };
  const submitTitle = async (sessionId: string) => {
    const title = draftTitle.trim();
    if (!title) {
      return;
    }
    if (await onRename(sessionId, title)) {
      cancelEditing();
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <section aria-labelledby="agent-conversations-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2
            className="text-xs font-semibold text-zinc-700 dark:text-zinc-200"
            id="agent-conversations-heading"
          >
            对话
          </h2>
          <div
            aria-label="对话范围"
            className="grid grid-cols-2 rounded-lg bg-[var(--surface-muted)] p-0.5"
            role="group"
          >
            <ScopeButton
              active={scope === "current"}
              count={currentSessions.length}
              label="当前目标"
              onClick={() => setScope("current")}
            />
            <ScopeButton
              active={scope === "all"}
              count={sessions.length}
              label="全部"
              onClick={() => setScope("all")}
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)]">
          {visibleSessions.length > 0 ? (
            <div className="scrollbar-none max-h-80 divide-y divide-[var(--border-subtle)] overflow-y-auto">
              {visibleSessions.map((session) => {
                const editing = editingSessionId === session.agentSessionId;
                const renaming = renamingSessionId === session.agentSessionId;
                return (
                  <article
                    className="min-w-0 px-3 py-3"
                    key={session.agentSessionId}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-zinc-500 dark:text-zinc-400">
                        <MessageSquare aria-hidden className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <form
                            className="flex min-w-0 items-center gap-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitTitle(session.agentSessionId);
                            }}
                          >
                            <input
                              aria-label="会话标题"
                              autoFocus
                              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-field)] px-2 text-xs font-medium outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                              disabled={renaming}
                              maxLength={120}
                              onChange={(event) => setDraftTitle(event.target.value)}
                              value={draftTitle}
                            />
                            <button
                              aria-label="保存标题"
                              className="kerminal-focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md text-emerald-700 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:text-emerald-300"
                              disabled={!draftTitle.trim() || renaming}
                              type="submit"
                            >
                              <Check aria-hidden className="h-3.5 w-3.5" />
                            </button>
                            <button
                              aria-label="取消修改标题"
                              className="kerminal-focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:text-zinc-400"
                              disabled={renaming}
                              onClick={cancelEditing}
                              type="button"
                            >
                              <X aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        ) : (
                          <div className="flex min-w-0 items-center gap-1">
                            <h3
                              className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-950 dark:text-zinc-100"
                              title={session.title}
                            >
                              {session.title}
                            </h3>
                            <button
                              aria-label={`重命名 ${session.title}`}
                              className="kerminal-focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-[var(--surface-hover)] hover:text-zinc-700 dark:hover:text-zinc-200"
                              disabled={actionDisabled}
                              onClick={() => beginEditing(session)}
                              title="重命名"
                              type="button"
                            >
                              <Pencil aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                          <span>{agentLabel(session.agentId)}</span>
                          <span aria-hidden>·</span>
                          <span
                            className="max-w-full truncate"
                            title={formatTargetChipLabel(session.target)}
                          >
                            {matchesCurrentTarget(session, currentTarget)
                              ? "当前目标"
                              : formatTargetChipLabel(session.target)}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{formatSessionTime(session)}</span>
                        </div>
                      </div>
                      <AgentWorkflowStatusBadge status={session.runtimeStatus} />
                    </div>
                    <div className="mt-2 pl-9">
                      <AgentWorkflowSessionCommands
                        disabled={actionDisabled || renaming}
                        onContinue={onContinue}
                        onNewSession={onNewSession}
                        sessionId={session.agentSessionId}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-7 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {scope === "current" ? "当前目标暂无对话" : "暂无 Agent 对话"}
            </p>
          )}
        </div>
      </section>

      {historyMetadata.length > 0 ? (
        <details className="group border-t border-[var(--border-subtle)] pt-1">
          <summary className="kerminal-focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
            />
            最近发送（不含正文）
            <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">
              {historyMetadata.length}
            </span>
          </summary>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)]">
            <AgentWorkflowHistoryList items={historyMetadata} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ScopeButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "kerminal-focus-ring h-7 whitespace-nowrap rounded-md px-2 text-[10px] font-medium",
        active
          ? "bg-[var(--surface-solid)] text-zinc-950 shadow-sm dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
      )}
      onClick={onClick}
      type="button"
    >
      {label} {count}
    </button>
  );
}

function matchesCurrentTarget(
  session: AgentWorkflowSessionSnapshot,
  currentTarget?: AgentSessionTargetRequest,
) {
  const target = session.target;
  if (!target || !currentTarget) {
    return false;
  }
  if (target.targetRef && currentTarget.targetRef) {
    return target.targetRef === currentTarget.targetRef;
  }
  if (target.targetTerminalSessionId && currentTarget.targetTerminalSessionId) {
    return (
      target.targetTerminalSessionId === currentTarget.targetTerminalSessionId
    );
  }
  if (target.paneId && currentTarget.paneId) {
    return target.paneId === currentTarget.paneId;
  }
  return Boolean(target.tabId && target.tabId === currentTarget.tabId);
}

function sortSessions(sessions: readonly AgentWorkflowSessionSnapshot[]) {
  return [...sessions].sort((left, right) => {
    const statusOrder =
      sessionStatusOrder(left.runtimeStatus) -
      sessionStatusOrder(right.runtimeStatus);
    if (statusOrder !== 0) {
      return statusOrder;
    }
    return sessionTimestamp(right) - sessionTimestamp(left);
  });
}

function sessionStatusOrder(status: AgentWorkflowSessionSnapshot["runtimeStatus"]) {
  if (status === "waitingForUser") {
    return 0;
  }
  if (status === "running") {
    return 1;
  }
  if (status === "failed") {
    return 2;
  }
  if (status === "stale") {
    return 3;
  }
  return 4;
}

function sessionTimestamp(session: AgentWorkflowSessionSnapshot) {
  const parsed = Date.parse(session.updatedAt ?? session.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSessionTime(session: AgentWorkflowSessionSnapshot) {
  const value = session.updatedAt ?? session.createdAt;
  if (!value) {
    return "时间未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function agentLabel(agentId?: AgentWorkflowSessionSnapshot["agentId"]) {
  if (agentId === "claude") {
    return "Claude";
  }
  if (agentId === "custom") {
    return "Custom";
  }
  return "Codex";
}
