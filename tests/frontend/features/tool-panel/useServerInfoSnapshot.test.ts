import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerInfoSnapshot } from "../../../../src/lib/serverInfoApi";
import type { ServerInfoTargetContext } from "../../../../src/features/tool-panel/serverInfoTargetModel";
import {
  createServerInfoSnapshotRuntime,
  resolveServerInfoRefreshDelay,
  useServerInfoSnapshot,
} from "../../../../src/features/tool-panel/useServerInfoSnapshot";

const serverInfoApiMock = vi.hoisted(() => ({
  getServerInfoSnapshot: vi.fn(),
}));
const diagnosticsApiMock = vi.hoisted(() => ({
  getRuntimeHealthSnapshot: vi.fn(),
}));

vi.mock("../../../../src/lib/serverInfoApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/serverInfoApi")>(
    "../../../../src/lib/serverInfoApi",
  );
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

describe("useServerInfoSnapshot", () => {
  let runtime: ReturnType<typeof createServerInfoSnapshotRuntime>;

  beforeEach(() => {
    runtime = createServerInfoSnapshotRuntime();
    diagnosticsApiMock.getRuntimeHealthSnapshot.mockReset();
    diagnosticsApiMock.getRuntimeHealthSnapshot.mockResolvedValue(
      runtimeHealthSnapshot(),
    );
    serverInfoApiMock.getServerInfoSnapshot.mockReset();
    serverInfoApiMock.getServerInfoSnapshot.mockResolvedValue(serverSnapshot());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the first snapshot for the selected target", async () => {
    const { result } = renderHook(() =>
      useServerInfoSnapshot(targetContext, { runtime }),
    );

    await waitFor(() => {
      expect(result.current.snapshot?.hostname).toBe("prod-api-01");
    });

    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "prod-api",
      target: { hostId: "prod-api", kind: "ssh" },
    });
    expect(result.current.error).toBeNull();
    expect(runtime.snapshots.get(targetContext.cacheKey)?.os).toBe("Linux");
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(1);
  });

  it("loads local targets from the runtime health API", async () => {
    const { result } = renderHook(() =>
      useServerInfoSnapshot(localTargetContext, { runtime }),
    );

    await waitFor(() => {
      expect(result.current.snapshot?.hostname).toBe("local-workstation");
    });

    expect(diagnosticsApiMock.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(1);
    expect(serverInfoApiMock.getServerInfoSnapshot).not.toHaveBeenCalled();
    expect(result.current.snapshot).toMatchObject({
      cpuUsagePercent: 12.5,
      hostId: "profile:powershell",
      os: "Windows 11",
    });
  });

  it("uses the hidden refresh delay while the document is not visible", async () => {
    vi.useFakeTimers();
    serverInfoApiMock.getServerInfoSnapshot
      .mockResolvedValueOnce(serverSnapshot({ capturedAt: "1" }))
      .mockResolvedValueOnce(serverSnapshot({ capturedAt: "2" }));
    let visible = false;
    let visibilityHandler: (() => void) | undefined;
    const documentVisible = () => visible;
    const subscribeToVisibilityChange = vi.fn((handler: () => void) => {
      visibilityHandler = handler;
      return vi.fn();
    });

    const { result } = renderHook(() =>
      useServerInfoSnapshot(targetContext, {
        documentVisible,
        hiddenRefreshIntervalMs: 1_000,
        runtime,
        subscribeToVisibilityChange,
      }),
    );

    await flushEffects();
    expect(result.current.snapshot?.capturedAt).toBe("1");

    act(() => {
      result.current.setRefreshIntervalMs(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(1);

    visible = true;
    act(() => {
      visibilityHandler?.();
    });
    await flushEffects();
    expect(result.current.snapshot?.capturedAt).toBe("2");
  });

  it("keeps manual refresh available when automatic refresh is disabled", async () => {
    serverInfoApiMock.getServerInfoSnapshot
      .mockResolvedValueOnce(serverSnapshot({ capturedAt: "1" }))
      .mockResolvedValueOnce(serverSnapshot({ capturedAt: "manual" }));

    const { result } = renderHook(() =>
      useServerInfoSnapshot(targetContext, { runtime }),
    );

    await waitFor(() => {
      expect(result.current.snapshot?.capturedAt).toBe("1");
    });

    act(() => {
      result.current.setRefreshIntervalMs(0);
    });

    await flushEffects();
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh({ force: true });
    });

    expect(result.current.snapshot?.capturedAt).toBe("manual");
    expect(serverInfoApiMock.getServerInfoSnapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps raw server failures behind a user-facing summary", async () => {
    serverInfoApiMock.getServerInfoSnapshot.mockRejectedValueOnce(
      new Error("runtime request failed: password=super-secret"),
    );

    const { result } = renderHook(() =>
      useServerInfoSnapshot(targetContext, { runtime }),
    );

    await waitFor(() => {
      expect(result.current.error?.title).toBe("无法读取服务器信息");
    });

    expect(result.current.error?.recoveryAction).toBe("请检查连接后重试。");
    expect(result.current.error?.technicalDetail).toContain(
      "runtime request failed",
    );
    expect(result.current.error?.technicalDetail).not.toContain("super-secret");
  });

  it("resolves visibility-aware refresh delay", () => {
    expect(
      resolveServerInfoRefreshDelay({
        documentVisible: true,
        hiddenRefreshIntervalMs: 10_000,
        refreshIntervalMs: 3_000,
      }),
    ).toBe(3_000);
    expect(
      resolveServerInfoRefreshDelay({
        documentVisible: false,
        hiddenRefreshIntervalMs: 10_000,
        refreshIntervalMs: 3_000,
      }),
    ).toBe(10_000);
    expect(
      resolveServerInfoRefreshDelay({
        documentVisible: true,
        hiddenRefreshIntervalMs: 10_000,
        refreshIntervalMs: 0,
      }),
    ).toBeNull();
  });
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const targetContext: ServerInfoTargetContext = {
  cacheKey: "ssh:prod-api",
  hostId: "prod-api",
  refreshAriaLabel: "刷新服务器信息",
  subtitle: "deploy@prod.internal:22",
  target: { hostId: "prod-api", kind: "ssh" },
  title: "远程服务器",
};

const localTargetContext: ServerInfoTargetContext = {
  cacheKey: "local:powershell",
  hostId: "profile:powershell",
  refreshAriaLabel: "刷新本机系统信息",
  subtitle: "PowerShell · pwsh.exe",
  target: { kind: "local", profileId: "powershell" },
  title: "本机系统",
};

function serverSnapshot(
  overrides: Partial<ServerInfoSnapshot> = {},
): ServerInfoSnapshot {
  return {
    architecture: "x86_64",
    capturedAt: "1",
    cpuCount: 4,
    diskMount: "/",
    diskTotalBytes: 64 * 1024 * 1024 * 1024,
    diskUsedBytes: 16 * 1024 * 1024 * 1024,
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    hostname: "prod-api-01",
    os: "Linux",
    port: 22,
    username: "deploy",
    ...overrides,
  };
}

function runtimeHealthSnapshot() {
  return {
    capturedAt: "1",
    process: {
      cpuUsagePercent: 2,
      diskReadBytes: 0,
      diskWrittenBytes: 0,
      memoryBytes: 128 * 1024 * 1024,
      name: "kerminal.exe",
      pid: 1425,
      startedAtSeconds: 1,
      uptimeSeconds: 100,
      virtualMemoryBytes: 256 * 1024 * 1024,
    },
    redacted: true,
    sampling: {
      cpuRefreshedTwice: true,
      cpuSampleIntervalMs: 200,
      source: "sysinfo",
    },
    storage: {
      appLogFile: "",
      appLogFileSizeBytes: 0,
      appLogMaxFileSizeBytes: 0,
      appLogRotationKeepFiles: 0,
      commandDatabaseFile: "",
      commandDatabaseFileSizeBytes: 0,
      diagnostics: "",
      logs: "",
      root: "",
      rootSizeBytes: 0,
    },
    system: {
      arch: "x86_64",
      availableMemoryBytes: 12 * 1024 * 1024 * 1024,
      bootTimeSeconds: 1,
      cpuCoreUsagePercents: [10, 15],
      cpuCount: 2,
      globalCpuUsagePercent: 12.5,
      gpus: [],
      hostName: "local-workstation",
      kernelVersion: "10.0.26100",
      os: "Windows",
      osVersion: "11",
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      totalSwapBytes: 4 * 1024 * 1024 * 1024,
      uptimeSeconds: 86_400,
      usedMemoryBytes: 4 * 1024 * 1024 * 1024,
      usedSwapBytes: 0,
    },
  };
}
