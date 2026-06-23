/**
 * 本机目录列表的类型筛选控件。
 *
 * @author kongweiguang
 */

import { cn } from "../../lib/cn";
import type {
  LocalDirectoryEntryFilter,
  localDirectorySummary,
} from "./localTransferPaneModel";

type LocalDirectorySummary = ReturnType<typeof localDirectorySummary>;

const filterOptions = [
  { filter: "all", label: "全部" },
  { filter: "files", label: "文件" },
  { filter: "directories", label: "目录" },
] as const satisfies ReadonlyArray<{
  filter: LocalDirectoryEntryFilter;
  label: string;
}>;

export function LocalDirectoryFilterTabs({
  filter,
  onChange,
  summary,
}: {
  filter: LocalDirectoryEntryFilter;
  onChange: (filter: LocalDirectoryEntryFilter) => void;
  summary: LocalDirectorySummary;
}) {
  return (
    <div
      aria-label="本地列表筛选"
      className="kerminal-muted-surface flex max-w-full shrink-0 overflow-x-auto rounded-lg border border-[var(--border-subtle)] p-0.5"
      role="group"
    >
      {filterOptions.map((option) => {
        const count = localDirectoryFilterCount(option.filter, summary);
        const active = option.filter === filter;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] dark:text-zinc-400",
              active &&
                "bg-[var(--surface-selected)] text-zinc-900 dark:text-zinc-100",
            )}
            key={option.filter}
            onClick={() => onChange(option.filter)}
            title={`${option.label}: ${count}`}
            type="button"
          >
            <span>{option.label}</span>
            <span className="font-mono text-[10px] opacity-75">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function localDirectoryFilterCount(
  filter: LocalDirectoryEntryFilter,
  summary: LocalDirectorySummary,
) {
  if (filter === "files") {
    return summary.fileCount;
  }
  if (filter === "directories") {
    return summary.directoryCount;
  }
  return summary.totalCount;
}
