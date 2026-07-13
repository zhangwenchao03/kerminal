import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerInfoToolContent } from "../../../../src/features/tool-panel/ServerInfoToolContent";
import {
  clearServerInfoHistoryStoreForTest,
  serverInfoHistoryForTarget,
} from "../../../../src/features/tool-panel/serverInfoHistoryModel";
import type { Machine } from "../../../../src/features/workspace/types";
import type {
  ServerInfoRequest,
  ServerInfoSnapshot,
} from "../../../../src/lib/serverInfoApi";
import { clearServerInfoSnapshotCacheForTest } from "../../../../src/features/tool-panel/useServerInfoSnapshot";

const serverInfoApiMock = vi.hoisted(() => ({
  getServerInfoSnapshot: vi.fn(),
}));
const diagnosticsApiMock = vi.hoisted(() => ({
  getRuntimeHealthSnapshot: vi.fn(),
}));

vi.mock("../../../../src/lib/serverInfoApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/lib/serverInfoApi")
  >("../../../../src/lib/serverInfoApi");
  return {
    ...actual,
    getServerInfoSnapshot: serverInfoApiMock.getServerInfoSnapshot,
  };
});

vi.mock("../../../../src/lib/diagnosticsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/lib/diagnosticsApi")
  >("../../../../src/lib/diagnosticsApi");
  return {
    ...actual,
    getRuntimeHealthSnapshot: diagnosticsApiMock.getRuntimeHealthSnapshot,
  };
});

describe("ServerInfoToolContent target lifecycle", () => {
  beforeEach(() => {
    clearServerInfoSnapshotCacheForTest();
    clearServerInfoHistoryStoreForTest();
    serverInfoApiMock.getServerInfoSnapshot.mockReset();
    diagnosticsApiMock.getRuntimeHealthSnapshot.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearServerInfoSnapshotCacheForTest();
    clearServerInfoHistoryStoreForTest();
  });

  it("does not write the previous target snapshot into the next target history", async () => {
    const targetB = deferred<ServerInfoSnapshot>();
    serverInfoApiMock.getServerInfoSnapshot.mockImplementation(
      ({ hostId }: ServerInfoRequest) =>
        hostId === machineA.id
          ? Promise.resolve(serverSnapshot(machineA, "1", "host-a"))
          : targetB.promise,
    );

    const { rerender } = render(
      <ServerInfoToolContent active selectedMachine={machineA} />,
    );

    expect(await screen.findByText("host-a")).toBeInTheDocument();
    await waitFor(() => {
      expect(serverInfoHistoryForTarget("ssh:host-a")).toHaveLength(1);
    });

    rerender(<ServerInfoToolContent active selectedMachine={machineB} />);

    await waitFor(() => {
      expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledWith({
        hostId: machineB.id,
        target: { hostId: machineB.id, kind: "ssh" },
      });
    });
    expect(screen.queryByText("host-a")).not.toBeInTheDocument();
    expect(serverInfoHistoryForTarget("ssh:host-b")).toEqual([]);

    await act(async () => {
      targetB.resolve(serverSnapshot(machineB, "2", "host-b"));
      await targetB.promise;
    });

    expect(await screen.findByText("host-b")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        serverInfoHistoryForTarget("ssh:host-b").map(
          (point) => point.capturedAtMs,
        ),
      ).toEqual([2_000]);
    });
  });

  it("keeps a late target A response out of target B display and history", async () => {
    const targetA = deferred<ServerInfoSnapshot>();
    const targetB = deferred<ServerInfoSnapshot>();
    serverInfoApiMock.getServerInfoSnapshot.mockImplementation(
      ({ hostId }: ServerInfoRequest) =>
        hostId === machineA.id ? targetA.promise : targetB.promise,
    );

    const { rerender } = render(
      <ServerInfoToolContent active selectedMachine={machineA} />,
    );
    await waitFor(() => {
      expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledWith({
        hostId: machineA.id,
        target: { hostId: machineA.id, kind: "ssh" },
      });
    });

    rerender(<ServerInfoToolContent active selectedMachine={machineB} />);
    await waitFor(() => {
      expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledWith({
        hostId: machineB.id,
        target: { hostId: machineB.id, kind: "ssh" },
      });
    });

    await act(async () => {
      targetB.resolve(serverSnapshot(machineB, "20", "host-b"));
      await targetB.promise;
    });
    expect(await screen.findByText("host-b")).toBeInTheDocument();

    await act(async () => {
      targetA.resolve(serverSnapshot(machineA, "10", "host-a"));
      await targetA.promise;
    });

    expect(screen.queryByText("host-a")).not.toBeInTheDocument();
    expect(screen.getByText("host-b")).toBeInTheDocument();
    expect(
      serverInfoHistoryForTarget("ssh:host-b").map(
        (point) => point.capturedAtMs,
      ),
    ).toEqual([20_000]);
    expect(serverInfoHistoryForTarget("ssh:host-a")).toEqual([]);
  });

  it("pauses remote collection while inactive and refreshes the current target on reopen", async () => {
    vi.useFakeTimers();
    serverInfoApiMock.getServerInfoSnapshot.mockImplementation(
      ({ hostId }: ServerInfoRequest) =>
        Promise.resolve(
          serverSnapshot(
            hostId === machineA.id ? machineA : machineB,
            hostId === machineA.id ? "1" : "2",
            hostId,
          ),
        ),
    );

    const { rerender } = render(
      <ServerInfoToolContent active={false} selectedMachine={machineA} />,
    );
    await flushEffects();
    rerender(
      <ServerInfoToolContent active={false} selectedMachine={machineB} />,
    );
    await flushEffects();
    expect(serverInfoApiMock.getServerInfoSnapshot).not.toHaveBeenCalled();

    rerender(<ServerInfoToolContent active selectedMachine={machineB} />);
    await flushEffects();
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(1);
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenLastCalledWith({
      hostId: machineB.id,
      target: { hostId: machineB.id, kind: "ssh" },
    });

    rerender(
      <ServerInfoToolContent active={false} selectedMachine={machineA} />,
    );
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(1);

    rerender(<ServerInfoToolContent active selectedMachine={machineA} />);
    await flushEffects();
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(2);
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenLastCalledWith({
      hostId: machineA.id,
      target: { hostId: machineA.id, kind: "ssh" },
    });
  });

  it("unmounts the local runtime card while inactive and restarts it on reopen", async () => {
    vi.useFakeTimers();
    diagnosticsApiMock.getRuntimeHealthSnapshot.mockImplementation(
      () => new Promise(() => {}),
    );

    const { rerender } = render(<ServerInfoToolContent active={false} />);
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(diagnosticsApiMock.getRuntimeHealthSnapshot).not.toHaveBeenCalled();

    rerender(<ServerInfoToolContent active />);
    await flushEffects();
    expect(diagnosticsApiMock.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(
      1,
    );

    rerender(<ServerInfoToolContent active={false} />);
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(diagnosticsApiMock.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(
      1,
    );

    rerender(<ServerInfoToolContent active />);
    await flushEffects();
    expect(diagnosticsApiMock.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(
      2,
    );
  });
});

const machineA = sshMachine("host-a", "a.internal");
const machineB = sshMachine("host-b", "b.internal");

function sshMachine(id: string, host: string): Machine {
  return {
    authType: "agent",
    description: `ops@${host}:22`,
    host,
    id,
    kind: "ssh",
    name: id,
    port: 22,
    production: false,
    status: "online",
    tags: ["ssh"],
    username: "ops",
  };
}

function serverSnapshot(
  machine: Machine,
  capturedAt: string,
  hostname: string,
): ServerInfoSnapshot {
  return {
    architecture: "x86_64",
    capturedAt,
    cpuCount: 4,
    cpuUsagePercent: 25,
    diskAvailableBytes: 48 * 1024 * 1024 * 1024,
    diskTotalBytes: 64 * 1024 * 1024 * 1024,
    diskUsedBytes: 16 * 1024 * 1024 * 1024,
    gpus: [],
    host: machine.host ?? hostname,
    hostId: machine.id,
    hostName: machine.name,
    hostname,
    memoryTotalBytes: 8 * 1024 * 1024 * 1024,
    memoryUsedBytes: 2 * 1024 * 1024 * 1024,
    networkInterfaces: [],
    os: "Linux",
    port: machine.port ?? 22,
    topProcesses: [],
    username: machine.username ?? "ops",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
