import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { listDockerContainerDirectory } from "../../lib/containerFilesApi";
import { PromptDialog } from "../../components/ui/prompt-dialog";
import {
  listSftpDirectory,
  type SftpEntry,
} from "../../lib/sftpApi";
import type { Machine } from "../workspace/types";
import { SftpTransferConflictDialog } from "./SftpTransferConflictDialog";
import type { InterfaceDensity } from "../settings/settingsModel";
import { resolveSftpFileRowHeight } from "./sftpDensityModel";
import { SftpBrowserView } from "./sftp-tool-content/SftpBrowserView";
import { useSftpTransferActions } from "./sftp-tool-content/useSftpTransferActions";
import { useSftpContextMenuActions } from "./sftp-tool-content/useSftpContextMenuActions";
import { useSftpLocalUploadDropActions } from "./sftp-tool-content/useSftpLocalUploadDropActions";
import { useSftpDialogActions } from "./sftp-tool-content/useSftpDialogActions";
import { useSftpRemoteSetupActions } from "./sftp-tool-content/useSftpRemoteSetupActions";
import { useSftpTransferSync } from "./sftp-tool-content/useSftpTransferSync";
import { useSftpWorkspaceDialogActions } from "./sftp-tool-content/useSftpWorkspaceDialogActions";
import { clampContextMenuPosition } from "./sftp-tool-content/sftpDragDropModel";
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
  normalizeFollowedRemotePath,
  resolveFollowedRemotePathChange,
  resolveFollowTerminalDirectoryToggle,
} from "./sftp-tool-content/sftpFollowDirectoryModel";
import { normalizeRemotePath } from "./sftp-tool-content/sftpPathModel";
import {
  initialSftpRemoteBrowserState,
  nextSftpRemoteBrowserRequestId,
  normalizeSftpRemoteBrowserError,
  resolveSftpRemoteBrowserSetState,
  sftpRemoteBrowserReducer,
  type SftpRemoteBrowserAction,
} from "./sftp-tool-content/sftpRemoteBrowserModel";
import {
  nextContextMenuSelection,
  nextSelectedEntryPaths,
} from "./sftp-tool-content/sftpSelectionModel";
import type { SftpWorkbenchClipboard } from "./sftpTransferClipboardModel";
import type {
  SftpClipboard,
  SftpContextMenuEvent,
  SftpContextMenuState,
  SftpDialogAction,
  SftpSelectionEvent,
  SftpStatus,
  SftpTransferTarget,
} from "./sftp-tool-content/types";
import { TRANSIENT_ERROR_STATUS_MS } from "./sftp-tool-content/types";

export type { SftpClipboard, SftpClipboardEntry } from "./sftp-tool-content/types";

export function SftpToolContent({
  active = true,
  compactHeader = false,
  followedRemotePath,
  interfaceDensity = "comfortable",
  onCurrentPathChange,
  onSftpClipboardChange,
  selectedMachine,
  showLocalTransferActions = true,
  showTransferStatusBar = true,
  sftpClipboard: controlledSftpClipboard,
  transferViewScope,
  transferTarget,
  workbenchClipboard,
}: {
  active?: boolean;
  compactHeader?: boolean;
  followedRemotePath?: string;
  interfaceDensity?: InterfaceDensity;
  onCurrentPathChange?: (path: string) => void;
  onSftpClipboardChange?: (clipboard: SftpClipboard | null) => void;
  selectedMachine?: Machine;
  showLocalTransferActions?: boolean;
  showTransferStatusBar?: boolean;
  sftpClipboard?: SftpClipboard | null;
  transferViewScope?: string | null;
  transferTarget?: SftpTransferTarget;
  workbenchClipboard?: SftpWorkbenchClipboard | null;
}) {
  const [remoteBrowserState, dispatchRemoteBrowser] = useReducer(
    sftpRemoteBrowserReducer,
    initialSftpRemoteBrowserState,
  );
  const [showHiddenFiles, setShowHiddenFiles] = useState(true);
  const [followTerminalDirectory, setFollowTerminalDirectory] = useState(false);
  const [operationStatus, setOperationStatus] = useState<SftpStatus | null>(
    null,
  );
  const [dialogAction, setDialogAction] = useState<SftpDialogAction | null>(
    null,
  );
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogStatus, setDialogStatus] = useState<SftpStatus | null>(null);
  const [contextMenu, setContextMenu] = useState<SftpContextMenuState | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uncontrolledSftpClipboard, setUncontrolledSftpClipboard] =
    useState<SftpClipboard | null>(null);
  const [dragDropActive, setDragDropActive] = useState(false);
  const [remoteDownloadDragActive, setRemoteDownloadDragActive] =
    useState(false);
  const [remoteDownloadDropActive, setRemoteDownloadDropActive] =
    useState(false);
  const lastAutoFollowedPathRef = useRef<string | undefined>(undefined);
  const followTerminalDirectoryRef = useRef(followTerminalDirectory);
  const remoteBrowserStateRef = useRef(remoteBrowserState);
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
  const fileRowHeight = resolveSftpFileRowHeight(interfaceDensity);
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
  const {
    cancelWorkspaceCloseConfirmation,
    closeWorkspaceDialog,
    confirmWorkspaceDialogClose,
    openEditorEntry,
    openWorkspaceDirectory,
    resetWorkspaceDialog,
    setWorkspaceCloseBlocked,
    setWorkspaceDirty,
    setWorkspaceExpanded,
    workspaceCloseConfirmationOpen,
    workspaceCloseBlocked,
    workspaceDialog,
    workspaceDirty,
    workspaceExpanded,
  } = useSftpWorkspaceDialogActions({
    fileTarget,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setOperationStatus,
  });

  followTerminalDirectoryRef.current = followTerminalDirectory;
  remoteBrowserStateRef.current = remoteBrowserState;
  const dispatchRemoteBrowserAction = useCallback(
    (action: SftpRemoteBrowserAction) => {
      remoteBrowserStateRef.current = sftpRemoteBrowserReducer(
        remoteBrowserStateRef.current,
        action,
      );
      dispatchRemoteBrowser(action);
    },
    [],
  );
  const {
    error,
    listing,
    loading,
    pathDraft,
    selectedEntryPath,
    selectedEntryPaths,
  } = remoteBrowserState;
  const currentPath = listing?.path ?? "/";
  const normalizedFollowedPath = normalizeFollowedRemotePath(followedRemotePath);
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
  const nextRemoteBrowserRequestId = useCallback(() => {
    const requestId = nextSftpRemoteBrowserRequestId(
      remoteBrowserStateRef.current.requestId,
    );
    remoteBrowserStateRef.current = {
      ...remoteBrowserStateRef.current,
      requestId,
    };
    return requestId;
  }, []);
  const setPathDraft = useCallback((value: SetStateAction<string>) => {
    dispatchRemoteBrowserAction({
      pathDraft: resolveSftpRemoteBrowserSetState(
        remoteBrowserStateRef.current.pathDraft,
        value,
      ),
      type: "path-draft-changed",
    });
  }, [dispatchRemoteBrowserAction]);
  const setSelectedEntryPath = useCallback(
    (value: SetStateAction<string | null>) => {
      dispatchRemoteBrowserAction({
        selectedEntryPath: resolveSftpRemoteBrowserSetState(
          remoteBrowserStateRef.current.selectedEntryPath,
          value,
        ),
        type: "selection-anchor-changed",
      });
    },
    [dispatchRemoteBrowserAction],
  );
  const setSelectedEntryPaths = useCallback(
    (value: SetStateAction<Set<string>>) => {
      const current = remoteBrowserStateRef.current;
      const nextEntryPaths = resolveSftpRemoteBrowserSetState(
        current.selectedEntryPaths,
        value,
      );
      const currentEntryPath = current.selectedEntryPath;
      dispatchRemoteBrowserAction({
        selectedEntryPath:
          currentEntryPath && nextEntryPaths.has(currentEntryPath)
            ? currentEntryPath
            : (nextEntryPaths.values().next().value ?? null),
        selectedEntryPaths: nextEntryPaths,
        type: "selection-changed",
      });
    },
    [dispatchRemoteBrowserAction],
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
        dispatchRemoteBrowserAction({
          requestId: nextRemoteBrowserRequestId(),
          type: "target-reset",
        });
        return;
      }

      const nextPath = normalizeRemotePath(path);
      const requestId = nextRemoteBrowserRequestId();
      dispatchRemoteBrowserAction({
        requestId,
        type: "load-started",
      });
      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
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
        dispatchRemoteBrowserAction({
          listing: normalizeDirectoryListing(nextListing),
          requestId,
          type: "load-succeeded",
        });
      } catch (nextError) {
        dispatchRemoteBrowserAction({
          error: normalizeSftpRemoteBrowserError(nextError),
          requestId,
          type: "load-failed",
        });
      }
    },
    [
      active,
      dispatchRemoteBrowserAction,
      fileTarget,
      nextRemoteBrowserRequestId,
    ],
  );
  const {
    cwdTrackingSetupBusy,
    hostKeyTrustBusy,
    setupRemoteCwdTracking,
    trustHostKey,
  } = useSftpRemoteSetupActions({
    currentPath,
    fileTarget,
    loadDirectory,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setOperationStatus,
  });
  const setFollowTerminalDirectoryFromView = useCallback(
    (value: SetStateAction<boolean>) => {
      const current = followTerminalDirectoryRef.current;
      const next = resolveSftpRemoteBrowserSetState(current, value);
      const decision = resolveFollowTerminalDirectoryToggle({
        currentEnabled: current,
        hasFileTarget: Boolean(fileTarget),
        lastAutoFollowedPath: lastAutoFollowedPathRef.current,
        nextEnabled: next,
        normalizedFollowedPath,
      });
      followTerminalDirectoryRef.current = decision.enabled;
      setFollowTerminalDirectory(decision.enabled);
      lastAutoFollowedPathRef.current = decision.nextLastAutoFollowedPath;
      if (decision.clearOperationStatus) {
        setOperationStatus(null);
      }
      if (decision.loadPath) {
        void loadDirectory(decision.loadPath);
      }
    },
    [fileTarget, loadDirectory, normalizedFollowedPath],
  );

  useEffect(() => {
    dispatchRemoteBrowserAction({
      requestId: nextRemoteBrowserRequestId(),
      type: "target-reset",
    });
    setOperationStatus(null);
    setDialogAction(null);
    setDialogStatus(null);
    setContextMenu(null);
    lastAutoFollowedPathRef.current = undefined;
    resetWorkspaceDialog();
    setDragDropActive(false);
    setRemoteDownloadDragActive(false);
    setRemoteDownloadDropActive(false);
    remoteDragEntriesRef.current = [];
    if (fileTarget) {
      void loadDirectory(fileTarget.initialPath);
    }
  }, [
    dispatchRemoteBrowserAction,
    fileTarget,
    loadDirectory,
    nextRemoteBrowserRequestId,
    resetWorkspaceDialog,
  ]);

  const { refreshTransfers, setTransfers, visibleTransfers } =
    useSftpTransferSync({
      active,
      currentPath,
      fileTarget,
      loadDirectory,
      viewScope: transferViewScope,
    });

  useEffect(() => {
    const decision = resolveFollowedRemotePathChange({
      enabled: followTerminalDirectory,
      hasFileTarget: Boolean(fileTarget),
      lastAutoFollowedPath: lastAutoFollowedPathRef.current,
      normalizedFollowedPath,
    });
    lastAutoFollowedPathRef.current = decision.nextLastAutoFollowedPath;
    if (decision.clearOperationStatus) {
      setOperationStatus(null);
    }
    if (decision.loadPath) {
      void loadDirectory(decision.loadPath);
    }
  }, [
    currentPath,
    followTerminalDirectory,
    loadDirectory,
    normalizedFollowedPath,
    fileTarget,
  ]);

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
    const currentSelection = {
      selectedEntryPath: remoteBrowserStateRef.current.selectedEntryPath,
      selectedEntryPaths: remoteBrowserStateRef.current.selectedEntryPaths,
    };
    const nextSelection = nextContextMenuSelection(
      currentSelection,
      entry?.path ?? null,
    );
    if (nextSelection !== currentSelection) {
      dispatchRemoteBrowserAction({
        selectedEntryPath: nextSelection.selectedEntryPath,
        selectedEntryPaths: nextSelection.selectedEntryPaths,
        type: "selection-changed",
      });
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

  const {
    cancelTransfer,
    clearFinishedTransfers,
    closeTransferConflictDialog,
    confirmTransferConflictPolicy,
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
    pendingTransferConflict,
    retryTransfer,
    startRemoteEntryDrag,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadDroppedLocalPaths,
    uploadLocalDirectory,
    uploadLocalFile,
  } = useSftpTransferActions({
    currentPath,
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
    viewScope: transferViewScope,
    workbenchClipboard,
  });

  useSftpLocalUploadDropActions({
    active,
    currentPath,
    dropZoneRef,
    fileTarget,
    setDragDropActive,
    setOperationStatus,
    uploadDroppedLocalPaths,
  });


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

  const { executeContextMenuAction } = useSftpContextMenuActions({
    contextMenu,
    copyRemotePath,
    copySelectedRemoteItem,
    currentPath,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    loadDirectory,
    openChmodDialog,
    openDeleteDialog,
    openEditorEntry,
    openNewDirectoryDialog,
    openRenameDialog,
    openWorkspaceDirectory,
    pasteSftpClipboard,
    setContextMenu,
    setOperationStatus,
    setShowHiddenFiles,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadLocalDirectory,
    uploadLocalFile,
  });


  return (
    <>
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
        fileRowHeight={fileRowHeight}
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
        interfaceDensity={interfaceDensity}
        listing={listing}
        loadDirectory={loadDirectory}
        loading={loading}
        normalizedFollowedPath={normalizedFollowedPath}
        openContextMenu={openContextMenu}
        openContextMenuFromPress={openContextMenuFromPress}
        openEditorEntry={openEditorEntry}
        openNewDirectoryDialog={openNewDirectoryDialog}
        operationStatus={operationStatus}
        pathDraft={pathDraft}
        remoteDownloadDragActive={remoteDownloadDragActive}
        remoteDownloadDropActive={remoteDownloadDropActive}
        remoteDragEntriesRef={remoteDragEntriesRef}
        retryTransfer={retryTransfer}
        selectEntry={selectEntry}
        selectedEntries={selectedEntries}
        selectedEntryPaths={selectedEntryPaths}
        setContextMenu={setContextMenu}
        setDialogAction={setDialogAction}
        setDialogStatus={setDialogStatus}
        setFollowTerminalDirectory={setFollowTerminalDirectoryFromView}
        setOperationStatus={setOperationStatus}
        setPathDraft={setPathDraft}
        setShowHiddenFiles={setShowHiddenFiles}
        setUploadMenuOpen={setUploadMenuOpen}
        setWorkspaceCloseBlocked={setWorkspaceCloseBlocked}
        setWorkspaceDirty={setWorkspaceDirty}
        setWorkspaceExpanded={setWorkspaceExpanded}
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
        workspaceExpanded={workspaceExpanded}
        workspaceTarget={workspaceTarget}
      />
      <SftpTransferConflictDialog
        conflictCount={pendingTransferConflict?.conflictCount ?? 0}
        onClose={closeTransferConflictDialog}
        onConfirm={(policy) => {
          void confirmTransferConflictPolicy(policy);
        }}
        open={Boolean(pendingTransferConflict)}
      />
      <PromptDialog
        confirmLabel="关闭工作区"
        confirmVariant="danger"
        description={workspaceDialog?.rootPath}
        onClose={cancelWorkspaceCloseConfirmation}
        onConfirm={() => confirmWorkspaceDialogClose()}
        open={workspaceCloseConfirmationOpen}
        title="关闭远程工作区"
      >
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3 py-3 text-sm text-amber-800 dark:text-amber-100">
          工作区有未保存修改，关闭会丢失这些修改。
        </div>
      </PromptDialog>
    </>
  );
}
