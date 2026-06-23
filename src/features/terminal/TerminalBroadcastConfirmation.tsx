import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { BroadcastCommandAnalysis } from "./broadcastCommandPolicy";

export function BroadcastConfirmation({
  analysis,
  disabled,
  onCancel,
  onConfirm,
}: {
  analysis: BroadcastCommandAnalysis;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-label="确认批量发送"
      className="border-b border-amber-300/20 bg-amber-500/10 px-3 py-3"
      role="dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            确认批量发送
          </div>
          <div className="kerminal-muted-surface mt-2 truncate rounded-lg border px-3 py-2 font-mono text-sm text-zinc-900 dark:text-zinc-100">
            {analysis.command}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {analysis.reasons.map((reason) => (
              <span
                className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-100"
                key={reason}
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={disabled}
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            取消
          </Button>
          <Button
            disabled={disabled}
            onClick={onConfirm}
            size="sm"
            variant="primary"
          >
            确认发送
          </Button>
        </div>
      </div>
    </div>
  );
}
