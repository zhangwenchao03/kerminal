import {
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  ListFilter,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  getRuntimeHealthSnapshot,
  type RuntimeStorageHealth,
} from "../../lib/diagnosticsApi";
const COMMAND_HISTORY_LIMIT = 100;
const COMMAND_HISTORY_PAGE_SIZE = 8;
const SOURCE_FILTER_OPTIONS: SelectOption[] = [
  { label: "全部来源", value: "" },
  { label: "用户输入", value: "user" },
  { label: "批量发送", value: "broadcast" },
  { label: "片段", value: "snippet" },
  { label: "工作流", value: "workflow" },
  { label: "工具", value: "tool" },
];

interface CommandHistoryPaneContext {
  containerId?: string;
  id: string;
  machineId: string;
  mode: "local" | "ssh" | "telnet" | "serial" | "container" | "preview";
  remoteHostId?: string;
  title: string;
}

interface LogToolContentProps {
  active?: boolean;
  diagnosticsBundleNotice?: ReactNode;
  focusedPane?: CommandHistoryPaneContext;
}

export function LogToolContent({
  active = true,
  diagnosticsBundleNotice,
  focusedPane,
}: LogToolContentProps) {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CommandHistorySource | "">("");
  const [logStorage, setLogStorage] = useState<RuntimeStorageHealth | null>(
    null,
  );
  const [logStorageError, setLogStorageError] = useState<string | null>(null);
  const [logStorageLoading, setLogStorageLoading] = useState(false);
  const historyScope = useMemo(
    () => buildHistoryScope(focusedPane),
    [focusedPane],
  );
  const historyBindingKey = useMemo(
    () =>
      [
        historyScope.request.target ?? "none",
        historyScope.request.paneId ?? "none",
        historyScope.request.remoteHostId ?? "none",
      ].join(":"),
    [historyScope.request],
  );
  const activeRef = useRef(active);
  const historyBindingKeyRef = useRef(historyBindingKey);
  const historyRequestIdRef = useRef(0);
  const logStorageRequestIdRef = useRef(0);
  const [historyStateBindingKey, setHistoryStateBindingKey] =
    useState(historyBindingKey);
  activeRef.current = active;
  historyBindingKeyRef.current = historyBindingKey;
  const historyStateCurrent = historyStateBindingKey === historyBindingKey;
  const visibleEntries = useMemo(
    () => (historyStateCurrent ? entries : []),
    [entries, historyStateCurrent],
  );
  const visibleError = historyStateCurrent ? error : null;
  const visibleLoading = historyStateCurrent
    ? loading
    : active && historyScope.bound;

  // 请求完成时同时核对代次与绑定 key，隐藏或切换 pane 后的旧结果不得回写。
  const isCurrentHistoryRequest = useCallback(
    (requestId: number, bindingKey: string) =>
      activeRef.current &&
      historyBindingKeyRef.current === bindingKey &&
      historyRequestIdRef.current === requestId,
    [],
  );
  const isCurrentLogStorageRequest = useCallback(
    (requestId: number) =>
      activeRef.current && logStorageRequestIdRef.current === requestId,
    [],
  );

  const loadLogStorage = useCallback(async () => {
    if (!activeRef.current) {
      return;
    }
    const requestId = ++logStorageRequestIdRef.current;
    setLogStorageLoading(true);
    setLogStorageError(null);
    try {
      const snapshot = await getRuntimeHealthSnapshot();
      if (isCurrentLogStorageRequest(requestId)) {
        setLogStorage(snapshot.storage);
      }
    } catch (nextError) {
      if (isCurrentLogStorageRequest(requestId)) {
        setLogStorageError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (isCurrentLogStorageRequest(requestId)) {
        setLogStorageLoading(false);
      }
    }
  }, [isCurrentLogStorageRequest]);

  useEffect(() => {
    if (!active) {
      logStorageRequestIdRef.current += 1;
      setLogStorageLoading(false);
      return undefined;
    }
    void loadLogStorage();
    return () => {
      logStorageRequestIdRef.current += 1;
    };
  }, [active, loadLogStorage]);

  const loadHistory = useCallback(async () => {
    if (!activeRef.current || !historyScope.bound) {
      return;
    }
    const requestId = ++historyRequestIdRef.current;
    const bindingKey = historyBindingKey;
    setLoading(true);
    setError(null);
    try {
      const nextEntries = await listCommandHistory({
        limit: COMMAND_HISTORY_LIMIT,
        ...historyScope.request,
        query: query || undefined,
        source: source || undefined,
      });
      if (isCurrentHistoryRequest(requestId, bindingKey)) {
        setEntries(nextEntries);
      }
    } catch (nextError) {
      if (isCurrentHistoryRequest(requestId, bindingKey)) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (isCurrentHistoryRequest(requestId, bindingKey)) {
        setLoading(false);
      }
    }
  }, [
    historyBindingKey,
    historyScope.request,
    isCurrentHistoryRequest,
    query,
    source,
  ]);

  useEffect(() => {
    historyRequestIdRef.current += 1;
    setHistoryStateBindingKey(historyBindingKey);
    setEntries([]);
    setError(null);
    setLoading(false);
    setPage(1);
  }, [historyBindingKey]);

  useEffect(() => {
    if (!active) {
      historyRequestIdRef.current += 1;
      setLoading(false);
      return undefined;
    }
    void loadHistory();
    return () => {
      historyRequestIdRef.current += 1;
    };
  }, [active, loadHistory]);

  const historyStats = useMemo(
    () => buildHistoryStats(visibleEntries),
    [visibleEntries],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(visibleEntries.length / COMMAND_HISTORY_PAGE_SIZE),
  );
  const activePage = Math.min(page, totalPages);
  const pageStart = (activePage - 1) * COMMAND_HISTORY_PAGE_SIZE;
  const pageEntries = visibleEntries.slice(
    pageStart,
    pageStart + COMMAND_HISTORY_PAGE_SIZE,
  );
  const pageRangeStart = visibleEntries.length === 0 ? 0 : pageStart + 1;
  const pageRangeEnd = Math.min(
    visibleEntries.length,
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
    if (
      !activeRef.current ||
      !historyScope.bound ||
      !historyStateCurrent ||
      !visibleEntries.some((entry) => entry.id === entryId)
    ) {
      return;
    }
    const bindingKey = historyBindingKey;
    setLoading(true);
    setError(null);
    try {
      await deleteCommandHistory(entryId);
      if (!activeRef.current || historyBindingKeyRef.current !== bindingKey) {
        return;
      }
      await loadHistory();
    } catch (nextError) {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setLoading(false);
      }
    }
  };

  const clearEntries = async () => {
    if (
      !activeRef.current ||
      !historyScope.bound ||
      !historyStateCurrent
    ) {
      return;
    }
    const bindingKey = historyBindingKey;
    const scopeRequest = historyScope.request;
    setLoading(true);
    setError(null);
    try {
      await clearCommandHistory(scopeRequest);
      if (!activeRef.current || historyBindingKeyRef.current !== bindingKey) {
        return;
      }
      setPage(1);
      await loadHistory();
    } catch (nextError) {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setLoading(false);
      }
    }
  };

  return (
    <section className="space-y-3">
      {diagnosticsBundleNotice}

      <section className="border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              <FileText className="h-4 w-4 text-[rgb(var(--app-accent))]" />
              应用日志
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              应用运行记录会保存在本机，可用于反馈问题或回溯操作。
            </p>
          </div>
          <Button
            aria-label="刷新应用日志状态"
            disabled={logStorageLoading}
            onClick={() => void loadLogStorage()}
            size="icon"
            title="刷新应用日志状态"
            variant="ghost"
          >
            <RefreshCw
              className={cn("h-4 w-4", logStorageLoading && "animate-spin")}
            />
          </Button>
        </div>

        {logStorageError ? (
          <div
            className="mt-3 rounded-lg border border-rose-300/25 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-100"
            role="alert"
          >
            {logStorageError}
          </div>
        ) : null}

        {!logStorage && logStorageLoading ? (
          <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            正在读取日志状态...
          </div>
        ) : null}

        {logStorage ? (
          <div className="mt-3 grid gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="grid gap-1 min-[720px]:grid-cols-[5rem_minmax(0,1fr)]">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                当前日志
              </span>
              <code
                className="kerminal-muted-surface min-w-0 truncate rounded-md px-2 py-1 font-mono text-zinc-800 dark:text-zinc-200"
                title={logStorage.appLogFile}
              >
                {logStorage.appLogFile}
              </code>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="kerminal-muted-surface rounded-md border px-2 py-1">
                当前 {formatBytes(logStorage.appLogFileSizeBytes)}
              </span>
              <span className="kerminal-muted-surface rounded-md border px-2 py-1">
                单文件上限 {formatBytes(logStorage.appLogMaxFileSizeBytes)}
              </span>
              <span className="kerminal-muted-surface rounded-md border px-2 py-1">
                保留 {logStorage.appLogRotationKeepFiles} 个文件
              </span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              <History className="h-4 w-4 text-[rgb(var(--app-accent))]" />
              命令历史
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              仅显示当前终端命令；密钥、密码或 token 会跳过。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="刷新命令历史"
              disabled={visibleLoading || !historyScope.bound}
              onClick={() => void loadHistory()}
              size="icon"
              title="刷新命令历史"
              variant="ghost"
            >
              <RefreshCw
                className={cn("h-4 w-4", visibleLoading && "animate-spin")}
              />
            </Button>
            <Button
              aria-label="清空命令历史"
              disabled={
                visibleLoading ||
                !historyScope.bound ||
                visibleEntries.length === 0
              }
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
          <span className="kerminal-muted-surface rounded-md border px-2 py-1">
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
              className="kerminal-field-surface h-9 w-full rounded-lg border pl-9 pr-9 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="搜索命令、目录或主机"
              value={query}
            />
            {query ? (
              <button
                aria-label="清空命令搜索"
                className="kerminal-focus-ring kerminal-pressable absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition hover:bg-[var(--surface-hover)] hover:text-zinc-700 dark:hover:text-zinc-100"
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
              buttonClassName="rounded-lg pl-9 text-sm text-zinc-900 dark:text-zinc-100"
              onValueChange={(nextSource) =>
                updateSource(nextSource as CommandHistorySource | "")
              }
              options={SOURCE_FILTER_OPTIONS}
              value={source}
            />
          </div>
        </div>
      </section>

      {visibleError ? (
        <div
          className="rounded-lg border border-rose-300/25 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {visibleError}
        </div>
      ) : null}

      <section className="kerminal-solid-surface overflow-hidden rounded-[var(--radius-card)] border">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            最近记录
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {visibleEntries.length > 0
              ? `${pageRangeStart}-${pageRangeEnd} / ${visibleEntries.length}`
              : "0 / 0"}
          </div>
        </div>

        {visibleLoading && visibleEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            正在加载命令历史...
          </div>
        ) : null}
        {!visibleLoading && visibleEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            暂无命令历史。
          </div>
        ) : null}

        {visibleEntries.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <div className="kerminal-muted-surface grid min-w-[760px] grid-cols-[92px_minmax(180px,1fr)_160px_120px_40px] gap-3 border-b px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span>类型</span>
                <span>命令</span>
                <span>上下文</span>
                <span>时间</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y divide-[var(--border-subtle)]">
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
                      className="kerminal-muted-surface block truncate rounded-md px-2 py-1.5 font-mono text-xs text-zinc-800 dark:text-zinc-200"
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
                      disabled={visibleLoading}
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

            <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
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

function buildHistoryScope(focusedPane?: CommandHistoryPaneContext): {
  bound: boolean;
  detail: string;
  label: string;
  request: Pick<
    CommandHistoryListRequest,
    "paneId" | "remoteHostId" | "target"
  >;
} {
  if (!focusedPane) {
    return {
      bound: false,
      detail: "未聚焦终端",
      label: "当前终端",
      request: {},
    };
  }

  if (focusedPane.mode === "ssh") {
    const remoteHostId = focusedPane.remoteHostId ?? focusedPane.machineId;
    return {
      bound: true,
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
      bound: true,
      detail: focusedPane.containerId ?? focusedPane.title,
      label: "容器",
      request: {
        paneId: focusedPane.id,
        target: "dockerContainer",
      },
    };
  }

  if (focusedPane.mode === "telnet" || focusedPane.mode === "serial") {
    const targetId = focusedPane.remoteHostId ?? focusedPane.machineId;
    return {
      bound: true,
      detail: targetId,
      label: focusedPane.mode === "telnet" ? "Telnet" : "Serial",
      request: {
        paneId: focusedPane.id,
        remoteHostId: targetId,
        target: focusedPane.mode,
      },
    };
  }

  return {
    bound: true,
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
    broadcast: "批量发送",
    snippet: "片段",
    workflow: "工作流",
    tool: "工具",
    user: "用户输入",
  };
  return labels[source];
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
