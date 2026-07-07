import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronUp,
  CornerDownRight,
  Download,
  Eye,
  EyeOff,
  FolderTree,
  FolderOpen,
  FolderPlus,
  List,
  PanelRight,
  RefreshCw,
  Settings2,
  Terminal,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { SftpEntry, SftpTransferSummary } from "../../../lib/sftpApi";
import { targetStableId, type RemoteTargetRef } from "../../../lib/targetModel";
import type { InterfaceDensity } from "../../settings/settingsModel";
import type {
  WorkspaceFileDirtyState,
  WorkspaceFileTab,
} from "../../workspace/types";
import { FixedRowVirtualList } from "../FixedRowVirtualList";
import { SftpActionDialog, StatusMessage } from "./SftpActionDialog";
import { SftpContextMenu } from "./SftpContextMenu";
import { SftpEntryRow } from "./SftpEntryRow";
import { SftpTransferStatusBar } from "./SftpTransferStatusBar";
import { ToolbarButton } from "./ToolbarButton";
import { WorkspaceTreeRow } from "../RemoteWorkspaceEditorParts";
import { listRemoteWorkspaceDirectory } from "../remoteWorkspaceEditorTransport";
import {
  createRootNode,
  entryToTreeNode,
  errorMessage,
  normalizeRemotePath as normalizeWorkspaceRemotePath,
  updateTreeNode,
  type WorkspaceTreeNode,
} from "../remoteWorkspaceEditorModel";
import type { SftpBrowserMode } from "./sftpBrowserModeModel";
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

const sftpDividerClassName =
  "mx-1 hidden h-5 w-px bg-[var(--border-subtle)] min-[420px]:block";

const sftpUploadMenuItemClassName =
  "kerminal-focus-ring kerminal-pressable flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50";

const SFTP_UPLOAD_MENU_WIDTH = 176;
const SFTP_UPLOAD_MENU_VIEWPORT_GAP = 8;

type SftpUploadMenuPosition = {
  left: number;
  top: number;
};

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
  const [uploadMenuPosition, setUploadMenuPosition] =
    useState<SftpUploadMenuPosition | null>(null);
  const treeRootPath = useMemo(
    () => normalizeWorkspaceRemotePath(currentPath),
    [currentPath],
  );
  const workspaceTargetKey = workspaceTarget
    ? targetStableId(workspaceTarget)
    : "none";
  const treeScopeKey = `${workspaceTargetKey}|${treeRootPath}`;
  const treeScopeKeyRef = useRef(treeScopeKey);
  const [treeNodes, setTreeNodes] = useState<WorkspaceTreeNode[]>(() => [
    createRootNode(treeRootPath),
  ]);
  const [openTreePaths, setOpenTreePaths] = useState<Set<string>>(
    () => new Set([treeRootPath]),
  );
  const [treeStatus, setTreeStatus] = useState<SftpStatus | null>(null);
  const loadTreeChildren = useCallback(
    async (path: string, replaceRoot = false) => {
      const normalizedPath = normalizeWorkspaceRemotePath(path);
      setTreeStatus(null);
      setOpenTreePaths((current) => {
        if (current.has(normalizedPath)) {
          return current;
        }
        const next = new Set(current);
        next.add(normalizedPath);
        return next;
      });
      setTreeNodes((current) =>
        replaceRoot
          ? [{ ...createRootNode(normalizedPath), loading: true }]
          : updateTreeNode(current, normalizedPath, (node) => ({
              ...node,
              error: null,
              loading: true,
            })),
      );

      try {
        const listing = await listRemoteWorkspaceDirectory(
          workspaceTarget,
          normalizedPath,
        );
        const children = directTreeChildren(
          listing.entries,
          normalizedPath,
        ).map(entryToTreeNode);
        setTreeNodes((current) =>
          replaceRoot
            ? [
                {
                  ...createRootNode(normalizedPath),
                  children,
                  loaded: true,
                  loading: false,
                },
              ]
            : updateTreeNode(current, normalizedPath, (node) => ({
                ...node,
                children,
                error: null,
                loaded: true,
                loading: false,
              })),
        );
      } catch (error) {
        const message = errorMessage(error);
        setTreeStatus({ kind: "error", message });
        setTreeNodes((current) =>
          replaceRoot
            ? [
                {
                  ...createRootNode(normalizedPath),
                  error: message,
                  loaded: false,
                  loading: false,
                },
              ]
            : updateTreeNode(current, normalizedPath, (node) => ({
                ...node,
                error: message,
                loading: false,
              })),
        );
      }
    },
    [workspaceTarget],
  );
  const toggleTreeDirectory = useCallback(
    (node: WorkspaceTreeNode) => {
      const opening = !openTreePaths.has(node.path);
      setOpenTreePaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      if (opening && (!node.loaded || node.error) && !node.loading) {
        void loadTreeChildren(node.path);
      }
    },
    [loadTreeChildren, openTreePaths],
  );
  const visibleTreeRows = useMemo(
    () => flattenWorkspaceTreeRows(treeNodes, openTreePaths),
    [openTreePaths, treeNodes],
  );
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

  useEffect(() => {
    if (treeScopeKeyRef.current === treeScopeKey) {
      return;
    }
    treeScopeKeyRef.current = treeScopeKey;
    setOpenTreePaths(new Set([treeRootPath]));
    setTreeNodes([createRootNode(treeRootPath)]);
    setTreeStatus(null);
  }, [treeRootPath, treeScopeKey]);

  useEffect(() => {
    if (browserMode !== "tree" || !workspaceTarget) {
      return;
    }
    const rootNode = treeNodes[0];
    if (!rootNode || rootNode.path !== treeRootPath) {
      void loadTreeChildren(treeRootPath, true);
      return;
    }
    if (!rootNode.loaded && !rootNode.loading) {
      void loadTreeChildren(treeRootPath, true);
    }
  }, [browserMode, loadTreeChildren, treeNodes, treeRootPath, workspaceTarget]);
  const updateUploadMenuPosition = useCallback(() => {
    if (!uploadMenuOpen || typeof window === "undefined") {
      return;
    }
    const anchor = uploadMenuRef.current;
    if (!anchor) {
      setUploadMenuPosition(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || rect.left + SFTP_UPLOAD_MENU_WIDTH;
    const maxLeft =
      viewportWidth - SFTP_UPLOAD_MENU_WIDTH - SFTP_UPLOAD_MENU_VIEWPORT_GAP;
    setUploadMenuPosition({
      left: Math.max(
        SFTP_UPLOAD_MENU_VIEWPORT_GAP,
        Math.min(rect.left, maxLeft),
      ),
      top: rect.bottom + 4,
    });
  }, [uploadMenuOpen, uploadMenuRef]);

  useLayoutEffect(() => {
    if (!uploadMenuOpen || typeof window === "undefined") {
      setUploadMenuPosition(null);
      return undefined;
    }
    updateUploadMenuPosition();
    window.addEventListener("resize", updateUploadMenuPosition);
    window.addEventListener("scroll", updateUploadMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateUploadMenuPosition);
      window.removeEventListener("scroll", updateUploadMenuPosition, true);
    };
  }, [updateUploadMenuPosition, uploadMenuOpen]);

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
      <header
        className={cn(
          "kerminal-material-nav relative z-30 shrink-0 border-b",
          headerPaddingClass,
        )}
      >
        <div className={cn("kerminal-solid-surface border", pathSurfaceClass)}>
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
          <div className="flex shrink-0 items-center gap-2">
            <div className="max-w-40 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {loading
                ? "刷新中"
                : `${visibleEntries.length} / ${entries.length} 项${
                    selectedEntries.length > 0
                      ? ` / 已选 ${selectedEntries.length}`
                      : ""
                  }`}
            </div>
            <SftpBrowserModeToggle
              mode={browserMode}
              onModeChange={setBrowserMode}
            />
          </div>
        </div>
      </header>

      <div className={cn("min-h-0 flex-1", bodyPaddingClass)}>
        <div
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border transition",
            compactChrome && "rounded-xl",
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
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/10 backdrop-blur-[1px]">
              <div className="kerminal-floating-surface flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-100">
                <Download className="h-4 w-4" />
                {remoteDragEntriesRef.current.length > 1
                  ? `拖到下方列表复制 ${remoteDragEntriesRef.current.length} 项`
                  : "拖到下方列表复制远端项目"}
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
                {browserMode === "tree"
                  ? "目录树"
                  : browserMode === "workspace"
                    ? "文件工作区"
                    : "远程目录"}
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
                  <StatusMessage className="m-3" status={treeStatus} />
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
              <div className="grid gap-3 overflow-auto p-3 text-sm">
                <div className="kerminal-muted-surface rounded-xl border px-3 py-3">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    当前根目录
                  </div>
                  <div className="mt-1 truncate font-mono text-zinc-900 dark:text-zinc-100">
                    {currentPath}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SftpWorkspaceMetric label="目录" value={directoryCount} />
                  <SftpWorkspaceMetric label="文件" value={fileCount} />
                  <SftpWorkspaceMetric
                    label="已打开"
                    value={openedWorkspaceFileTabs.length}
                  />
                  <SftpWorkspaceMetric
                    label="未保存"
                    tone={
                      dirtyWorkspaceFileTabs.length > 0 ? "dirty" : "default"
                    }
                    value={dirtyWorkspaceFileTabs.length}
                  />
                  <SftpWorkspaceMetric
                    label="传输"
                    value={visibleTransfers.length}
                  />
                </div>
                <div className="kerminal-muted-surface rounded-xl border px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        最近打开
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        右栏只负责导航和文件操作；文件正文会打开到中间工作区
                        tab。
                      </div>
                    </div>
                    <span className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      {recentWorkspaceFileTabs.length}
                    </span>
                  </div>
                  {recentWorkspaceFileTabs.length > 0 ? (
                    <div className="mt-3 grid gap-1.5" role="list">
                      {recentWorkspaceFileTabs.map((tab) => {
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
                  onClick={() => {
                    if (selectedFileEntry) {
                      openEditorEntry(selectedFileEntry);
                    }
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                  在中间打开选中文件
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SftpOperationStatusBar status={operationStatus} />

      {uploadMenuOpen && uploadMenuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="上传菜单"
              className="kerminal-floating-surface kerminal-floating-enter fixed z-[1000] w-44 overflow-hidden rounded-2xl border bg-[var(--surface-overlay)] p-1.5 text-zinc-900 shadow-2xl shadow-black/20 dark:text-zinc-100"
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

function SftpBrowserModeToggle({
  mode,
  onModeChange,
}: {
  mode: SftpBrowserMode;
  onModeChange: Dispatch<SetStateAction<SftpBrowserMode>>;
}) {
  const items: Array<{
    icon: ReactNode;
    id: SftpBrowserMode;
    label: string;
  }> = [
    { icon: <List className="h-3.5 w-3.5" />, id: "list", label: "列表模式" },
    {
      icon: <FolderTree className="h-3.5 w-3.5" />,
      id: "tree",
      label: "树形模式",
    },
    {
      icon: <PanelRight className="h-3.5 w-3.5" />,
      id: "workspace",
      label: "工作区模式",
    },
  ];

  return (
    <div
      aria-label="SFTP 浏览模式"
      className="kerminal-muted-surface flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
      role="group"
    >
      {items.map((item) => (
        <button
          aria-label={item.label}
          aria-pressed={mode === item.id}
          className={cn(
            "kerminal-focus-ring flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50",
            mode === item.id &&
              "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100",
          )}
          data-testid={`sftp-browser-mode-${item.id}`}
          key={item.id}
          onClick={() => onModeChange(item.id)}
          title={item.label}
          type="button"
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}

function SftpWorkspaceMetric({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "dirty";
  value: number;
}) {
  return (
    <div className="kerminal-muted-surface rounded-xl border px-3 py-2">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
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

type SftpTreeRenderRow = {
  depth: number;
  node: WorkspaceTreeNode;
};

function flattenWorkspaceTreeRows(
  nodes: WorkspaceTreeNode[],
  openPaths: Set<string>,
  depth = 0,
): SftpTreeRenderRow[] {
  return nodes.flatMap((node) => {
    const row = { depth, node };
    const isRootRow = depth === 0;
    if (
      node.kind !== "directory" ||
      (!isRootRow && !openPaths.has(node.path)) ||
      !node.children?.length
    ) {
      return [row];
    }
    return [
      row,
      ...flattenWorkspaceTreeRows(node.children, openPaths, depth + 1),
    ];
  });
}

function directTreeChildren(
  entries: SftpEntry[],
  parentPath: string,
): SftpEntry[] {
  const normalizedParentPath = normalizeWorkspaceRemotePath(parentPath);
  const seenPaths = new Set<string>();
  return entries.filter((entry) => {
    const normalizedEntryPath = normalizeWorkspaceRemotePath(entry.path);
    if (seenPaths.has(normalizedEntryPath)) {
      return false;
    }
    seenPaths.add(normalizedEntryPath);
    return parentPathForTreeEntry(normalizedEntryPath) === normalizedParentPath;
  });
}

function parentPathForTreeEntry(path: string): string | null {
  const normalizedPath = normalizeWorkspaceRemotePath(path);
  if (normalizedPath === "/") {
    return null;
  }
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return "/";
  }
  return normalizedPath.slice(0, lastSlashIndex);
}

function treeNodeToSftpEntry(node: WorkspaceTreeNode, path: string): SftpEntry {
  return {
    kind: node.kind,
    modified: node.modified,
    name: node.name,
    path,
    permissions: node.permissions,
    raw: node.name,
    size: node.size,
  };
}

function workspaceFileTabToSftpEntry(tab: WorkspaceFileTab): SftpEntry {
  return {
    kind: "file",
    name: basenameFromPath(tab.path) || tab.title,
    path: tab.path,
    raw: tab.title,
  };
}

function basenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : normalized;
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
