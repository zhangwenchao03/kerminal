import {
  ChevronLeft,
  ChevronRight,
  History,
  ListFilter,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import {
  clearCommandHistory,
  deleteCommandHistory,
  listCommandHistory,
  type CommandHistoryEntry,
  type CommandHistoryListRequest,
  type CommandHistorySource,
  type CommandHistoryTarget,
} from "../../lib/commandHistoryApi";
import { cn } from "../../lib/cn";
import { DiagnosticsBundleCard } from "../tool-panel/DiagnosticsBundleCard";
import type { TerminalPane } from "../workspace/types";

const COMMAND_HISTORY_LIMIT = 100;
const COMMAND_HISTORY_PAGE_SIZE = 8;
const SOURCE_FILTER_OPTIONS: SelectOption[] = [
  { label: "全部来源", value: "" },
  { label: "用户输入", value: "user" },
  { label: "AI", value: "ai" },
  { label: "批量发送", value: "broadcast" },
  { label: "片段", value: "snippet" },
  { label: "工作流", value: "workflow" },
  { label: "工具", value: "tool" },
];

interface LogToolContentProps {
  focusedPane?: TerminalPane;
}

export function LogToolContent({ focusedPane }: LogToolContentProps) {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CommandHistorySource | "">("");
  const historyScope = useMemo(
    () => buildHistoryScope(focusedPane),
    [focusedPane],
  );

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextEntries = await listCommandHistory({
        limit: COMMAND_HISTORY_LIMIT,
        ...historyScope.request,
        query: query || undefined,
        source: source || undefined,
      });
      setEntries(nextEntries);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  }, [historyScope.request, query, source]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const historyStats = useMemo(() => buildHistoryStats(entries), [entries]);
  const totalPages = Math.max(
    1,
    Math.ceil(entries.length / COMMAND_HISTORY_PAGE_SIZE),
  );
  const activePage = Math.min(page, totalPages);
  const pageStart = (activePage - 1) * COMMAND_HISTORY_PAGE_SIZE;
  const pageEntries = entries.slice(
    pageStart,
    pageStart + COMMAND_HISTORY_PAGE_SIZE,
  );
  const pageRangeStart = entries.length === 0 ? 0 : pageStart + 1;
  const pageRangeEnd = Math.min(
    entries.length,
    pageStart + COMMAND_HISTORY_PAGE_SIZE,
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setPage(1);
  };

  const updateSource = (nextSource: CommandHistorySource | "") => {
    setSource(nextSource);
    setPage(1);
  };

  const deleteEntry = async (entryId: string) => {
    setLoading(true);
    setError(null);
    try {
      await deleteCommandHistory(entryId);
      await loadHistory();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  };

  const clearEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      await clearCommandHistory();
      setPage(1);
      await loadHistory();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      <DiagnosticsBundleCard />

      <section className="rounded-lg border border-black/8 bg-white/80 p-3 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              <History className="h-4 w-4 text-sky-500 dark:text-sky-300" />
              命令历史
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              只显示当前终端提交的命令；疑似包含密钥、密码或 token 的命令会被跳过。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="刷新命令历史"
              disabled={loading}
              onClick={() => void loadHistory()}
              size="icon"
              title="刷新命令历史"
              variant="ghost"
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
              />
            </Button>
            <Button
              aria-label="清空命令历史"
              disabled={loading || entries.length === 0}
              onClick={() => void clearEntries()}
              size="icon"
              title="清空命令历史"
              variant="danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="rounded-md border border-black/8 bg-black/[0.03] px-2 py-1 dark:border-white/8 dark:bg-black/20">
            {historyScope.label}
          </span>
          <span className="min-w-0 truncate font-mono">
            {historyScope.detail}
          </span>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <span>
            共 {historyStats.total} 条 · 本地 {historyStats.local} · SSH{" "}
            {historyStats.ssh} · 容器 {historyStats.container}
          </span>
        </div>

        <div className="mt-3 grid gap-2 min-[560px]:grid-cols-[minmax(0,1fr)_10rem]">
          <label className="relative min-w-0">
            <span className="sr-only">搜索命令历史</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <input
              className="h-9 w-full rounded-lg border border-black/8 bg-white/70 pl-9 pr-9 text-sm text-zinc-900 outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="搜索命令、目录或主机"
              value={query}
            />
            {query ? (
              <button
                aria-label="清空命令搜索"
                className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/8 dark:hover:text-zinc-100"
                onClick={() => updateQuery("")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <div className="relative min-w-0">
            <span className="sr-only">历史来源</span>
            <ListFilter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <Select
              aria-label="历史来源"
              buttonClassName="rounded-lg border-black/8 bg-white/70 pl-9 text-sm text-zinc-900 focus-visible:border-sky-500/50 focus-visible:ring-sky-500/15 dark:border-white/10 dark:bg-white/8 dark:text-zinc-100"
              onValueChange={(nextSource) =>
                updateSource(nextSource as CommandHistorySource | "")
              }
              options={SOURCE_FILTER_OPTIONS}
              value={source}
            />
          </div>
        </div>
      </section>

      {error ? (
        <div
          className="rounded-lg border border-rose-300/25 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-black/8 bg-white/80 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20">
        <div className="flex items-center justify-between gap-3 border-b border-black/8 px-3 py-2 dark:border-white/8">
          <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            最近记录
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {entries.length > 0
              ? `${pageRangeStart}-${pageRangeEnd} / ${entries.length}`
              : "0 / 0"}
          </div>
        </div>

        {loading && entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            正在加载命令历史...
          </div>
        ) : null}
        {!loading && entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            暂无命令历史。
          </div>
        ) : null}

        {entries.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <div className="grid min-w-[760px] grid-cols-[92px_minmax(180px,1fr)_160px_120px_40px] gap-3 border-b border-black/8 bg-black/[0.025] px-3 py-2 text-xs font-medium text-zinc-500 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-zinc-400">
                <span>类型</span>
                <span>命令</span>
                <span>上下文</span>
                <span>时间</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y divide-black/8 dark:divide-white/[0.06]">
                {pageEntries.map((entry) => (
                  <div
                    className="grid min-w-[760px] grid-cols-[92px_minmax(180px,1fr)_160px_120px_40px] items-center gap-3 px-3 py-2 text-sm"
                    key={entry.id}
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="w-fit rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-100">
                        {historyTargetLabel(entry.target)}
                      </span>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {historySourceLabel(entry.source)}
                      </span>
                    </div>
                    <code
                      className="block truncate rounded-md bg-black/[0.04] px-2 py-1.5 font-mono text-xs text-zinc-800 dark:bg-black/25 dark:text-zinc-200"
                      title={entry.command}
                    >
                      {entry.command}
                    </code>
                    <span
                      className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                      title={historyContextLabel(entry)}
                    >
                      {historyContextLabel(entry)}
                    </span>
                    <span
                      className="truncate text-xs text-zinc-500 dark:text-zinc-400"
                      title={entry.createdAt}
                    >
                      {formatTimestamp(entry.createdAt)}
                    </span>
                    <Button
                      aria-label={`删除历史 ${entry.command}`}
                      disabled={loading}
                      onClick={() => void deleteEntry(entry.id)}
                      size="icon"
                      title={`删除历史 ${entry.command}`}
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-black/8 px-3 py-2 text-xs text-zinc-500 dark:border-white/8 dark:text-zinc-400 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
              <span>
                每页 {COMMAND_HISTORY_PAGE_SIZE} 条，最多加载{" "}
                {COMMAND_HISTORY_LIMIT} 条最近记录
              </span>
              <div className="flex items-center gap-1">
                <Button
                  aria-label="上一页命令历史"
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
                  aria-label="下一页命令历史"
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
    </section>
  );
}

function buildHistoryStats(entries: CommandHistoryEntry[]) {
  return entries.reduce(
    (stats, entry) => ({
      container: stats.container + (entry.target === "dockerContainer" ? 1 : 0),
      local: stats.local + (entry.target === "local" ? 1 : 0),
      ssh: stats.ssh + (entry.target === "ssh" ? 1 : 0),
      total: stats.total + 1,
    }),
    { container: 0, local: 0, ssh: 0, total: 0 },
  );
}

function buildHistoryScope(focusedPane?: TerminalPane): {
  detail: string;
  label: string;
  request: Pick<
    CommandHistoryListRequest,
    "paneId" | "remoteHostId" | "target"
  >;
} {
  if (!focusedPane) {
    return {
      detail: "未聚焦终端",
      label: "当前终端",
      request: {},
    };
  }

  if (focusedPane.mode === "ssh") {
    const remoteHostId = focusedPane.remoteHostId ?? focusedPane.machineId;
    return {
      detail: remoteHostId,
      label: "SSH",
      request: {
        paneId: focusedPane.id,
        remoteHostId,
        target: "ssh",
      },
    };
  }

  if (focusedPane.mode === "container") {
    return {
      detail: focusedPane.containerId ?? focusedPane.title,
      label: "容器",
      request: {
        paneId: focusedPane.id,
        target: "dockerContainer",
      },
    };
  }

  return {
    detail: focusedPane.title,
    label: "本地",
    request: {
      paneId: focusedPane.id,
      target: "local",
    },
  };
}

function historyContextLabel(entry: CommandHistoryEntry) {
  return (
    entry.cwd ??
    entry.remoteHostId ??
    entry.sessionId ??
    entry.shell ??
    "未绑定上下文"
  );
}

function historyTargetLabel(target: CommandHistoryTarget) {
  const labels: Record<CommandHistoryTarget, string> = {
    dockerContainer: "容器",
    local: "本地",
    serial: "Serial",
    ssh: "SSH",
    telnet: "Telnet",
  };
  return labels[target];
}

function historySourceLabel(source: CommandHistorySource) {
  const labels: Record<CommandHistorySource, string> = {
    ai: "AI",
    broadcast: "批量发送",
    snippet: "片段",
    workflow: "工作流",
    tool: "工具",
    user: "用户输入",
  };
  return labels[source];
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
