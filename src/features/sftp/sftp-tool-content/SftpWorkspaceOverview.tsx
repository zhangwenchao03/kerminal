import { PanelRight } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { SftpEntry } from "../../../lib/sftpApi";
import type {
  WorkspaceFileDirtyState,
  WorkspaceFileTab,
} from "../../workspace";
import { workspaceFileTabToSftpEntry } from "./sftpWorkspaceTreeModel";

interface SftpWorkspaceOverviewProps {
  currentPath: string;
  directoryCount: number;
  dirtyFileCount: number;
  fileCount: number;
  openedFileCount: number;
  openEditorEntry: (entry: SftpEntry) => void;
  recentFileTabs: WorkspaceFileTab[];
  selectEntry: (entry: SftpEntry) => void;
  selectedFileEntry: SftpEntry | undefined;
  transferCount: number;
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 展示 SFTP 工作区指标和最近打开文件，并把打开命令转回 Browser controller。 */
export function SftpWorkspaceOverview({
  currentPath,
  directoryCount,
  dirtyFileCount,
  fileCount,
  openedFileCount,
  openEditorEntry,
  recentFileTabs,
  selectEntry,
  selectedFileEntry,
  transferCount,
  workspaceFileDirtyState,
}: SftpWorkspaceOverviewProps) {
  return (
    <div className="grid gap-3 overflow-auto p-3 text-sm">
      <div className="border-b border-[var(--border-subtle)] pb-3">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          当前根目录
        </div>
        <div className="mt-1 truncate font-mono text-zinc-900 dark:text-zinc-100">
          {currentPath}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border bg-[var(--border-subtle)]">
        <WorkspaceMetric label="目录" value={directoryCount} />
        <WorkspaceMetric label="文件" value={fileCount} />
        <WorkspaceMetric label="已打开" value={openedFileCount} />
        <WorkspaceMetric
          label="未保存"
          tone={dirtyFileCount > 0 ? "dirty" : "default"}
          value={dirtyFileCount}
        />
        <WorkspaceMetric label="传输" value={transferCount} />
      </div>
      <div className="border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              最近打开
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              右栏只负责导航和文件操作；文件正文会打开到中间工作区 tab。
            </div>
          </div>
          <span className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            {recentFileTabs.length}
          </span>
        </div>
        {recentFileTabs.length > 0 ? (
          <div className="mt-3 grid gap-1.5" role="list">
            {recentFileTabs.map((tab) => {
              const dirty = Boolean(workspaceFileDirtyState[tab.id]);
              const entry = workspaceFileTabToSftpEntry(tab);
              return (
                <button
                  className="kerminal-focus-ring kerminal-pressable flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200"
                  key={tab.id}
                  onClick={() => {
                    selectEntry(entry);
                    openEditorEntry(entry);
                  }}
                  role="listitem"
                  title={tab.path}
                  type="button"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      dirty ? "bg-amber-400" : "bg-emerald-400/80",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {tab.title}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {tab.path}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            还没有从当前目标打开文件。
          </div>
        )}
      </div>
      <Button
        className="h-8 justify-start rounded-lg px-2 text-xs"
        disabled={!selectedFileEntry}
        onClick={() => selectedFileEntry && openEditorEntry(selectedFileEntry)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PanelRight className="h-3.5 w-3.5" />
        在中间打开选中文件
      </Button>
    </div>
  );
}

function WorkspaceMetric({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "dirty";
  value: number;
}) {
  return (
    <div className="kerminal-solid-surface px-3 py-2">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-semibold",
          tone === "dirty"
            ? "text-amber-700 dark:text-amber-200"
            : "text-zinc-900 dark:text-zinc-50",
        )}
      >
        {value}
      </div>
    </div>
  );
}
