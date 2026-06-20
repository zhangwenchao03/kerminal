import { RefreshCw } from "lucide-react";

export function RemoteWorkspaceEditorFallback() {
  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-xl border border-black/8 bg-white/72 shadow-sm dark:border-white/8 dark:bg-white/[0.04]">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-black/8 px-4 dark:border-white/[0.06]">
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
        <div className="hidden border-r border-black/8 bg-black/[0.015] dark:border-white/[0.06] dark:bg-zinc-950/25 lg:block" />
        <div className="flex min-h-0 items-center justify-center bg-white/45 p-6 dark:bg-zinc-950/20">
          <div className="h-2 w-36 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-500/70 dark:bg-sky-300/70" />
          </div>
        </div>
      </div>
    </div>
  );
}
