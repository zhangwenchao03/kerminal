import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  Loader2,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import { SftpTransferQueueRow } from "./SftpTransferQueueRow";
import {
  buildSftpTransferQueuePanelModel,
  formatSftpTransferQueueCounts,
} from "./sftpTransferQueuePanelModel";

export function SftpTransferQueuePanel({
  error,
  onCancel,
  onRetry,
  transfers,
}: {
  error: string | null;
  onCancel: (transferId: string) => void;
  onRetry: (transfer: SftpTransferSummary) => void;
  transfers: SftpTransferSummary[];
}) {
  const historyListId = useId();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const {
    activeCount,
    failedCount,
    hasOverflowHistory,
    hiddenTransferCount,
    historyCount,
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
          <span className="truncate text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {formatSftpTransferQueueCounts({
              activeCount,
              failedCount,
              historyCount,
            })}
          </span>
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
      ) : null}
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
