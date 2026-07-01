import { describe, expect, it } from "vitest";
import type { LocalDirectoryEntry } from "../../../../src/lib/fileDialogApi";
import {
  buildSftpWorkbenchClipboardPastePlan,
  buildSftpWorkbenchLocalClipboard,
  remoteClipboardFromWorkbenchClipboard,
  wrapRemoteWorkbenchClipboard,
} from "../../../../src/features/sftp/sftpTransferClipboardModel";

describe("sftpTransferClipboardModel", () => {
  it("builds a local clipboard from transferable local entries", () => {
    const plan = buildSftpWorkbenchLocalClipboard({
      copiedAt: 1782054300000,
      entries: [
        localEntry({ kind: "file", name: "app.log", path: "C:/logs/app.log" }),
        localEntry({ kind: "directory", name: "conf", path: "C:/logs/conf" }),
        localEntry({ kind: "other", name: "socket", path: "C:/logs/socket" }),
      ],
      sourcePath: "C:/logs",
    });

    expect(plan).toEqual({
      clipboard: {
        copiedAt: 1782054300000,
        entries: [
          { kind: "file", name: "app.log", path: "C:/logs/app.log" },
          { kind: "directory", name: "conf", path: "C:/logs/conf" },
        ],
        kind: "local",
        sourcePath: "C:/logs",
      },
      kind: "copy",
      status: {
        kind: "success",
        message: "已复制 2 个本机项目。",
      },
    });
  });

  it("returns an empty status when no transferable local entry is selected", () => {
    expect(
      buildSftpWorkbenchLocalClipboard({
        copiedAt: 1782054300000,
        entries: [localEntry({ kind: "other", name: "socket" })],
        sourcePath: "C:/logs",
      }),
    ).toEqual({
      kind: "empty",
      status: {
        kind: "info",
        message: "请先选择可复制的本机文件或目录。",
      },
    });
  });

  it("wraps and unwraps remote clipboard values", () => {
    const remoteClipboard = {
      copiedAt: 1782054300000,
      entries: [{ kind: "file" as const, name: "app.log", path: "/srv/app.log" }],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    };

    expect(
      remoteClipboardFromWorkbenchClipboard(
        wrapRemoteWorkbenchClipboard(remoteClipboard),
      ),
    ).toBe(remoteClipboard);
    expect(remoteClipboardFromWorkbenchClipboard(null)).toBeNull();
    expect(
      remoteClipboardFromWorkbenchClipboard({
        copiedAt: 1782054300000,
        entries: [{ kind: "file", name: "app.log", path: "C:/logs/app.log" }],
        kind: "local",
        sourcePath: "C:/logs",
      }),
    ).toBeNull();
  });

  it("resolves a local clipboard paste into remote upload tasks", () => {
    expect(
      buildSftpWorkbenchClipboardPastePlan({
        clipboard: {
          copiedAt: 1782054300000,
          entries: [
            { kind: "file", name: "app.log", path: "C:/logs/app.log" },
            { kind: "directory", name: "conf", path: "C:/logs/conf" },
          ],
          kind: "local",
          sourcePath: "C:/logs",
        },
        target: {
          hostId: "host-right",
          hostLabel: "Right Host",
          kind: "remote",
          path: "/srv",
        },
      }),
    ).toEqual({
      kind: "transfer",
      plan: {
        conflictPolicy: "ask",
        entries: [
          { kind: "file", name: "app.log", path: "C:/logs/app.log" },
          { kind: "directory", name: "conf", path: "C:/logs/conf" },
        ],
        operation: "upload",
        requestedBy: "paste",
        source: { kind: "local", path: "C:/logs" },
        target: {
          hostId: "host-right",
          hostLabel: "Right Host",
          kind: "remote",
          path: "/srv",
        },
        tasks: [
          {
            entryKind: "file",
            entryName: "app.log",
            sourceEntryPath: "C:/logs/app.log",
            targetEntryPath: "/srv/app.log",
            targetPath: "/srv",
          },
          {
            entryKind: "directory",
            entryName: "conf",
            sourceEntryPath: "C:/logs/conf",
            targetEntryPath: "/srv/conf",
            targetPath: "/srv",
          },
        ],
      },
      status: {
        kind: "success",
        message: "已粘贴 2 个本机项目。",
      },
    });
  });

  it("reports unsupported local-to-local paste targets", () => {
    expect(
      buildSftpWorkbenchClipboardPastePlan({
        clipboard: {
          copiedAt: 1782054300000,
          entries: [{ kind: "file", name: "app.log", path: "C:/logs/app.log" }],
          kind: "local",
          sourcePath: "C:/logs",
        },
        target: { kind: "local", path: "C:/target" },
      }),
    ).toEqual({
      kind: "unsupported",
      status: {
        kind: "error",
        message:
          "暂不支持本机到本机复制，请用系统文件管理器。",
      },
    });
  });

  it("reports unsupported non-local clipboard paste targets", () => {
    expect(
      buildSftpWorkbenchClipboardPastePlan({
        clipboard: wrapRemoteWorkbenchClipboard({
          copiedAt: 1782054300000,
          entries: [
            { kind: "file", name: "app.log", path: "/srv/app.log" },
          ],
          sourceHostId: "host-left",
          sourceHostLabel: "Left Host",
        }),
        target: { kind: "local", path: "C:/target" },
      }),
    ).toEqual({
      kind: "unsupported",
      status: {
        kind: "error",
        message: "当前剪贴板暂不支持粘贴到此目标。",
      },
    });
  });
});

function localEntry({
  kind,
  name,
  path = `C:/logs/${name}`,
}: {
  kind: LocalDirectoryEntry["kind"];
  name: string;
  path?: string;
}): LocalDirectoryEntry {
  return {
    kind,
    name,
    path,
    raw: `${kind} ${path}`,
  };
}
