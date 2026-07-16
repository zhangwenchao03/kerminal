/**
 * SFTP dialog facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpDialogActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpDialogActions";

const sftpApiMocks = vi.hoisted(() => ({
  chmodSftpPath: vi.fn<(request: unknown) => Promise<boolean>>(),
  createSftpDirectory: vi.fn<(request: unknown) => Promise<boolean>>(),
  deleteSftpPath: vi.fn<(request: unknown) => Promise<boolean>>(),
  renameSftpPath: vi.fn<(request: unknown) => Promise<boolean>>(),
}));

const dockerApiMocks = vi.hoisted(() => ({
  chmodDockerContainerPath: vi.fn<(request: unknown) => Promise<boolean>>(),
  createDockerContainerDirectory: vi.fn<(request: unknown) => Promise<boolean>>(),
  deleteDockerContainerPath: vi.fn<(request: unknown) => Promise<boolean>>(),
  renameDockerContainerPath: vi.fn<(request: unknown) => Promise<boolean>>(),
}));

vi.mock("../../../../../src/lib/sftpApi", () => ({
  chmodSftpPath: sftpApiMocks.chmodSftpPath,
  createSftpDirectory: sftpApiMocks.createSftpDirectory,
  deleteSftpPath: sftpApiMocks.deleteSftpPath,
  renameSftpPath: sftpApiMocks.renameSftpPath,
}));

vi.mock("../../../../../src/lib/containerFilesApi", () => ({
  chmodDockerContainerPath: dockerApiMocks.chmodDockerContainerPath,
  createDockerContainerDirectory: dockerApiMocks.createDockerContainerDirectory,
  deleteDockerContainerPath: dockerApiMocks.deleteDockerContainerPath,
  renameDockerContainerPath: dockerApiMocks.renameDockerContainerPath,
}));

type ActionCall = string;

describe("useSftpDialogActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(sftpApiMocks).forEach((mock) => mock.mockResolvedValue(true));
    Object.values(dockerApiMocks).forEach((mock) =>
      mock.mockResolvedValue(true),
    );
  });

  it("opens dialog actions with default paths and clears transient UI state", () => {
    const fileEntry = remoteEntry({ path: "/srv/app.log" });
    const executableEntry = remoteEntry({
      path: "/srv/run.sh",
      permissions: "-rwxr-xr-x",
    });
    const directoryEntry = remoteEntry({
      kind: "directory",
      name: "logs",
      path: "/srv/logs",
    });
    const { result, setters } = renderDialogHook({
      currentPath: "/srv",
    });

    act(() => result.current.openNewDirectoryDialog());
    expect(setters.setContextMenu).toHaveBeenLastCalledWith(null);
    expect(setters.setDialogStatus).toHaveBeenLastCalledWith(null);
    expect(setters.setDialogAction).toHaveBeenLastCalledWith({
      kind: "mkdir",
      path: "/srv/new-folder",
    });

    act(() => result.current.openRenameDialog(fileEntry));
    expect(setters.setDialogAction).toHaveBeenLastCalledWith({
      entry: fileEntry,
      kind: "rename",
      newName: "app.log",
    });

    act(() => result.current.openChmodDialog(executableEntry));
    expect(setters.setDialogAction).toHaveBeenLastCalledWith({
      entry: executableEntry,
      kind: "chmod",
      mode: "755",
    });

    act(() => result.current.openDeleteDialog([directoryEntry]));
    expect(setters.setDialogAction).toHaveBeenLastCalledWith({
      entries: [directoryEntry],
      kind: "delete",
    });
  });

  it("keeps submit as a no-op without an action or target", async () => {
    const noAction = renderDialogHook({ dialogAction: null });

    await act(async () => {
      await noAction.result.current.submitDialogAction();
    });

    expectNoApiCalls();
    expect(noAction.setters.setDialogBusy).not.toHaveBeenCalled();
    expect(noAction.setters.loadDirectory).not.toHaveBeenCalled();

    const noTarget = renderDialogHook({
      dialogAction: { kind: "mkdir", path: "/srv/logs" },
      fileTarget: null,
    });

    await act(async () => {
      await noTarget.result.current.submitDialogAction();
    });

    expectNoApiCalls();
    expect(noTarget.setters.setDialogBusy).not.toHaveBeenCalled();
    expect(noTarget.setters.loadDirectory).not.toHaveBeenCalled();
  });

  it("reports blockers before entering busy state or calling remote APIs", async () => {
    const { result, setters } = renderDialogHook({
      dialogAction: { kind: "chmod", mode: "88", entry: remoteEntry() },
    });

    await act(async () => {
      await result.current.submitDialogAction();
    });

    expect(setters.setDialogStatus).toHaveBeenCalledWith({
      kind: "error",
      message: "权限模式需要是 3 或 4 位八进制数字，例如 644 或 0755。",
    });
    expect(setters.setDialogBusy).not.toHaveBeenCalled();
    expect(setters.setOperationStatus).not.toHaveBeenCalled();
    expect(setters.loadDirectory).not.toHaveBeenCalled();
    expectNoApiCalls();
  });

  it("runs SSH dialog operations and closes the dialog after refresh succeeds", async () => {
    const mkdir = renderDialogHook({
      calls: [],
      currentPath: "/srv",
      dialogAction: { kind: "mkdir", path: "logs" },
    });

    await act(async () => {
      await mkdir.result.current.submitDialogAction();
    });

    expect(sftpApiMocks.createSftpDirectory).toHaveBeenCalledWith({
      hostId: "ssh-host",
      path: "/srv/logs",
    });
    expect(mkdir.setters.loadDirectory).toHaveBeenCalledWith("/srv");
    expect(mkdir.calls).toEqual([
      "setDialogBusy:true",
      "setDialogStatus:null",
      "setOperationStatus:null",
      "loadDirectory:/srv",
      "setOperationStatus:success:目录已创建：/srv/logs",
      "setDialogAction:null",
      "setDialogBusy:false",
    ]);

    const entry = remoteEntry({ path: "/srv/app.log" });
    const rename = renderDialogHook({
      dialogAction: { entry, kind: "rename", newName: "app.old.log" },
    });

    await act(async () => {
      await rename.result.current.submitDialogAction();
    });

    expect(sftpApiMocks.renameSftpPath).toHaveBeenCalledWith({
      fromPath: "/srv/app.log",
      hostId: "ssh-host",
      toPath: "/srv/app.old.log",
    });
    expect(rename.setters.setDialogAction).toHaveBeenCalledWith(null);

    const chmod = renderDialogHook({
      dialogAction: { entry, kind: "chmod", mode: " 0644 " },
    });

    await act(async () => {
      await chmod.result.current.submitDialogAction();
    });

    expect(sftpApiMocks.chmodSftpPath).toHaveBeenCalledWith({
      hostId: "ssh-host",
      mode: "0644",
      path: "/srv/app.log",
    });

    const remove = renderDialogHook({
      dialogAction: {
        entries: [remoteEntry({ kind: "directory" })],
        kind: "delete",
      },
    });

    await act(async () => {
      await remove.result.current.submitDialogAction();
    });

    expect(sftpApiMocks.deleteSftpPath).toHaveBeenCalledWith({
      directory: true,
      hostId: "ssh-host",
      path: "/srv/app.log",
    });
  });

  it("runs Docker dialog operations with container target context", async () => {
    const fileTarget = dockerFileTarget();
    const entry = remoteEntry({
      name: "config.json",
      path: "/app/config.json",
    });

    const mkdir = renderDialogHook({
      currentPath: "/app",
      dialogAction: { kind: "mkdir", path: "logs" },
      fileTarget,
    });

    await act(async () => {
      await mkdir.result.current.submitDialogAction();
    });

    expect(dockerApiMocks.createDockerContainerDirectory).toHaveBeenCalledWith({
      containerId: "container-1",
      hostId: "docker-host",
      path: "/app/logs",
      runtime: "docker",
    });

    const rename = renderDialogHook({
      currentPath: "/app",
      dialogAction: { entry, kind: "rename", newName: "config.old.json" },
      fileTarget,
    });

    await act(async () => {
      await rename.result.current.submitDialogAction();
    });

    expect(dockerApiMocks.renameDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-1",
      fromPath: "/app/config.json",
      hostId: "docker-host",
      runtime: "docker",
      toPath: "/app/config.old.json",
    });

    const chmod = renderDialogHook({
      currentPath: "/app",
      dialogAction: { entry, kind: "chmod", mode: "755" },
      fileTarget,
    });

    await act(async () => {
      await chmod.result.current.submitDialogAction();
    });

    expect(dockerApiMocks.chmodDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-1",
      hostId: "docker-host",
      mode: "755",
      path: "/app/config.json",
      runtime: "docker",
    });

    const remove = renderDialogHook({
      currentPath: "/app",
      dialogAction: { entries: [entry], kind: "delete" },
      fileTarget,
    });

    await act(async () => {
      await remove.result.current.submitDialogAction();
    });

    expect(dockerApiMocks.deleteDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-1",
      directory: false,
      hostId: "docker-host",
      path: "/app/config.json",
      runtime: "docker",
    });
  });

  it("keeps failed operations open and clears busy state", async () => {
    sftpApiMocks.createSftpDirectory.mockRejectedValueOnce(
      new Error("permission denied password=dialog-secret"),
    );
    const { result, setters } = renderDialogHook({
      dialogAction: { kind: "mkdir", path: "/srv/logs" },
    });

    await act(async () => {
      await result.current.submitDialogAction();
    });

    expect(setters.setDialogStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: "文件操作未完成。请检查名称、权限或目标位置后重试。",
    });
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: expect.stringContaining("/srv/logs"),
    });
    const status =
      setters.setOperationStatus.mock.calls[
        setters.setOperationStatus.mock.calls.length - 1
      ]?.[0] as
      | SftpStatus
      | null;
    expect(status?.message).toContain('password="[已隐藏]"');
    expect(status?.message).not.toContain("dialog-secret");
    expect(setters.setDialogAction).not.toHaveBeenCalledWith(null);
    expect(setters.loadDirectory).not.toHaveBeenCalled();
    expect(setters.setDialogBusy).toHaveBeenLastCalledWith(false);
  });

  it("runs batch delete operations and keeps partial failures open", async () => {
    const file = remoteEntry({ name: "app.log", path: "/srv/app.log" });
    const directory = remoteEntry({
      kind: "directory",
      name: "logs",
      path: "/srv/logs",
    });
    sftpApiMocks.deleteSftpPath
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(
        new Error("permission denied token=dialog-batch-secret"),
      );
    const { result, setters } = renderDialogHook({
      dialogAction: { entries: [file, directory], kind: "delete" },
    });

    await act(async () => {
      await result.current.submitDialogAction();
    });

    expect(sftpApiMocks.deleteSftpPath).toHaveBeenNthCalledWith(1, {
      directory: false,
      hostId: "ssh-host",
      path: "/srv/app.log",
    });
    expect(sftpApiMocks.deleteSftpPath).toHaveBeenNthCalledWith(2, {
      directory: true,
      hostId: "ssh-host",
      path: "/srv/logs",
    });
    expect(setters.loadDirectory).toHaveBeenCalledWith("/srv");
    expect(setters.setDialogAction).not.toHaveBeenCalledWith(null);
    expect(setters.setDialogStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message:
        "已完成 1 项，1 项未处理。请检查权限或目标位置后重试。",
    });
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: expect.stringContaining("/srv/logs"),
    });
    const status =
      setters.setOperationStatus.mock.calls[
        setters.setOperationStatus.mock.calls.length - 1
      ]?.[0] as
      | SftpStatus
      | null;
    expect(status?.message).toContain('token="[已隐藏]"');
    expect(status?.message).not.toContain("dialog-batch-secret");
  });
});

function renderDialogHook({
  calls = [],
  currentPath = "/srv",
  dialogAction = { kind: "mkdir", path: "/srv/logs" },
  fileTarget = sshFileTarget(),
}: {
  calls?: ActionCall[];
  currentPath?: string;
  dialogAction?: SftpDialogAction | null;
  fileTarget?: SftpFileTarget | null;
} = {}) {
  const setters = createSetters(calls);
  const hook = renderHook(() =>
    useSftpDialogActions({
      currentPath,
      dialogAction,
      fileTarget,
      loadDirectory: setters.loadDirectory,
      setContextMenu: setters.setContextMenu,
      setDialogAction: setters.setDialogAction,
      setDialogBusy: setters.setDialogBusy,
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
    loadDirectory: vi.fn<(path: string) => Promise<void>>(async (path) => {
      calls.push(`loadDirectory:${path}`);
    }),
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
    setDialogBusy: vi.fn<Dispatch<SetStateAction<boolean>>>((busy) => {
      calls.push(`setDialogBusy:${String(busy)}`);
    }),
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

function expectNoApiCalls() {
  expect(sftpApiMocks.createSftpDirectory).not.toHaveBeenCalled();
  expect(sftpApiMocks.renameSftpPath).not.toHaveBeenCalled();
  expect(sftpApiMocks.chmodSftpPath).not.toHaveBeenCalled();
  expect(sftpApiMocks.deleteSftpPath).not.toHaveBeenCalled();
  expect(dockerApiMocks.createDockerContainerDirectory).not.toHaveBeenCalled();
  expect(dockerApiMocks.renameDockerContainerPath).not.toHaveBeenCalled();
  expect(dockerApiMocks.chmodDockerContainerPath).not.toHaveBeenCalled();
  expect(dockerApiMocks.deleteDockerContainerPath).not.toHaveBeenCalled();
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
    summary: "prod.example.com",
  };
}

function dockerFileTarget(): SftpFileTarget {
  return {
    containerId: "container-1",
    containerName: "api",
    hostId: "docker-host",
    initialPath: "/app",
    kind: "dockerContainer",
    protocol: "container://",
    runtime: "docker",
    summary: "api container",
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
