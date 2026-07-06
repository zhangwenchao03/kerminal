/**
 * SFTP workspace action facade tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import type { RemoteTargetRef } from "../../../../../src/lib/targetModel";
import type { SftpBrowserMode } from "../../../../../src/features/sftp/sftp-tool-content/sftpBrowserModeModel";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpWorkspaceDialogActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpWorkspaceDialogActions";

describe("useSftpWorkspaceDialogActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps workspace open actions as no-ops without a file target", () => {
    const { result, setters } = renderWorkspaceHook({ fileTarget: null });

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
      result.current.openEditorEntry(remoteEntry({ path: "/srv/app.conf" }));
    });

    expect(setters.setBrowserMode).not.toHaveBeenCalled();
    expect(setters.setOperationStatus).not.toHaveBeenCalled();
  });

  it("routes directory workspace actions to the right-panel workspace mode", () => {
    const { result, setters } = renderWorkspaceHook();

    act(() => {
      result.current.openWorkspaceDirectory("/srv/app");
    });

    expect(setters.setContextMenu).toHaveBeenCalledWith(null);
    expect(setters.setDialogAction).toHaveBeenCalledWith(null);
    expect(setters.setDialogStatus).toHaveBeenCalledWith(null);
    expect(setters.setBrowserMode).toHaveBeenCalledWith("workspace");
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "info",
      message: "已切到文件工作区：/srv/app",
    });
  });

  it("opens file entries in central editable workspace file tabs", () => {
    const onOpenWorkspaceFileTab = vi.fn();
    const { result, setters } = renderWorkspaceHook({
      onOpenWorkspaceFileTab,
      workspaceTarget: { hostId: "ssh-host", kind: "ssh" },
    });

    act(() => {
      result.current.openEditorEntry(
        remoteEntry({ path: "/srv/app/config.json" }),
      );
    });

    expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
      access: "editable",
      path: "/srv/app/config.json",
      rootPath: "/srv/app",
      source: "sftp",
      target: { hostId: "ssh-host", kind: "ssh" },
    });
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith(null);
  });

  it("opens container file entries in central editable workspace file tabs", () => {
    const onOpenWorkspaceFileTab = vi.fn();
    const target: RemoteTargetRef = {
      containerId: "c1",
      hostId: "ssh-host",
      kind: "dockerContainer",
      runtime: "docker",
    };
    const { result } = renderWorkspaceHook({
      onOpenWorkspaceFileTab,
      workspaceTarget: target,
    });

    act(() => {
      result.current.openEditorEntry(remoteEntry({ path: "/etc/app.yaml" }));
    });

    expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
      access: "editable",
      path: "/etc/app.yaml",
      rootPath: "/etc",
      source: "container",
      target,
    });
  });

  it("reports unsupported file entries without reopening the old workspace dialog", () => {
    const { result, setters } = renderWorkspaceHook({
      onOpenWorkspaceFileTab: vi.fn(),
      workspaceTarget: { hostId: "ssh-host", kind: "ssh" },
    });

    act(() => {
      result.current.openEditorEntry(
        remoteEntry({ kind: "directory", name: "logs", path: "/srv/logs" }),
      );
    });

    expect(setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "info",
      message: "只有普通文件支持打开到编辑器。",
    });
  });
});

function renderWorkspaceHook({
  fileTarget = sshFileTarget(),
  onOpenWorkspaceFileTab,
  workspaceTarget = fileTarget ? { hostId: fileTarget.hostId, kind: "ssh" } : null,
}: {
  fileTarget?: SftpFileTarget | null;
  onOpenWorkspaceFileTab?: Parameters<
    typeof useSftpWorkspaceDialogActions
  >[0]["onOpenWorkspaceFileTab"];
  workspaceTarget?: RemoteTargetRef | null;
} = {}) {
  const setters = createSetters();
  const hook = renderHook(() =>
    useSftpWorkspaceDialogActions({
      fileTarget,
      onOpenWorkspaceFileTab,
      setBrowserMode: setters.setBrowserMode,
      setContextMenu: setters.setContextMenu,
      setDialogAction: setters.setDialogAction,
      setDialogStatus: setters.setDialogStatus,
      setOperationStatus: setters.setOperationStatus,
      workspaceTarget,
    }),
  );

  return {
    result: hook.result,
    setters,
  };
}

function createSetters() {
  return {
    setBrowserMode: vi.fn<Dispatch<SetStateAction<SftpBrowserMode>>>(),
    setContextMenu: vi.fn<Dispatch<SetStateAction<SftpContextMenuState | null>>>(),
    setDialogAction: vi.fn<Dispatch<SetStateAction<SftpDialogAction | null>>>(),
    setDialogStatus: vi.fn<Dispatch<SetStateAction<SftpStatus | null>>>(),
    setOperationStatus: vi.fn<Dispatch<SetStateAction<SftpStatus | null>>>(),
  };
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
