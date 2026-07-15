import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  listLocalDirectory,
  openLocalDirectory,
  selectLocalDirectory,
  type LocalDirectoryEntry,
  type LocalDirectoryListing,
} from "../../lib/fileDialogApi";
import {
  createLocalDirectory,
  deleteLocalPath,
  renameLocalPath,
} from "../../lib/localFilesApi";
import {
  nextLocalDirectoryRequestId,
  normalizeLocalTransferError,
  type LocalTransferPaneAction,
} from "./localTransferPaneModel";
import { parentLocalPath } from "./LocalTransferPaneKeyboard";

interface LocalTransferPaneFileActionsOptions {
  active: boolean;
  dispatch: Dispatch<LocalTransferPaneAction>;
  listing: LocalDirectoryListing | null;
  loading: boolean;
  requestIdRef: MutableRefObject<number>;
  setCreateDirectoryDialogOpen: Dispatch<SetStateAction<boolean>>;
  setCreateDirectoryNameDraft: Dispatch<SetStateAction<string>>;
  setDeleteEntry: Dispatch<SetStateAction<LocalDirectoryEntry | null>>;
  setRenameEntry: Dispatch<SetStateAction<LocalDirectoryEntry | null>>;
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>;
}

/** 本地目录 CRUD controller；组件只保留选择、拖放和 transfer 编排。 */
export function useLocalTransferPaneFileActions({
  active,
  dispatch,
  listing,
  loading,
  requestIdRef,
  setCreateDirectoryDialogOpen,
  setCreateDirectoryNameDraft,
  setDeleteEntry,
  setRenameEntry,
  setSelectedEntryPaths,
}: LocalTransferPaneFileActionsOptions) {
  const loadDirectory = useCallback(
    async (path?: string | null) => {
      if (!active) return;
      const requestId = nextLocalDirectoryRequestId(requestIdRef.current);
      requestIdRef.current = requestId;
      dispatch({ requestId, type: "load-started" });
      try {
        dispatch({
          listing: await listLocalDirectory(path),
          requestId,
          type: "load-succeeded",
        });
      } catch (error) {
        dispatch({
          error: normalizeLocalTransferError(error),
          requestId,
          type: "load-failed",
        });
      }
    },
    [active, dispatch, requestIdRef],
  );

  const reportError = (error: unknown) =>
    dispatch({
      error: normalizeLocalTransferError(error),
      type: "error-reported",
    });

  return {
    loadDirectory,
    async chooseDirectory() {
      try {
        const selected = await selectLocalDirectory();
        if (selected) await loadDirectory(selected);
      } catch (error) {
        reportError(error);
      }
    },
    async openCurrentDirectory() {
      if (!listing) return;
      try {
        await openLocalDirectory(listing.path);
      } catch (error) {
        reportError(error);
      }
    },
    openCreateDirectoryDialog() {
      if (!listing || loading) return;
      setCreateDirectoryNameDraft("");
      setCreateDirectoryDialogOpen(true);
    },
    async createDirectoryInCurrentDirectory(name: string) {
      const trimmedName = name.trim();
      if (!listing || !trimmedName) return;
      setCreateDirectoryDialogOpen(false);
      await runListingMutation(requestIdRef, dispatch, () =>
        createLocalDirectory({
          name: trimmedName,
          parentPath: listing.path,
          rootPath: listing.path,
        }),
      );
    },
    async renameLocalEntry(entry: LocalDirectoryEntry, name: string) {
      const trimmedName = name.trim();
      if (
        !listing ||
        (entry.kind !== "file" && entry.kind !== "directory") ||
        !trimmedName ||
        trimmedName === entry.name
      ) {
        return;
      }
      const succeeded = await runListingMutation(requestIdRef, dispatch, () =>
        renameLocalPath({
          kind: entry.kind as "directory" | "file",
          name: trimmedName,
          path: entry.path,
          rootPath: listing.path,
        }),
      );
      if (succeeded) {
        setRenameEntry(null);
        setSelectedEntryPaths(new Set());
      }
    },
    async deleteLocalEntry(entry: LocalDirectoryEntry, confirmName: string) {
      if (!listing || (entry.kind !== "file" && entry.kind !== "directory")) {
        return;
      }
      const kind = entry.kind;
      const succeeded = await runListingMutation(requestIdRef, dispatch, () =>
        deleteLocalPath({
          confirmName,
          kind,
          path: entry.path,
          recursive: kind === "directory",
          rootPath: listing.path,
        }),
      );
      if (succeeded) {
        setDeleteEntry(null);
        setSelectedEntryPaths(new Set());
      }
    },
    async openEntryInFileManager(entry: LocalDirectoryEntry) {
      try {
        await openLocalDirectory(
          entry.kind === "directory" ? entry.path : parentLocalPath(entry.path),
        );
      } catch (error) {
        reportError(error);
      }
    },
    async copyEntryPath(entry: LocalDirectoryEntry) {
      try {
        const result = await writeDesktopClipboardText(entry.path);
        if (!result.ok) throw new Error("当前环境不支持复制到剪贴板。");
      } catch (error) {
        reportError(error);
      }
    },
  };
}

async function runListingMutation(
  requestIdRef: MutableRefObject<number>,
  dispatch: Dispatch<LocalTransferPaneAction>,
  mutate: () => Promise<LocalDirectoryListing>,
) {
  const requestId = nextLocalDirectoryRequestId(requestIdRef.current);
  requestIdRef.current = requestId;
  dispatch({ requestId, type: "load-started" });
  try {
    dispatch({ listing: await mutate(), requestId, type: "load-succeeded" });
    return true;
  } catch (error) {
    dispatch({
      error: normalizeLocalTransferError(error),
      requestId,
      type: "load-failed",
    });
    return false;
  }
}
