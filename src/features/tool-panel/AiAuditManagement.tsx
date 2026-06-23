import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type {
  AiToolAuditContext,
  AiToolAuditRecord,
  AiToolInvocationStatus,
} from "../../lib/aiToolInvocationApi";
import { riskLabel } from "./toolRegistryModel";

type AuditActionState = "idle" | "exporting" | "clearing";

const AUDIT_PAGE_SIZE = 8;

interface AiAuditManagementProps {
  actionState: AuditActionState;
  audits: AiToolAuditRecord[];
  clearRequested: boolean;
  message: string | null;
  onCancelClear: () => void;
  onConfirmClear: () => void;
  onExport: () => void;
  onOpenContext?: (request: AiAuditContextOpenRequest) => void;
  onRefresh: () => void;
  onRequestClear: () => void;
}

export type AiAuditContextOpenTarget =
  | "assistantMessage"
  | "attachments"
  | "contextSnapshot"
  | "conversation"
  | "userMessage";

export interface AiAuditContextOpenRequest {
  attachmentIds?: string[];
  audit: AiToolAuditRecord;
  context: AiToolAuditContext;
  target: AiAuditContextOpenTarget;
}

export function AiAuditManagement({
  actionState,
  audits,
  clearRequested,
  message,
  onCancelClear,
  onConfirmClear,
  onExport,
  onOpenContext,
  onRefresh,
  onRequestClear,
}: AiAuditManagementProps) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const busy = actionState !== "idle";
  const filteredAudits = useMemo(
    () => filterAudits(audits, query),
    [audits, query],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredAudits.length / AUDIT_PAGE_SIZE),
  );
  const activePage = Math.min(page, totalPages);
  const pageStart = (activePage - 1) * AUDIT_PAGE_SIZE;
  const pageAudits = filteredAudits.slice(pageStart, pageStart + AUDIT_PAGE_SIZE);
  const pageRangeStart = filteredAudits.length === 0 ? 0 : pageStart + 1;
  const pageRangeEnd = Math.min(filteredAudits.length, pageStart + AUDIT_PAGE_SIZE);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setPage(1);
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="kerminal-solid-surface rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              工具审计
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              已加载 {audits.length} 条，匹配 {filteredAudits.length} 条；导出内容仅包含已脱敏摘要。
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              aria-label="刷新审计"
              disabled={busy}
              onClick={onRefresh}
              size="icon"
              title="刷新审计"
              variant="ghost"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              aria-label="导出审计"
              disabled={busy || audits.length === 0}
              onClick={onExport}
              size="icon"
              title="导出审计"
              variant="ghost"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              aria-label="清空审计"
              disabled={busy || audits.length === 0}
              onClick={onRequestClear}
              size="icon"
              title="清空审计"
              variant="danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">搜索工具审计</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          <input
            className="kerminal-field-surface h-9 w-full rounded-lg border pl-9 pr-9 text-sm text-zinc-900 dark:text-zinc-100"
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="搜索工具、状态、风险或摘要"
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="清空审计搜索"
              className="kerminal-focus-ring kerminal-pressable absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition hover:bg-[var(--surface-hover)] hover:text-zinc-700 dark:hover:text-zinc-100"
              onClick={() => updateQuery("")}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-100">
          {message}
        </div>
      ) : null}

      {clearRequested ? (
        <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2">
          <div className="text-xs leading-5 text-rose-700 dark:text-rose-100">
            清空后本地 AI 工具审计不可恢复，待确认调用不会受影响。
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              className="gap-1.5"
              disabled={actionState === "clearing"}
              onClick={onConfirmClear}
              size="sm"
              variant="secondary"
            >
              <Check className="h-3.5 w-3.5" />
              确认清空
            </Button>
            <Button
              className="gap-1.5"
              disabled={actionState === "clearing"}
              onClick={onCancelClear}
              size="sm"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <section className="kerminal-solid-surface overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            审计列表
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {filteredAudits.length > 0
              ? `${pageRangeStart}-${pageRangeEnd} / ${filteredAudits.length}`
              : "0 / 0"}
          </div>
        </div>

        {audits.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            暂无工具调用审计。
          </div>
        ) : null}
        {audits.length > 0 && filteredAudits.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            没有匹配的审计记录。
          </div>
        ) : null}

        {filteredAudits.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <div className="kerminal-muted-surface grid min-w-[1120px] grid-cols-[96px_160px_minmax(220px,1fr)_minmax(260px,0.9fr)_88px_120px] gap-3 border-b px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span>状态</span>
                <span>工具</span>
                <span>摘要</span>
                <span>上下文</span>
                <span>风险</span>
                <span>完成时间</span>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
                {pageAudits.map((audit) => {
                  const summary = auditSummary(audit);
                  const contextItems = auditContextItems(audit.auditContext);

                  return (
                    <div
                      className="grid min-w-[1120px] grid-cols-[96px_160px_minmax(220px,1fr)_minmax(260px,0.9fr)_88px_120px] items-center gap-3 px-3 py-2 text-sm"
                      key={audit.id}
                    >
                      <span
                        className={cn(
                          "w-fit rounded-full border px-2 py-0.5 text-xs",
                          statusTone(audit.status),
                        )}
                      >
                        {statusLabel(audit.status)}
                      </span>
                      <div className="min-w-0">
                        <div
                          className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                          title={audit.toolTitle}
                        >
                          {audit.toolTitle}
                        </div>
                        <div
                          className="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
                          title={audit.toolId}
                        >
                          {audit.toolId}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div
                          className="truncate text-xs leading-5 text-zinc-600 dark:text-zinc-300"
                          title={summary}
                        >
                          {summary}
                        </div>
                        {audit.riskSummary ? (
                          <div
                            className="truncate text-xs leading-5 text-rose-700 dark:text-rose-100"
                            title={audit.riskSummary}
                          >
                            {audit.riskSummary}
                          </div>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        {contextItems.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {contextItems.map((item) =>
                              renderAuditContextItem({
                                audit,
                                context: audit.auditContext,
                                item,
                                onOpenContext,
                              }),
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            无会话上下文
                          </span>
                        )}
                      </div>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {riskLabel(audit.risk)}
                      </span>
                      <span
                        className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                        title={audit.completedAt}
                      >
                        {formatTimestamp(audit.completedAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
              <span>每页 {AUDIT_PAGE_SIZE} 条</span>
              <div className="flex items-center gap-1">
                <Button
                  aria-label="上一页审计"
                  disabled={activePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  size="icon"
                  title="上一页"
                  variant="ghost"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-16 text-center">
                  {activePage} / {totalPages}
                </span>
                <Button
                  aria-label="下一页审计"
                  disabled={activePage >= totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  size="icon"
                  title="下一页"
                  variant="ghost"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function filterAudits(audits: AiToolAuditRecord[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return audits;
  }

  return audits.filter((audit) =>
    [
      audit.toolTitle,
      audit.toolId,
      audit.argumentsSummary,
      audit.resultSummary,
      audit.error,
      audit.riskSummary,
      audit.createdAt,
      audit.completedAt,
      audit.confirmation,
      statusLabel(audit.status),
      riskLabel(audit.risk),
      ...auditContextSearchValues(audit.auditContext),
    ].some((value) => value?.toLowerCase().includes(normalizedQuery)),
  );
}

function auditSummary(audit: AiToolAuditRecord) {
  return audit.resultSummary ?? audit.error ?? audit.argumentsSummary;
}

function auditContextItems(
  context: AiToolAuditContext | null | undefined,
): AuditContextItem[] {
  if (!context) {
    return [];
  }

  return [
    contextItem("会话", context.conversationId, "conversation"),
    contextItem("主机", context.hostId),
    contextItem("Tab", context.tabId),
    contextItem("Pane", context.paneId),
    contextItem("快照", context.contextSnapshotId, "contextSnapshot"),
    contextItem("用户消息", context.userMessageId, "userMessage"),
    contextItem("AI消息", context.assistantMessageId, "assistantMessage"),
    contextItem("目标", context.targetKey),
    attachmentContextItem(context.attachmentIds),
  ].filter((item): item is AuditContextItem => item !== null);
}

function contextItem(
  label: string,
  value: string | null | undefined,
  target?: AiAuditContextOpenTarget,
): AuditContextItem | null {
  if (!value) {
    return null;
  }
  return {
    label,
    target,
    title: value,
    value: truncateContextValue(value),
  };
}

function attachmentContextItem(
  attachmentIds: string[] | undefined,
): AuditContextItem | null {
  if (!attachmentIds?.length) {
    return null;
  }
  return {
    attachmentIds,
    label: "附件",
    target: "attachments",
    title: attachmentIds.join(", "),
    value: `${attachmentIds.length} 个`,
  };
}

interface AuditContextItem {
  attachmentIds?: string[];
  label: string;
  target?: AiAuditContextOpenTarget;
  title?: string;
  value: string;
}

function renderAuditContextItem({
  audit,
  context,
  item,
  onOpenContext,
}: {
  audit: AiToolAuditRecord;
  context: AiToolAuditContext | null | undefined;
  item: AuditContextItem;
  onOpenContext?: (request: AiAuditContextOpenRequest) => void;
}) {
  const content = `${item.label}: ${item.value}`;
  const key = `${audit.id}-${item.label}-${item.value}`;
  const title = item.title ?? item.value;
  const className =
    "max-w-full truncate rounded-md border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] leading-4 text-zinc-600 dark:text-zinc-300";
  if (!context || !item.target || !onOpenContext) {
    return (
      <span className={className} key={key} title={title}>
        {content}
      </span>
    );
  }

  return (
    <button
      aria-label={`打开审计上下文 ${item.label} ${title}`}
      className={`${className} kerminal-focus-ring kerminal-pressable hover:bg-[var(--surface-hover)] hover:text-zinc-800 dark:hover:text-zinc-100`}
      key={key}
      onClick={() =>
        onOpenContext({
          audit,
          context,
          target: item.target as AiAuditContextOpenTarget,
          ...(item.attachmentIds ? { attachmentIds: item.attachmentIds } : {}),
        })
      }
      title={`打开 ${content}`}
      type="button"
    >
      {content}
    </button>
  );
}

function auditContextSearchValues(
  context: AiToolAuditContext | null | undefined,
) {
  if (!context) {
    return [];
  }

  return [
    context.conversationId,
    context.userMessageId,
    context.assistantMessageId,
    context.contextSnapshotId,
    context.hostId,
    context.tabId,
    context.paneId,
    context.routeMode,
    context.scopeKind,
    context.scopeRefJson,
    context.targetKey,
    context.targetRefJson,
    ...(context.attachmentIds ?? []),
  ];
}

function truncateContextValue(value: string) {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value;
}

function statusLabel(status: AiToolInvocationStatus) {
  const labels: Record<AiToolInvocationStatus, string> = {
    failed: "失败",
    pending: "待确认",
    rejected: "已拒绝",
    succeeded: "已执行",
  };
  return labels[status];
}

function statusTone(status: AiToolInvocationStatus) {
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

function formatTimestamp(value: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return value;
  }

  return new Date(seconds * 1000).toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
  });
}
