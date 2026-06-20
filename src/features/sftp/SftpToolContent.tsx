import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listDockerContainerDirectory } from "../../lib/containerFilesApi";
import {
  listSftpDirectory,
  listSftpTransfers,
  trustSftpHostKey,
  type SftpEntry,
  type SftpTransferSummary,
} from "../../lib/sftpApi";
import { executeSshCommand } from "../../lib/sshCommandApi";
import type { Machine } from "../workspace/types";
import { sortTransfers, upsertTransfer } from "./sftpTransferModel";
import { SftpBrowserView } from "./sftp-tool-content/SftpBrowserView";
import { useSftpTransferActions } from "./sftp-tool-content/useSftpTransferActions";
import { useSftpDialogActions } from "./sftp-tool-content/useSftpDialogActions";
import { buildSftpCwdTrackingSetupScript } from "./sftp-tool-content/sftpCwdTrackingScript";
import {
  clampContextMenuPosition,
  detachedWorkspaceLabel,
  detachedWorkspaceUrl,
  isRunningInTauriWebview,
} from "./sftp-tool-content/sftpDragDropModel";
import {
  isHiddenEntry,
  transferKindFromEntry,
} from "./sftp-tool-content/sftpEntryModel";
import {
  fileTargetToRemoteTarget,
  normalizeDirectoryListing,
  resolveFileTarget,
} from "./sftp-tool-content/sftpFileTargetModel";
import {
  errorMessage,
  isFollowableRemotePath,
  normalizeRemotePath,
  parentRemotePath,
} from "./sftp-tool-content/sftpPathModel";
import { nextSelectedEntryPaths } from "./sftp-tool-content/sftpSelectionModel";
import type {
  RemoteDirectoryListing,
  SftpClipboard,
  SftpContextMenuEvent,
  SftpContextMenuState,
  SftpDialogAction,
  SftpMenuAction,
  SftpSelectionEvent,
  SftpStatus,
  SftpTransferTarget,
  SftpWorkspaceDialog,
} from "./sftp-tool-content/types";
import {
  SFTP_TRANSFER_UPDATED_EVENT,
  TRANSIENT_ERROR_STATUS_MS,
} from "./sftp-tool-content/types";

export type { SftpClipboard, SftpClipboardEntry } from "./sftp-tool-content/types";

export function SftpToolContent({
  active = true,
  compactHeader = false,
  followedRemotePath,
  onCurrentPathChange,
  onSftpClipboardChange,
  selectedMachine,
  showLocalTransferActions = true,
  showTransferStatusBar = true,
  sftpClipboard: controlledSftpClipboard,
  transferTarget,
}: {
  active?: boolean;
  compactHeader?: boolean;
  followedRemotePath?: string;
  onCurrentPathChange?: (path: string) => void;
  onSftpClipboardChange?: (clipboard: SftpClipboard | null) => void;
  selectedMachine?: Machine;
  showLocalTransferActions?: boolean;
  showTransferStatusBar?: boolean;
  sftpClipboard?: SftpClipboard | null;
  transferTarget?: SftpTransferTarget;
}) {
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState("/");
  const [showHiddenFiles, setShowHiddenFiles] = useState(true);
  const [followTerminalDirectory, setFollowTerminalDirectory] = useState(false);
  const [cwdTrackingSetupBusy, setCwdTrackingSetupBusy] = useState(false);
  const [hostKeyTrustBusy, setHostKeyTrustBusy] = useState(false);
  const [operationStatus, setOperationStatus] = useState<SftpStatus | null>(
    null,
  );
  const [dialogAction, setDialogAction] = useState<SftpDialogAction | null>(
    null,
  );
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogStatus, setDialogStatus] = useState<SftpStatus | null>(null);
  const [contextMenu, setContextMenu] = useState<SftpContextMenuState | null>(null);
  const [workspaceDialog, setWorkspaceDialog] =
    useState<SftpWorkspaceDialog | null>(null);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceCloseBlocked, setWorkspaceCloseBlocked] = useState(false);
  const [workspacePopoutBusy, setWorkspacePopoutBusy] = useState(false);
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(
    null,
  );
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uncontrolledSftpClipboard, setUncontrolledSftpClipboard] =
    useState<SftpClipboard | null>(null);
  const [dragDropActive, setDragDropActive] = useState(false);
  const [remoteDownloadDragActive, setRemoteDownloadDragActive] =
    useState(false);
  const [remoteDownloadDropActive, setRemoteDownloadDropActive] =
    useState(false);
  const lastAutoFollowedPathRef = useRef<string | undefined>(undefined);
  const completedTransferIdsRef = useRef(new Set<string>());
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const remoteDragEntriesRef = useRef<SftpEntry[]>([]);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const fileTarget = useMemo(
    () => resolveFileTarget(selectedMachine),
    [selectedMachine],
  );
  const workspaceTarget = useMemo(
    () => fileTargetToRemoteTarget(fileTarget),
    [fileTarget],
  );
  const supportsSftpAdvancedActions = fileTarget?.kind === "ssh";
  const sftpClipboard =
    controlledSftpClipboard !== undefined
      ? controlledSftpClipboard
      : uncontrolledSftpClipboard;
  const setSftpClipboard = useCallback(
    (clipboard: SftpClipboard | null) => {
      if (onSftpClipboardChange) {
        onSftpClipboardChange(clipboard);
        return;
      }
      setUncontrolledSftpClipboard(clipboard);
    },
    [onSftpClipboardChange],
  );

  const currentPath = listing?.path ?? "/";
  const followedPath = followedRemotePath?.trim();
  const normalizedFollowedPath = isFollowableRemotePath(followedPath)
    ? normalizeRemotePath(followedPath)
    : undefined;
  const entries = listing?.entries ?? [];
  const visibleEntries = useMemo(
    () =>
      showHiddenFiles
        ? entries
        : entries.filter((entry) => !isHiddenEntry(entry)),
    [entries, showHiddenFiles],
  );
  const hiddenEntryCount = entries.length - visibleEntries.length;
  const directoryCount = visibleEntries.filter(
    (entry) => entry.kind === "directory",
  ).length;
  const fileCount = visibleEntries.length - directoryCount;
  const selectedEntries = useMemo(
    () => visibleEntries.filter((entry) => selectedEntryPaths.has(entry.path)),
    [selectedEntryPaths, visibleEntries],
  );
  const transferableSelectedEntries = useMemo(
    () => selectedEntries.filter((entry) => transferKindFromEntry(entry)),
    [selectedEntries],
  );
  const visibleTransfers = useMemo(
    () =>
      fileTarget?.kind === "ssh"
        ? transfers.filter((transfer) => transfer.hostId === fileTarget.hostId)
        : [],
    [fileTarget, transfers],
  );

  useEffect(() => {
    onCurrentPathChange?.(currentPath);
  }, [currentPath, onCurrentPathChange]);

  useEffect(() => {
    if (!operationStatus || operationStatus.kind !== "error") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setOperationStatus((current) =>
        current === operationStatus ? null : current,
      );
    }, TRANSIENT_ERROR_STATUS_MS);

    return () => window.clearTimeout(timeoutId);
  }, [operationStatus]);

  useEffect(() => {
    if (!uploadMenuOpen) {
      return undefined;
    }

    const closeUploadMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        uploadMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setUploadMenuOpen(false);
    };

    window.addEventListener("pointerdown", closeUploadMenu);
    return () => window.removeEventListener("pointerdown", closeUploadMenu);
  }, [uploadMenuOpen]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!active) {
        return;
      }
      if (!fileTarget) {
        setListing(null);
        return;
      }

      const nextPath = normalizeRemotePath(path);
      setLoading(true);
      setError(null);
      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
      setSelectedEntryPath(null);
      setSelectedEntryPaths(new Set());
      try {
        const nextListing =
          fileTarget.kind === "ssh"
            ? await listSftpDirectory({
                hostId: fileTarget.hostId,
                path: nextPath,
              })
            : await listDockerContainerDirectory({
                containerId: fileTarget.containerId,
                hostId: fileTarget.hostId,
                path: nextPath,
                runtime: fileTarget.runtime,
              });
        setListing(normalizeDirectoryListing(nextListing));
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : String(nextError);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [active, fileTarget],
  );

  useEffect(() => {
    setListing(null);
    setError(null);
    setOperationStatus(null);
    setDialogAction(null);
    setDialogStatus(null);
    setContextMenu(null);
    lastAutoFollowedPathRef.current = undefined;
    setWorkspaceDialog(null);
    setWorkspaceDirty(false);
    setWorkspaceCloseBlocked(false);
    setSelectedEntryPath(null);
    setSelectedEntryPaths(new Set());
    setDragDropActive(false);
    setRemoteDownloadDragActive(false);
    setRemoteDownloadDropActive(false);
    remoteDragEntriesRef.current = [];
    setHostKeyTrustBusy(false);
    setTransfers([]);
    completedTransferIdsRef.current.clear();
    if (fileTarget) {
      void loadDirectory(fileTarget.initialPath);
    }
  }, [fileTarget, loadDirectory]);

  const refreshTransfers = useCallback(async () => {
    if (!active || !fileTarget || fileTarget.kind !== "ssh") {
      setTransfers([]);
      return;
    }
    const nextTransfers = await listSftpTransfers();
    setTransfers(sortTransfers(nextTransfers));
  }, [active, fileTarget]);

  useEffect(() => {
    if (!active || !fileTarget || fileTarget.kind !== "ssh") {
      setTransfers([]);
      return undefined;
    }

    let disposed = false;
    const loadTransfers = async () => {
      try {
        const nextTransfers = await listSftpTransfers();
        if (!disposed) {
          setTransfers(sortTransfers(nextTransfers));
        }
      } catch {
        if (!disposed) {
          setTransfers([]);
        }
      }
    };

    void loadTransfers();
    const intervalId = window.setInterval(loadTransfers, 900);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [active, fileTarget]);

  useEffect(() => {
    if (
      !active ||
      !fileTarget ||
      fileTarget.kind !== "ssh" ||
      !isRunningInTauriWebview()
    ) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<SftpTransferSummary>(SFTP_TRANSFER_UPDATED_EVENT, (event) => {
          if (disposed || event.payload.hostId !== fileTarget.hostId) {
            return;
          }
          setTransfers((current) =>
            sortTransfers(upsertTransfer(current, event.payload)),
          );
        }),
      )
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // Polling remains the fallback when the Tauri event channel is unavailable.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, fileTarget]);

  useEffect(() => {
    for (const transfer of visibleTransfers) {
      if (
        transfer.status === "succeeded" &&
        !completedTransferIdsRef.current.has(transfer.id)
      ) {
        completedTransferIdsRef.current.add(transfer.id);
        if (
          transfer.direction === "upload" &&
          parentRemotePath(transfer.remotePath) === currentPath
        ) {
          void loadDirectory(currentPath);
        }
      }
      if (transfer.status === "failed" || transfer.status === "canceled") {
        completedTransferIdsRef.current.add(transfer.id);
      }
    }
  }, [currentPath, loadDirectory, visibleTransfers]);

  useEffect(() => {
    if (
      !followTerminalDirectory ||
      !normalizedFollowedPath ||
      !fileTarget
    ) {
      if (!followTerminalDirectory || !normalizedFollowedPath) {
        lastAutoFollowedPathRef.current = undefined;
      }
      return;
    }

    if (normalizedFollowedPath === lastAutoFollowedPathRef.current) {
      return;
    }

    lastAutoFollowedPathRef.current = normalizedFollowedPath;
    if (normalizedFollowedPath === currentPath) {
      return;
    }

    setOperationStatus(null);
    void loadDirectory(normalizedFollowedPath);
  }, [
    currentPath,
    followTerminalDirectory,
    loadDirectory,
    normalizedFollowedPath,
    fileTarget,
  ]);

  useEffect(() => {
    setPathDraft(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const close = (event: PointerEvent) => {
      if (event.button === 2) {
        return;
      }
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const openContextMenuAt = (
    clientX: number,
    clientY: number,
    entry: SftpEntry | null,
  ) => {
    const position = clampContextMenuPosition(clientX, clientY);
    if (entry && !selectedEntryPaths.has(entry.path)) {
      setSelectedEntryPath(entry.path);
      setSelectedEntryPaths(new Set([entry.path]));
    }
    setContextMenu({
      entry,
      x: position.x,
      y: position.y,
    });
  };

  const openContextMenu = (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(event.clientX, event.clientY, entry);
  };

  const selectEntry = (entry: SftpEntry, event?: SftpSelectionEvent) => {
    const nextSelection = nextSelectedEntryPaths(
      visibleEntries,
      selectedEntryPaths,
      selectedEntryPath,
      entry.path,
      event,
    );
    setSelectedEntryPaths(nextSelection);
    setSelectedEntryPath(
      nextSelection.has(entry.path)
        ? entry.path
        : (nextSelection.values().next().value ?? null),
    );
  };

  const openContextMenuFromPress = (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => {
    if (event.button !== 2) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(event.clientX, event.clientY, entry);
  };

  const submitPathDraft = () => {
    const nextPath = normalizeRemotePath(pathDraft);
    setPathDraft(nextPath);
    setOperationStatus(null);
    void loadDirectory(nextPath);
  };

  const openWorkspaceDirectory = (path: string) => {
    if (!fileTarget) {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    setWorkspaceDirty(false);
    setWorkspaceCloseBlocked(false);
    setWorkspaceDialog({
      openCommand: null,
      rootPath: normalizeRemotePath(path),
    });
  };

  const openEditorEntry = (entry: SftpEntry) => {
    if (entry.kind !== "file") {
      setOperationStatus({
        kind: "info",
        message: "只有普通文件支持打开到编辑器。",
      });
      return;
    }

    if (!fileTarget) {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus(null);
    setWorkspaceDirty(false);
    setWorkspaceCloseBlocked(false);
    setWorkspaceDialog({
      openCommand: { nonce: Date.now(), path: entry.path },
      rootPath: parentRemotePath(entry.path),
    });
  };

  const closeWorkspaceDialog = () => {
    if (
      workspaceDirty &&
      !window.confirm("工作区有未保存修改，关闭会丢失这些修改。仍然关闭？")
    ) {
      setWorkspaceCloseBlocked(true);
      return;
    }
    setWorkspaceDialog(null);
    setWorkspaceDirty(false);
    setWorkspaceCloseBlocked(false);
  };

  const openDetachedWorkspaceWindow = async () => {
    if (!workspaceDialog || !fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    if (
      workspaceDirty &&
      !window.confirm(
        "独立窗口会重新从远端打开工作区，当前弹框里未保存的修改不会带过去。仍然弹出？",
      )
    ) {
      setWorkspaceCloseBlocked(true);
      return;
    }

    const windowUrl = detachedWorkspaceUrl(fileTarget.hostId, workspaceDialog);
    setWorkspacePopoutBusy(true);
    setOperationStatus({ kind: "info", message: "正在打开独立工作区窗口..." });

    try {
      if (isRunningInTauriWebview()) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const detachedWindow = new WebviewWindow(
          detachedWorkspaceLabel(fileTarget.hostId),
          {
            center: true,
            decorations: true,
            dragDropEnabled: false,
            focus: true,
            height: 760,
            minHeight: 560,
            minWidth: 900,
            resizable: true,
            title: `Kerminal 工作区 - ${workspaceDialog.rootPath}`,
            url: windowUrl,
            width: 1180,
          },
        );

        void detachedWindow.once("tauri://created", () => {
          setWorkspacePopoutBusy(false);
          setOperationStatus({
            kind: "success",
            message: "已弹出独立工作区窗口。",
          });
          setWorkspaceDialog(null);
          setWorkspaceDirty(false);
          setWorkspaceCloseBlocked(false);
        });
        void detachedWindow.once("tauri://error", (event) => {
          setWorkspacePopoutBusy(false);
          setOperationStatus({
            kind: "error",
            message: `独立工作区窗口打开失败：${errorMessage(event.payload)}`,
          });
        });
        return;
      }

      const opened = window.open(
        windowUrl,
        "_blank",
        "popup,width=1180,height=760",
      );
      if (!opened) {
        throw new Error("浏览器阻止了弹出窗口。");
      }
      setOperationStatus({ kind: "success", message: "已弹出独立工作区窗口。" });
      setWorkspaceDialog(null);
      setWorkspaceDirty(false);
      setWorkspaceCloseBlocked(false);
    } catch (nextError) {
      setWorkspacePopoutBusy(false);
      setOperationStatus({
        kind: "error",
        message: `独立工作区窗口打开失败：${errorMessage(nextError)}`,
      });
    } finally {
      if (!isRunningInTauriWebview()) {
        setWorkspacePopoutBusy(false);
      }
    }
  };


  const {
    cancelTransfer,
    clearFinishedTransfers,
    copyRemotePath,
    copySelectedRemoteItem,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadSelectedEntries,
    finishRemoteEntryDrag,
    handleRemoteDownloadDragEnter,
    handleRemoteDownloadDragLeave,
    handleRemoteDownloadDragOver,
    handleRemoteDownloadDrop,
    handleSftpKeyDown,
    pasteSftpClipboard,
    startRemoteEntryDrag,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadLocalDirectory,
    uploadLocalFile,
  } = useSftpTransferActions({
    active,
    currentPath,
    dropZoneRef,
    fileTarget,
    loadDirectory,
    refreshTransfers,
    remoteDragEntriesRef,
    selectedEntries,
    selectedEntryPaths,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setDragDropActive,
    setOperationStatus,
    setRemoteDownloadDragActive,
    setRemoteDownloadDropActive,
    setSelectedEntryPath,
    setSelectedEntryPaths,
    setSftpClipboard,
    setTransfers,
    sftpClipboard,
    transferableSelectedEntries,
    transferTarget,
  });


  const trustHostKey = async () => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    setHostKeyTrustBusy(true);
    setOperationStatus(null);
    try {
      const summary = await trustSftpHostKey({ hostId: fileTarget.hostId });
      await loadDirectory(currentPath);
      setOperationStatus({
        kind: "success",
        message: `已信任主机密钥：${summary.host}:${summary.port}`,
      });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `信任主机密钥失败：${errorMessage(nextError)}`,
      });
    } finally {
      setHostKeyTrustBusy(false);
    }
  };

  const setupRemoteCwdTracking = async () => {
    if (!fileTarget || fileTarget.kind !== "ssh") {
      return;
    }

    setContextMenu(null);
    setDialogAction(null);
    setDialogStatus(null);
    setOperationStatus({
      kind: "info",
      message: "正在写入远端 shell 配置...",
    });
    setCwdTrackingSetupBusy(true);
    try {
      const output = await executeSshCommand({
        command: buildSftpCwdTrackingSetupScript(),
        hostId: fileTarget.hostId,
        maxOutputBytes: 4096,
        timeoutSeconds: 15,
      });
      if (!output.success) {
        const details = (output.stderr || output.stdout).trim();
        throw new Error(
          details || `远端命令退出码：${output.exitCode ?? "未知"}`,
        );
      }
      setOperationStatus({
        kind: "success",
        message: "已写入远端配置。重新登录或 source 对应 shell 配置后生效。",
      });
    } catch (nextError) {
      setOperationStatus({
        kind: "error",
        message: `自动设置失败：${errorMessage(nextError)}`,
      });
    } finally {
      setCwdTrackingSetupBusy(false);
    }
  };


  const {
    openChmodDialog,
    openDeleteDialog,
    openNewDirectoryDialog,
    openRenameDialog,
    submitDialogAction,
  } = useSftpDialogActions({
    currentPath,
    dialogAction,
    fileTarget,
    loadDirectory,
    setContextMenu,
    setDialogAction,
    setDialogBusy,
    setDialogStatus,
    setOperationStatus,
  });

  const executeContextMenuAction = (action: SftpMenuAction) => {
    const entry = contextMenu?.entry ?? null;
    setContextMenu(null);

    if (action === "refresh") {
      setOperationStatus(null);
      void loadDirectory(currentPath);
      return;
    }
    if (action === "toggleHidden") {
      setShowHiddenFiles((current) => !current);
      return;
    }
    if (action === "copyPath") {
      void copyRemotePath(entry?.path ?? currentPath);
      return;
    }
    if (action === "copyItem" && entry) {
      copySelectedRemoteItem(entry);
      return;
    }
    if (action === "pasteClipboard") {
      void pasteSftpClipboard(
        entry && entry.kind === "directory" ? entry.path : currentPath,
      );
      return;
    }
    if (action === "uploadFile") {
      void uploadLocalFile(currentPath);
      return;
    }
    if (action === "uploadDirectory") {
      void uploadLocalDirectory(currentPath);
      return;
    }
    if (action === "uploadFileArchive") {
      void uploadLocalArchive("file", currentPath);
      return;
    }
    if (action === "uploadDirectoryArchive") {
      void uploadLocalArchive("directory", currentPath);
      return;
    }
    if (action === "newDirectory") {
      openNewDirectoryDialog();
      return;
    }

    if (!entry) {
      return;
    }

    if (action === "open" && entry.kind === "directory") {
      setOperationStatus(null);
      void loadDirectory(entry.path);
    }
    if (action === "workspace" && entry.kind === "directory") {
      openWorkspaceDirectory(entry.path);
    }
    if (action === "preview") {
      openEditorEntry(entry);
    }
    if (action === "download") {
      void downloadEntry(entry);
    }
    if (action === "downloadArchive") {
      void downloadEntryAsArchive(entry);
    }
    if (action === "downloadClipboard") {
      void downloadEntryToLocalClipboard(entry);
    }
    if (action === "uploadFileInto") {
      void uploadLocalFile(entry.path);
    }
    if (action === "uploadDirectoryInto") {
      void uploadLocalDirectory(entry.path);
    }
    if (action === "rename") {
      openRenameDialog(entry);
    }
    if (action === "chmod") {
      openChmodDialog(entry);
    }
    if (action === "delete") {
      openDeleteDialog(entry);
    }
  };


  return (
    <SftpBrowserView
      cancelTransfer={cancelTransfer}
      clearFinishedTransfers={clearFinishedTransfers}
      closeWorkspaceDialog={closeWorkspaceDialog}
      compactHeader={compactHeader}
      contextMenu={contextMenu}
      currentPath={currentPath}
      cwdTrackingSetupBusy={cwdTrackingSetupBusy}
      dialogAction={dialogAction}
      dialogBusy={dialogBusy}
      dialogStatus={dialogStatus}
      directoryCount={directoryCount}
      downloadSelectedEntries={downloadSelectedEntries}
      dragDropActive={dragDropActive}
      dropZoneRef={dropZoneRef}
      entries={entries}
      error={error}
      executeContextMenuAction={executeContextMenuAction}
      fileCount={fileCount}
      fileTarget={fileTarget}
      finishRemoteEntryDrag={finishRemoteEntryDrag}
      followTerminalDirectory={followTerminalDirectory}
      handleRemoteDownloadDragEnter={handleRemoteDownloadDragEnter}
      handleRemoteDownloadDragLeave={handleRemoteDownloadDragLeave}
      handleRemoteDownloadDragOver={handleRemoteDownloadDragOver}
      handleRemoteDownloadDrop={handleRemoteDownloadDrop}
      handleSftpKeyDown={handleSftpKeyDown}
      hiddenEntryCount={hiddenEntryCount}
      hostKeyTrustBusy={hostKeyTrustBusy}
      listing={listing}
      loadDirectory={loadDirectory}
      loading={loading}
      normalizedFollowedPath={normalizedFollowedPath}
      openContextMenu={openContextMenu}
      openContextMenuFromPress={openContextMenuFromPress}
      openDetachedWorkspaceWindow={openDetachedWorkspaceWindow}
      openEditorEntry={openEditorEntry}
      openNewDirectoryDialog={openNewDirectoryDialog}
      openWorkspaceDirectory={openWorkspaceDirectory}
      operationStatus={operationStatus}
      pathDraft={pathDraft}
      remoteDownloadDragActive={remoteDownloadDragActive}
      remoteDownloadDropActive={remoteDownloadDropActive}
      remoteDragEntriesRef={remoteDragEntriesRef}
      selectEntry={selectEntry}
      selectedEntries={selectedEntries}
      selectedEntryPaths={selectedEntryPaths}
      setContextMenu={setContextMenu}
      setDialogAction={setDialogAction}
      setDialogStatus={setDialogStatus}
      setFollowTerminalDirectory={setFollowTerminalDirectory}
      setOperationStatus={setOperationStatus}
      setPathDraft={setPathDraft}
      setShowHiddenFiles={setShowHiddenFiles}
      setUploadMenuOpen={setUploadMenuOpen}
      setWorkspaceCloseBlocked={setWorkspaceCloseBlocked}
      setWorkspaceDirty={setWorkspaceDirty}
      setupRemoteCwdTracking={setupRemoteCwdTracking}
      showHiddenFiles={showHiddenFiles}
      showLocalTransferActions={showLocalTransferActions}
      showTransferStatusBar={showTransferStatusBar}
      startRemoteEntryDrag={startRemoteEntryDrag}
      submitDialogAction={submitDialogAction}
      submitPathDraft={submitPathDraft}
      supportsSftpAdvancedActions={supportsSftpAdvancedActions}
      transferableSelectedEntries={transferableSelectedEntries}
      transferSelectedEntriesToTarget={transferSelectedEntriesToTarget}
      transferTarget={transferTarget}
      trustHostKey={trustHostKey}
      uploadLocalDirectory={uploadLocalDirectory}
      uploadLocalFile={uploadLocalFile}
      uploadMenuOpen={uploadMenuOpen}
      uploadMenuRef={uploadMenuRef}
      visibleEntries={visibleEntries}
      visibleTransfers={visibleTransfers}
      workspaceCloseBlocked={workspaceCloseBlocked}
      workspaceDialog={workspaceDialog}
      workspaceDirty={workspaceDirty}
      workspacePopoutBusy={workspacePopoutBusy}
      workspaceTarget={workspaceTarget}
    />
  );
}
