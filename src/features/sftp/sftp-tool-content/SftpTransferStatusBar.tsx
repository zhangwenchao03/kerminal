import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { SftpTransferSummary } from "../../../lib/sftpApi";
import { SftpTransferQueueRow } from "../SftpTransferQueueRow";
import { canClearFinishedTransfers } from "../sftpTransferModel";
import {
  buildSftpTransferQueuePanelModel,
  formatSftpTransferQueueCounts,
  SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT,
} from "../sftpTransferQueuePanelModel";

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
    if (transfers.length <= SFTP_TRANSFER_QUEUE_COLLAPSED_LIMIT) {
      setHistoryExpanded(false);
    }
  }, [transfers.length]);

  if (transfers.length === 0) {
    return null;
  }

  const {
    activeCount,
    failedCount,
    hasOverflowHistory,
    hiddenTransferCount,
    historyCount,
    visibleTransfers,
  } = buildSftpTransferQueuePanelModel({ historyExpanded, transfers });
  const canClear = canClearFinishedTransfers(transfers);
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
              {formatSftpTransferQueueCounts({
                activeCount,
                failedCount,
                historyCount,
              })}
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end">
          {canClear ? (
            <Button
              aria-label="清理完成的传输"
              className="kerminal-muted-surface h-7 w-7 shrink-0 rounded-md border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
              onClick={onClearCompleted}
              size="sm"
              title="清理完成的传输"
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
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
            <SftpTransferQueueRow
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
