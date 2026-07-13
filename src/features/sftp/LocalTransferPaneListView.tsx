/**
 * 本地传输面板的目录列表视图。
 *
 * @author kongweiguang
 */

import type { MouseEvent as ReactMouseEvent } from "react";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import type { LocalDirectoryEntry, LocalDirectoryListing } from "../../lib/fileDialogApi";
import { buildUserFacingError } from "../../lib/userFacingMessage";
import { FixedRowVirtualList } from "./FixedRowVirtualList";
import { LocalDirectoryEntryRow } from "./LocalDirectoryEntryRow";
import type { LocalDirectoryEntryFilter } from "./localTransferPaneModel";

export function LocalTransferPaneListView({
  bodyPaddingClass,
  compactDensity,
  entryFilter,
  error,
  fileRowHeight,
  listHeaderPaddingClass,
  listing,
  loading,
  onLoadDirectory,
  onOpenContextMenu,
  onOpenFile,
  onSelectEntry,
  selectedEntries,
  selectedEntryPaths,
  showHiddenEntries,
  visibleEntries,
}: {
  bodyPaddingClass: string;
  compactDensity: boolean;
  entryFilter: LocalDirectoryEntryFilter;
  error: string | null;
  fileRowHeight: number;
  listHeaderPaddingClass: string;
  listing: LocalDirectoryListing | null;
  loading: boolean;
  onLoadDirectory: (path: string) => Promise<void>;
  onOpenContextMenu: (
    event: ReactMouseEvent,
    entry: LocalDirectoryEntry | null,
  ) => void;
  onOpenFile?: (entry: LocalDirectoryEntry) => void;
  onSelectEntry: (
    entry: LocalDirectoryEntry,
    event: ReactMouseEvent,
  ) => void;
  selectedEntries: LocalDirectoryEntry[];
  selectedEntryPaths: Set<string>;
  showHiddenEntries: boolean;
  visibleEntries: LocalDirectoryEntry[];
}) {
  return (
    <div className={cn("min-h-0 flex-1", bodyPaddingClass)}>
      <div
        className={cn(
          "kerminal-solid-surface relative flex h-full min-h-0 flex-col overflow-hidden border transition",
          compactDensity
            ? "rounded-[var(--radius-control)]"
            : "rounded-[var(--radius-card)]",
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div
              className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
              role="status"
            >
              正在读取本地目录...
            </div>
          ) : null}
          {error ? (
            <UserFacingNotice
              className="m-3"
              compact
              message={buildUserFacingError(error, {
                detail: "本地目录内容可能尚未更新。",
                recoveryAction: "请检查路径、权限或文件占用后重试。",
                title: "本地文件操作未完成",
              })}
            />
          ) : null}
          {!loading && !error && listing && visibleEntries.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              当前视图没有可显示项目。
            </div>
          ) : null}
          {!loading && !error && visibleEntries.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col">
              <div
                className={cn(
                  "kerminal-muted-surface grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2 border-b text-xs font-medium text-zinc-500 dark:text-zinc-400 min-[560px]:grid-cols-[minmax(0,1fr)_4.25rem_5.75rem]",
                  listHeaderPaddingClass,
                )}
              >
                <span className="pl-6">名称</span>
                <span className="hidden text-right min-[560px]:block">大小</span>
                <span className="text-right" title="修改时间">
                  时间
                </span>
              </div>
              <FixedRowVirtualList
                ariaLabel="本地目录项目"
                entries={visibleEntries}
                getKey={(entry) => entry.path}
                itemContainerClassName="divide-y divide-[var(--border-subtle)]"
                renderItem={(entry) => (
                  <LocalDirectoryEntryRow
                    dragEntries={
                      selectedEntryPaths.has(entry.path) && selectedEntries.length > 0
                        ? selectedEntries
                        : [entry]
                    }
                    entry={entry}
                    selected={selectedEntryPaths.has(entry.path)}
                    onOpenDirectory={onLoadDirectory}
                    onOpenContextMenu={onOpenContextMenu}
                    onOpenFile={onOpenFile}
                    onSelect={onSelectEntry}
                  />
                )}
                resetKey={`${listing?.path ?? ""}:${
                  showHiddenEntries ? "shown" : "hidden"
                }:${entryFilter}`}
                rowHeight={fileRowHeight}
                testId="sftp-local-entry-list"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
