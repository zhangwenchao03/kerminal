import { ArrowLeftRight, Box, ChevronsDownUp, ChevronsUpDown, RefreshCw, Search, Server } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { MachineSidebarViewMode } from "./MachineSidebar.shared";

const accentIconButtonClassName =
  "kerminal-pressable h-8 w-8 rounded-lg text-sky-600 hover:bg-[var(--surface-hover)] dark:text-sky-300";
const iconButtonClassName =
  "kerminal-pressable h-8 w-8 rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
const searchInputClassName =
  "kerminal-sidebar-search kerminal-field-surface w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600";

export function MachineSidebarHeader({
  activeView, allGroupsCollapsed, groupCount, groupToggleLabel,
  onRefreshContainers, onSearchChange, onToggleAllGroups,
  onViewChange, onOpenTransferWorkbench, search,
}: {
  activeView: MachineSidebarViewMode;
  allGroupsCollapsed: boolean;
  groupCount: number;
  groupToggleLabel: string;
  onOpenTransferWorkbench?: () => void;
  onRefreshContainers: () => void;
  onSearchChange: (query: string) => void;
  onToggleAllGroups: () => void;
  onViewChange: (view: MachineSidebarViewMode) => void;
  search: string;
}) {
  const GroupToggleIcon = allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp;
  return (
    <div className="kerminal-sidebar-header flex flex-col" data-tauri-drag-region>
      <div className="flex items-center gap-2">
        <div aria-label="左栏视图" className="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-xl border border-[var(--border-subtle)] bg-black/[0.025] p-1 dark:bg-white/[0.045]" role="group">
          <button aria-pressed={activeView === "hosts"} className={cn(
            "kerminal-focus-ring kerminal-pressable flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] dark:text-zinc-400",
            activeView === "hosts" && "bg-[var(--surface-selected)] text-zinc-950 shadow-sm dark:text-zinc-50",
          )} onClick={() => onViewChange("hosts")} type="button"><Server className="h-3.5 w-3.5 shrink-0" /><span className="truncate">主机</span></button>
          <button aria-pressed={activeView === "containers"} className={cn(
            "kerminal-focus-ring kerminal-pressable flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] dark:text-zinc-400",
            activeView === "containers" && "bg-[var(--surface-selected)] text-zinc-950 shadow-sm dark:text-zinc-50",
          )} onClick={() => onViewChange("containers")} type="button"><Box className="h-3.5 w-3.5 shrink-0" /><span className="truncate">容器</span></button>
        </div>
        <div className="flex w-[68px] shrink-0 items-center gap-1">
          <Button aria-label="打开 SFTP 传输工作台" className={accentIconButtonClassName} disabled={!onOpenTransferWorkbench} onClick={onOpenTransferWorkbench} size="icon" title="SFTP 传输" type="button" variant="ghost"><ArrowLeftRight className="h-4 w-4" /></Button>
          {activeView === "hosts" ? (
            <Button aria-label={groupToggleLabel} aria-pressed={allGroupsCollapsed} className={iconButtonClassName} disabled={groupCount === 0} onClick={onToggleAllGroups} size="icon" title={groupToggleLabel} type="button" variant="ghost"><GroupToggleIcon className="h-4 w-4" /></Button>
          ) : (
            <Button aria-label="刷新容器列表" className={iconButtonClassName} onClick={onRefreshContainers} size="icon" title="刷新容器列表" type="button" variant="ghost"><RefreshCw className="h-4 w-4" /></Button>
          )}
        </div>
      </div>
      {activeView === "hosts" && groupCount > 0 ? (
        <label className="relative block">
          <span className="sr-only">搜索主机</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input className={searchInputClassName} onChange={(event) => onSearchChange(event.currentTarget.value)} placeholder="搜索" value={search} />
        </label>
      ) : null}
    </div>
  );
}
