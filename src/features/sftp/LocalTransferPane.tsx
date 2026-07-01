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
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  listLocalDirectory,
  openLocalDirectory,
  selectLocalDirectory,
  type LocalDirectoryEntry,
} from "../../lib/fileDialogApi";
import {
  copyLocalPath,
  createLocalDirectory,
  deleteLocalPath,
  renameLocalPath,
} from "../../lib/localFilesApi";
import {
  enqueueSftpTransfer,
  type SftpManagedTransferRequest,
  type SftpTransferConflictPolicy,
} from "../../lib/sftpApi";
import type { InterfaceDensity } from "../settings/settingsModel";
import type { Machine } from "../workspace/types";
import {
  filterLocalDirectoryEntries,
  initialLocalTransferPaneState,
  localDirectorySummary,
  localTransferPaneReducer,
  nextLocalDirectoryRequestId,
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
  parentLocalPath,
} from "./LocalTransferPaneKeyboard";
import {
  LocalTransferPaneContextMenu,
  type LocalContextMenuState,
} from "./LocalTransferPaneContextMenu";
import { LocalTransferPaneDialogs } from "./LocalTransferPaneDialogs";
import { LocalTransferPaneListView } from "./LocalTransferPaneListView";
import { LocalTransferPaneTargetFooter } from "./LocalTransferPaneTargetFooter";
import {
  SFTP_REMOTE_DRAG_PAYLOAD_MIME,
  hasSftpRemoteDragPayloadType,
  parseSftpRemoteDragPayload,
  remoteDragPayloadEntriesToSftpEntries,
} from "./sftp-tool-content/sftpRemoteTransferModel";
import {
  SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
  parseSftpLocalFileDragPayload,
  resolveSftpLocalPaneDropTarget,
} from "./sftp-tool-content/sftpLocalUploadDropModel";
import { buildBatchDownloadTransferPlan } from "./sftp-tool-content/sftpTransferActionPlan";
import { withSftpTransferViewScope } from "./sftp-tool-content/sftpTransferScopeModel";
import {
  resolveTransferIntent,
  type ResolvedTransferPlan,
} from "./sftpTransferResolver";
import { resolveSftpFileRowHeight } from "./sftpDensityModel";

const DEFAULT_TRANSFER_CONFLICT_POLICY: SftpTransferConflictPolicy = "overwrite";

export function LocalTransferPane({
  active,
  interfaceDensity = "comfortable",
  onCurrentPathChange,
  onLocalClipboardChange,
  onTransferQueued,
  targetMachine,
  targetPath,
  transferViewScope,
}: {
  active: boolean;
  interfaceDensity?: InterfaceDensity;
  onCurrentPathChange?: (path: string | undefined) => void;
  onLocalClipboardChange?: (clipboard: SftpWorkbenchLocalClipboard) => void;
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
  const hiddenEntryCount =
    (listing?.entries.length ?? 0) - (visibleListing?.entries.length ?? 0);
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
  const paneHeaderPaddingClass = compactDensity
    ? "px-2.5 py-2"
    : spaciousDensity
      ? "px-4 py-3"
      : "px-3 py-2.5";

  const loadDirectory = useCallback(
    async (path?: string | null) => {
      if (!active) {
        return;
      }
      const requestId = nextLocalDirectoryRequestId(requestIdRef.current);
      requestIdRef.current = requestId;
      dispatchLocalState({ requestId, type: "load-started" });
      try {
        const nextListing = await listLocalDirectory(path);
        dispatchLocalState({
          listing: nextListing,
          requestId,
          type: "load-succeeded",
        });
      } catch (nextError) {
        dispatchLocalState({
          error: normalizeLocalTransferError(nextError),
          requestId,
          type: "load-failed",
        });
      }
    },
    [active],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadDirectory(null);
  }, [active, loadDirectory]);

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

  const chooseDirectory = async () => {
    try {
      const selected = await selectLocalDirectory();
      if (selected) {
        await loadDirectory(selected);
      }
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        type: "error-reported",
      });
    }
  };

  const openCurrentDirectory = async () => {
    if (!listing) {
      return;
    }
    try {
      await openLocalDirectory(listing.path);
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        type: "error-reported",
      });
    }
  };

  const openCreateDirectoryDialog = () => {
    if (!listing || loading) {
      return;
    }
    setCreateDirectoryNameDraft("");
    setCreateDirectoryDialogOpen(true);
  };

  const createDirectoryInCurrentDirectory = async (name: string) => {
    if (!listing) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    setCreateDirectoryDialogOpen(false);

    const requestId = nextLocalDirectoryRequestId(requestIdRef.current);
    requestIdRef.current = requestId;
    dispatchLocalState({ requestId, type: "load-started" });
    try {
      const nextListing = await createLocalDirectory({
        name: trimmedName,
        parentPath: listing.path,
        rootPath: listing.path,
      });
      dispatchLocalState({
        listing: nextListing,
        requestId,
        type: "load-succeeded",
      });
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        requestId,
        type: "load-failed",
      });
    }
  };

  const renameLocalEntry = async (entry: LocalDirectoryEntry, name: string) => {
    if (!listing || (entry.kind !== "file" && entry.kind !== "directory")) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === entry.name) {
      return;
    }

    const requestId = nextLocalDirectoryRequestId(requestIdRef.current);
    requestIdRef.current = requestId;
    dispatchLocalState({ requestId, type: "load-started" });
    try {
      const nextListing = await renameLocalPath({
        kind: entry.kind,
        name: trimmedName,
        path: entry.path,
        rootPath: listing.path,
      });
      setRenameEntry(null);
      setSelectedEntryPaths(new Set());
      dispatchLocalState({
        listing: nextListing,
        requestId,
        type: "load-succeeded",
      });
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        requestId,
        type: "load-failed",
      });
    }
  };

  const deleteLocalEntry = async (
    entry: LocalDirectoryEntry,
    confirmName: string,
  ) => {
    if (!listing || (entry.kind !== "file" && entry.kind !== "directory")) {
      return;
    }

    const requestId = nextLocalDirectoryRequestId(requestIdRef.current);
    requestIdRef.current = requestId;
    dispatchLocalState({ requestId, type: "load-started" });
    try {
      const nextListing = await deleteLocalPath({
        confirmName,
        kind: entry.kind,
        path: entry.path,
        recursive: entry.kind === "directory",
        rootPath: listing.path,
      });
      setDeleteEntry(null);
      setSelectedEntryPaths(new Set());
      dispatchLocalState({
        listing: nextListing,
        requestId,
        type: "load-succeeded",
      });
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        requestId,
        type: "load-failed",
      });
    }
  };

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

  const handleRemoteDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!listing) {
      return;
    }
    const decision = resolveSftpLocalPaneDropTarget({
      hasLocalPayload: event.dataTransfer.types.includes(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME),
      hasRemotePayload: hasSftpRemoteDragPayloadType(event.dataTransfer.types),
      type: "enter",
    });
    if (decision.kind === "ignore") {
      return;
    }
    event.preventDefault();
    if (decision.kind === "copy-hover") {
      setDropRejectedActive(false);
      setRemoteDropActive(decision.active);
      return;
    }
    if (decision.kind === "download-hover") {
      setDropRejectedActive(false);
      setRemoteDropActive(true);
    }
  };

  const handleRemoteDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!listing) {
      return;
    }
    const decision = resolveSftpLocalPaneDropTarget({
      hasLocalPayload: event.dataTransfer.types.includes(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME),
      hasRemotePayload: hasSftpRemoteDragPayloadType(event.dataTransfer.types),
      type: "over",
    });
    if (decision.kind === "ignore") {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (decision.kind === "copy-hover") {
      setDropRejectedActive(false);
      setRemoteDropActive(decision.active);
      return;
    }
    setDropRejectedActive(false);
    setRemoteDropActive(true);
  };

  const handleRemoteDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setRemoteDropActive(false);
      setDropRejectedActive(false);
    }
  };

  const handleRemoteDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!listing) {
      return;
    }
    const decision = resolveSftpLocalPaneDropTarget({
      hasLocalPayload: event.dataTransfer.types.includes(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME),
      hasRemotePayload: hasSftpRemoteDragPayloadType(event.dataTransfer.types),
      type: "drop",
    });
    if (decision.kind === "ignore") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setRemoteDropActive(false);
    setDropRejectedActive(false);
    if (decision.kind === "copy") {
      const payload = parseSftpLocalFileDragPayload(
        event.dataTransfer.getData(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME),
      );
      if (!payload) {
        dispatchLocalState({
          error: "无法识别拖拽的本机文件。",
          type: "error-reported",
        });
        return;
      }
      void copyLocalEntriesToCurrentDirectory(payload.entries, listing.path);
      return;
    }
    if (decision.kind === "download") {
      void downloadRemotePayloadToCurrentDirectory(
        event.dataTransfer.getData(SFTP_REMOTE_DRAG_PAYLOAD_MIME),
      );
      return;
    }
  };

  const openEntryInFileManager = async (entry: LocalDirectoryEntry) => {
    try {
      await openLocalDirectory(
        entry.kind === "directory" ? entry.path : parentLocalPath(entry.path),
      );
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        type: "error-reported",
      });
    }
  };

  const copyEntryPath = async (entry: LocalDirectoryEntry) => {
    try {
      const result = await writeDesktopClipboardText(entry.path);
      if (!result.ok) {
        throw new Error("当前环境不支持复制到剪贴板。");
      }
    } catch (nextError) {
      dispatchLocalState({
        error: normalizeLocalTransferError(nextError),
        type: "error-reported",
      });
    }
  };

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

  return (
    <div
      aria-label="本地目录面板"
      className={cn(
        "kerminal-muted-surface flex h-full min-h-0 flex-col overflow-hidden rounded-xl border transition",
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
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)]",
          chromePaddingClass,
        )}
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            左侧本地目录
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            本机文件系统
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
        directorySummary={directorySummary}
        entryFilter={entryFilter}
        error={error}
        fileRowHeight={fileRowHeight}
        hiddenEntryCount={hiddenEntryCount}
        listHeaderPaddingClass={listHeaderPaddingClass}
        listing={listing}
        loading={loading}
        paneHeaderPaddingClass={paneHeaderPaddingClass}
        selectedEntries={selectedEntries}
        selectedEntryPaths={selectedEntryPaths}
        showHiddenEntries={showHiddenEntries}
        visibleEntries={visibleEntries}
        onLoadDirectory={loadDirectory}
        onOpenContextMenu={openContextMenu}
        onSelectEntry={selectEntry}
      />

      <LocalTransferPaneTargetFooter
        chromePaddingClass={chromePaddingClass}
        targetMachine={targetMachine}
        targetPath={targetPath}
      />
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
