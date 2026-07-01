/**
 * SFTP workspace dialog facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpWorkspaceDialogActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpWorkspaceDialogActions";

type ActionCall = string;

describe("useSftpWorkspaceDialogActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("keeps workspace open actions as no-ops without a file target", () => {
    const { result, setters } = renderWorkspaceHook({ fileTarget: null });

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
      result.current.openEditorEntry(remoteEntry({ path: "/srv/app.conf" }));
    });

    expect(result.current.workspaceDialog).toBeNull();
    expect(result.current.workspaceDirty).toBe(false);
    expect(result.current.workspaceCloseBlocked).toBe(false);
    expectNoUiSetters(setters);
  });

  it("opens directory workspaces after clearing transient UI and dirty state", () => {
    const { calls, result, setters } = renderWorkspaceHook();

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
      result.current.setWorkspaceDirty(true);
    });
    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/srv/app",
    });
    expect(result.current.workspaceDirty).toBe(true);

    act(() => {
      result.current.closeWorkspaceDialog();
    });
    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/srv/app",
    });
    expect(result.current.workspaceCloseBlocked).toBe(true);
    expect(result.current.workspaceCloseConfirmationOpen).toBe(true);

    act(() => {
      result.current.openWorkspaceDirectory("//var//logs//");
    });

    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/var/logs",
    });
    expect(result.current.workspaceDirty).toBe(false);
    expect(result.current.workspaceCloseBlocked).toBe(false);
    expect(result.current.workspaceCloseConfirmationOpen).toBe(false);
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith(null);
    expect(calls).toEqual([
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:null",
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:null",
    ]);
  });

  it("opens file editor workspaces and rejects unsupported editor targets", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const { result, setters } = renderWorkspaceHook();
    const entry = remoteEntry({
      name: "config.json",
      path: "/srv/app/config.json",
    });

    act(() => {
      result.current.openEditorEntry(entry);
    });

    expect(result.current.workspaceDialog).toEqual({
      openCommand: { nonce: 42, path: "/srv/app/config.json" },
      rootPath: "/srv/app",
    });
    expect(setters.setContextMenu).toHaveBeenLastCalledWith(null);
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith(null);

    const directory = remoteEntry({
      kind: "directory",
      name: "logs",
      path: "/srv/app/logs",
    });
    act(() => {
      result.current.openEditorEntry(directory);
    });

    expect(result.current.workspaceDialog).toEqual({
      openCommand: { nonce: 42, path: "/srv/app/config.json" },
      rootPath: "/srv/app",
    });
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "info",
      message: "只有普通文件支持打开到编辑器。",
    });
  });

  it("blocks dirty workspace close until confirmation succeeds", () => {
    const { result } = renderWorkspaceHook();

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
      result.current.setWorkspaceDirty(true);
    });

    act(() => {
      result.current.closeWorkspaceDialog();
    });

    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/srv/app",
    });
    expect(result.current.workspaceDirty).toBe(true);
    expect(result.current.workspaceCloseBlocked).toBe(true);
    expect(result.current.workspaceCloseConfirmationOpen).toBe(true);

    act(() => {
      result.current.cancelWorkspaceCloseConfirmation();
    });
    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/srv/app",
    });
    expect(result.current.workspaceDirty).toBe(true);
    expect(result.current.workspaceCloseBlocked).toBe(true);
    expect(result.current.workspaceCloseConfirmationOpen).toBe(false);

    act(() => {
      result.current.closeWorkspaceDialog();
    });
    expect(result.current.workspaceCloseConfirmationOpen).toBe(true);

    act(() => {
      result.current.confirmWorkspaceDialogClose();
    });

    expect(result.current.workspaceDialog).toBeNull();
    expect(result.current.workspaceDirty).toBe(false);
    expect(result.current.workspaceCloseBlocked).toBe(false);
    expect(result.current.workspaceCloseConfirmationOpen).toBe(false);
  });

  it("expands the workspace inside the current app without closing it", () => {
    const { result } = renderWorkspaceHook();

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
    });

    act(() => {
      result.current.setWorkspaceExpanded(true);
    });

    expect(result.current.workspaceExpanded).toBe(true);
    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/srv/app",
    });
  });

  it("resets the expanded workspace state when opening a different workspace", () => {
    const { result } = renderWorkspaceHook();

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
      result.current.setWorkspaceExpanded(true);
    });
    expect(result.current.workspaceExpanded).toBe(true);

    act(() => {
      result.current.openWorkspaceDirectory("/var/logs");
    });

    expect(result.current.workspaceDialog).toEqual({
      openCommand: null,
      rootPath: "/var/logs",
    });
    expect(result.current.workspaceExpanded).toBe(false);
  });
});

function renderWorkspaceHook({
  calls = [],
  fileTarget = sshFileTarget(),
}: {
  calls?: ActionCall[];
  fileTarget?: SftpFileTarget | null;
} = {}) {
  const setters = createSetters(calls);
  const hook = renderHook(() =>
    useSftpWorkspaceDialogActions({
      fileTarget,
      setContextMenu: setters.setContextMenu,
      setDialogAction: setters.setDialogAction,
      setDialogStatus: setters.setDialogStatus,
      setOperationStatus: setters.setOperationStatus,
    }),
  );

  return {
    calls,
    result: hook.result,
    setters,
  };
}

function createSetters(calls: ActionCall[]) {
  return {
    setContextMenu: vi.fn<
      Dispatch<SetStateAction<SftpContextMenuState | null>>
    >((contextMenu) => {
      calls.push(`setContextMenu:${contextMenu === null ? "null" : "open"}`);
    }),
    setDialogAction: vi.fn<Dispatch<SetStateAction<SftpDialogAction | null>>>(
      (action) => {
        calls.push(`setDialogAction:${formatDialogAction(action)}`);
      },
    ),
    setDialogStatus: vi.fn<Dispatch<SetStateAction<SftpStatus | null>>>(
      (status) => {
        calls.push(`setDialogStatus:${formatStatus(status)}`);
      },
    ),
    setOperationStatus: vi.fn<Dispatch<SetStateAction<SftpStatus | null>>>(
      (status) => {
        calls.push(`setOperationStatus:${formatStatus(status)}`);
      },
    ),
  };
}

function expectNoUiSetters(setters: ReturnType<typeof createSetters>) {
  expect(setters.setContextMenu).not.toHaveBeenCalled();
  expect(setters.setDialogAction).not.toHaveBeenCalled();
  expect(setters.setDialogStatus).not.toHaveBeenCalled();
  expect(setters.setOperationStatus).not.toHaveBeenCalled();
}

function formatDialogAction(
  action: SetStateAction<SftpDialogAction | null>,
) {
  if (typeof action === "function") {
    return "updater";
  }
  return action?.kind ?? "null";
}

function formatStatus(status: SetStateAction<SftpStatus | null>) {
  if (typeof status === "function") {
    return "updater";
  }
  return status ? `${status.kind}:${status.message}` : "null";
}

function sshFileTarget(): SftpFileTarget {
  return {
    hostId: "ssh-host",
    initialPath: "/srv",
    kind: "ssh",
    protocol: "sftp://",
    summary: "deploy@prod.internal:22",
  };
}

function remoteEntry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const path = overrides.path ?? "/srv/app.log";
  return {
    kind: "file",
    name: path.split("/").pop() ?? "app.log",
    path,
    permissions: "-rw-r--r--",
    raw: `-rw-r--r-- ${path}`,
    ...overrides,
  };
}
