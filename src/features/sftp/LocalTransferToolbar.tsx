/**
 * 本地传输面板工具栏。
 *
 * @author kongweiguang
 */

import {
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { LocalDirectoryListing } from "../../lib/fileDialogApi";
import { LocalDirectoryFilterTabs } from "./LocalDirectoryFilterTabs";
import type {
  LocalDirectoryEntryFilter,
  localDirectorySummary,
} from "./localTransferPaneModel";
import { ToolbarButton } from "./sftp-tool-content/ToolbarButton";

type LocalDirectorySummary = ReturnType<typeof localDirectorySummary>;

const localDividerClassName =
  "mx-1 hidden h-5 w-px bg-[var(--border-subtle)] min-[420px]:block";

export function LocalTransferToolbar({
  directorySummary,
  entryFilter,
  listing,
  loading,
  onCreateDirectory,
  onEntryFilterChange,
  onLoadDirectory,
  onOpenCurrentDirectory,
  onToggleHiddenEntries,
  showHiddenEntries,
}: {
  directorySummary: LocalDirectorySummary;
  entryFilter: LocalDirectoryEntryFilter;
  listing: LocalDirectoryListing | null;
  loading: boolean;
  onCreateDirectory: () => void;
  onEntryFilterChange: (filter: LocalDirectoryEntryFilter) => void;
  onLoadDirectory: (path?: string | null) => Promise<void>;
  onOpenCurrentDirectory: () => void;
  onToggleHiddenEntries: () => void;
  showHiddenEntries: boolean;
}) {
  const hiddenToggleLabel = showHiddenEntries ? "隐藏隐藏项目" : "显示隐藏项目";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ToolbarButton
          ariaLabel="上级"
          disabled={!listing?.parentPath || loading}
          icon={<ChevronUp className="h-3.5 w-3.5" />}
          label="上级"
          onClick={() => listing?.parentPath && void onLoadDirectory(listing.parentPath)}
        />
        <ToolbarButton
          ariaLabel="刷新"
          disabled={!listing || loading}
          icon={
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          }
          label="刷新"
          onClick={() => void onLoadDirectory(listing?.path ?? null)}
        />
        <ToolbarButton
          ariaLabel={hiddenToggleLabel}
          disabled={!listing}
          icon={
            showHiddenEntries ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )
          }
          label={hiddenToggleLabel}
          onClick={onToggleHiddenEntries}
          pressed={showHiddenEntries}
        />
        <div className={localDividerClassName} />
        <ToolbarButton
          ariaLabel="打开"
          disabled={!listing}
          icon={<ExternalLink className="h-3.5 w-3.5" />}
          label="打开"
          onClick={onOpenCurrentDirectory}
        />
        <ToolbarButton
          ariaLabel="新建"
          disabled={!listing || loading}
          icon={<FolderPlus className="h-3.5 w-3.5" />}
          label="新建"
          onClick={onCreateDirectory}
        />
      </div>
      <div className="flex min-w-0 basis-full items-center justify-between gap-2 min-[860px]:ml-auto min-[860px]:basis-auto min-[860px]:justify-end">
        <LocalDirectoryFilterTabs
          filter={entryFilter}
          onChange={onEntryFilterChange}
          summary={directorySummary}
        />
        <div aria-live="polite" className="sr-only">
          {loading ? "读取中" : directorySummary.label}
        </div>
      </div>
    </div>
  );
}
