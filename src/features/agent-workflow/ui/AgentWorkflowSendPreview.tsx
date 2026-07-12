import { AlertTriangle, Clock3, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import type { AgentWorkflowSendPreview as SendPreview } from "../agentWorkflowTypes";
import { createAgentWorkflowPreviewViewModel } from "./agentWorkflowUiModel";

export interface AgentWorkflowSendPreviewPanelProps {
  busy?: boolean;
  now?: () => Date;
  onCancel: (previewId: string) => void;
  onConfirm: (previewId: string) => void;
  preview: SendPreview;
}

const readCurrentTime = () => new Date();

/** 显式发送确认面板；正文仅从瞬时 preview prop 渲染，不写入其它状态或存储。 */
export function AgentWorkflowSendPreviewPanel({
  busy = false,
  now = readCurrentTime,
  onCancel,
  onConfirm,
  preview,
}: AgentWorkflowSendPreviewPanelProps) {
  const [currentTime, setCurrentTime] = useState(now);
  const model = createAgentWorkflowPreviewViewModel(preview, currentTime);

  useEffect(() => {
    setCurrentTime(now());
    const timer = window.setInterval(() => setCurrentTime(now()), 1_000);
    return () => window.clearInterval(timer);
  }, [now, preview.id]);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel(preview.id);
      }
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [busy, onCancel, preview.id]);

  return (
    <section
      aria-labelledby={`${preview.id}-title`}
      className="flex h-full min-h-0 min-w-0 flex-col border-t border-[var(--surface-border)] bg-[var(--surface-solid)] text-zinc-900 dark:text-zinc-100"
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-[var(--surface-border)] px-3 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300">
          <Send aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" id={`${preview.id}-title`}>
            确认发送
          </h3>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {model.sourceLabel} · {model.byteLabel}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
          {model.expiresAtLabel}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {model.warnings.length > 0 ? (
          <div
            className="flex shrink-0 items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200"
            role="status"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>{model.warnings.join("；")}</span>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            发送前需要明确确认
          </div>
        )}

        <pre
          aria-label="待发送正文"
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--surface-border)] bg-[var(--surface-field)] p-3 font-mono text-xs leading-5"
        >
          {preview.text}
        </pre>
      </div>

      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--surface-border)] px-3 py-2.5">
        <Button
          disabled={busy}
          onClick={() => onCancel(preview.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          取消
        </Button>
        <Button
          disabled={busy || model.expired}
          onClick={() => onConfirm(preview.id)}
          size="sm"
          type="button"
          variant="primary"
        >
          {busy ? "处理中" : "确认发送"}
        </Button>
      </footer>
    </section>
  );
}
