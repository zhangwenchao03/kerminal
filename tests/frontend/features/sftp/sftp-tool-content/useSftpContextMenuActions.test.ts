/**
 * SFTP context menu facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import type {
  SftpContextMenuState,
  SftpStatus,
} from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpContextMenuActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpContextMenuActions";

type ActionCall = string;

describe("useSftpContextMenuActions", () => {
  it("closes the context menu before executing refresh navigation", () => {
    const calls: ActionCall[] = [];
    const { actions, result } = renderContextMenuHook({
      calls,
      currentPath: "/srv/releases",
    });

    act(() => {
      result.current.executeContextMenuAction("refresh");
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setOperationStatus:null",
      "loadDirectory:/srv/releases",
    ]);
    expect(actions.loadDirectory).toHaveBeenCalledWith("/srv/releases");
  });

  it("keeps entry-scoped actions as no-ops without an entry", () => {
    const { actions, result } = renderContextMenuHook({
      contextMenu: { entry: null, x: 24, y: 48 },
    });

    act(() => {
      result.current.executeContextMenuAction("download");
    });

    expect(actions.setContextMenu).toHaveBeenCalledWith(null);
    expectNoSideEffects(actions);
  });

  it("dispatches global menu actions to their facade callbacks", () => {
    const fileEntry = remoteEntry({ path: "/srv/app.log" });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });

    const copyPath = renderContextMenuHook({
      contextMenu: contextMenu(fileEntry),
    });
    act(() => copyPath.result.current.executeContextMenuAction("copyPath"));
    expect(copyPath.actions.copyRemotePath).toHaveBeenCalledWith("/srv/app.log");

    const paste = renderContextMenuHook({
      contextMenu: contextMenu(directoryEntry),
    });
    act(() => paste.result.current.executeContextMenuAction("pasteClipboard"));
    expect(paste.actions.pasteSftpClipboard).toHaveBeenCalledWith("/srv/conf");

    const uploadFile = renderContextMenuHook({ currentPath: "/srv/uploads" });
    act(() => uploadFile.result.current.executeContextMenuAction("uploadFile"));
    expect(uploadFile.actions.uploadLocalFile).toHaveBeenCalledWith(
      "/srv/uploads",
    );

    const uploadDirectory = renderContextMenuHook({
      currentPath: "/srv/uploads",
    });
    act(() =>
      uploadDirectory.result.current.executeContextMenuAction("uploadDirectory"),
    );
    expect(uploadDirectory.actions.uploadLocalDirectory).toHaveBeenCalledWith(
      "/srv/uploads",
    );

    const uploadDirectoryArchive = renderContextMenuHook({
      currentPath: "/srv/uploads",
    });
    act(() =>
      uploadDirectoryArchive.result.current.executeContextMenuAction(
        "uploadDirectoryArchive",
      ),
    );
    expect(uploadDirectoryArchive.actions.uploadLocalArchive).toHaveBeenCalledWith(
      "directory",
      "/srv/uploads",
    );

    const toggleHidden = renderContextMenuHook();
    act(() =>
      toggleHidden.result.current.executeContextMenuAction("toggleHidden"),
    );
    const updater = toggleHidden.actions.setShowHiddenFiles.mock.calls[0]?.[0];
    expect(typeof updater).toBe("function");
    expect((updater as (current: boolean) => boolean)(true)).toBe(false);

    const mkdir = renderContextMenuHook();
    act(() => mkdir.result.current.executeContextMenuAction("newDirectory"));
    expect(mkdir.actions.openNewDirectoryDialog).toHaveBeenCalledTimes(1);

    const workspaceCurrentDirectory = renderContextMenuHook({
      contextMenu: { entry: null, x: 24, y: 48 },
      currentPath: "/srv/uploads",
    });
    act(() =>
      workspaceCurrentDirectory.result.current.executeContextMenuAction(
        "workspace",
      ),
    );
    expect(
      workspaceCurrentDirectory.actions.setOperationStatus,
    ).toHaveBeenCalledWith(null);
    expect(workspaceCurrentDirectory.actions.loadDirectory).toHaveBeenCalledWith(
      "/srv/uploads",
    );
    expect(
      workspaceCurrentDirectory.actions.openWorkspaceDirectory,
    ).toHaveBeenCalledWith("/srv/uploads");
  });

  it("dispatches entry-scoped actions to downloads, dialogs, and workspace callbacks", () => {
    const fileEntry = remoteEntry({ path: "/srv/app.log" });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });

    const openDirectory = renderContextMenuHook({
      contextMenu: contextMenu(directoryEntry),
    });
    act(() => openDirectory.result.current.executeContextMenuAction("open"));
    expect(openDirectory.actions.setOperationStatus).toHaveBeenCalledWith(null);
    expect(openDirectory.actions.loadDirectory).toHaveBeenCalledWith("/srv/conf");

    const workspace = renderContextMenuHook({
      contextMenu: contextMenu(directoryEntry),
    });
    act(() => workspace.result.current.executeContextMenuAction("workspace"));
    expect(workspace.actions.setOperationStatus).toHaveBeenCalledWith(null);
    expect(workspace.actions.loadDirectory).toHaveBeenCalledWith("/srv/conf");
    expect(workspace.actions.openWorkspaceDirectory).toHaveBeenCalledWith(
      "/srv/conf",
    );

    const preview = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() => preview.result.current.executeContextMenuAction("preview"));
    expect(preview.actions.openEditorEntry).toHaveBeenCalledWith(fileEntry);

    const copyItem = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() => copyItem.result.current.executeContextMenuAction("copyItem"));
    expect(copyItem.actions.copySelectedRemoteItem).toHaveBeenCalledWith(
      fileEntry,
    );

    const transferToTarget = renderContextMenuHook({
      contextMenu: contextMenu(fileEntry),
    });
    act(() =>
      transferToTarget.result.current.executeContextMenuAction(
        "transferToTarget",
      ),
    );
    expect(
      transferToTarget.actions.transferSelectedEntriesToTarget,
    ).toHaveBeenCalledTimes(1);

    const download = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() => download.result.current.executeContextMenuAction("download"));
    expect(download.actions.downloadEntry).toHaveBeenCalledWith(fileEntry);

    const archive = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() =>
      archive.result.current.executeContextMenuAction("downloadArchive"),
    );
    expect(archive.actions.downloadEntryAsArchive).toHaveBeenCalledWith(
      fileEntry,
    );

    const clipboard = renderContextMenuHook({
      contextMenu: contextMenu(fileEntry),
    });
    act(() =>
      clipboard.result.current.executeContextMenuAction("downloadClipboard"),
    );
    expect(clipboard.actions.downloadEntryToLocalClipboard).toHaveBeenCalledWith(
      fileEntry,
    );

    const uploadInto = renderContextMenuHook({
      contextMenu: contextMenu(directoryEntry),
    });
    act(() =>
      uploadInto.result.current.executeContextMenuAction("uploadFileInto"),
    );
    expect(uploadInto.actions.uploadLocalFile).toHaveBeenCalledWith("/srv/conf");

    const uploadDirectoryInto = renderContextMenuHook({
      contextMenu: contextMenu(directoryEntry),
    });
    act(() =>
      uploadDirectoryInto.result.current.executeContextMenuAction(
        "uploadDirectoryInto",
      ),
    );
    expect(uploadDirectoryInto.actions.uploadLocalDirectory).toHaveBeenCalledWith(
      "/srv/conf",
    );

    const rename = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() => rename.result.current.executeContextMenuAction("rename"));
    expect(rename.actions.openRenameDialog).toHaveBeenCalledWith(fileEntry);

    const chmod = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() => chmod.result.current.executeContextMenuAction("chmod"));
    expect(chmod.actions.openChmodDialog).toHaveBeenCalledWith(fileEntry);

    const remove = renderContextMenuHook({ contextMenu: contextMenu(fileEntry) });
    act(() => remove.result.current.executeContextMenuAction("delete"));
    expect(remove.actions.openDeleteDialog).toHaveBeenCalledWith([fileEntry]);
  });

  it("dispatches selection-scoped actions to batch download and delete callbacks", () => {
    const fileEntry = remoteEntry({ path: "/srv/app.log" });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });
    const contextMenuState: SftpContextMenuState = {
      entry: fileEntry,
      scope: {
        entries: [fileEntry, directoryEntry],
        kind: "selection",
        transferableEntries: [fileEntry, directoryEntry],
      },
      x: 24,
      y: 48,
    };

    const download = renderContextMenuHook({ contextMenu: contextMenuState });
    act(() =>
      download.result.current.executeContextMenuAction("downloadSelection"),
    );
    expect(download.actions.downloadSelectedEntries).toHaveBeenCalledTimes(1);

    const remove = renderContextMenuHook({ contextMenu: contextMenuState });
    act(() => remove.result.current.executeContextMenuAction("deleteSelection"));
    expect(remove.actions.openDeleteDialog).toHaveBeenCalledWith([
      fileEntry,
      directoryEntry,
    ]);
  });
});

function renderContextMenuHook({
  calls = [],
  contextMenu = null,
  currentPath = "/srv",
}: {
  calls?: ActionCall[];
  contextMenu?: SftpContextMenuState | null;
  currentPath?: string;
} = {}) {
  const actions = createActions(calls);
  const hook = renderHook(() =>
    useSftpContextMenuActions({
      contextMenu,
      copyRemotePath: actions.copyRemotePath,
      copySelectedRemoteItem: actions.copySelectedRemoteItem,
      currentPath,
      downloadEntry: actions.downloadEntry,
      downloadEntryAsArchive: actions.downloadEntryAsArchive,
      downloadEntryToLocalClipboard: actions.downloadEntryToLocalClipboard,
      downloadSelectedEntries: actions.downloadSelectedEntries,
      loadDirectory: actions.loadDirectory,
      openChmodDialog: actions.openChmodDialog,
      openDeleteDialog: actions.openDeleteDialog,
      openEditorEntry: actions.openEditorEntry,
      openNewDirectoryDialog: actions.openNewDirectoryDialog,
      openRenameDialog: actions.openRenameDialog,
      openWorkspaceDirectory: actions.openWorkspaceDirectory,
      pasteSftpClipboard: actions.pasteSftpClipboard,
      setContextMenu: actions.setContextMenu,
      setOperationStatus: actions.setOperationStatus,
      setShowHiddenFiles: actions.setShowHiddenFiles,
      transferSelectedEntriesToTarget: actions.transferSelectedEntriesToTarget,
      uploadLocalArchive: actions.uploadLocalArchive,
      uploadLocalDirectory: actions.uploadLocalDirectory,
      uploadLocalFile: actions.uploadLocalFile,
    }),
  );

  return {
    actions,
    result: hook.result,
  };
}

function createActions(calls: ActionCall[]) {
  return {
    copyRemotePath: vi.fn<(path: string) => void>((path) => {
      calls.push(`copyRemotePath:${path}`);
    }),
    copySelectedRemoteItem: vi.fn<(entry: SftpEntry) => void>((entry) => {
      calls.push(`copySelectedRemoteItem:${entry.path}`);
    }),
    downloadEntry: vi.fn<(entry: SftpEntry) => void>((entry) => {
      calls.push(`downloadEntry:${entry.path}`);
    }),
    downloadEntryAsArchive: vi.fn<(entry: SftpEntry) => void>((entry) => {
      calls.push(`downloadEntryAsArchive:${entry.path}`);
    }),
    downloadEntryToLocalClipboard: vi.fn<(entry: SftpEntry) => void>(
      (entry) => {
        calls.push(`downloadEntryToLocalClipboard:${entry.path}`);
      },
    ),
    downloadSelectedEntries: vi.fn<() => void>(() => {
      calls.push("downloadSelectedEntries");
    }),
    loadDirectory: vi.fn<(path: string) => void>((path) => {
      calls.push(`loadDirectory:${path}`);
    }),
    openChmodDialog: vi.fn<(entry: SftpEntry) => void>((entry) => {
      calls.push(`openChmodDialog:${entry.path}`);
    }),
    openDeleteDialog: vi.fn<(entries: SftpEntry[]) => void>((entries) => {
      calls.push(
        `openDeleteDialog:${entries.map((entry) => entry.path).join(",")}`,
      );
    }),
    openEditorEntry: vi.fn<(entry: SftpEntry) => void>((entry) => {
      calls.push(`openEditorEntry:${entry.path}`);
    }),
    openNewDirectoryDialog: vi.fn<() => void>(() => {
      calls.push("openNewDirectoryDialog");
    }),
    openRenameDialog: vi.fn<(entry: SftpEntry) => void>((entry) => {
      calls.push(`openRenameDialog:${entry.path}`);
    }),
    openWorkspaceDirectory: vi.fn<(path: string) => void>((path) => {
      calls.push(`openWorkspaceDirectory:${path}`);
    }),
    pasteSftpClipboard: vi.fn<(destinationRemotePath?: string) => void>(
      (destinationRemotePath) => {
        calls.push(`pasteSftpClipboard:${destinationRemotePath ?? ""}`);
      },
    ),
    setContextMenu: vi.fn<(contextMenu: SftpContextMenuState | null) => void>(
      (nextContextMenu) => {
        calls.push(`setContextMenu:${nextContextMenu === null ? "null" : "open"}`);
      },
    ),
    setOperationStatus: vi.fn<Dispatch<SetStateAction<SftpStatus | null>>>(
      (status) => {
        calls.push(`setOperationStatus:${status === null ? "null" : "status"}`);
      },
    ),
    setShowHiddenFiles: vi.fn<Dispatch<SetStateAction<boolean>>>(),
    transferSelectedEntriesToTarget: vi.fn<() => void>(() => {
      calls.push("transferSelectedEntriesToTarget");
    }),
    uploadLocalArchive: vi.fn<
      (kind: "file" | "directory", destinationRemotePath?: string) => void
    >((kind, destinationRemotePath) => {
      calls.push(`uploadLocalArchive:${kind}:${destinationRemotePath ?? ""}`);
    }),
    uploadLocalDirectory: vi.fn<(targetRemotePath?: string) => void>(
      (targetRemotePath) => {
        calls.push(`uploadLocalDirectory:${targetRemotePath ?? ""}`);
      },
    ),
    uploadLocalFile: vi.fn<(targetRemotePath?: string) => void>(
      (targetRemotePath) => {
        calls.push(`uploadLocalFile:${targetRemotePath ?? ""}`);
      },
    ),
  };
}

function expectNoSideEffects(actions: ReturnType<typeof createActions>) {
  expect(actions.copyRemotePath).not.toHaveBeenCalled();
  expect(actions.copySelectedRemoteItem).not.toHaveBeenCalled();
  expect(actions.downloadEntry).not.toHaveBeenCalled();
  expect(actions.downloadEntryAsArchive).not.toHaveBeenCalled();
  expect(actions.downloadEntryToLocalClipboard).not.toHaveBeenCalled();
  expect(actions.downloadSelectedEntries).not.toHaveBeenCalled();
  expect(actions.loadDirectory).not.toHaveBeenCalled();
  expect(actions.openChmodDialog).not.toHaveBeenCalled();
  expect(actions.openDeleteDialog).not.toHaveBeenCalled();
  expect(actions.openEditorEntry).not.toHaveBeenCalled();
  expect(actions.openNewDirectoryDialog).not.toHaveBeenCalled();
  expect(actions.openRenameDialog).not.toHaveBeenCalled();
  expect(actions.openWorkspaceDirectory).not.toHaveBeenCalled();
  expect(actions.pasteSftpClipboard).not.toHaveBeenCalled();
  expect(actions.setOperationStatus).not.toHaveBeenCalled();
  expect(actions.setShowHiddenFiles).not.toHaveBeenCalled();
  expect(actions.transferSelectedEntriesToTarget).not.toHaveBeenCalled();
  expect(actions.uploadLocalArchive).not.toHaveBeenCalled();
  expect(actions.uploadLocalDirectory).not.toHaveBeenCalled();
  expect(actions.uploadLocalFile).not.toHaveBeenCalled();
}

function contextMenu(entry: SftpEntry): SftpContextMenuState {
  return {
    entry,
    x: 24,
    y: 48,
  };
}

function remoteEntry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const path = overrides.path ?? "/srv/app.log";
  return {
    kind: "file",
    name: path.split("/").pop() ?? "app.log",
    path,
    raw: `-rw-r--r-- ${path}`,
    ...overrides,
  };
}
