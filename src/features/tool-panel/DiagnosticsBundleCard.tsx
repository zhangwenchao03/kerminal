import { ShieldCheck, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  createDiagnosticsBundle,
  type DiagnosticBundle,
} from "../../lib/diagnosticsApi";

export interface DiagnosticsBundleController {
  actionLabel: string;
  bundle: DiagnosticBundle | null;
  creating: boolean;
  createBundle: () => Promise<void>;
  dismissNotice: () => void;
  error: string | null;
  noticeVisible: boolean;
}

export function useDiagnosticsBundleController(): DiagnosticsBundleController {
  const [bundle, setBundle] = useState<DiagnosticBundle | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);

  const createBundle = async () => {
    setNoticeVisible(true);
    setCreating(true);
    setError(null);
    setBundle(null);
    try {
      setBundle(await createDiagnosticsBundle());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCreating(false);
    }
  };
  const dismissNotice = () => setNoticeVisible(false);

  const actionLabel = creating
    ? "正在导出日志"
    : error
      ? "重试导出日志"
      : bundle
        ? "重新导出日志"
        : "导出日志";

  return {
    actionLabel,
    bundle,
    creating,
    createBundle,
    dismissNotice,
    error,
    noticeVisible,
  };
}

export function DiagnosticsBundleCard() {
  const controller = useDiagnosticsBundleController();

  return (
    <section aria-label="日志导出" className="space-y-2">
      <DiagnosticsBundleButton controller={controller} />
      <DiagnosticsBundleNotice controller={controller} />
    </section>
  );
}

export function DiagnosticsBundleButton({
  controller,
}: {
  controller: DiagnosticsBundleController;
}) {
  const tooltipId = useId();

  return (
    <div className="diagnostics-bundle-action relative inline-flex justify-end">
      <Button
        aria-describedby={tooltipId}
        aria-label={controller.actionLabel}
        disabled={controller.creating}
        onClick={() => void controller.createBundle()}
        size="icon"
        title={controller.actionLabel}
        variant="ghost"
      >
        <ShieldCheck className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
      </Button>
      <span
        className="diagnostics-bundle-tooltip kerminal-solid-surface pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium text-zinc-700 shadow-lg shadow-black/10 transition-opacity dark:text-zinc-100"
        id={tooltipId}
        role="tooltip"
      >
        {controller.actionLabel}
      </span>
    </div>
  );
}

export function DiagnosticsBundleNotice({
  controller,
}: {
  controller: DiagnosticsBundleController;
}) {
  const { bundle, creating, dismissNotice, error, noticeVisible } = controller;

  if (!noticeVisible) {
    return null;
  }

  return (
    <>
      {creating ? (
        <div
          className="rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-100"
          role="status"
        >
          正在整理日志...
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-100"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              日志导出失败，请稍后重试；详细信息已写入应用日志。
            </div>
            <DiagnosticsBundleNoticeCloseButton onClick={dismissNotice} />
          </div>
        </div>
      ) : null}

      {bundle ? (
        <div
          aria-label="日志导出结果"
          className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-800 dark:text-emerald-100"
          role="status"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">日志已导出：{bundle.fileName}</div>
              <div className="mt-1">
                保存位置：
                <span className="break-all font-mono">{bundle.path}</span>
              </div>
              <div className="mt-1 text-emerald-700/80 dark:text-emerald-100/75">
                大小 {formatBytes(bundle.bytesWritten)} · 包含{" "}
                {bundle.sections.length} 类信息
              </div>
            </div>
            <DiagnosticsBundleNoticeCloseButton onClick={dismissNotice} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function DiagnosticsBundleNoticeCloseButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      aria-label="关闭日志导出提示"
      className="kerminal-focus-ring kerminal-pressable shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-50"
      onClick={onClick}
      title="关闭日志导出提示"
      type="button"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
