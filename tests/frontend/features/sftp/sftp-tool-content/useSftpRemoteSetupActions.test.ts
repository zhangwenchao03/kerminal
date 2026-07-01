/**
 * SFTP remote setup facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SshCommandOutput } from "../../../../../src/lib/sshCommandApi";
import type {
  SftpContextMenuState,
  SftpDialogAction,
  SftpFileTarget,
  SftpStatus,
} from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpRemoteSetupActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpRemoteSetupActions";

const sftpApiMocks = vi.hoisted(() => ({
  trustSftpHostKey: vi.fn<(request: unknown) => Promise<unknown>>(),
}));

const sshCommandApiMocks = vi.hoisted(() => ({
  executeSshCommand: vi.fn<(request: unknown) => Promise<SshCommandOutput>>(),
}));

vi.mock("../../../../../src/lib/sftpApi", () => ({
  trustSftpHostKey: sftpApiMocks.trustSftpHostKey,
}));

vi.mock("../../../../../src/lib/sshCommandApi", () => ({
  executeSshCommand: sshCommandApiMocks.executeSshCommand,
}));

type ActionCall = string;

describe("useSftpRemoteSetupActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sftpApiMocks.trustSftpHostKey.mockResolvedValue({
      host: "prod.internal",
      hostId: "ssh-host",
      knownHostsPath: "/home/deploy/.ssh/known_hosts",
      port: 22,
    });
    sshCommandApiMocks.executeSshCommand.mockResolvedValue(sshOutput({}));
  });

  it("keeps remote setup actions as no-ops without an SSH target", async () => {
    const noTarget = renderRemoteSetupHook({ fileTarget: null });

    await act(async () => {
      await noTarget.result.current.trustHostKey();
      await noTarget.result.current.setupRemoteCwdTracking();
    });

    expectNoApiCalls();
    expectNoUiSetters(noTarget.setters);
    expect(noTarget.result.current.hostKeyTrustBusy).toBe(false);
    expect(noTarget.result.current.cwdTrackingSetupBusy).toBe(false);

    const dockerTarget = renderRemoteSetupHook({ fileTarget: dockerFileTarget() });

    await act(async () => {
      await dockerTarget.result.current.trustHostKey();
      await dockerTarget.result.current.setupRemoteCwdTracking();
    });

    expectNoApiCalls();
    expectNoUiSetters(dockerTarget.setters);
  });

  it("trusts an SSH host key, refreshes the current directory, and clears busy", async () => {
    const trustRequest = deferred<unknown>();
    sftpApiMocks.trustSftpHostKey.mockReturnValueOnce(trustRequest.promise);
    const { calls, result, setters } = renderRemoteSetupHook({
      currentPath: "/srv/app",
    });

    let actionPromise!: Promise<void>;
    act(() => {
      actionPromise = result.current.trustHostKey();
    });

    expect(result.current.hostKeyTrustBusy).toBe(true);
    expect(sftpApiMocks.trustSftpHostKey).toHaveBeenCalledWith({
      hostId: "ssh-host",
    });
    expect(calls).toEqual(["setOperationStatus:null"]);

    await act(async () => {
      trustRequest.resolve({
        host: "prod.internal",
        hostId: "ssh-host",
        knownHostsPath: "/home/deploy/.ssh/known_hosts",
        port: 22,
      });
      await actionPromise;
    });

    expect(setters.loadDirectory).toHaveBeenCalledWith("/srv/app");
    expect(calls).toEqual([
      "setOperationStatus:null",
      "loadDirectory:/srv/app",
      "setOperationStatus:success:已信任主机密钥：prod.internal:22",
    ]);
    expect(result.current.hostKeyTrustBusy).toBe(false);
  });

  it("reports host key trust failures without refreshing the directory", async () => {
    sftpApiMocks.trustSftpHostKey.mockRejectedValueOnce(
      new Error("known_hosts is read-only"),
    );
    const { result, setters } = renderRemoteSetupHook();

    await act(async () => {
      await result.current.trustHostKey();
    });

    expect(setters.loadDirectory).not.toHaveBeenCalled();
    expect(setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: "信任主机密钥失败：known_hosts is read-only",
    });
    expect(result.current.hostKeyTrustBusy).toBe(false);
  });

  it("clears transient UI state and executes the cwd tracking setup command", async () => {
    const commandRequest = deferred<SshCommandOutput>();
    sshCommandApiMocks.executeSshCommand.mockReturnValueOnce(
      commandRequest.promise,
    );
    const { calls, result } = renderRemoteSetupHook();

    let actionPromise!: Promise<void>;
    act(() => {
      actionPromise = result.current.setupRemoteCwdTracking();
    });

    expect(result.current.cwdTrackingSetupBusy).toBe(true);
    expect(sshCommandApiMocks.executeSshCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "ssh-host",
        maxOutputBytes: 4096,
        timeoutSeconds: 15,
      }),
    );
    const request = sshCommandApiMocks.executeSshCommand.mock.calls[0]?.[0] as {
      command?: string;
    };
    expect(request.command).toContain("1337;CurrentDir");
    expect(calls).toEqual([
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:info:正在写入远端 shell 配置...",
    ]);

    await act(async () => {
      commandRequest.resolve(sshOutput({}));
      await actionPromise;
    });

    expect(calls).toEqual([
      "setContextMenu:null",
      "setDialogAction:null",
      "setDialogStatus:null",
      "setOperationStatus:info:正在写入远端 shell 配置...",
      "setOperationStatus:success:已写入远端配置。重新登录或 source 对应 shell 配置后生效。",
    ]);
    expect(result.current.cwdTrackingSetupBusy).toBe(false);
  });

  it("reports cwd tracking command failures and rejected setup calls", async () => {
    sshCommandApiMocks.executeSshCommand.mockResolvedValueOnce(
      sshOutput({
        exitCode: 1,
        stderr: "permission denied",
        success: false,
      }),
    );
    const failedOutput = renderRemoteSetupHook();

    await act(async () => {
      await failedOutput.result.current.setupRemoteCwdTracking();
    });

    expect(failedOutput.setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: "自动设置失败：permission denied",
    });
    expect(failedOutput.result.current.cwdTrackingSetupBusy).toBe(false);

    sshCommandApiMocks.executeSshCommand.mockRejectedValueOnce(
      new Error("ssh timeout"),
    );
    const rejected = renderRemoteSetupHook();

    await act(async () => {
      await rejected.result.current.setupRemoteCwdTracking();
    });

    expect(rejected.setters.setOperationStatus).toHaveBeenLastCalledWith({
      kind: "error",
      message: "自动设置失败：ssh timeout",
    });
    expect(rejected.result.current.cwdTrackingSetupBusy).toBe(false);
  });

  it("resets host key busy state when the file target changes", () => {
    const trustRequest = deferred<unknown>();
    sftpApiMocks.trustSftpHostKey.mockReturnValueOnce(trustRequest.promise);
    const setters = createSetters([]);
    const hook = renderHook(
      ({ fileTarget }: { fileTarget: SftpFileTarget | null }) =>
        useSftpRemoteSetupActions({
          currentPath: "/srv",
          fileTarget,
          loadDirectory: setters.loadDirectory,
          setContextMenu: setters.setContextMenu,
          setDialogAction: setters.setDialogAction,
          setDialogStatus: setters.setDialogStatus,
          setOperationStatus: setters.setOperationStatus,
        }),
      { initialProps: { fileTarget: sshFileTarget() } },
    );

    act(() => {
      void hook.result.current.trustHostKey();
    });
    expect(hook.result.current.hostKeyTrustBusy).toBe(true);

    act(() => {
      hook.rerender({ fileTarget: dockerFileTarget() });
    });

    expect(hook.result.current.hostKeyTrustBusy).toBe(false);
  });
});

function renderRemoteSetupHook({
  calls = [],
  currentPath = "/srv",
  fileTarget = sshFileTarget(),
}: {
  calls?: ActionCall[];
  currentPath?: string;
  fileTarget?: SftpFileTarget | null;
} = {}) {
  const setters = createSetters(calls);
  const hook = renderHook(() =>
    useSftpRemoteSetupActions({
      currentPath,
      fileTarget,
      loadDirectory: setters.loadDirectory,
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
  expect(sftpApiMocks.trustSftpHostKey).not.toHaveBeenCalled();
  expect(sshCommandApiMocks.executeSshCommand).not.toHaveBeenCalled();
}

function expectNoUiSetters(setters: ReturnType<typeof createSetters>) {
  expect(setters.loadDirectory).not.toHaveBeenCalled();
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

function sshOutput(overrides: Partial<SshCommandOutput>): SshCommandOutput {
  return {
    durationMs: 18,
    exitCode: 0,
    host: "prod.internal",
    hostId: "ssh-host",
    hostName: "prod api",
    maxOutputBytes: 4096,
    port: 22,
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
    stdout: "",
    stdoutBytes: 0,
    stdoutTruncated: false,
    success: true,
    username: "deploy",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
