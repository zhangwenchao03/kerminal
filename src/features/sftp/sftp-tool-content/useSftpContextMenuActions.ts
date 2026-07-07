import { type SetStateAction, useCallback } from "react";
import type { SftpEntry, SftpTransferKind } from "../../../lib/sftpApi";
import { resolveSftpContextMenuAction } from "./sftpContextMenuActionModel";
import type {
  SftpContextMenuState,
  SftpMenuAction,
  SftpStatus,
} from "./types";

type UseSftpContextMenuActionsArgs = {
  contextMenu: SftpContextMenuState | null;
  copyRemotePath: (path: string) => void | Promise<void>;
  copySelectedRemoteItem: (entry: SftpEntry) => void;
  currentPath: string;
  downloadEntry: (entry: SftpEntry) => void | Promise<void>;
  downloadEntryAsArchive: (entry: SftpEntry) => void | Promise<void>;
  downloadEntryToLocalClipboard: (entry: SftpEntry) => void | Promise<void>;
  downloadSelectedEntries: () => void | Promise<void>;
  loadDirectory: (path: string) => void | Promise<void>;
  openChmodDialog: (entry: SftpEntry) => void;
  openDeleteDialog: (entries: SftpEntry[]) => void;
  openEditorEntry: (entry: SftpEntry) => void;
  openNewDirectoryDialog: () => void;
  openRenameDialog: (entry: SftpEntry) => void;
  openWorkspaceDirectory: (path: string) => void;
  pasteSftpClipboard: (destinationRemotePath?: string) => void | Promise<void>;
  setContextMenu: (contextMenu: SftpContextMenuState | null) => void;
  setOperationStatus: (status: SftpStatus | null) => void;
  setShowHiddenFiles: (value: SetStateAction<boolean>) => void;
  transferSelectedEntriesToTarget: () => void | Promise<void>;
  uploadLocalArchive: (
    kind: SftpTransferKind,
    destinationRemotePath?: string,
  ) => void | Promise<void>;
  uploadLocalDirectory: (targetRemotePath?: string) => void | Promise<void>;
  uploadLocalFile: (targetRemotePath?: string) => void | Promise<void>;
};

export function useSftpContextMenuActions({
  contextMenu,
  copyRemotePath,
  copySelectedRemoteItem,
  currentPath,
  downloadEntry,
  downloadEntryAsArchive,
  downloadEntryToLocalClipboard,
  downloadSelectedEntries,
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
}: UseSftpContextMenuActionsArgs) {
  const executeContextMenuAction = useCallback(
    (action: SftpMenuAction) => {
      const decision = resolveSftpContextMenuAction({
        action,
        currentPath,
        entry: contextMenu?.entry ?? null,
        scope: contextMenu?.scope,
      });
      setContextMenu(null);

      if (decision.kind === "noop") {
        return;
      }
      if (decision.kind === "refresh") {
        setOperationStatus(null);
        void loadDirectory(decision.path);
        return;
      }
      if (decision.kind === "toggleHidden") {
        setShowHiddenFiles((current) => !current);
        return;
      }
      if (decision.kind === "copyPath") {
        void copyRemotePath(decision.path);
        return;
      }
      if (decision.kind === "copyItem") {
        copySelectedRemoteItem(decision.entry);
        return;
      }
      if (decision.kind === "pasteClipboard") {
        void pasteSftpClipboard(decision.destinationRemotePath);
        return;
      }
      if (decision.kind === "uploadFile") {
        void uploadLocalFile(decision.targetRemotePath);
        return;
      }
      if (decision.kind === "uploadDirectory") {
        void uploadLocalDirectory(decision.targetRemotePath);
        return;
      }
      if (decision.kind === "uploadArchive") {
        void uploadLocalArchive(
          decision.transferKind,
          decision.destinationRemotePath,
        );
        return;
      }
      if (decision.kind === "newDirectory") {
        openNewDirectoryDialog();
        return;
      }
      if (decision.kind === "openDirectory") {
        setOperationStatus(null);
        void loadDirectory(decision.path);
        return;
      }
      if (decision.kind === "workspaceDirectory") {
        setOperationStatus(null);
        void loadDirectory(decision.path);
        openWorkspaceDirectory(decision.path);
        return;
      }
      if (decision.kind === "preview") {
        openEditorEntry(decision.entry);
        return;
      }
      if (decision.kind === "download") {
        void downloadEntry(decision.entry);
        return;
      }
      if (decision.kind === "downloadSelection") {
        void downloadSelectedEntries();
        return;
      }
      if (decision.kind === "transferToTarget") {
        void transferSelectedEntriesToTarget();
        return;
      }
      if (decision.kind === "downloadArchive") {
        void downloadEntryAsArchive(decision.entry);
        return;
      }
      if (decision.kind === "downloadClipboard") {
        void downloadEntryToLocalClipboard(decision.entry);
        return;
      }
      if (decision.kind === "uploadFileInto") {
        void uploadLocalFile(decision.targetRemotePath);
        return;
      }
      if (decision.kind === "uploadDirectoryInto") {
        void uploadLocalDirectory(decision.targetRemotePath);
        return;
      }
      if (decision.kind === "rename") {
        openRenameDialog(decision.entry);
        return;
      }
      if (decision.kind === "chmod") {
        openChmodDialog(decision.entry);
        return;
      }
      if (decision.kind === "deleteSelection") {
        openDeleteDialog(decision.entries);
        return;
      }
      openDeleteDialog([decision.entry]);
    },
    [
      contextMenu,
      copyRemotePath,
      copySelectedRemoteItem,
      currentPath,
      downloadEntry,
      downloadEntryAsArchive,
      downloadEntryToLocalClipboard,
      downloadSelectedEntries,
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
    ],
  );

  return { executeContextMenuAction };
}
