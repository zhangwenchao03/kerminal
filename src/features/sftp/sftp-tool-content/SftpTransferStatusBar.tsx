import {
  ChevronDown,
  ChevronUp,
  Download,
  ListChecks,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { SftpTransferSummary } from "../../../lib/sftpApi";
import {
  activeTransferCount,
  canCancelTransfer,
  canClearFinishedTransfers,
  formatTransferBytes,
  isFinishedTransfer,
  transferPathSummary,
  transferPercentLabel,
  transferProgressPercent,
  transferStatusClassName,
  transferStatusLabel,
  transferStatusSummary,
  transferTitle,
} from "../sftpTransferModel";
import { resolveSftpTransferRetry } from "../sftpTransferRetryPolicy";

const COLLAPSED_TRANSFER_LIMIT = 3;

export function SftpTransferStatusBar({
  onCancel,
  onClearCompleted,
  onRetry,
  transfers,
}: {
  onCancel: (transferId: string) => void;
  onClearCompleted: () => void;
  onRetry: (transfer: SftpTransferSummary) => void;
  transfers: SftpTransferSummary[];
}) {
  const historyListId = useId();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    if (transfers.length <= COLLAPSED_TRANSFER_LIMIT) {
      setHistoryExpanded(false);
    }
  }, [transfers.length]);

  if (transfers.length === 0) {
    return null;
  }

  const activeCount = activeTransferCount(transfers);
  const completedCount = transfers.filter(isFinishedTransfer).length;
  const failedCount = transfers.filter(
    (transfer) => transfer.status === "failed",
  ).length;
  const primaryTransfer =
    transfers.find((transfer) => transfer.status === "running") ??
    transfers.find((transfer) => transfer.status === "queued") ??
    transfers.find((transfer) => transfer.status === "failed") ??
    transfers[0];
  const canClear = canClearFinishedTransfers(transfers);
  const hasOverflowHistory = transfers.length > COLLAPSED_TRANSFER_LIMIT;
  const hiddenTransferCount = Math.max(
    0,
    transfers.length - COLLAPSED_TRANSFER_LIMIT,
  );
  const visibleTransfers =
    hasOverflowHistory && !historyExpanded
      ? transfers.slice(0, COLLAPSED_TRANSFER_LIMIT)
      : transfers;
  const HistoryToggleIcon = historyExpanded ? ChevronUp : ChevronDown;

  return (
    <div
      aria-label="SFTP 传输状态"
      aria-live="polite"
      className="kerminal-material-nav shrink-0 border-t px-3 py-2.5"
      role="status"
    >
      <div className="flex min-w-0 flex-wrap items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sky-300/35 bg-sky-500/10 text-sky-600 dark:text-sky-200">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-[12rem] flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              SFTP 传输队列
            </span>
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {transferStatusSummary({
                activeCount,
                completedCount,
                failedCount,
                transfer: primaryTransfer,
                totalCount: transfers.length,
              })}
            </span>
          </div>
        </div>
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span className="shrink-0 rounded-md border border-zinc-300/45 bg-zinc-500/10 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
            {transfers.length} 记录
          </span>
          <span className="shrink-0 rounded-md border border-sky-300/35 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-100">
            {activeCount} 活动
          </span>
          {failedCount > 0 ? (
            <span className="shrink-0 rounded-md border border-rose-300/35 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-100">
              {failedCount} 失败
            </span>
          ) : null}
          {canClear ? (
            <Button
              aria-label="清理完成的传输"
              className="kerminal-muted-surface h-7 shrink-0 gap-1 rounded-md border px-2 text-xs text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
              onClick={onClearCompleted}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              清理
            </Button>
          ) : null}
        </div>
      </div>

      <div
        id={historyListId}
        aria-label="SFTP 传输历史列表"
        className={cn(
          "scrollbar-thin mt-2 pr-1 transition-[max-height]",
          historyExpanded
            ? "max-h-72 overflow-y-auto"
            : "max-h-[15rem] overflow-hidden",
        )}
      >
        <div className="space-y-1.5">
          {visibleTransfers.map((transfer) => (
            <SftpTransferRow
              key={transfer.id}
              onCancel={onCancel}
              onRetry={onRetry}
              transfer={transfer}
            />
          ))}
        </div>
      </div>
      {hasOverflowHistory ? (
        <Button
          aria-controls={historyListId}
          aria-expanded={historyExpanded}
          aria-label={
            historyExpanded
              ? "收起传输历史"
              : `展开传输历史，查看其余 ${hiddenTransferCount} 项`
          }
          className="kerminal-muted-surface mt-2 h-8 w-full justify-center gap-1.5 rounded-md border border-dashed px-2 text-xs text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
          onClick={() => setHistoryExpanded((current) => !current)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HistoryToggleIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {historyExpanded
            ? "收起历史"
            : `查看全部历史（还有 ${hiddenTransferCount} 项）`}
        </Button>
      ) : null}
    </div>
  );
}

function SftpTransferRow({
  onCancel,
  onRetry,
  transfer,
}: {
  onCancel: (transferId: string) => void;
  onRetry: (transfer: SftpTransferSummary) => void;
  transfer: SftpTransferSummary;
}) {
  const percent = transferProgressPercent(transfer);
  const percentLabel = transferPercentLabel(transfer);
  const canCancel = canCancelTransfer(transfer);
  const retryDecision =
    transfer.status === "failed" || transfer.status === "canceled"
      ? resolveSftpTransferRetry(transfer)
      : null;
  const showRetryUnavailable =
    retryDecision &&
    !retryDecision.canRetry &&
    transfer.transportMode === "singleHostSftp";
  const Icon = transfer.direction === "upload" ? Upload : Download;
  const title = transferTitle(transfer);

  return (
    <div
      aria-label={`SFTP 传输 ${title}`}
      className="kerminal-muted-surface rounded-md border px-2.5 py-1.5"
      role="group"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            transfer.status === "failed"
              ? "text-rose-500 dark:text-rose-300"
              : transfer.status === "succeeded"
                ? "text-emerald-500 dark:text-emerald-300"
                : "text-sky-500 dark:text-sky-300",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]",
            transferStatusClassName(transfer.status),
          )}
        >
          {transferStatusLabel(transfer.status, transfer.phase)}
        </span>
        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
          {percentLabel}
        </span>
        {retryDecision?.canRetry ? (
          <Button
            aria-label={`重试传输 ${title}`}
            className="kerminal-muted-surface h-6 w-6 shrink-0 rounded-md border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
            onClick={() => onRetry(transfer)}
            size="sm"
            title="重新加入传输队列；将优先尝试断点续传"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            aria-label={`取消传输 ${title}`}
            className="kerminal-muted-surface h-6 w-6 shrink-0 rounded-md border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
            onClick={() => onCancel(transfer.id)}
            size="sm"
            title="取消传输"
            type="button"
            variant="ghost"
          >
            <X className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div
          aria-label={`传输进度 ${title}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)]"
          role="progressbar"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              transfer.status === "failed"
                ? "bg-rose-500"
                : transfer.status === "canceled"
                  ? "bg-zinc-400"
                  : transfer.status === "succeeded"
                    ? "bg-emerald-500"
                    : "bg-sky-500",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {formatTransferBytes(transfer)}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {transferPathSummary(transfer)}
      </div>
      {transfer.error ? (
        <div className="mt-1 truncate text-[11px] text-rose-600 dark:text-rose-300">
          {transfer.error}
        </div>
      ) : null}
      {showRetryUnavailable ? (
        <div className="mt-1 truncate text-[11px] text-amber-700 dark:text-amber-200">
          不能安全重试：{retryDecision.statusMessage}
        </div>
      ) : null}
    </div>
  );
}
