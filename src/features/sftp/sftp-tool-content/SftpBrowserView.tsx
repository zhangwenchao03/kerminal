import { Check, Download, FolderOpen, RefreshCw, Upload } from "lucide-react";
import {
  useId,
  useMemo,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/ui/button";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import { cn } from "../../../lib/cn";
import type { SftpEntry, SftpTransferSummary } from "../../../lib/sftpApi";
import { targetStableId, type RemoteTargetRef } from "../../../lib/targetModel";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../../lib/userFacingMessage";
import type { InterfaceDensity } from "../../settings/contracts/index";
import type {
  WorkspaceFileDirtyState,
  WorkspaceFileTab,
} from "../../workspace";
import { FixedRowVirtualList } from "../FixedRowVirtualList";
import { sanitizeSftpTransferSummary } from "../useSftpTransferQueueSync";
import { SftpActionDialog, StatusMessage } from "./SftpActionDialog";
import { SftpBrowserHeader } from "./SftpBrowserHeader";
import { SftpContextMenu } from "./SftpContextMenu";
import { SftpEntryRow } from "./SftpEntryRow";
import { SftpTransferStatusBar } from "./SftpTransferStatusBar";
import { WorkspaceTreeRow } from "../RemoteWorkspaceEditorParts";
import type { SftpBrowserMode } from "./sftpBrowserModeModel";
import {
  treeNodeToSftpEntry,
} from "./sftpWorkspaceTreeModel";
import { SftpWorkspaceOverview } from "./SftpWorkspaceOverview";
import { useSftpUploadMenuPosition } from "./useSftpUploadMenuPosition";
import { useSftpWorkspaceTreeController } from "./useSftpWorkspaceTreeController";
import type {
  RemoteDirectoryListing,
  SftpContextMenuEvent,
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpMenuAction,
  SftpSelectionEvent,
  SftpStatus,
  SftpTransferTarget,
} from "./types";

const sftpUploadMenuItemClassName =
  "kerminal-focus-ring kerminal-pressable flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50";

type SftpBrowserViewProps = {
  browserMode: SftpBrowserMode;
  cancelTransfer: (transferId: string) => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  compactHeader: boolean;
  contextMenu: SftpContextMenuState | null;
  currentPath: string;
  cwdTrackingSetupBusy: boolean;
  dialogAction: SftpDialogAction | null;
  dialogBusy: boolean;
  dialogStatus: SftpStatus | null;
  directoryCount: number;
  downloadSelectedEntries: () => Promise<void>;
  dragDropActive: boolean;
  dropZoneRef: RefObject<HTMLDivElement | null>;
  entries: SftpEntry[];
  error: string | null;
  executeContextMenuAction: (action: SftpMenuAction) => void;
  fileCount: number;
  fileRowHeight: number;
  fileTarget: SftpFileTarget | null;
  finishRemoteEntryDrag: () => void;
  followTerminalDirectory: boolean;
  handleRemoteDownloadDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  handleRemoteDownloadDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  handleRemoteDownloadDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  handleRemoteDownloadDrop: (event: ReactDragEvent<HTMLElement>) => void;
  handleSftpKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  hiddenEntryCount: number;
  hostKeyTrustBusy: boolean;
  interfaceDensity: InterfaceDensity;
  listing: RemoteDirectoryListing | null;
  loadDirectory: (path: string) => Promise<void>;
  loading: boolean;
  normalizedFollowedPath: string | undefined;
  openContextMenu: (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => void;
  openContextMenuFromPress: (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => void;
  openEditorEntry: (entry: SftpEntry) => void;
  openNewDirectoryDialog: () => void;
  operationStatus: SftpStatus | null;
  pathDraft: string;
  remoteDownloadDragActive: boolean;
  remoteDownloadDropActive: boolean;
  remoteDragEntriesRef: MutableRefObject<SftpEntry[]>;
  retryTransfer: (transfer: SftpTransferSummary) => Promise<void>;
  selectEntry: (entry: SftpEntry, event?: SftpSelectionEvent) => void;
  selectedEntries: SftpEntry[];
  selectedEntryPath: string | null;
  selectedEntryPaths: Set<string>;
  setBrowserMode: Dispatch<SetStateAction<SftpBrowserMode>>;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setFollowTerminalDirectory: Dispatch<SetStateAction<boolean>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setPathDraft: Dispatch<SetStateAction<string>>;
  setShowHiddenFiles: Dispatch<SetStateAction<boolean>>;
  setUploadMenuOpen: Dispatch<SetStateAction<boolean>>;
  setupRemoteCwdTracking: () => Promise<void>;
  showHiddenFiles: boolean;
  showLocalTransferActions: boolean;
  showTransferStatusBar: boolean;
  startRemoteEntryDrag: (
    event: ReactDragEvent<HTMLElement>,
    entry: SftpEntry,
  ) => void;
  submitDialogAction: () => Promise<void>;
  submitPathDraft: () => void;
  supportsSftpAdvancedActions: boolean;
  transferableSelectedEntries: SftpEntry[];
  transferSelectedEntriesToTarget: () => Promise<void>;
  transferTarget: SftpTransferTarget | undefined;
  trustHostKey: () => Promise<void>;
  uploadLocalDirectory: (targetRemotePath?: string) => Promise<void>;
  uploadLocalFile: (targetRemotePath?: string) => Promise<void>;
  uploadMenuOpen: boolean;
  uploadMenuRef: RefObject<HTMLDivElement | null>;
  visibleEntries: SftpEntry[];
  visibleTransfers: SftpTransferSummary[];
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
  workspaceFileTabs?: WorkspaceFileTab[];
  workspaceTarget: RemoteTargetRef | null;
};

export function SftpBrowserView({
  browserMode,
  cancelTransfer,
  clearFinishedTransfers,
  compactHeader,
  contextMenu,
  currentPath,
  cwdTrackingSetupBusy,
  dialogAction,
  dialogBusy,
  dialogStatus,
  directoryCount,
  downloadSelectedEntries,
  dragDropActive,
  dropZoneRef,
  entries,
  error,
  executeContextMenuAction,
  fileCount,
  fileRowHeight,
  fileTarget,
  finishRemoteEntryDrag,
  followTerminalDirectory,
  handleRemoteDownloadDragEnter,
  handleRemoteDownloadDragLeave,
  handleRemoteDownloadDragOver,
  handleRemoteDownloadDrop,
  handleSftpKeyDown,
  hiddenEntryCount,
  hostKeyTrustBusy,
  interfaceDensity,
  listing,
  loadDirectory,
  loading,
  normalizedFollowedPath,
  openContextMenu,
  openContextMenuFromPress,
  openEditorEntry,
  openNewDirectoryDialog,
  operationStatus,
  pathDraft,
  remoteDownloadDragActive,
  remoteDownloadDropActive,
  remoteDragEntriesRef,
  retryTransfer,
  selectEntry,
  selectedEntries,
  selectedEntryPath,
  selectedEntryPaths,
  setBrowserMode,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setFollowTerminalDirectory,
  setOperationStatus,
  setPathDraft,
  setShowHiddenFiles,
  setUploadMenuOpen,
  setupRemoteCwdTracking,
  showHiddenFiles,
  showLocalTransferActions,
  showTransferStatusBar,
  startRemoteEntryDrag,
  submitDialogAction,
  submitPathDraft,
  supportsSftpAdvancedActions,
  transferableSelectedEntries,
  transferSelectedEntriesToTarget,
  transferTarget,
  trustHostKey,
  uploadLocalDirectory,
  uploadLocalFile,
  uploadMenuOpen,
  uploadMenuRef,
  visibleEntries,
  visibleTransfers,
  workspaceFileDirtyState = {},
  workspaceFileTabs = [],
  workspaceTarget,
}: SftpBrowserViewProps) {
  const pathInputId = useId();
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const compactChrome = compactHeader || compactDensity;
  const headerPaddingClass = compactChrome
    ? "p-2"
    : spaciousDensity
      ? "p-4"
      : "p-3";
  const pathSurfaceClass = compactChrome
    ? "rounded-[var(--radius-card)] px-2.5 py-2"
    : spaciousDensity
      ? "rounded-[var(--radius-card)] p-4"
      : "rounded-[var(--radius-card)] p-3";
  const bodyPaddingClass = compactChrome
    ? "p-2"
    : spaciousDensity
      ? "p-4"
      : "p-3";
  const listHeaderPaddingClass = compactChrome
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-4 py-2.5"
      : "px-3 py-2";
  const paneHeaderPaddingClass = compactChrome
    ? "px-2.5 py-2"
    : spaciousDensity
      ? "px-4 py-3"
      : "px-3 py-2.5";
  const uploadMenuPosition = useSftpUploadMenuPosition({
    anchorRef: uploadMenuRef,
    open: uploadMenuOpen,
  });
  const {
    openTreePaths,
    toggleTreeDirectory,
    treeStatus,
    visibleTreeRows,
    workspaceTargetKey,
  } = useSftpWorkspaceTreeController({
    browserMode,
    currentPath,
    showHiddenFiles,
    workspaceTarget,
  });
  const openedWorkspaceFileTabs = useMemo(
    () =>
      workspaceFileTabs.filter(
        (tab) => targetStableId(tab.target) === workspaceTargetKey,
      ),
    [workspaceFileTabs, workspaceTargetKey],
  );
  const dirtyWorkspaceFileTabs = useMemo(
    () =>
      openedWorkspaceFileTabs.filter((tab) => workspaceFileDirtyState[tab.id]),
    [openedWorkspaceFileTabs, workspaceFileDirtyState],
  );
  const recentWorkspaceFileTabs = useMemo(
    () => openedWorkspaceFileTabs.slice(-5).reverse(),
    [openedWorkspaceFileTabs],
  );
  const selectedFileEntry = selectedEntries.find(
    (entry) => entry.kind === "file",
  );
  const directoryErrorMessage = error
    ? buildSftpBrowserError(error, {
        detail: "当前目录内容未更新。",
        recoveryAction: supportsSftpAdvancedActions
          ? "检查连接后重试；主机密钥变化时可重新信任。"
          : "检查连接后重试。",
        title: "无法读取远程目录",
      })
    : null;
  const safeDialogStatus =
    dialogStatus?.kind === "error"
      ? {
          kind: "error" as const,
          message: "文件操作未完成。请检查名称、权限或目标位置后重试。",
        }
      : dialogStatus;
  const safeVisibleTransfers = useMemo(
    () => visibleTransfers.map(sanitizeSftpTransferSummary),
    [visibleTransfers],
  );

  if (!fileTarget) {
    return (
      <section
        className={cn(
          "flex h-full min-h-0 flex-col text-sm text-zinc-600 dark:text-zinc-400",
          bodyPaddingClass,
        )}
      >
        <div
          className={cn(
            "kerminal-solid-surface border",
            "rounded-[var(--radius-card)]",
            compactChrome ? "p-3" : "p-4",
          )}
        >
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            SFTP
          </div>
          <h3 className="mt-1 font-semibold text-zinc-950 dark:text-zinc-50">
            远程文件浏览
          </h3>
          <p className="mt-2 leading-6">连接 SSH 主机或容器后显示文件。</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col text-zinc-900 dark:text-zinc-100"
      onKeyDown={handleSftpKeyDown}
    >
      <SftpBrowserHeader
        actions={{
          downloadSelectedEntries,
          openNewDirectoryDialog,
          setOperationStatus,
          setShowHiddenFiles,
          setUploadMenuOpen,
          showHiddenFiles,
          showLocalTransferActions,
          transferableSelectionCount: transferableSelectedEntries.length,
          transferSelectedEntriesToTarget,
          transferTarget,
          uploadMenuOpen,
          uploadMenuRef,
        }}
        chrome={{
          compact: compactChrome,
          headerPaddingClass,
          pathSurfaceClass,
        }}
        follow={{
          busy: cwdTrackingSetupBusy,
          enabled: followTerminalDirectory,
          normalizedPath: normalizedFollowedPath,
          setEnabled: setFollowTerminalDirectory,
          setup: setupRemoteCwdTracking,
          supported: supportsSftpAdvancedActions,
        }}
        navigation={{
          currentPath,
          fileTarget,
          listing,
          loadDirectory,
          loading,
          pathDraft,
          pathInputId,
          setPathDraft,
          submitPathDraft,
        }}
        summary={{
          browserMode,
          entryCount: entries.length,
          selectedCount: selectedEntries.length,
          setBrowserMode,
          visibleEntryCount: visibleEntries.length,
        }}
      />

      <div className={cn("min-h-0 flex-1", bodyPaddingClass)}>
        <div
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border transition",
            !dragDropActive &&
              !remoteDownloadDropActive &&
              "kerminal-solid-surface",
            dragDropActive &&
              "border-sky-400/55 bg-sky-500/10 ring-4 ring-sky-400/15 dark:border-sky-300/45 dark:bg-sky-300/10",
            remoteDownloadDropActive &&
              "border-emerald-400/55 bg-emerald-500/10 ring-4 ring-emerald-400/15 dark:border-emerald-300/45 dark:bg-emerald-300/10",
          )}
          data-testid="sftp-drop-zone"
          ref={dropZoneRef}
          onContextMenu={(event) => openContextMenu(event, null)}
          onDragEnter={handleRemoteDownloadDragEnter}
          onDragLeave={handleRemoteDownloadDragLeave}
          onDragOver={handleRemoteDownloadDragOver}
          onDragEnd={finishRemoteEntryDrag}
          onDrop={handleRemoteDownloadDrop}
          onMouseDown={(event) => openContextMenuFromPress(event, null)}
          onPointerDown={(event) => openContextMenuFromPress(event, null)}
        >
          {remoteDownloadDragActive ? (
            <div className="kerminal-reduced-transparency-surface pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/10 backdrop-blur-[1px]">
              <div className="kerminal-floating-surface flex items-center gap-2 rounded-[var(--radius-card)] border px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-100">
                <Download className="h-4 w-4" />
                {remoteDragEntriesRef.current.length > 1
                  ? `拖到下方列表复制 ${remoteDragEntriesRef.current.length} 项`
                  : "拖到下方列表复制远端项目"}
              </div>
            </div>
          ) : dragDropActive ? (
            <div className="kerminal-reduced-transparency-surface pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-sky-500/10 backdrop-blur-[1px]">
              <div className="kerminal-floating-surface rounded-[var(--radius-card)] border px-4 py-3 text-sm font-medium text-sky-700 dark:text-sky-100">
                释放以上传到 {currentPath}
              </div>
            </div>
          ) : null}
          {browserMode === "list" ? null : (
            <div
              className={cn(
                "flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)]",
                paneHeaderPaddingClass,
              )}
            >
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {browserMode === "tree" ? "目录树" : "文件工作区"}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {directoryCount} 目录 / {fileCount} 文件
                  {!showHiddenFiles && hiddenEntryCount > 0
                    ? ` / 已隐藏 ${hiddenEntryCount}`
                    : ""}
                </div>
              </div>
              {error ? null : (
                <span className="kerminal-muted-surface rounded-lg border px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {listing ? "已连接" : "等待中"}
                </span>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {loading ? (
              <div
                className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                role="status"
              >
                正在读取远程目录...
              </div>
            ) : null}
            {directoryErrorMessage ? (
              <div className="m-3">
                <UserFacingNotice compact message={directoryErrorMessage} />
                {supportsSftpAdvancedActions ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      aria-label="信任 SFTP 主机密钥"
                      className="kerminal-focus-ring kerminal-pressable h-8 rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 text-xs text-rose-700 hover:bg-rose-500/15 dark:border-rose-200/20 dark:text-rose-100 dark:hover:bg-rose-400/15"
                      disabled={hostKeyTrustBusy}
                      onClick={() => void trustHostKey()}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {hostKeyTrustBusy ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      信任主机密钥
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!loading && !error && listing && visibleEntries.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {entries.length === 0
                  ? "当前目录为空。"
                  : "当前筛选下没有可见项目。"}
              </div>
            ) : null}
            {!loading &&
            !error &&
            browserMode === "list" &&
            visibleEntries.length > 0 ? (
              <div className="kerminal-sftp-entry-list flex h-full min-h-0 flex-col">
                <div
                  className={cn(
                    "kerminal-muted-surface kerminal-sftp-entry-grid grid gap-2 border-b text-xs font-medium text-zinc-500 dark:text-zinc-400",
                    listHeaderPaddingClass,
                  )}
                >
                  <span className="pl-6">名称</span>
                  <span className="kerminal-sftp-permissions-column hidden text-right">
                    权限
                  </span>
                  <span className="kerminal-sftp-size-column hidden text-right">
                    大小
                  </span>
                  <span className="text-right" title="修改时间">
                    时间
                  </span>
                </div>
                <FixedRowVirtualList
                  ariaLabel="远程目录项目"
                  entries={visibleEntries}
                  getKey={(entry) => entry.path}
                  itemContainerClassName="divide-y divide-[var(--border-subtle)]"
                  renderItem={(entry) => (
                    <SftpEntryRow
                      contextMenuOpen={contextMenu?.entry?.path === entry.path}
                      entry={entry}
                      onContextMenu={(event) => openContextMenu(event, entry)}
                      onContextMenuMouseDown={(event) =>
                        openContextMenuFromPress(event, entry)
                      }
                      onContextMenuPointerDown={(event) =>
                        openContextMenuFromPress(event, entry)
                      }
                      onDragEnd={finishRemoteEntryDrag}
                      onDragStart={(event) =>
                        startRemoteEntryDrag(event, entry)
                      }
                      onOpenDirectory={loadDirectory}
                      onPreviewFile={() => openEditorEntry(entry)}
                      onSelect={(event) => selectEntry(entry, event)}
                      previewing={false}
                      selected={selectedEntryPaths.has(entry.path)}
                    />
                  )}
                  resetKey={`${fileTarget.kind}:${fileTarget.summary}:${currentPath}:${
                    showHiddenFiles ? "shown" : "hidden"
                  }`}
                  rowHeight={fileRowHeight}
                  testId="sftp-remote-entry-list"
                />
              </div>
            ) : null}
            {!loading && !error && browserMode === "tree" ? (
              <div
                aria-label="SFTP 目录树"
                className="h-full min-h-0 overflow-auto py-1"
                role="tree"
              >
                {treeStatus ? (
                  treeStatus.kind === "error" ? (
                    <UserFacingNotice
                      className="m-3"
                      compact
                      message={buildSftpBrowserError(treeStatus.message, {
                        detail: "目录树保持在上次成功读取的状态。",
                        recoveryAction: "检查连接后重新展开该目录。",
                        title: "无法展开目录",
                      })}
                    />
                  ) : (
                    <StatusMessage className="m-3" status={treeStatus} />
                  )
                ) : null}
                {visibleTreeRows.map(({ depth, node }) => (
                  <WorkspaceTreeRow
                    activePath={selectedEntryPath}
                    depth={depth}
                    isOpen={depth === 0 || openTreePaths.has(node.path)}
                    key={node.path}
                    node={node}
                    onContextMenu={(event, item) =>
                      openContextMenu(
                        event,
                        treeNodeToSftpEntry(item, item.path),
                      )
                    }
                    onContextMenuFromPress={(event, item) =>
                      openContextMenuFromPress(
                        event,
                        treeNodeToSftpEntry(item, item.path),
                      )
                    }
                    onOpenFile={(path) => {
                      const entry = treeNodeToSftpEntry(node, path);
                      selectEntry(entry);
                      openEditorEntry(entry);
                    }}
                    onToggleDirectory={(item) => {
                      selectEntry(treeNodeToSftpEntry(item, item.path));
                      toggleTreeDirectory(item);
                    }}
                  />
                ))}
              </div>
            ) : null}
            {!loading && !error && browserMode === "workspace" ? (
              <SftpWorkspaceOverview
                currentPath={currentPath}
                directoryCount={directoryCount}
                dirtyFileCount={dirtyWorkspaceFileTabs.length}
                fileCount={fileCount}
                openedFileCount={openedWorkspaceFileTabs.length}
                openEditorEntry={openEditorEntry}
                recentFileTabs={recentWorkspaceFileTabs}
                selectEntry={selectEntry}
                selectedFileEntry={selectedFileEntry}
                transferCount={visibleTransfers.length}
                workspaceFileDirtyState={workspaceFileDirtyState}
              />
            ) : null}
          </div>
        </div>
      </div>

      <SftpOperationStatusBar status={operationStatus} />

      {uploadMenuOpen && uploadMenuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="上传菜单"
              className="kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover fixed w-44 overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface-overlay)] p-1.5 text-zinc-900 dark:text-zinc-100"
              data-sftp-upload-menu="true"
              role="menu"
              style={{
                left: uploadMenuPosition.left,
                top: uploadMenuPosition.top,
              }}
            >
              <button
                className={sftpUploadMenuItemClassName}
                onClick={() => {
                  setUploadMenuOpen(false);
                  void uploadLocalFile();
                }}
                role="menuitem"
                type="button"
              >
                <Upload className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-300" />
                <span className="min-w-0 flex-1 truncate">上传文件</span>
              </button>
              <button
                className={sftpUploadMenuItemClassName}
                onClick={() => {
                  setUploadMenuOpen(false);
                  void uploadLocalDirectory();
                }}
                role="menuitem"
                type="button"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-300" />
                <span className="min-w-0 flex-1 truncate">上传文件夹</span>
              </button>
            </div>,
            document.body,
          )
        : null}

      {showTransferStatusBar ? (
        <SftpTransferStatusBar
          onCancel={(transferId) => void cancelTransfer(transferId)}
          onClearCompleted={() => void clearFinishedTransfers()}
          onRetry={(transfer) => void retryTransfer(transfer)}
          transfers={safeVisibleTransfers}
        />
      ) : null}

      <SftpActionDialog
        action={dialogAction}
        busy={dialogBusy}
        currentPath={currentPath}
        onActionChange={(action) => {
          setDialogAction(action);
          setDialogStatus(null);
        }}
        onClose={() => {
          setDialogAction(null);
          setDialogStatus(null);
        }}
        onSubmit={() => void submitDialogAction()}
        status={safeDialogStatus}
      />

      {contextMenu
        ? createPortal(
            <SftpContextMenu
              currentPath={currentPath}
              entry={contextMenu.entry}
              onAction={executeContextMenuAction}
              onClose={() => setContextMenu(null)}
              position={{ x: contextMenu.x, y: contextMenu.y }}
              scope={contextMenu.scope}
              showHiddenFiles={showHiddenFiles}
              supportsAdvancedActions={supportsSftpAdvancedActions}
              transferTargetSide={transferTarget?.side}
            />,
            document.body,
          )
        : null}
    </section>
  );
}


function SftpOperationStatusBar({ status }: { status: SftpStatus | null }) {
  if (!status) {
    return null;
  }

  if (status.kind === "error") {
    const message = buildSftpOperationError(status.message);
    return (
      <div
        aria-label="SFTP 操作状态"
        className="kerminal-material-nav shrink-0 border-t px-3 py-2"
        data-testid="sftp-operation-status"
      >
        <UserFacingNotice
          compact
          message={message}
        />
      </div>
    );
  }

  return (
    <div
      aria-label="SFTP 操作状态"
      className="kerminal-material-nav shrink-0 border-t px-3 py-2"
      data-testid="sftp-operation-status"
    >
      <StatusMessage className="mt-0" status={status} />
    </div>
  );
}

/**
 * 按操作类别提供稳定摘要；原始错误只作为脱敏后的技术详情展示。
 */
function buildSftpOperationError(error: string): UserFacingMessage {
  if (error.startsWith("主机密钥信任失败：")) {
    return buildSftpBrowserError(error, {
      detail: "主机密钥没有更新。",
      recoveryAction: "检查主机密钥文件权限后重试。",
      title: "无法信任主机密钥",
    });
  }
  if (error.startsWith("目录跟随配置失败：")) {
    return buildSftpBrowserError(error, {
      detail: "远端配置没有更新。",
      recoveryAction: "检查远端文件权限或重新连接后重试。",
      title: "无法启用目录跟随",
    });
  }
  if (error.startsWith("拖放上传初始化失败：")) {
    return buildSftpBrowserError(error, {
      detail: "仍可使用上传按钮选择文件或文件夹。",
      recoveryAction: "重新打开 SFTP 面板后重试。",
      title: "暂时无法拖放上传",
    });
  }
  return buildSftpBrowserError(error, {
    detail: "当前操作没有完成。",
    recoveryAction: "检查连接、权限和目标位置后重试。",
    title: "SFTP 操作未完成",
  });
}

function buildSftpBrowserError(
  error: unknown,
  options: {
    detail: string;
    recoveryAction: string;
    title: string;
  },
): UserFacingMessage {
  return buildUserFacingError(error, options);
}
