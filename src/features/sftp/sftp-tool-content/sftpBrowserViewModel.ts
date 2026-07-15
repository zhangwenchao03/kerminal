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
import { sanitizeSftpTransferSummary } from "../useSftpTransferQueueSync";
import type { SftpBrowserMode } from "./sftpBrowserModeModel";
import type { SftpTreeRenderRow } from "./sftpWorkspaceTreeModel";
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

/** 路径、浏览模式和终端目录跟随合同。 */
export interface SftpBrowserNavigation {
  browserMode: SftpBrowserMode;
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  followTerminalDirectory: boolean;
  listing: RemoteDirectoryListing | null;
  loadDirectory: (path: string) => Promise<void>;
  loading: boolean;
  normalizedFollowedPath: string | undefined;
  pathDraft: string;
  setBrowserMode: Dispatch<SetStateAction<SftpBrowserMode>>;
  setFollowTerminalDirectory: Dispatch<SetStateAction<boolean>>;
  setPathDraft: Dispatch<SetStateAction<string>>;
  submitPathDraft: () => void;
}

/** 当前目录的可见项目与多选状态合同。 */
export interface SftpBrowserSelection {
  entries: SftpEntry[];
  hiddenEntryCount: number;
  selectEntry: (entry: SftpEntry, event?: SftpSelectionEvent) => void;
  selectedEntries: SftpEntry[];
  selectedEntryPath: string | null;
  selectedEntryPaths: Set<string>;
  setShowHiddenFiles: Dispatch<SetStateAction<boolean>>;
  showHiddenFiles: boolean;
  transferableSelectedEntries: SftpEntry[];
  visibleEntries: SftpEntry[];
}

/** 文件操作、拖放和浏览器级输入命令合同。 */
export interface SftpBrowserOperations {
  downloadSelectedEntries: () => Promise<void>;
  dragDropActive: boolean;
  dropZoneRef: RefObject<HTMLDivElement | null>;
  error: string | null;
  finishRemoteEntryDrag: () => void;
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  handleRemoteDownloadDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  handleRemoteDownloadDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  handleRemoteDownloadDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  handleRemoteDownloadDrop: (event: ReactDragEvent<HTMLElement>) => void;
  openContextMenu: (event: SftpContextMenuEvent, entry: SftpEntry | null) => void;
  openContextMenuFromPress: (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => void;
  openEditorEntry: (entry: SftpEntry) => void;
  openNewDirectoryDialog: () => void;
  operationStatus: SftpStatus | null;
  remoteDownloadDragActive: boolean;
  remoteDownloadDropActive: boolean;
  remoteDragEntriesRef: MutableRefObject<SftpEntry[]>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  startRemoteEntryDrag: (
    event: ReactDragEvent<HTMLElement>,
    entry: SftpEntry,
  ) => void;
}

/** 上传、下载和传输队列合同。 */
export interface SftpBrowserTransfers {
  cancelTransfer: (transferId: string) => Promise<void>;
  clearFinishedTransfers: () => Promise<void>;
  retryTransfer: (transfer: SftpTransferSummary) => Promise<void>;
  setUploadMenuOpen: Dispatch<SetStateAction<boolean>>;
  transferSelectedEntriesToTarget: () => Promise<void>;
  transferTarget: SftpTransferTarget | undefined;
  uploadLocalDirectory: (targetRemotePath?: string) => Promise<void>;
  uploadLocalFile: (targetRemotePath?: string) => Promise<void>;
  uploadMenuOpen: boolean;
  uploadMenuRef: RefObject<HTMLDivElement | null>;
  visibleTransfers: SftpTransferSummary[];
}

/** 模态对话框与上下文菜单合同。 */
export interface SftpBrowserDialogs {
  contextMenu: SftpContextMenuState | null;
  dialogAction: SftpDialogAction | null;
  dialogBusy: boolean;
  dialogStatus: SftpStatus | null;
  executeContextMenuAction: (action: SftpMenuAction) => void;
  setContextMenu: Dispatch<SetStateAction<SftpContextMenuState | null>>;
  setDialogAction: Dispatch<SetStateAction<SftpDialogAction | null>>;
  setDialogStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  submitDialogAction: () => Promise<void>;
}

/** 由当前目标和宿主界面决定的能力合同。 */
export interface SftpBrowserCapabilities {
  compactHeader: boolean;
  cwdTrackingSetupBusy: boolean;
  fileRowHeight: number;
  hostKeyTrustBusy: boolean;
  interfaceDensity: InterfaceDensity;
  setupRemoteCwdTracking: () => Promise<void>;
  showLocalTransferActions: boolean;
  showTransferStatusBar: boolean;
  supportsSftpAdvancedActions: boolean;
  trustHostKey: () => Promise<void>;
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
  workspaceFileTabs?: WorkspaceFileTab[];
  workspaceTarget: RemoteTargetRef | null;
}

/** Presenter 的稳定分组输入，避免 View 重新依赖 controller 内部状态。 */
export interface SftpBrowserPresenterProps {
  capabilities: SftpBrowserCapabilities;
  dialogs: SftpBrowserDialogs;
  navigation: SftpBrowserNavigation;
  operations: SftpBrowserOperations;
  selection: SftpBrowserSelection;
  transfers: SftpBrowserTransfers;
}

/** View 直接消费的脱敏、聚合和布局投影。 */
export interface SftpBrowserViewModel {
  bodyPaddingClass: string;
  compactChrome: boolean;
  directoryCount: number;
  directoryErrorMessage: UserFacingMessage | null;
  dirtyWorkspaceFileCount: number;
  fileCount: number;
  headerPaddingClass: string;
  listHeaderPaddingClass: string;
  openTreePaths: Set<string>;
  openedWorkspaceFileCount: number;
  paneHeaderPaddingClass: string;
  pathInputId: string;
  pathSurfaceClass: string;
  recentWorkspaceFileTabs: WorkspaceFileTab[];
  safeDialogStatus: SftpStatus | null;
  safeVisibleTransfers: SftpTransferSummary[];
  selectedFileEntry: SftpEntry | undefined;
  treeStatus: SftpStatus | null;
  toggleTreeDirectory: ReturnType<
    typeof useSftpWorkspaceTreeController
  >["toggleTreeDirectory"];
  uploadMenuPosition: { left: number; top: number } | null;
  visibleTreeRows: SftpTreeRenderRow[];
}

/** 将 controller 状态投影为不包含业务副作用的稳定浏览器视图模型。 */
export function useSftpBrowserViewModel({
  capabilities,
  dialogs,
  navigation,
  operations,
  selection,
  transfers,
}: SftpBrowserPresenterProps): SftpBrowserViewModel {
  const pathInputId = useId();
  const compactDensity = capabilities.interfaceDensity === "compact";
  const spaciousDensity = capabilities.interfaceDensity === "spacious";
  const compactChrome = capabilities.compactHeader || compactDensity;
  const uploadMenuPosition = useSftpUploadMenuPosition({
    anchorRef: transfers.uploadMenuRef,
    open: transfers.uploadMenuOpen,
  });
  const tree = useSftpWorkspaceTreeController({
    browserMode: navigation.browserMode,
    currentPath: navigation.currentPath,
    showHiddenFiles: selection.showHiddenFiles,
    workspaceTarget: capabilities.workspaceTarget,
  });
  const workspaceFileTabs = capabilities.workspaceFileTabs ?? [];
  const workspaceFileDirtyState = capabilities.workspaceFileDirtyState ?? {};
  const openedWorkspaceFileTabs = useMemo(
    () =>
      workspaceFileTabs.filter(
        (tab) => targetStableId(tab.target) === tree.workspaceTargetKey,
      ),
    [tree.workspaceTargetKey, workspaceFileTabs],
  );
  const dirtyWorkspaceFileCount = useMemo(
    () =>
      openedWorkspaceFileTabs.filter((tab) => workspaceFileDirtyState[tab.id])
        .length,
    [openedWorkspaceFileTabs, workspaceFileDirtyState],
  );
  const recentWorkspaceFileTabs = useMemo(
    () => openedWorkspaceFileTabs.slice(-5).reverse(),
    [openedWorkspaceFileTabs],
  );
  const safeVisibleTransfers = useMemo(
    () => transfers.visibleTransfers.map(sanitizeSftpTransferSummary),
    [transfers.visibleTransfers],
  );
  const directoryCount = selection.visibleEntries.filter(
    (entry) => entry.kind === "directory",
  ).length;

  return {
    bodyPaddingClass: compactChrome ? "p-2" : spaciousDensity ? "p-4" : "p-3",
    compactChrome,
    directoryCount,
    directoryErrorMessage: operations.error
      ? buildSftpBrowserError(operations.error, {
          detail: "当前目录内容未更新。",
          recoveryAction: capabilities.supportsSftpAdvancedActions
            ? "检查连接后重试；主机密钥变化时可重新信任。"
            : "检查连接后重试。",
          title: "无法读取远程目录",
        })
      : null,
    dirtyWorkspaceFileCount,
    fileCount: selection.visibleEntries.length - directoryCount,
    headerPaddingClass: compactChrome ? "p-2" : spaciousDensity ? "p-4" : "p-3",
    listHeaderPaddingClass: compactChrome
      ? "px-2.5 py-1.5"
      : spaciousDensity
        ? "px-4 py-2.5"
        : "px-3 py-2",
    openTreePaths: tree.openTreePaths,
    openedWorkspaceFileCount: openedWorkspaceFileTabs.length,
    paneHeaderPaddingClass: compactChrome
      ? "px-2.5 py-2"
      : spaciousDensity
        ? "px-4 py-3"
        : "px-3 py-2.5",
    pathInputId,
    pathSurfaceClass: compactChrome
      ? "rounded-[var(--radius-card)] px-2.5 py-2"
      : spaciousDensity
        ? "rounded-[var(--radius-card)] p-4"
        : "rounded-[var(--radius-card)] p-3",
    recentWorkspaceFileTabs,
    safeDialogStatus:
      dialogs.dialogStatus?.kind === "error"
        ? {
            kind: "error",
            message: "文件操作未完成。请检查名称、权限或目标位置后重试。",
          }
        : dialogs.dialogStatus,
    safeVisibleTransfers,
    selectedFileEntry: selection.selectedEntries.find(
      (entry) => entry.kind === "file",
    ),
    treeStatus: tree.treeStatus,
    toggleTreeDirectory: tree.toggleTreeDirectory,
    uploadMenuPosition,
    visibleTreeRows: tree.visibleTreeRows,
  };
}

export function buildSftpBrowserError(
  error: unknown,
  options: { detail: string; recoveryAction: string; title: string },
): UserFacingMessage {
  return buildUserFacingError(error, options);
}

/** 按操作类别提供稳定摘要；原始错误只作为脱敏后的技术详情展示。 */
export function buildSftpOperationError(error: string): UserFacingMessage {
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
