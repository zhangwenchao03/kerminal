import { RefreshCw } from "lucide-react";

export function RemoteWorkspaceEditorFallback() {
  return (
    <div
      className="kerminal-solid-surface flex h-full min-h-[560px] flex-col overflow-hidden rounded-xl border"
      role="status"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4">
        <RefreshCw className="h-4 w-4 animate-spin text-sky-600 dark:text-sky-300" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            正在加载远程编辑器
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            工作区和 Monaco 依赖会在需要时加载。
          </div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="kerminal-muted-surface hidden border-r border-[var(--border-subtle)] lg:block" />
        <div className="flex min-h-0 items-center justify-center p-6">
          <div className="kerminal-muted-surface h-2 w-36 overflow-hidden rounded-full">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-500/70 dark:bg-sky-300/70" />
          </div>
        </div>
      </div>
    </div>
  );
}
