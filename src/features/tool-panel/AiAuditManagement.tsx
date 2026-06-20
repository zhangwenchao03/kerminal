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
  onRefresh: () => void;
  onRequestClear: () => void;
}

export function AiAuditManagement({
  actionState,
  audits,
  clearRequested,
  message,
  onCancelClear,
  onConfirmClear,
  onExport,
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
  const totalPages = Math.max(1, Math.ceil(filteredAudits.length / AUDIT_PAGE_SIZE));
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
      <div className="rounded-lg border border-black/8 bg-white/80 p-3 dark:border-white/8 dark:bg-white/6">
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
            className="h-9 w-full rounded-lg border border-black/8 bg-white/70 pl-9 pr-9 text-sm text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="搜索工具、状态、风险或摘要"
            value={query}
          />
          {query ? (
            <button
              aria-label="清空审计搜索"
              className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/8 dark:hover:text-zinc-100"
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

      <section className="overflow-hidden rounded-lg border border-black/8 bg-white/80 dark:border-white/8 dark:bg-white/6">
        <div className="flex items-center justify-between gap-3 border-b border-black/8 px-3 py-2 dark:border-white/8">
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
              <div className="grid min-w-[820px] grid-cols-[96px_170px_minmax(220px,1fr)_88px_120px] gap-3 border-b border-black/8 bg-black/[0.025] px-3 py-2 text-xs font-medium text-zinc-500 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-zinc-400">
                <span>状态</span>
                <span>工具</span>
                <span>摘要</span>
                <span>风险</span>
                <span>完成时间</span>
              </div>
              <div className="divide-y divide-black/8 dark:divide-white/[0.06]">
                {pageAudits.map((audit) => {
                  const summary = auditSummary(audit);

                  return (
                    <div
                      className="grid min-w-[820px] grid-cols-[96px_170px_minmax(220px,1fr)_88px_120px] items-center gap-3 px-3 py-2 text-sm"
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

            <div className="flex flex-col gap-2 border-t border-black/8 px-3 py-2 text-xs text-zinc-500 dark:border-white/8 dark:text-zinc-400 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
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
    ].some((value) => value?.toLowerCase().includes(normalizedQuery)),
  );
}

function auditSummary(audit: AiToolAuditRecord) {
  return audit.resultSummary ?? audit.error ?? audit.argumentsSummary;
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
