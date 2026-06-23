import { AlertTriangle, FileText, RotateCcw } from "lucide-react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Button } from "../../components/ui/button";
import type { TerminalPane } from "../workspace/types";

interface TerminalPaneErrorBoundaryProps {
  children: React.ReactNode;
  onOpenLogs?: () => void;
  pane: TerminalPane;
}

export function TerminalPaneErrorBoundary({
  children,
  onOpenLogs,
  pane,
}: TerminalPaneErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackRender={(props) => (
        <TerminalPaneErrorFallback
          {...props}
          onOpenLogs={onOpenLogs}
          pane={pane}
        />
      )}
      resetKeys={[pane.id]}
    >
      {children}
    </ErrorBoundary>
  );
}

function TerminalPaneErrorFallback({
  error,
  onOpenLogs,
  pane,
  resetErrorBoundary,
}: FallbackProps & {
  onOpenLogs?: () => void;
  pane: TerminalPane;
}) {
  return (
    <section
      aria-label={`${pane.title} 终端分屏异常`}
      className="flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-2xl border border-rose-300/25 bg-rose-50 p-4 text-rose-950 shadow-sm dark:border-rose-300/20 dark:bg-rose-950/30 dark:text-rose-50"
    >
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4" />
          终端分屏渲染异常
        </div>
        <p className="mt-2 text-sm leading-6 text-rose-800 dark:text-rose-100/85">
          {pane.title} 的前端渲染已被隔离，其他终端和工具仍可继续使用。可以重新挂载该分屏，或打开日志查看最近诊断信息。
        </p>
        <dl className="mt-4 space-y-2 rounded-xl border border-rose-300/20 bg-[rgb(255_255_255_/_0.55)] p-3 text-xs dark:bg-[rgb(0_0_0_/_0.2)]">
          <div className="grid grid-cols-[4rem_1fr] gap-2">
            <dt className="text-rose-700/75 dark:text-rose-100/65">分屏</dt>
            <dd className="truncate font-medium">{pane.title}</dd>
          </div>
          <div className="grid grid-cols-[4rem_1fr] gap-2">
            <dt className="text-rose-700/75 dark:text-rose-100/65">模式</dt>
            <dd>
              {pane.mode === "ssh"
                ? "SSH"
                : pane.mode === "container"
                  ? "容器"
                  : pane.mode === "local"
                    ? "本地"
                    : "预览"}
            </dd>
          </div>
          <div className="grid grid-cols-[4rem_1fr] gap-2">
            <dt className="text-rose-700/75 dark:text-rose-100/65">错误</dt>
            <dd className="break-words font-mono">
              {error instanceof Error ? error.message : String(error)}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={resetErrorBoundary} size="sm" variant="secondary">
          <RotateCcw className="h-4 w-4" />
          重新挂载
        </Button>
        <Button disabled={!onOpenLogs} onClick={onOpenLogs} size="sm" variant="ghost">
          <FileText className="h-4 w-4" />
          打开日志
        </Button>
      </div>
    </section>
  );
}
