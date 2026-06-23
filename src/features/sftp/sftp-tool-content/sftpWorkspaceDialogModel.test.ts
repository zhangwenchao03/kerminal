/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../lib/sftpApi";
import {
  buildOpenWorkspaceDirectoryDialog,
  buildOpenWorkspaceEditorDialog,
  resolveWorkspaceDialogCloseDecision,
} from "./sftpWorkspaceDialogModel";

describe("sftpWorkspaceDialogModel", () => {
  it("normalizes a directory path before opening the workspace dialog", () => {
    expect(buildOpenWorkspaceDirectoryDialog("//srv//app//")).toEqual({
      openCommand: null,
      rootPath: "/srv/app",
    });
  });

  it("builds an editor open command for regular files", () => {
    expect(
      buildOpenWorkspaceEditorDialog({
        entry: entry({ name: "config.json", path: "/srv/app/config.json" }),
        nonce: 42,
      }),
    ).toEqual({
      dialog: {
        openCommand: { nonce: 42, path: "/srv/app/config.json" },
        rootPath: "/srv/app",
      },
      kind: "open",
    });
  });

  it("rejects non-file editor targets with the existing status message", () => {
    expect(
      buildOpenWorkspaceEditorDialog({
        entry: entry({ kind: "directory", name: "logs", path: "/srv/logs" }),
        nonce: 42,
      }),
    ).toEqual({
      kind: "unsupported",
      status: {
        kind: "info",
        message: "只有普通文件支持打开到编辑器。",
      },
    });
  });

  it("keeps dirty workspace close blocked until confirmed", () => {
    expect(resolveWorkspaceDialogCloseDecision({ confirmed: false, dirty: false })).toEqual({
      kind: "close",
    });
    expect(resolveWorkspaceDialogCloseDecision({ confirmed: false, dirty: true })).toEqual({
      kind: "blocked",
    });
    expect(resolveWorkspaceDialogCloseDecision({ confirmed: true, dirty: true })).toEqual({
      kind: "close",
    });
  });
});

function entry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const name = overrides.name ?? "app.log";
  return {
    kind: "file",
    name,
    path: `/srv/${name}`,
    permissions: "-rw-r--r--",
    raw: name,
    ...overrides,
  };
}
