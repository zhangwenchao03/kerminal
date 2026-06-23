import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import {
  canCancelTransfer,
  formatTransferBytes,
  transferMethodLabel,
  transferPathSummary,
  transferPercentLabel,
  transferProgressPercent,
  transferStatusClassName,
  transferStatusLabel,
  transferTitle,
} from "./sftpTransferModel";
import { buildSftpTransferQueuePanelModel } from "./sftpTransferQueuePanelModel";

export function SftpTransferQueuePanel({
  error,
  onCancel,
  transfers,
}: {
  error: string | null;
  onCancel: (transferId: string) => void;
  transfers: SftpTransferSummary[];
}) {
  const historyListId = useId();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const {
    activeCount,
    failedCount,
    hasOverflowHistory,
    hiddenTransferCount,
    totalCount,
    visibleTransfers,
  } = buildSftpTransferQueuePanelModel({ historyExpanded, transfers });
  const HistoryToggleIcon = historyExpanded ? ChevronUp : ChevronDown;

  useEffect(() => {
    if (!hasOverflowHistory) {
      setHistoryExpanded(false);
    }
  }, [hasOverflowHistory]);

  return (
    <div className="kerminal-muted-surface shrink-0 border-t border-[var(--border-subtle)]">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          <QueueIcon activeCount={activeCount} error={error} transfers={transfers} />
          <span className="truncate">传输队列</span>
          <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {totalCount} 记录
          </span>
          {activeCount > 0 ? (
            <span className="shrink-0 rounded-full border border-sky-300/35 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-100">
              {activeCount} 活动
            </span>
          ) : null}
          {failedCount > 0 ? (
            <span className="shrink-0 rounded-full border border-rose-300/35 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-700 dark:text-rose-100">
              {failedCount} 失败
            </span>
          ) : null}
        </div>
        {error ? (
          <div className="truncate text-xs text-rose-600 dark:text-rose-300" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      {transfers.length > 0 ? (
        <>
          <div
            id={historyListId}
            aria-label="SFTP 后台传输历史"
            className={cn(
              "scrollbar-thin px-3 pr-2 transition-[max-height]",
              historyExpanded
                ? "max-h-72 overflow-y-auto pb-3"
                : "max-h-44 overflow-hidden pb-2",
            )}
          >
            <div className="space-y-1.5 pr-1">
              {visibleTransfers.map((transfer) => (
                <TransferQueueRow
                  key={transfer.id}
                  onCancel={onCancel}
                  transfer={transfer}
                />
              ))}
            </div>
          </div>
          {hasOverflowHistory ? (
            <div className="px-3 pb-3">
              <Button
                aria-controls={historyListId}
                aria-expanded={historyExpanded}
                aria-label={
                  historyExpanded
                    ? "收起传输历史"
                    : `展开传输历史，查看其余 ${hiddenTransferCount} 项`
                }
                className="kerminal-muted-surface h-8 w-full justify-center gap-1.5 rounded-lg border border-dashed text-xs text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
                onClick={() => setHistoryExpanded((current) => !current)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <HistoryToggleIcon className="h-3.5 w-3.5" />
                {historyExpanded
                  ? "收起历史"
                  : `查看全部历史（还有 ${hiddenTransferCount} 项）`}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="px-4 pb-3 text-xs text-zinc-500 dark:text-zinc-400">
          暂无后台传输任务。
        </div>
      )}
    </div>
  );
}

function TransferQueueRow({
  onCancel,
  transfer,
}: {
  onCancel: (transferId: string) => void;
  transfer: SftpTransferSummary;
}) {
  const progress = transferProgressPercent(transfer);
  const canCancel = canCancelTransfer(transfer);

  return (
    <div className="kerminal-muted-surface rounded-lg border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
                transferStatusClassName(transfer.status),
              )}
            >
              {transferStatusLabel(transfer.status, transfer.phase)}
            </span>
            <span className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-300">
              {transferMethodLabel(transfer)}
            </span>
            <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {transferTitle(transfer)}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {transferPathSummary(transfer)}
          </div>
          {transfer.error ? (
            <div className="mt-1 truncate text-xs text-rose-600 dark:text-rose-300">
              {transfer.error}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {transferPercentLabel(transfer)}
          </span>
          {canCancel ? (
            <Button
              aria-label="取消传输"
              className="h-7 w-7 rounded-lg"
              onClick={() => onCancel(transfer.id)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
        <div
          aria-label="传输进度"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(progress)}
          className={cn(
            "h-full rounded-full transition-all",
            transfer.status === "failed"
              ? "bg-rose-500"
              : transfer.status === "canceled"
                ? "bg-zinc-400"
                : "bg-sky-500",
          )}
          role="progressbar"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {formatTransferBytes(transfer)}
      </div>
    </div>
  );
}

function QueueIcon({
  activeCount,
  error,
  transfers,
}: {
  activeCount: number;
  error: string | null;
  transfers: SftpTransferSummary[];
}) {
  if (error || transfers.some((transfer) => transfer.status === "failed")) {
    return <CircleAlert className="h-4 w-4 text-rose-500" />;
  }
  if (activeCount > 0) {
    return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />;
  }
  if (transfers.some((transfer) => transfer.status === "succeeded")) {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  return <Clock3 className="h-4 w-4 text-zinc-400" />;
}
