import {
  CornerDownRight,
  FolderOpen,
  HardDrive,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  type LocalDirectoryEntry,
} from "../../lib/fileDialogApi";
import { copyLocalPath } from "../../lib/localFilesApi";
import {
  enqueueSftpTransfer,
  type SftpManagedTransferRequest,
  type SftpTransferConflictPolicy,
} from "../../lib/sftpApi";
import type { InterfaceDensity } from "../settings/contracts/index";
import type { Machine } from "../workspace/contracts/index";
import {
  filterLocalDirectoryEntries,
  initialLocalTransferPaneState,
  localDirectorySummary,
  localTransferPaneReducer,
  normalizeLocalTransferError,
  visibleLocalDirectoryListing,
  type LocalDirectoryEntryFilter,
} from "./localTransferPaneModel";
import {
  buildSftpWorkbenchClipboardPastePlan,
  buildSftpWorkbenchLocalClipboard,
  type SftpWorkbenchLocalClipboard,
} from "./sftpTransferClipboardModel";
import {
  isTransferableLocalEntry,
} from "./LocalDirectoryEntryRow";
import { LocalTransferToolbar } from "./LocalTransferToolbar";
import {
  countRemoteUploadConflicts,
  toManagedTransferKind,
} from "./LocalTransferPaneTransfer";
import {
  isEditableLocalKeyboardTarget,
  isLocalCopyShortcut,
  isLocalPasteShortcut,
} from "./LocalTransferPaneKeyboard";
import {
  LocalTransferPaneContextMenu,
  type LocalContextMenuState,
} from "./LocalTransferPaneContextMenu";
import { LocalTransferPaneDialogs } from "./LocalTransferPaneDialogs";
import { LocalTransferPaneListView } from "./LocalTransferPaneListView";
import { LocalTransferPaneTargetFooter } from "./LocalTransferPaneTargetFooter";
import {
  parseSftpRemoteDragPayload,
  remoteDragPayloadEntriesToSftpEntries,
} from "./sftp-tool-content/sftpRemoteTransferModel";
import { buildBatchDownloadTransferPlan } from "./sftp-tool-content/sftpTransferActionPlan";
import { withSftpTransferViewScope } from "./sftp-tool-content/sftpTransferScopeModel";
import {
  resolveTransferIntent,
  type ResolvedTransferPlan,
} from "./sftpTransferResolver";
import { resolveSftpFileRowHeight } from "./sftpDensityModel";
import { useLocalTransferPaneFileActions } from "./useLocalTransferPaneFileActions";
import { useLocalTransferPaneDropHandlers } from "./useLocalTransferPaneDropHandlers";

const DEFAULT_TRANSFER_CONFLICT_POLICY: SftpTransferConflictPolicy = "overwrite";

export function LocalTransferPane({
  active,
  followedPath,
  initialPath,
  interfaceDensity = "comfortable",
  mode = "transfer",
  onCurrentPathChange,
  onLocalClipboardChange,
  onOpenLocalFile,
  onTransferQueued,
  targetMachine,
  targetPath,
  transferViewScope,
}: {
  active: boolean;
  followedPath?: string;
  initialPath?: string;
  interfaceDensity?: InterfaceDensity;
  mode?: "browser" | "transfer";
  onCurrentPathChange?: (path: string | undefined) => void;
  onLocalClipboardChange?: (clipboard: SftpWorkbenchLocalClipboard) => void;
  onOpenLocalFile?: (entry: LocalDirectoryEntry) => void;
  onTransferQueued?: () => void;
  targetMachine: Machine | undefined;
  targetPath: string | undefined;
  transferViewScope?: string | null;
}) {
  const localPathInputId = useId();
  const requestIdRef = useRef(0);
  const [localState, dispatchLocalState] = useReducer(
    localTransferPaneReducer,
    initialLocalTransferPaneState,
  );
  const { error, listing, loading, pathDraft } = localState;
  const [contextMenu, setContextMenu] = useState<LocalContextMenuState | null>(
    null,
  );
  const [deleteEntry, setDeleteEntry] = useState<LocalDirectoryEntry | null>(
    null,
  );
  const [renameEntry, setRenameEntry] = useState<LocalDirectoryEntry | null>(
    null,
  );
  const [createDirectoryDialogOpen, setCreateDirectoryDialogOpen] =
    useState(false);
  const [createDirectoryNameDraft, setCreateDirectoryNameDraft] = useState("");
  const [remoteDropActive, setRemoteDropActive] = useState(false);
  const [dropRejectedActive, setDropRejectedActive] = useState(false);
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [localClipboard, setLocalClipboard] =
    useState<SftpWorkbenchLocalClipboard | null>(null);
  const [entryFilter, setEntryFilter] =
    useState<LocalDirectoryEntryFilter>("all");
  const [showHiddenEntries, setShowHiddenEntries] = useState(true);
  const [pendingConflictPlan, setPendingConflictPlan] =
    useState<ResolvedTransferPlan | null>(null);
  const [pendingConflictCount, setPendingConflictCount] = useState(0);
  const visibleListing = visibleLocalDirectoryListing(listing, showHiddenEntries);
  const directorySummary = localDirectorySummary(visibleListing);
  const visibleEntries = filterLocalDirectoryEntries(visibleListing, entryFilter);
  const selectedEntries =
    visibleListing?.entries.filter((entry) => selectedEntryPaths.has(entry.path)) ??
    [];
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const fileRowHeight = resolveSftpFileRowHeight(interfaceDensity);
  const chromePaddingClass = compactDensity
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-4 py-3"
      : "px-3 py-2";
  const pathToolbarPaddingClass = compactDensity
    ? "p-1.5"
    : spaciousDensity
      ? "p-3"
      : "p-2";
  const bodyPaddingClass = compactDensity
    ? "p-2"
    : spaciousDensity
      ? "p-4"
      : "p-3";
  const listHeaderPaddingClass = compactDensity
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-4 py-2.5"
      : "px-3 py-2";
  const {
    chooseDirectory,
    copyEntryPath,
    createDirectoryInCurrentDirectory,
    deleteLocalEntry,
    loadDirectory,
    openCreateDirectoryDialog,
    openCurrentDirectory,
    openEntryInFileManager,
    renameLocalEntry,
  } = useLocalTransferPaneFileActions({
    active,
    dispatch: dispatchLocalState,
    listing,
    loading,
    requestIdRef,
    setCreateDirectoryDialogOpen,
    setCreateDirectoryNameDraft,
    setDeleteEntry,
    setRenameEntry,
    setSelectedEntryPaths,
  });

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadDirectory(followedPath ?? initialPath ?? null);
  }, [active, followedPath, initialPath, loadDirectory]);

  useEffect(() => {
    setSelectedEntryPaths(new Set());
  }, [entryFilter, showHiddenEntries]);

  useEffect(() => {
    setSelectedEntryPaths(new Set());
    setContextMenu(null);
    setDeleteEntry(null);
    setRenameEntry(null);
  }, [listing?.path]);

  useEffect(() => {
    onCurrentPathChange?.(listing?.path);
  }, [listing?.path, onCurrentPathChange]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  const enqueueUploadPlan = useCallback(
    async (
      plan: ResolvedTransferPlan,
      conflictPolicy?: SftpTransferConflictPolicy,
    ) => {
      if (!targetMachine) {
        return;
      }
      if (plan.conflictPolicy === "ask" && !conflictPolicy) {
        const conflictCount = await countRemoteUploadConflicts(
          targetMachine.id,
          plan,
        );
        if (conflictCount > 0) {
          setPendingConflictPlan(plan);
          setPendingConflictCount(conflictCount);
          return;
        }
      }
      await Promise.all(
        plan.tasks.map((task) => {
          const kind = toManagedTransferKind(task.entryKind);
          if (!kind) {
            return Promise.resolve();
          }
          const request: SftpManagedTransferRequest = {
            conflictPolicy: conflictPolicy ?? DEFAULT_TRANSFER_CONFLICT_POLICY,
            direction: "upload",
            hostId: targetMachine.id,
            kind,
            localPath: task.sourceEntryPath,
            remotePath: task.targetEntryPath,
          };
          return enqueueSftpTransfer(
            withSftpTransferViewScope(request, transferViewScope),
          );
        }),
      );
      onTransferQueued?.();
    },
    [onTransferQueued, targetMachine, transferViewScope],
  );

  const confirmConflictPolicy = useCallback(
    async (policy: SftpTransferConflictPolicy) => {
      const plan = pendingConflictPlan;
      setPendingConflictPlan(null);
      setPendingConflictCount(0);
      if (!plan) {
        return;
      }
      try {
        await enqueueUploadPlan(plan, policy);
      } catch (nextError) {
        dispatchLocalState({
          error: normalizeLocalTransferError(nextError),
          type: "error-reported",
        });
      }
    },
    [enqueueUploadPlan, pendingConflictPlan],
  );

  const transferEntriesToTarget = useCallback(
    async (entries: LocalDirectoryEntry[]) => {
      if (!listing || !targetMachine || !targetPath) {
        return;
      }
      const transferableEntries = entries.filter(isTransferableLocalEntry);
      if (transferableEntries.length === 0) {
        return;
      }

      try {
        const plan = resolveTransferIntent({
          conflictPolicy: "ask",
          entries: transferableEntries,
          requestedBy: "contextMenu",
          source: { kind: "local", path: listing.path },
          target: {
            hostId: targetMachine.id,
            hostLabel: targetMachine.name,
            kind: "remote",
            path: targetPath,
          },
        });
        await enqueueUploadPlan(plan);
      } catch (nextError) {
        dispatchLocalState({
          error: normalizeLocalTransferError(nextError),
          type: "error-reported",
        });
      }
    },
    [enqueueUploadPlan, listing, targetMachine, targetPath],
  );

  const downloadRemotePayloadToCurrentDirectory = useCallback(
    async (payloadText: string) => {
      if (!listing) {
        return;
      }
      const payload = parseSftpRemoteDragPayload(payloadText);
      if (!payload) {
        dispatchLocalState({
          error: "无法识别拖拽的远程文件。",
          type: "error-reported",
        });
        return;
      }

      try {
        const plan = buildBatchDownloadTransferPlan({
          entries: remoteDragPayloadEntriesToSftpEntries(payload.entries),
          fileTargetKind: "ssh",
          hostId: payload.sourceHostId,
          selectedDirectory: listing.path,
        });
        if (plan.items.length === 0) {
          dispatchLocalState({
            error: "拖拽的远程项目暂不支持下载。",
            type: "error-reported",
          });
          return;
        }
        await Promise.all(
          plan.items.map((item) =>
            enqueueSftpTransfer(
              withSftpTransferViewScope(item.request, transferViewScope),
            ),
          ),
        );
        onTransferQueued?.();
      } catch (nextError) {
        dispatchLocalState({
          error: normalizeLocalTransferError(nextError),
          type: "error-reported",
        });
      }
    },
    [listing, onTransferQueued, transferViewScope],
  );

  const copyLocalEntriesToCurrentDirectory = useCallback(
    async (
      entries: Array<{ kind: "directory" | "file"; path: string }>,
      targetDirectoryPath?: string,
    ) => {
      const targetDirectory = targetDirectoryPath ?? listing?.path;
      if (!targetDirectory || entries.length === 0) {
        return;
      }
      try {
        await Promise.all(
          entries.map((entry) =>
            copyLocalPath({
              kind: entry.kind,
              rootPath: targetDirectory,
              sourcePath: entry.path,
              targetDirectoryPath: targetDirectory,
            }),
          ),
        );
        await loadDirectory(targetDirectory);
      } catch (nextError) {
        dispatchLocalState({
          error: normalizeLocalTransferError(nextError),
          type: "error-reported",
        });
      }
    },
    [listing?.path, loadDirectory],
  );
  const {
    handleRemoteDragEnter,
    handleRemoteDragLeave,
    handleRemoteDragOver,
    handleRemoteDrop,
  } = useLocalTransferPaneDropHandlers({
    closeContextMenu: () => setContextMenu(null),
    copyLocalEntries: copyLocalEntriesToCurrentDirectory,
    downloadRemotePayload: downloadRemotePayloadToCurrentDirectory,
    listing,
    reportError: (nextError) =>
      dispatchLocalState({ error: nextError, type: "error-reported" }),
    setDropRejectedActive,
    setRemoteDropActive,
  });

  const openContextMenu = (
    event: ReactMouseEvent,
    entry: LocalDirectoryEntry | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) {
      setSelectedEntryPaths((current) =>
        current.has(entry.path) ? current : new Set([entry.path]),
      );
    }
    setContextMenu({ entry, x: event.clientX, y: event.clientY });
  };

  const selectEntry = (entry: LocalDirectoryEntry, event: ReactMouseEvent) => {
    setSelectedEntryPaths((current) => {
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      }
      return new Set([entry.path]);
    });
  };

  const copySelectedLocalEntries = () => {
    const plan = buildSftpWorkbenchLocalClipboard({
      copiedAt: Date.now(),
      entries: selectedEntries,
      sourcePath: listing?.path ?? "",
    });
    if (plan.kind === "empty") {
      dispatchLocalState({
        error: plan.status.message,
        type: "error-reported",
      });
      return;
    }
    setLocalClipboard(plan.clipboard);
    onLocalClipboardChange?.(plan.clipboard);
  };

  const pasteLocalClipboardToTarget = async () => {
    if (localClipboard?.kind === "local" && listing && !targetMachine) {
      await copyLocalEntriesToCurrentDirectory(localClipboard.entries, listing.path);
      return;
    }
    const pastePlan = buildSftpWorkbenchClipboardPastePlan({
      clipboard: localClipboard,
      target:
        targetMachine && targetPath
          ? {
              hostId: targetMachine.id,
              hostLabel: targetMachine.name,
              kind: "remote",
              path: targetPath,
            }
          : listing
            ? { kind: "local", path: listing.path }
            : null,
    });
    if (pastePlan.kind !== "transfer") {
      dispatchLocalState({
        error: pastePlan.status.message,
        type: "error-reported",
      });
      return;
    }
    try {
      await enqueueUploadPlan(pastePlan.plan);
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        type: "error-reported",
      });
    }
  };

  const handleLocalKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!isLocalCopyShortcut(event) && !isLocalPasteShortcut(event)) {
      return;
    }
    if (isEditableLocalKeyboardTarget(event.target)) {
      return;
    }
    event.preventDefault();
    if (isLocalCopyShortcut(event)) {
      copySelectedLocalEntries();
      return;
    }
    void pasteLocalClipboardToTarget();
  };

  const contextEntries = contextMenu?.entry
    ? selectedEntryPaths.has(contextMenu.entry.path) && selectedEntries.length > 0
      ? selectedEntries
      : [contextMenu.entry]
    : selectedEntries;
  const transferableContextEntries = contextEntries.filter(
    isTransferableLocalEntry,
  );
  const canTransferContextEntries =
    Boolean(targetMachine && targetPath) && transferableContextEntries.length > 0;
  const browserMode = mode === "browser";

  return (
    <div
      aria-label="本地目录面板"
      className={cn(
        "kerminal-muted-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border transition",
        remoteDropActive &&
          "border-sky-400/70 ring-2 ring-sky-400/30 dark:border-sky-300/70 dark:ring-sky-300/25",
        dropRejectedActive &&
          "border-rose-400/70 ring-2 ring-rose-400/30 dark:border-rose-300/70 dark:ring-rose-300/25",
      )}
      onContextMenu={(event) => openContextMenu(event, null)}
      onDragEnter={handleRemoteDragEnter}
      onDragLeave={handleRemoteDragLeave}
      onDragOver={handleRemoteDragOver}
      onDrop={handleRemoteDrop}
      onKeyDown={handleLocalKeyDown}
    >
      {browserMode ? (
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)]",
            chromePaddingClass,
          )}
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              本地文件
            </div>
            <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {followedPath ? "跟随当前终端路径" : "本机文件系统"}
            </div>
          </div>
          <Button
            aria-label="选择本地目录"
            className="h-8 w-8 rounded-lg bg-emerald-500/10 px-0 text-emerald-600 hover:bg-emerald-500/15 dark:bg-emerald-400/12 dark:text-emerald-300 dark:hover:bg-emerald-400/18"
            onClick={() => void chooseDirectory()}
            size="sm"
            title="选择本地目录"
            type="button"
            variant="ghost"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "shrink-0 border-b border-[var(--border-subtle)]",
          pathToolbarPaddingClass,
        )}
      >
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void loadDirectory(pathDraft);
          }}
        >
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
          <label className="sr-only" htmlFor={localPathInputId}>
            当前本地路径
          </label>
          <input
            className="kerminal-field-surface min-w-0 flex-1 rounded-lg border px-2 py-1 font-mono text-[13px] text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600"
            id={localPathInputId}
            onChange={(event) =>
              dispatchLocalState({
                pathDraft: event.target.value,
                type: "path-draft-changed",
              })
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                dispatchLocalState({ type: "path-draft-reset" });
              }
            }}
            placeholder="本地路径"
            spellCheck={false}
            value={pathDraft}
          />
          <Button
            aria-label="跳转本地路径"
            className="kerminal-muted-surface h-8 w-8 rounded-lg border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
            disabled={loading || pathDraft.trim().length === 0}
            size="sm"
            title="跳转"
            type="submit"
            variant="ghost"
          >
            <CornerDownRight className="h-3.5 w-3.5" />
          </Button>
          {browserMode ? null : (
            <Button
              aria-label="选择本地目录"
              className="h-8 w-8 rounded-lg bg-emerald-500/10 px-0 text-emerald-600 hover:bg-emerald-500/15 dark:bg-emerald-400/12 dark:text-emerald-300 dark:hover:bg-emerald-400/18"
              onClick={() => void chooseDirectory()}
              size="sm"
              title="选择本地目录"
              type="button"
              variant="ghost"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
        </form>

        <LocalTransferToolbar
          directorySummary={directorySummary}
          entryFilter={entryFilter}
          listing={listing}
          loading={loading}
          onCreateDirectory={openCreateDirectoryDialog}
          onEntryFilterChange={setEntryFilter}
          onLoadDirectory={loadDirectory}
          onOpenCurrentDirectory={() => void openCurrentDirectory()}
          onToggleHiddenEntries={() => setShowHiddenEntries((current) => !current)}
          showHiddenEntries={showHiddenEntries}
        />
      </div>

      <LocalTransferPaneListView
        bodyPaddingClass={bodyPaddingClass}
        compactDensity={compactDensity}
        entryFilter={entryFilter}
        error={error}
        fileRowHeight={fileRowHeight}
        listHeaderPaddingClass={listHeaderPaddingClass}
        listing={listing}
        loading={loading}
        selectedEntries={selectedEntries}
        selectedEntryPaths={selectedEntryPaths}
        showHiddenEntries={showHiddenEntries}
        visibleEntries={visibleEntries}
        onLoadDirectory={loadDirectory}
        onOpenContextMenu={openContextMenu}
        onOpenFile={onOpenLocalFile}
        onSelectEntry={selectEntry}
      />

      {browserMode ? null : (
        <LocalTransferPaneTargetFooter
          chromePaddingClass={chromePaddingClass}
          targetMachine={targetMachine}
          targetPath={targetPath}
        />
      )}
      <LocalTransferPaneContextMenu
        canTransferContextEntries={canTransferContextEntries}
        contextMenu={contextMenu}
        listing={listing}
        loading={loading}
        onCopyEntryPath={(entry) => {
          setContextMenu(null);
          void copyEntryPath(entry);
        }}
        onCreateDirectory={() => {
          setContextMenu(null);
          openCreateDirectoryDialog();
        }}
        onDeleteEntry={(entry) => {
          setContextMenu(null);
          setDeleteEntry(entry);
        }}
        onOpenEntryInFileManager={(entry) => {
          setContextMenu(null);
          void openEntryInFileManager(entry);
        }}
        onOpenFile={
          onOpenLocalFile
            ? (entry) => {
                setContextMenu(null);
                onOpenLocalFile(entry);
              }
            : undefined
        }
        onRefresh={() => {
          setContextMenu(null);
          void loadDirectory(listing?.path ?? null);
        }}
        onRenameEntry={(entry) => {
          setContextMenu(null);
          setRenameEntry(entry);
        }}
        onTransfer={() => {
          setContextMenu(null);
          void transferEntriesToTarget(contextEntries);
        }}
        transferableContextEntryCount={transferableContextEntries.length}
      />
      <LocalTransferPaneDialogs
        busy={loading}
        createDirectoryDialogOpen={createDirectoryDialogOpen}
        createDirectoryNameDraft={createDirectoryNameDraft}
        deleteEntry={deleteEntry}
        listingPath={listing?.path}
        pendingConflictCount={pendingConflictCount}
        pendingConflictOpen={Boolean(pendingConflictPlan)}
        renameEntry={renameEntry}
        onCloseCreateDirectory={() => setCreateDirectoryDialogOpen(false)}
        onCloseDelete={() => setDeleteEntry(null)}
        onCloseRename={() => setRenameEntry(null)}
        onCloseTransferConflict={() => {
          setPendingConflictPlan(null);
          setPendingConflictCount(0);
        }}
        onConfirmCreateDirectory={(name) => {
          void createDirectoryInCurrentDirectory(name);
        }}
        onConfirmDelete={(confirmName) => {
          if (deleteEntry) {
            void deleteLocalEntry(deleteEntry, confirmName);
          }
        }}
        onConfirmRename={(name) => {
          if (renameEntry) {
            void renameLocalEntry(renameEntry, name);
          }
        }}
        onConfirmTransferConflictPolicy={(policy) =>
          void confirmConflictPolicy(policy)
        }
        onCreateDirectoryNameDraftChange={setCreateDirectoryNameDraft}
      />
    </div>
  );
}
