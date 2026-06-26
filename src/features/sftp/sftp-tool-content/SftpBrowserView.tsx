import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronUp,
  CornerDownRight,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings2,
  Terminal,
  Upload,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useId,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import { cn } from "../../../lib/cn";
import type { SftpEntry, SftpTransferSummary } from "../../../lib/sftpApi";
import type { RemoteTargetRef } from "../../../lib/targetModel";
import type { InterfaceDensity } from "../../settings/settingsModel";
import { FixedRowVirtualList } from "../FixedRowVirtualList";
import { SftpActionDialog, StatusMessage } from "./SftpActionDialog";
import { SftpContextMenu } from "./SftpContextMenu";
import { RemoteWorkspaceEditorFallback } from "./RemoteWorkspaceEditorFallback";
import { SftpEntryRow } from "./SftpEntryRow";
import { SftpTransferStatusBar } from "./SftpTransferStatusBar";
import { ToolbarButton } from "./ToolbarButton";
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
  SftpWorkspaceDialog,
} from "./types";

const LazyRemoteWorkspaceEditor = lazy(async () => {
  const module = await import("../RemoteWorkspaceEditor");
  return { default: module.RemoteWorkspaceEditor };
});

const sftpDividerClassName =
  "mx-1 hidden h-5 w-px bg-[var(--border-subtle)] min-[420px]:block";

const sftpUploadMenuItemClassName =
  "kerminal-focus-ring kerminal-pressable flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50";

type SftpBrowserViewProps = {
  cancelTransfer: (transferId: string) => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  closeWorkspaceDialog: () => void;
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
  openContextMenu: (event: SftpContextMenuEvent, entry: SftpEntry | null) => void;
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
  selectEntry: (entry: SftpEntry, event?: SftpSelectionEvent) => void;
  selectedEntries: SftpEntry[];
  selectedEntryPaths: Set<string>;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setFollowTerminalDirectory: Dispatch<SetStateAction<boolean>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  setPathDraft: Dispatch<SetStateAction<string>>;
  setShowHiddenFiles: Dispatch<SetStateAction<boolean>>;
  setUploadMenuOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceCloseBlocked: Dispatch<SetStateAction<boolean>>;
  setWorkspaceDirty: Dispatch<SetStateAction<boolean>>;
  setWorkspaceExpanded: Dispatch<SetStateAction<boolean>>;
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
  workspaceCloseBlocked: boolean;
  workspaceDialog: SftpWorkspaceDialog | null;
  workspaceDirty: boolean;
  workspaceExpanded: boolean;
  workspaceTarget: RemoteTargetRef | null;
};

export function SftpBrowserView({
  cancelTransfer,
  clearFinishedTransfers,
  closeWorkspaceDialog,
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
  selectEntry,
  selectedEntries,
  selectedEntryPaths,
  setContextMenu,
  setDialogAction,
  setDialogStatus,
  setFollowTerminalDirectory,
  setOperationStatus,
  setPathDraft,
  setShowHiddenFiles,
  setUploadMenuOpen,
  setWorkspaceCloseBlocked,
  setWorkspaceDirty,
  setWorkspaceExpanded,
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
  workspaceCloseBlocked,
  workspaceDialog,
  workspaceDirty,
  workspaceExpanded,
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
    ? "rounded-xl px-2.5 py-2"
    : spaciousDensity
      ? "rounded-2xl p-4"
      : "rounded-2xl p-3";
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
            compactChrome ? "rounded-xl p-3" : "rounded-2xl p-4",
          )}
        >
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            SFTP
          </div>
          <h3 className="mt-1 font-semibold text-zinc-950 dark:text-zinc-50">
            远程文件浏览
          </h3>
          <p className="mt-2 leading-6">
            连接 SSH 主机或容器后显示文件。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col text-zinc-900 dark:text-zinc-100"
      onKeyDown={handleSftpKeyDown}
    >
      <header
        className={cn(
          "kerminal-material-nav shrink-0 border-b",
          headerPaddingClass,
        )}
      >
        <div
          className={cn(
            "kerminal-solid-surface border",
            pathSurfaceClass,
          )}
        >
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitPathDraft();
            }}
          >
            <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {fileTarget.protocol}
            </span>
            <label className="sr-only" htmlFor={pathInputId}>
              当前远程路径
            </label>
            <input
              className={cn(
                "kerminal-field-surface min-w-0 flex-1 rounded-lg border font-mono text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600",
                compactChrome ? "px-1.5 py-1 text-[13px]" : "px-2 py-1 text-sm",
              )}
              id={pathInputId}
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPathDraft(currentPath);
                }
              }}
              spellCheck={false}
              value={pathDraft}
            />
            <Button
              aria-label="跳转远程路径"
              className="kerminal-muted-surface h-8 w-8 rounded-lg border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
              disabled={loading}
              size="sm"
              title="跳转"
              type="submit"
              variant="ghost"
            >
              <CornerDownRight className="h-3.5 w-3.5" />
            </Button>
          </form>
          {!compactChrome ? (
            <div className="mt-2 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {fileTarget.summary}
            </div>
          ) : null}
          {!compactChrome ? (
            <div className="kerminal-muted-surface mt-3 flex items-center gap-2 rounded-xl border px-2 py-1.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-300">
                <Terminal className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                    CWD SYNC
                  </span>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      followTerminalDirectory
                        ? "bg-emerald-400"
                        : "bg-zinc-400 dark:bg-zinc-600",
                    )}
                  />
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {normalizedFollowedPath ?? "waiting for OSC 1337"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {supportsSftpAdvancedActions ? (
                  <Button
                    aria-label="自动设置 SFTP 目录跟随"
                    className="kerminal-focus-ring kerminal-pressable h-7 w-7 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-0 text-emerald-700 hover:border-emerald-500/35 hover:bg-emerald-500/15 hover:text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-300 dark:hover:border-emerald-300/35 dark:hover:bg-emerald-300/15 dark:hover:text-emerald-200"
                    disabled={cwdTrackingSetupBusy}
                    onClick={() => void setupRemoteCwdTracking()}
                    size="sm"
                    title="自动写入远端 shell 配置"
                    type="button"
                    variant="ghost"
                  >
                    <Settings2
                      className={cn(
                        "h-3.5 w-3.5",
                        cwdTrackingSetupBusy && "animate-spin",
                      )}
                    />
                  </Button>
                ) : null}
                <button
                  aria-checked={followTerminalDirectory}
                  aria-label="跟随终端目录"
                  className={cn(
                    "kerminal-focus-ring kerminal-pressable relative h-5 w-9 shrink-0 rounded-full border transition",
                    followTerminalDirectory
                      ? "border-emerald-400/50 bg-emerald-500"
                      : "border-[var(--border-strong)] bg-[var(--surface-muted)]",
                  )}
                  onClick={() =>
                    setFollowTerminalDirectory((current) => !current)
                  }
                  role="switch"
                  type="button"
                >
                  <span
                    className={cn(
                      "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition",
                      followTerminalDirectory ? "left-[1.125rem]" : "left-0.5",
                    )}
                  />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2",
            compactChrome ? "mt-2" : "mt-3",
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <ToolbarButton
              ariaLabel="返回上级目录"
              disabled={!listing?.parentPath || loading}
              icon={<ChevronUp className="h-3.5 w-3.5" />}
              label="上级"
              onClick={() =>
                listing?.parentPath && void loadDirectory(listing.parentPath)
              }
            />
            <ToolbarButton
              ariaLabel="刷新目录"
              disabled={loading}
              icon={
                <RefreshCw
                  className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                />
              }
              label="刷新"
              onClick={() => {
                setOperationStatus(null);
                void loadDirectory(currentPath);
              }}
            />
            <ToolbarButton
              ariaLabel={showHiddenFiles ? "隐藏隐藏文件" : "显示隐藏文件"}
              icon={
                showHiddenFiles ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )
              }
              label={showHiddenFiles ? "隐藏隐藏文件" : "显示隐藏文件"}
              onClick={() => setShowHiddenFiles((current) => !current)}
              pressed={showHiddenFiles}
            />
            <div className={sftpDividerClassName} />
            {showLocalTransferActions ? (
              <div className="relative" ref={uploadMenuRef}>
                <ToolbarButton
                  ariaExpanded={uploadMenuOpen}
                  ariaHaspopup="menu"
                  ariaLabel="上传"
                  icon={<Upload className="h-3.5 w-3.5" />}
                  label="上传"
                  onClick={() => setUploadMenuOpen((current) => !current)}
                  pressed={uploadMenuOpen}
                />
                {uploadMenuOpen ? (
                  <div
                    aria-label="上传菜单"
                    className="kerminal-floating-surface kerminal-floating-enter absolute left-0 top-9 z-40 w-44 overflow-hidden rounded-2xl border p-1.5 text-zinc-900 dark:text-zinc-100"
                    role="menu"
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
                  </div>
                ) : null}
              </div>
            ) : null}
            <ToolbarButton
              ariaLabel="新建目录"
              icon={<FolderPlus className="h-3.5 w-3.5" />}
              label="新建"
              onClick={openNewDirectoryDialog}
            />
            {showLocalTransferActions ? (
              <>
                <div className={sftpDividerClassName} />
                <ToolbarButton
                  ariaLabel="下载选中项目"
                  disabled={transferableSelectedEntries.length === 0}
                  icon={<Download className="h-3.5 w-3.5" />}
                  label={
                    transferableSelectedEntries.length > 1
                      ? `下载 ${transferableSelectedEntries.length} 项`
                      : "下载"
                  }
                  onClick={() => void downloadSelectedEntries()}
                />
              </>
            ) : transferTarget ? (
              <>
                <div className={sftpDividerClassName} />
                <ToolbarButton
                  ariaLabel={
                    transferTarget.side === "right" ? "传到右侧" : "传到左侧"
                  }
                  disabled={transferableSelectedEntries.length === 0}
                  icon={
                    transferTarget.side === "right" ? (
                      <ArrowRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowLeft className="h-3.5 w-3.5" />
                    )
                  }
                  label={
                    transferTarget.side === "right" ? "传到右侧" : "传到左侧"
                  }
                  onClick={() => void transferSelectedEntriesToTarget()}
                />
              </>
            ) : null}
          </div>
          <div className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {loading
              ? "刷新中"
              : `${visibleEntries.length} / ${entries.length} 项${
                  selectedEntries.length > 0
                    ? ` / 已选 ${selectedEntries.length}`
                    : ""
                }`}
          </div>
        </div>
      </header>

      <div className={cn("min-h-0 flex-1", bodyPaddingClass)}>
        <div
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border transition",
            compactChrome && "rounded-xl",
            !dragDropActive && !remoteDownloadDropActive && "kerminal-solid-surface",
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
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/10 backdrop-blur-[1px]">
              <div className="kerminal-floating-surface flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-100">
                <Download className="h-4 w-4" />
                {remoteDragEntriesRef.current.length > 1
                  ? `释放下载 ${remoteDragEntriesRef.current.length} 项`
                  : "释放下载远端项目"}
              </div>
            </div>
          ) : dragDropActive ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-sky-500/10 backdrop-blur-[1px]">
              <div className="kerminal-floating-surface rounded-2xl border px-4 py-3 text-sm font-medium text-sky-700 dark:text-sky-100">
                释放以上传到 {currentPath}
              </div>
            </div>
          ) : null}
          <div
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)]",
              paneHeaderPaddingClass,
            )}
          >
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                远程目录
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

          <div className="min-h-0 flex-1 overflow-hidden">
            {loading ? (
              <div
                className="kerminal-muted-surface m-3 rounded-xl border px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                role="status"
              >
                正在读取远程目录...
              </div>
            ) : null}
            {error ? (
              <div
                className="m-3 rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
                role="alert"
              >
                <div>{error}</div>
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
              <div className="kerminal-muted-surface m-3 rounded-xl border px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {entries.length === 0
                  ? "当前目录为空。"
                  : "当前筛选下没有可见项目。"}
              </div>
            ) : null}
            {!loading && !error && visibleEntries.length > 0 ? (
              <div className="flex h-full min-h-0 flex-col">
                <div
                  className={cn(
                    "kerminal-muted-surface grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2 border-b text-xs font-medium text-zinc-500 dark:text-zinc-400 min-[560px]:grid-cols-[minmax(0,1fr)_4.25rem_5.75rem] min-[720px]:grid-cols-[minmax(0,1fr)_4.75rem_4.25rem_5.75rem]",
                    listHeaderPaddingClass,
                  )}
                >
                  <span className="pl-6">名称</span>
                  <span className="hidden text-right min-[720px]:block">
                    权限
                  </span>
                  <span className="hidden text-right min-[560px]:block">大小</span>
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
                      onDragStart={(event) => startRemoteEntryDrag(event, entry)}
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
          </div>
        </div>
      </div>

      <SftpOperationStatusBar status={operationStatus} />

      {showTransferStatusBar ? (
        <SftpTransferStatusBar
          onCancel={(transferId) => void cancelTransfer(transferId)}
          onClearCompleted={() => void clearFinishedTransfers()}
          transfers={visibleTransfers}
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
        status={dialogStatus}
      />

      <ModalShell
        description={workspaceDialog?.rootPath}
        footer={
          workspaceDirty ? (
            <div className="mr-auto text-xs text-amber-700 dark:text-amber-200">
              {workspaceCloseBlocked
                ? "工作区有未保存修改，确认后可以关闭。"
                : "有未保存修改。"}
            </div>
          ) : null
        }
        headerActions={
          workspaceDialog && supportsSftpAdvancedActions ? (
            <Button
              aria-label={workspaceExpanded ? "还原工作区" : "放大工作区"}
              className="h-8 w-8 rounded-md px-0"
              onClick={() => setWorkspaceExpanded((current) => !current)}
              size="sm"
              title={workspaceExpanded ? "还原工作区" : "放大工作区"}
              type="button"
              variant="ghost"
            >
              {workspaceExpanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : null
        }
        bodyClassName="p-2"
        layout={workspaceExpanded ? "fullscreen" : "workspace"}
        onClose={closeWorkspaceDialog}
        open={Boolean(workspaceDialog)}
        title="远程工作区"
      >
        {workspaceDialog && workspaceTarget ? (
          <Suspense fallback={<RemoteWorkspaceEditorFallback />}>
            <LazyRemoteWorkspaceEditor
              onDirtyStateChange={(dirty) => {
                setWorkspaceDirty(dirty);
                if (!dirty) {
                  setWorkspaceCloseBlocked(false);
                }
              }}
              onOpenDirectory={loadDirectory}
              onStatus={setOperationStatus}
              openCommand={workspaceDialog.openCommand}
              rootPath={workspaceDialog.rootPath}
              target={workspaceTarget}
              variant="workspace"
            />
          </Suspense>
        ) : null}
      </ModalShell>

      {contextMenu
        ? createPortal(
            <SftpContextMenu
              currentPath={currentPath}
              entry={contextMenu.entry}
              onAction={executeContextMenuAction}
              onClose={() => setContextMenu(null)}
              position={{ x: contextMenu.x, y: contextMenu.y }}
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
