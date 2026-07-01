/**
 * SFTP context menu action model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import { resolveSftpContextMenuAction } from "../../../../../src/features/sftp/sftp-tool-content/sftpContextMenuActionModel";
import type { SftpMenuAction } from "../../../../../src/features/sftp/sftp-tool-content/types";

function entry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const name = overrides.name ?? "app.log";
  return {
    kind: "file",
    name,
    path: `/srv/${name}`,
    raw: name,
    ...overrides,
  };
}

function resolve(action: SftpMenuAction, target: SftpEntry | null = null) {
  return resolveSftpContextMenuAction({
    action,
    currentPath: "/srv",
    entry: target,
  });
}

describe("sftpContextMenuActionModel", () => {
  it("maps refresh and hidden toggle to global actions", () => {
    expect(resolve("refresh")).toEqual({ kind: "refresh", path: "/srv" });
    expect(resolve("toggleHidden")).toEqual({ kind: "toggleHidden" });
  });

  it("copies the entry path and falls back to the current directory", () => {
    expect(resolve("copyPath")).toEqual({ kind: "copyPath", path: "/srv" });
    expect(resolve("copyPath", entry({ path: "/srv/app.log" }))).toEqual({
      kind: "copyPath",
      path: "/srv/app.log",
    });
  });

  it("pastes into a directory entry or the current directory", () => {
    expect(resolve("pasteClipboard")).toEqual({
      destinationRemotePath: "/srv",
      kind: "pasteClipboard",
    });
    expect(
      resolve("pasteClipboard", entry({ kind: "directory", path: "/srv/conf" })),
    ).toEqual({
      destinationRemotePath: "/srv/conf",
      kind: "pasteClipboard",
    });
    expect(resolve("pasteClipboard", entry({ path: "/srv/app.log" }))).toEqual({
      destinationRemotePath: "/srv",
      kind: "pasteClipboard",
    });
  });

  it("maps current-directory upload actions to the current path", () => {
    expect(resolve("uploadFile")).toEqual({
      kind: "uploadFile",
      targetRemotePath: "/srv",
    });
    expect(resolve("uploadDirectory")).toEqual({
      kind: "uploadDirectory",
      targetRemotePath: "/srv",
    });
    expect(resolve("uploadFileArchive")).toEqual({
      destinationRemotePath: "/srv",
      kind: "uploadArchive",
      transferKind: "file",
    });
    expect(resolve("uploadDirectoryArchive")).toEqual({
      destinationRemotePath: "/srv",
      kind: "uploadArchive",
      transferKind: "directory",
    });
  });

  it("only opens directories for navigation and workspace actions", () => {
    const directory = entry({ kind: "directory", path: "/srv/conf" });
    expect(resolve("workspace")).toEqual({
      kind: "workspaceDirectory",
      path: "/srv",
    });
    expect(resolve("open", directory)).toEqual({
      kind: "openDirectory",
      path: "/srv/conf",
    });
    expect(resolve("workspace", directory)).toEqual({
      kind: "workspaceDirectory",
      path: "/srv/conf",
    });
    expect(resolve("open", entry({ path: "/srv/app.log" }))).toEqual({
      kind: "noop",
    });
    expect(resolve("workspace", entry({ path: "/srv/app.log" }))).toEqual({
      kind: "noop",
    });
  });

  it("keeps entry-scoped actions as no-ops without an entry", () => {
    const entryActions: SftpMenuAction[] = [
      "copyItem",
      "transferToTarget",
      "preview",
      "download",
      "downloadArchive",
      "downloadClipboard",
      "uploadFileInto",
      "uploadDirectoryInto",
      "rename",
      "chmod",
      "delete",
    ];

    for (const action of entryActions) {
      expect(resolve(action)).toEqual({ kind: "noop" });
    }
  });

  it("maps entry-scoped actions to their target entry or path", () => {
    const file = entry({ path: "/srv/app.log" });
    expect(resolve("copyItem", file)).toEqual({ entry: file, kind: "copyItem" });
    expect(resolve("transferToTarget", file)).toEqual({
      kind: "transferToTarget",
    });
    expect(resolve("preview", file)).toEqual({ entry: file, kind: "preview" });
    expect(resolve("download", file)).toEqual({ entry: file, kind: "download" });
    expect(resolve("downloadArchive", file)).toEqual({
      entry: file,
      kind: "downloadArchive",
    });
    expect(resolve("downloadClipboard", file)).toEqual({
      entry: file,
      kind: "downloadClipboard",
    });
    expect(resolve("uploadFileInto", file)).toEqual({
      kind: "uploadFileInto",
      targetRemotePath: "/srv/app.log",
    });
    expect(resolve("uploadDirectoryInto", file)).toEqual({
      kind: "uploadDirectoryInto",
      targetRemotePath: "/srv/app.log",
    });
    expect(resolve("rename", file)).toEqual({ entry: file, kind: "rename" });
    expect(resolve("chmod", file)).toEqual({ entry: file, kind: "chmod" });
    expect(resolve("delete", file)).toEqual({ entry: file, kind: "delete" });
  });
});
