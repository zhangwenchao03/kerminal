/**
 * SFTP context menu action execution decision model.
 *
 * @author kongweiguang
 */

import type { SftpEntry, SftpTransferKind } from "../../../lib/sftpApi";
import type { SftpMenuAction } from "./types";

export type SftpContextMenuActionDecision =
  | { kind: "noop" }
  | { kind: "refresh"; path: string }
  | { kind: "toggleHidden" }
  | { kind: "copyPath"; path: string }
  | { entry: SftpEntry; kind: "copyItem" }
  | { destinationRemotePath: string; kind: "pasteClipboard" }
  | { kind: "uploadFile"; targetRemotePath: string }
  | { kind: "uploadDirectory"; targetRemotePath: string }
  | {
      destinationRemotePath: string;
      kind: "uploadArchive";
      transferKind: SftpTransferKind;
    }
  | { kind: "newDirectory" }
  | { kind: "openDirectory"; path: string }
  | { kind: "workspaceDirectory"; path: string }
  | { kind: "transferToTarget" }
  | { entry: SftpEntry; kind: "preview" }
  | { entry: SftpEntry; kind: "download" }
  | { entry: SftpEntry; kind: "downloadArchive" }
  | { entry: SftpEntry; kind: "downloadClipboard" }
  | { kind: "uploadFileInto"; targetRemotePath: string }
  | { kind: "uploadDirectoryInto"; targetRemotePath: string }
  | { entry: SftpEntry; kind: "rename" }
  | { entry: SftpEntry; kind: "chmod" }
  | { entry: SftpEntry; kind: "delete" };

export type SftpContextMenuActionOptions = {
  action: SftpMenuAction;
  currentPath: string;
  entry: SftpEntry | null;
};

export function resolveSftpContextMenuAction({
  action,
  currentPath,
  entry,
}: SftpContextMenuActionOptions): SftpContextMenuActionDecision {
  if (action === "refresh") {
    return { kind: "refresh", path: currentPath };
  }
  if (action === "toggleHidden") {
    return { kind: "toggleHidden" };
  }
  if (action === "copyPath") {
    return { kind: "copyPath", path: entry?.path ?? currentPath };
  }
  if (action === "pasteClipboard") {
    return {
      destinationRemotePath:
        entry && entry.kind === "directory" ? entry.path : currentPath,
      kind: "pasteClipboard",
    };
  }
  if (action === "uploadFile") {
    return { kind: "uploadFile", targetRemotePath: currentPath };
  }
  if (action === "uploadDirectory") {
    return { kind: "uploadDirectory", targetRemotePath: currentPath };
  }
  if (action === "uploadFileArchive") {
    return {
      destinationRemotePath: currentPath,
      kind: "uploadArchive",
      transferKind: "file",
    };
  }
  if (action === "uploadDirectoryArchive") {
    return {
      destinationRemotePath: currentPath,
      kind: "uploadArchive",
      transferKind: "directory",
    };
  }
  if (action === "newDirectory") {
    return { kind: "newDirectory" };
  }

  if (!entry) {
    return { kind: "noop" };
  }

  if (action === "open") {
    return entry.kind === "directory"
      ? { kind: "openDirectory", path: entry.path }
      : { kind: "noop" };
  }
  if (action === "workspace") {
    return entry.kind === "directory"
      ? { kind: "workspaceDirectory", path: entry.path }
      : { kind: "noop" };
  }
  if (action === "transferToTarget") {
    return { kind: "transferToTarget" };
  }
  if (action === "copyItem") {
    return { entry, kind: "copyItem" };
  }
  if (action === "preview") {
    return { entry, kind: "preview" };
  }
  if (action === "download") {
    return { entry, kind: "download" };
  }
  if (action === "downloadArchive") {
    return { entry, kind: "downloadArchive" };
  }
  if (action === "downloadClipboard") {
    return { entry, kind: "downloadClipboard" };
  }
  if (action === "uploadFileInto") {
    return { kind: "uploadFileInto", targetRemotePath: entry.path };
  }
  if (action === "uploadDirectoryInto") {
    return { kind: "uploadDirectoryInto", targetRemotePath: entry.path };
  }
  if (action === "rename") {
    return { entry, kind: "rename" };
  }
  if (action === "chmod") {
    return { entry, kind: "chmod" };
  }
  if (action === "delete") {
    return { entry, kind: "delete" };
  }

  return { kind: "noop" };
}
