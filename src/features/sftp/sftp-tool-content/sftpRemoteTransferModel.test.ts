/**
 * SFTP 远程传输纯模型测试。
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../lib/sftpApi";
import type { SftpClipboard, SftpRemoteTransferTarget } from "./types";
import {
  SFTP_REMOTE_DOWNLOAD_DRAG_MIME,
  SFTP_REMOTE_DRAG_PAYLOAD_MIME,
  buildRemoteDownloadDragStartPlan,
  buildSftpRemoteDragPayload,
  buildSftpRemoteClipboardCopyPlan,
  buildSftpClipboardPasteIntent,
  buildSftpClipboardPastePlan,
  buildSftpTargetTransferPlan,
  hasSftpRemoteDragPayloadType,
  parseSftpRemoteDragPayload,
  remoteDragPayloadEntriesToSftpEntries,
  remoteClipboardCopySuccessMessage,
  remoteClipboardEntriesFor,
  remoteDownloadEntriesFor,
} from "./sftpRemoteTransferModel";

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

function transferTarget(
  overrides: Partial<SftpRemoteTransferTarget> = {},
): SftpRemoteTransferTarget {
  return {
    kind: "remote",
    hostId: "host-right",
    hostLabel: "Right Host",
    remotePath: "/opt/app/",
    side: "right",
    ...overrides,
  };
}

describe("sftpRemoteTransferModel", () => {
  it("uses the selected transferable set when dragging a selected entry", () => {
    const selectedFile = entry({ name: "selected.log", path: "/srv/selected.log" });
    const selectedDirectory = entry({
      kind: "directory",
      name: "data",
      path: "/srv/data",
    });

    expect(
      remoteDownloadEntriesFor({
        entry: selectedFile,
        selectedEntryPaths: new Set([selectedFile.path]),
        transferableSelectedEntries: [selectedFile, selectedDirectory],
      }),
    ).toEqual([selectedFile, selectedDirectory]);
    expect(
      remoteDownloadEntriesFor({
        entry: entry({ kind: "other", name: "socket", path: "/srv/socket" }),
        selectedEntryPaths: new Set(["/srv/socket"]),
        transferableSelectedEntries: [selectedFile],
      }),
    ).toEqual([]);
  });

  it("falls back to the selected entry when selected transferable entries are empty", () => {
    const selectedFile = entry({ name: "selected.log", path: "/srv/selected.log" });

    expect(
      remoteDownloadEntriesFor({
        entry: selectedFile,
        selectedEntryPaths: new Set([selectedFile.path]),
        transferableSelectedEntries: [],
      }),
    ).toEqual([selectedFile]);

    expect(
      buildRemoteDownloadDragStartPlan({
        entry: selectedFile,
        selectedEntryPaths: new Set([selectedFile.path]),
        transferableSelectedEntries: [],
      }),
    ).toMatchObject({
      entriesToDrag: [selectedFile],
      selectOnlyEntryPath: null,
    });
  });

  it("treats symlinks as downloadable file entries in remote drag plans", () => {
    const symlink = entry({
      kind: "symlink",
      name: "current.log",
      path: "/srv/current.log",
    });

    expect(
      buildRemoteDownloadDragStartPlan({
        entry: symlink,
        selectedEntryPaths: new Set(),
        transferableSelectedEntries: [],
      }),
    ).toEqual({
      dataTransferItems: [
        {
          type: SFTP_REMOTE_DOWNLOAD_DRAG_MIME,
          value: JSON.stringify(["/srv/current.log"]),
        },
        {
          type: "text/plain",
          value: "/srv/current.log",
        },
      ],
      entriesToDrag: [symlink],
      selectOnlyEntryPath: "/srv/current.log",
    });
  });

  it("builds a remote drag payload from the active transferable selection", () => {
    const selectedFile = entry({ name: "selected.log", path: "/srv/selected.log" });
    const selectedDirectory = entry({
      kind: "directory",
      name: "data",
      path: "/srv/data",
    });

    const plan = buildRemoteDownloadDragStartPlan({
      entry: selectedFile,
      selectedEntryPaths: new Set([selectedFile.path, selectedDirectory.path]),
      transferableSelectedEntries: [selectedFile, selectedDirectory],
    });

    expect(plan).toEqual({
      dataTransferItems: [
        {
          type: SFTP_REMOTE_DOWNLOAD_DRAG_MIME,
          value: JSON.stringify(["/srv/selected.log", "/srv/data"]),
        },
        {
          type: "text/plain",
          value: "/srv/selected.log\n/srv/data",
        },
      ],
      entriesToDrag: [selectedFile, selectedDirectory],
      selectOnlyEntryPath: null,
    });
  });

  it("adds a complete cross-pane remote drag payload when source host is known", () => {
    const selectedFile = entry({ name: "selected.log", path: "/srv/selected.log" });
    const selectedDirectory = entry({
      kind: "directory",
      name: "data",
      path: "/srv/data",
    });

    const plan = buildRemoteDownloadDragStartPlan({
      entry: selectedFile,
      selectedEntryPaths: new Set([selectedFile.path, selectedDirectory.path]),
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
      transferableSelectedEntries: [selectedFile, selectedDirectory],
    });
    const remotePayloadItem = plan?.dataTransferItems.find(
      (item) => item.type === SFTP_REMOTE_DRAG_PAYLOAD_MIME,
    );

    expect(remotePayloadItem).toBeDefined();
    expect(parseSftpRemoteDragPayload(remotePayloadItem?.value ?? "")).toEqual({
      entries: [
        { kind: "file", name: "selected.log", path: "/srv/selected.log" },
        { kind: "directory", name: "data", path: "/srv/data" },
      ],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });
  });

  it("builds and parses remote drag payloads while filtering unsupported entries", () => {
    const payload = buildSftpRemoteDragPayload({
      entries: [
        entry({ kind: "symlink", name: "current.log", path: "/srv/current.log" }),
        entry({ kind: "directory", name: "conf", path: "/srv/conf" }),
        entry({ kind: "other", name: "socket", path: "/srv/socket" }),
      ],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });

    expect(payload).toEqual({
      entries: [
        { kind: "file", name: "current.log", path: "/srv/current.log" },
        { kind: "directory", name: "conf", path: "/srv/conf" },
      ],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });
    expect(parseSftpRemoteDragPayload(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects invalid remote drag payloads and filters invalid payload entries", () => {
    expect(parseSftpRemoteDragPayload("{bad json")).toBeNull();
    expect(parseSftpRemoteDragPayload("{}")).toBeNull();
    expect(
      parseSftpRemoteDragPayload(
        JSON.stringify({
          entries: [
            { kind: "other", name: "socket", path: "/srv/socket" },
            { kind: "file", path: "/srv/app.log" },
          ],
          sourceHostId: "host-left",
          sourceHostLabel: "Left Host",
        }),
      ),
    ).toEqual({
      entries: [{ kind: "file", name: "app.log", path: "/srv/app.log" }],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    });
  });

  it("converts remote drag payload entries back to SFTP entries for transfer plans", () => {
    expect(
      remoteDragPayloadEntriesToSftpEntries([
        { kind: "file", name: "app.log", path: "/srv/app.log" },
        { kind: "directory", name: "conf", path: "/srv/conf" },
      ]),
    ).toEqual([
      {
        kind: "file",
        name: "app.log",
        path: "/srv/app.log",
        raw: "file /srv/app.log",
      },
      {
        kind: "directory",
        name: "conf",
        path: "/srv/conf",
        raw: "directory /srv/conf",
      },
    ]);
  });

  it("detects remote drag payload MIME in data transfer type collections", () => {
    expect(
      hasSftpRemoteDragPayloadType(["text/plain", SFTP_REMOTE_DRAG_PAYLOAD_MIME]),
    ).toBe(true);
    expect(
      hasSftpRemoteDragPayloadType({
        0: "text/plain",
        1: SFTP_REMOTE_DRAG_PAYLOAD_MIME,
        length: 2,
      }),
    ).toBe(true);
    expect(hasSftpRemoteDragPayloadType(["text/plain"])).toBe(false);
  });

  it("uses a single unselected entry for remote drag and requests selection sync", () => {
    const selectedFile = entry({ name: "selected.log", path: "/srv/selected.log" });
    const unselectedFile = entry({ name: "other.log", path: "/srv/other.log" });

    const plan = buildRemoteDownloadDragStartPlan({
      entry: unselectedFile,
      selectedEntryPaths: new Set([selectedFile.path]),
      transferableSelectedEntries: [selectedFile],
    });

    expect(plan?.entriesToDrag).toEqual([unselectedFile]);
    expect(plan?.selectOnlyEntryPath).toBe("/srv/other.log");
    expect(plan?.dataTransferItems).toEqual([
      {
        type: SFTP_REMOTE_DOWNLOAD_DRAG_MIME,
        value: JSON.stringify(["/srv/other.log"]),
      },
      {
        type: "text/plain",
        value: "/srv/other.log",
      },
    ]);
  });

  it("blocks remote drag for unsupported entry kinds", () => {
    expect(
      buildRemoteDownloadDragStartPlan({
        entry: entry({ kind: "other", name: "socket", path: "/srv/socket" }),
        selectedEntryPaths: new Set(["/srv/socket"]),
        transferableSelectedEntries: [],
      }),
    ).toBeNull();
  });

  it("builds SFTP clipboard entries from the active selection and filters unsupported entries", () => {
    const selectedFile = entry({ name: "app.log", path: "/srv/app.log" });
    const selectedDirectory = entry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });
    const unsupported = entry({
      kind: "other",
      name: "socket",
      path: "/srv/socket",
    });

    const clipboardEntries = remoteClipboardEntriesFor({
      entry: selectedFile,
      selectedEntries: [selectedFile, selectedDirectory, unsupported],
      selectedEntryPaths: new Set([selectedFile.path, selectedDirectory.path]),
    });

    expect(clipboardEntries).toEqual([
      { kind: "file", name: "app.log", path: "/srv/app.log" },
      { kind: "directory", name: "conf", path: "/srv/conf" },
    ]);
    expect(remoteClipboardCopySuccessMessage(clipboardEntries)).toBe(
      "已复制到 SFTP 剪贴板：2 个远程项目",
    );
    expect(remoteClipboardCopySuccessMessage([clipboardEntries[0]])).toBe(
      "已复制到 SFTP 剪贴板：/srv/app.log",
    );
  });

  it("builds a remote clipboard copy plan with status and clipboard payload", () => {
    const selectedFile = entry({ name: "app.log", path: "/srv/app.log" });
    const selectedDirectory = entry({
      kind: "directory",
      name: "conf",
      path: "/srv/conf",
    });

    expect(
      buildSftpRemoteClipboardCopyPlan({
        copiedAt: 42,
        entry: selectedFile,
        selectedEntries: [selectedFile, selectedDirectory],
        selectedEntryPaths: new Set([selectedFile.path, selectedDirectory.path]),
        sourceHostId: "host-left",
        sourceHostLabel: "Left Host",
      }),
    ).toEqual({
      clipboard: {
        copiedAt: 42,
        entries: [
          { kind: "file", name: "app.log", path: "/srv/app.log" },
          { kind: "directory", name: "conf", path: "/srv/conf" },
        ],
        sourceHostId: "host-left",
        sourceHostLabel: "Left Host",
      },
      kind: "copy",
      status: {
        kind: "success",
        message: "已复制到 SFTP 剪贴板：2 个远程项目",
      },
    });
  });

  it("returns explicit clipboard copy statuses for empty and unsupported selections", () => {
    expect(
      buildSftpRemoteClipboardCopyPlan({
        copiedAt: 42,
        entry: null,
        selectedEntries: [],
        selectedEntryPaths: new Set(),
        sourceHostId: "host-left",
        sourceHostLabel: "Left Host",
      }),
    ).toEqual({
      kind: "empty",
      status: { kind: "info", message: "请先选择一个远程项目。" },
    });

    expect(
      buildSftpRemoteClipboardCopyPlan({
        copiedAt: 42,
        entry: entry({ kind: "other", name: "socket", path: "/srv/socket" }),
        selectedEntries: [],
        selectedEntryPaths: new Set(),
        sourceHostId: "host-left",
        sourceHostLabel: "Left Host",
      }),
    ).toEqual({
      kind: "unsupported",
      status: {
        kind: "info",
        message: "该类型暂不支持复制到 SFTP 剪贴板。",
      },
    });
  });

  it("plans same-host clipboard paste with duplicate target paths", () => {
    const clipboard: SftpClipboard = {
      copiedAt: 1,
      entries: [{ kind: "file", name: "app.log", path: "/var/app.log" }],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    };

    const plan = buildSftpClipboardPastePlan({
      clipboard,
      destinationRemotePath: "/var",
      targetHostId: "host-left",
    });

    expect(plan.targetDescription).toBe("远程复制");
    expect(plan.statusMessage).toBe(
      "已加入远程复制队列：当前主机 app.log -> /var",
    );
    expect(plan.requests).toEqual([
      {
        kind: "file",
        sourceHostId: "host-left",
        sourceRemotePath: "/var/app.log",
        targetHostId: "host-left",
        targetRemotePath: "/var/app.copy.log",
      },
    ]);
  });

  it("selects local clipboard fallback when the SFTP clipboard is empty", () => {
    expect(
      buildSftpClipboardPasteIntent({
        clipboard: null,
        destinationRemotePath: "/var",
        targetHostId: "host-left",
      }),
    ).toEqual({
      emptyStatus: {
        kind: "info",
        message: "SFTP 剪贴板为空，系统剪贴板也没有本地文件。",
      },
      kind: "localFileClipboard",
      readFailureMessagePrefix: "读取系统文件剪贴板失败",
    });

    expect(
      buildSftpClipboardPasteIntent({
        clipboard: {
          copiedAt: 1,
          entries: [],
          sourceHostId: "host-left",
          sourceHostLabel: "Left Host",
        },
        destinationRemotePath: "/var",
        targetHostId: "host-left",
      }).kind,
    ).toBe("localFileClipboard");
  });

  it("selects remote copy when the SFTP clipboard has entries", () => {
    const intent = buildSftpClipboardPasteIntent({
      clipboard: {
        copiedAt: 1,
        entries: [{ kind: "file", name: "app.log", path: "/var/app.log" }],
        sourceHostId: "host-left",
        sourceHostLabel: "Left Host",
      },
      destinationRemotePath: "/backup",
      targetHostId: "host-right",
    });

    expect(intent.kind).toBe("remoteCopy");
    if (intent.kind !== "remoteCopy") {
      throw new Error("expected remote copy intent");
    }
    expect(intent.remoteCopyPlan.statusMessage).toBe(
      "已加入跨主机传输队列：Left Host app.log -> /backup",
    );
    expect(intent.remoteCopyPlan.requests[0]).toMatchObject({
      sourceHostId: "host-left",
      targetHostId: "host-right",
      targetRemotePath: "/backup/app.log",
    });
  });

  it("plans cross-host clipboard paste and selected-entry transfer requests", () => {
    const clipboard: SftpClipboard = {
      copiedAt: 1,
      entries: [{ kind: "directory", name: "conf", path: "/etc/conf" }],
      sourceHostId: "host-left",
      sourceHostLabel: "Left Host",
    };
    const pastePlan = buildSftpClipboardPastePlan({
      clipboard,
      conflictPolicy: "skip",
      destinationRemotePath: "/backup",
      targetHostId: "host-right",
    });

    expect(pastePlan.statusMessage).toBe(
      "已加入跨主机传输队列：Left Host conf -> /backup",
    );
    expect(pastePlan.requests[0]).toMatchObject({
      conflictPolicy: "skip",
      kind: "directory",
      sourceHostId: "host-left",
      sourceRemotePath: "/etc/conf",
      targetHostId: "host-right",
      targetRemotePath: "/backup/conf",
    });

    const transferPlan = buildSftpTargetTransferPlan({
      conflictPolicy: "rename",
      entries: [
        entry({ name: "app.log", path: "/srv/app.log" }),
        entry({ kind: "other", name: "socket", path: "/srv/socket" }),
      ],
      sourceHostId: "host-left",
      transferTarget: transferTarget(),
    });

    expect(transferPlan.destinationRemotePath).toBe("/opt/app");
    expect(transferPlan.statusMessage).toBe(
      "已加入传输队列：app.log、socket -> Right Host /opt/app",
    );
    expect(transferPlan.requests).toEqual([
      {
        conflictPolicy: "rename",
        kind: "file",
        sourceHostId: "host-left",
        sourceRemotePath: "/srv/app.log",
        targetHostId: "host-right",
        targetRemotePath: "/opt/app/app.log",
      },
    ]);
  });
});
