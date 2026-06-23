import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import { cn } from "../../../lib/cn";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import {
  compactId,
  formatHistoryDate,
  formatHistoryTime,
} from "./aiToolContentModel";
import type {
  AiConversationHistoryFilter,
  AiConversationHistoryRow,
} from "./useAiConversationHistoryList";

interface TargetRef {
  kind?: string;
  machineId?: string;
  machineName?: string;
  paneId?: string;
  paneTitle?: string;
  tabId?: string;
  tabTitle?: string;
}

export function AiConversationHistoryDialog({
  activeConversationId,
  canFilterCurrentHost,
  canNextPage,
  canPreviousPage,
  currentSlot,
  error,
  filter,
  loading,
  onClose,
  onDelete,
  onFilterChange,
  onNextPage,
  onPreviousPage,
  onQueryChange,
  onSelect,
  open,
  page,
  query,
  rows,
  usingRemoteRows,
}: {
  activeConversationId: string;
  canFilterCurrentHost: boolean;
  canNextPage: boolean;
  canPreviousPage: boolean;
  currentSlot: AiConversationSlotDescriptor;
  error?: string | null;
  filter: AiConversationHistoryFilter;
  loading?: boolean;
  onClose: () => void;
  onDelete: (conversationId: string) => void;
  onFilterChange: (filter: AiConversationHistoryFilter) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (conversationId: string, row: AiConversationHistoryRow) => void;
  open: boolean;
  page: number;
  query: string;
  rows: AiConversationHistoryRow[];
  usingRemoteRows?: boolean;
}) {
  const currentTarget = parseTargetRef(currentSlot.targetRefJson);
  const errorRole = rows.length > 0 ? "status" : "alert";

  return (
    <ModalShell
      bodyClassName="flex min-h-0 flex-col gap-3 p-0"
      description="搜索、筛选并继续当前工作区里的 AI 会话"
      maxWidthClassName="max-w-4xl"
      onClose={onClose}
      open={open}
      size="large"
      title="历史会话"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
            <input
              aria-label="搜索历史会话"
              className="kerminal-field-surface h-10 w-full rounded-xl border px-9 pr-9 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="搜索标题、内容、模型、附件或目标"
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label="清空历史搜索"
                className="kerminal-focus-ring kerminal-pressable absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-zinc-400 hover:bg-[var(--surface-hover)] hover:text-zinc-700 dark:hover:text-zinc-200"
                onClick={() => onQueryChange("")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <div
            aria-label="历史会话筛选"
            className="inline-flex shrink-0 items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-1"
            role="group"
          >
            <HistoryFilterButton
              active={filter === "all"}
              label="全部"
              onClick={() => onFilterChange("all")}
            />
            <HistoryFilterButton
              active={filter === "currentTarget"}
              label="当前目标"
              onClick={() => onFilterChange("currentTarget")}
            />
            <HistoryFilterButton
              active={filter === "currentHost"}
              disabled={!canFilterCurrentHost}
              label="当前主机"
              onClick={() => onFilterChange("currentHost")}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {loading ? "正在加载历史会话..." : `当前显示 ${rows.length} 条`}
            {usingRemoteRows ? " · 后端分页" : " · 本地缓存"}
          </span>
          <span className="truncate">
            当前槽位 {currentSlot.slotKey}
            {currentTarget.machineName ? ` · ${currentTarget.machineName}` : ""}
          </span>
        </div>

        {error ? (
          <div
            className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100"
            role={errorRole}
          >
            后端历史加载失败，已显示本地已加载会话：{error}
          </div>
        ) : null}

        <div className="kerminal-scrollbar min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-subtle)]">
          {loading && rows.length === 0 ? <HistoryLoadingState /> : null}
          {!loading && rows.length === 0 ? (
            <HistoryEmptyState label="暂无历史会话" />
          ) : null}
          {rows.length > 0 ? (
            <table className="min-w-full table-fixed text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="w-[34%] px-3 py-2">会话</th>
                  <th className="w-[28%] px-3 py-2">目标</th>
                  <th className="w-[18%] px-3 py-2">更新时间</th>
                  <th className="w-[10%] px-3 py-2">内容</th>
                  <th className="w-[10%] px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {rows.map((row) => {
                  const active = row.id === activeConversationId;
                  const providerModelLabel = conversationProviderModelLabel(row);
                  return (
                    <tr
                      className={cn(
                        "transition hover:bg-[var(--surface-hover)]",
                        active && "bg-[var(--surface-selected)]",
                      )}
                      key={row.id}
                    >
                      <td className="min-w-0 px-3 py-2">
                        <button
                          aria-current={active ? "true" : undefined}
                          className="kerminal-focus-ring block min-w-0 rounded-lg text-left"
                          onClick={() => onSelect(row.id, row)}
                          type="button"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                              {row.title}
                            </span>
                            <HistoryStatusPill status={row.status} />
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {compactId(row.id)}
                            {active ? " · 当前对话" : ""}
                          </span>
                          {providerModelLabel ? (
                            <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {providerModelLabel}
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td className="min-w-0 px-3 py-2">
                        <span className="block truncate text-zinc-700 dark:text-zinc-200">
                          {conversationTargetLabel(row)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {conversationScopeLabel(row)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1 text-zinc-700 dark:text-zinc-200">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatHistoryTime(row.updatedAt)}
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                          {formatHistoryDate(row.updatedAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {row.messageCount} 消息
                        {row.attachmentCount > 0
                          ? ` · ${row.attachmentCount} 附件`
                          : ""}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={`继续会话 ${row.title}`}
                            className="h-8 px-2"
                            onClick={() => onSelect(row.id, row)}
                            size="sm"
                            type="button"
                            variant={active ? "secondary" : "ghost"}
                          >
                            继续
                          </Button>
                          <Button
                            aria-label={`删除对话 ${row.title}`}
                            className="h-8 w-8 rounded-lg"
                            onClick={() => onDelete(row.id)}
                            size="icon"
                            title={`删除对话 ${row.title}`}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            第 {page} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              disabled={!canPreviousPage || loading}
              onClick={onPreviousPage}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <Button
              disabled={!canNextPage || loading}
              onClick={onNextPage}
              size="sm"
              type="button"
              variant="ghost"
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function HistoryFilterButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "kerminal-focus-ring kerminal-pressable h-7 rounded-lg px-2.5 text-xs font-medium",
        active
          ? "bg-[var(--surface-selected)] text-zinc-950 dark:text-zinc-50"
          : "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
        disabled && "cursor-not-allowed opacity-45",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function HistoryEmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-52 place-items-center px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
      <div>
        <History className="mx-auto mb-2 h-5 w-5 text-zinc-400 dark:text-zinc-500" />
        {label}
      </div>
    </div>
  );
}

function HistoryLoadingState() {
  return (
    <div className="grid min-h-52 place-items-center px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
      <div>
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-zinc-400 dark:text-zinc-500" />
        正在加载历史会话
      </div>
    </div>
  );
}

function HistoryStatusPill({ status }: { status?: string | null }) {
  const meta = historyStatusMeta(status);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] leading-4",
        meta.className,
      )}
      title={meta.label}
    >
      {meta.label}
    </span>
  );
}

function historyStatusMeta(status?: string | null) {
  if (status === "running") {
    return {
      className:
        "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-100",
      label: "运行中",
    };
  }
  if (status === "waiting") {
    return {
      className:
        "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-100",
      label: "待确认",
    };
  }
  if (status === "failed") {
    return {
      className:
        "border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-100",
      label: "失败",
    };
  }
  if (status?.trim()) {
    return {
      className:
        "border-zinc-400/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
      label: status.trim(),
    };
  }
  return {
    className:
      "border-zinc-400/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    label: "空闲",
  };
}

function parseTargetRef(value: string): TargetRef {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return {
      kind: textValue(parsed.kind),
      machineId: textValue(parsed.machineId),
      machineName: textValue(parsed.machineName),
      paneId: textValue(parsed.paneId),
      paneTitle: textValue(parsed.paneTitle),
      tabId: textValue(parsed.tabId),
      tabTitle: textValue(parsed.tabTitle),
    };
  } catch {
    return {};
  }
}

function conversationTargetLabel(conversation: AiConversationHistoryRow) {
  const target = parseTargetRef(conversation.scopeRefJson ?? "");
  if (target.paneTitle) {
    return target.machineName
      ? `${target.paneTitle} · ${target.machineName}`
      : target.paneTitle;
  }
  if (target.tabTitle) {
    return target.machineName
      ? `${target.tabTitle} · ${target.machineName}`
      : target.tabTitle;
  }
  if (target.machineName) {
    return target.machineName;
  }
  if (conversation.targetKey) {
    return conversation.targetKey;
  }
  if (conversation.hostId) {
    return conversation.hostId;
  }
  if (conversation.paneId) {
    return conversation.paneId;
  }
  if (conversation.scopeKind === "noContext") {
    return "普通 AI 会话";
  }
  return "未标记目标";
}

function conversationScopeLabel(conversation: AiConversationHistoryRow) {
  const labels: Record<string, string> = {
    followFocus: "跟随焦点",
    lockedHost: "主机会话",
    lockedPane: "窗格会话",
    noContext: "普通会话",
    workspaceTask: "工作区任务",
  };
  return conversation.scopeKind ? labels[conversation.scopeKind] : "旧版本地历史";
}

function conversationProviderModelLabel(conversation: AiConversationHistoryRow) {
  return [conversation.providerLabel ?? conversation.providerId, conversation.model]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
