import { Download, Upload, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { SftpTransferSummary } from "../../../lib/sftpApi";
import {
  activeTransferCount,
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

export function SftpTransferStatusBar({
  onCancel,
  onClearCompleted,
  transfers,
}: {
  onCancel: (transferId: string) => void;
  onClearCompleted: () => void;
  transfers: SftpTransferSummary[];
}) {
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
  const visibleRows = transfers.slice(0, 4);
  const hiddenCount = transfers.length - visibleRows.length;

  return (
    <div
      aria-label="SFTP 传输状态"
      aria-live="polite"
      className="shrink-0 border-t border-black/8 bg-white/80 px-3 py-2 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/80"
      role="status"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
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
        <span className="shrink-0 rounded-md border border-sky-300/35 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-100">
          {activeCount} 活动
        </span>
        {failedCount > 0 ? (
          <span className="shrink-0 rounded-md border border-rose-300/35 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-100">
            {failedCount} 失败
          </span>
        ) : null}
        {completedCount > 0 && activeCount === 0 ? (
          <Button
            aria-label="清理完成的传输"
            className="h-7 shrink-0 rounded-md px-2 text-xs"
            onClick={onClearCompleted}
            size="sm"
            type="button"
            variant="ghost"
          >
            清理
          </Button>
        ) : null}
      </div>

      <div className="mt-2 space-y-2">
        {visibleRows.map((transfer) => (
          <SftpTransferRow
            key={transfer.id}
            onCancel={onCancel}
            transfer={transfer}
          />
        ))}
      </div>

      {hiddenCount > 0 ? (
        <div className="mt-1 text-right text-[11px] text-zinc-500 dark:text-zinc-400">
          还有 {hiddenCount} 项传输在队列中
        </div>
      ) : null}
    </div>
  );
}

function SftpTransferRow({
  onCancel,
  transfer,
}: {
  onCancel: (transferId: string) => void;
  transfer: SftpTransferSummary;
}) {
  const percent = transferProgressPercent(transfer);
  const percentLabel = transferPercentLabel(transfer);
  const canCancel =
    (transfer.status === "queued" || transfer.status === "running") &&
    !transfer.cancelRequested;
  const Icon = transfer.direction === "upload" ? Upload : Download;
  const title = transferTitle(transfer);

  return (
    <div
      aria-label={`SFTP 传输 ${title}`}
      className="rounded-md border border-black/8 bg-black/[0.025] px-2.5 py-2 dark:border-white/8 dark:bg-black/25"
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
          {transferStatusLabel(transfer.status)}
        </span>
        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
          {percentLabel}
        </span>
        {canCancel ? (
          <Button
            aria-label={`取消传输 ${title}`}
            className="h-6 w-6 shrink-0 rounded-md px-0"
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
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
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
        <span className="shrink-0 font-mono text-[11px] text-zinc-500">
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
    </div>
  );
}
