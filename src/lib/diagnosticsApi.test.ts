import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("diagnosticsApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("creates a diagnostic bundle through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bytesWritten: 1024,
      createdAt: "1",
      fileName: "diagnostics-1-test.json",
      id: "bundle-1",
      path: "C:/Users/me/.kerminal/diagnostics/diagnostics-1-test.json",
      redacted: true,
      sections: ["app", "terminalSessions"],
    });
    const { createDiagnosticsBundle } = await import("./diagnosticsApi");

    const bundle = await createDiagnosticsBundle();

    expect(bundle.fileName).toBe("diagnostics-1-test.json");
    expect(bundle.redacted).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("diagnostics_create_bundle");
  });

  it("returns a browser preview bundle outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createDiagnosticsBundle } = await import("./diagnosticsApi");

    const bundle = await createDiagnosticsBundle();

    expect(bundle.id).toMatch(/^browser-preview-/);
    expect(bundle.path).toMatch(/^browser-preview:\/\/diagnostics\//);
    expect(bundle.sections).toContain("terminalSessions");
    expect(bundle.redacted).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads runtime health through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      capturedAt: "1",
      process: {
        cpuUsagePercent: 2.4,
        diskReadBytes: 1024,
        diskWrittenBytes: 2048,
        memoryBytes: 128,
        name: "kerminal",
        pid: 1425,
        startedAtSeconds: 1,
        uptimeSeconds: 20,
        virtualMemoryBytes: 512,
      },
      redacted: true,
      sampling: {
        cpuRefreshedTwice: true,
        cpuSampleIntervalMs: 200,
        source: "sysinfo",
      },
      storage: {
        appLogFile: "C:/Users/me/.kerminal/logs/kerminal.log",
        appLogFileSizeBytes: 256,
        appLogMaxFileSizeBytes: 1_000_000,
        appLogRotationKeepFiles: 5,
        commandDatabaseFile: "C:/Users/me/.kerminal/data/command.sqlite",
        commandDatabaseFileSizeBytes: 1024,
        diagnostics: "C:/Users/me/.kerminal/diagnostics",
        logs: "C:/Users/me/.kerminal/logs",
        root: "C:/Users/me/.kerminal",
        rootSizeBytes: 4096,
      },
      system: {
        arch: "x86_64",
        availableMemoryBytes: 2048,
        bootTimeSeconds: 1,
        cpuCoreUsagePercents: [12.2, 18.6, 20.4, 22.4, 16.1, 14.8, 19.2, 23.5],
        cpuCount: 8,
        globalCpuUsagePercent: 18.4,
        gpus: [
          {
            driverVersion: "555.42",
            memoryTotalBytes: 8 * 1024 * 1024 * 1024,
            memoryUsedBytes: 2 * 1024 * 1024 * 1024,
            name: "NVIDIA GeForce RTX 4060",
            temperatureCelsius: 48,
            utilizationPercent: 22.5,
            vendor: "NVIDIA",
          },
        ],
        hostName: "devbox",
        kernelVersion: "10",
        os: "Windows",
        osVersion: "11",
        totalMemoryBytes: 4096,
        totalSwapBytes: 1024,
        uptimeSeconds: 100,
        usedMemoryBytes: 2048,
        usedSwapBytes: 128,
      },
    });
    const { getRuntimeHealthSnapshot } = await import("./diagnosticsApi");

    const snapshot = await getRuntimeHealthSnapshot();

    expect(snapshot.process.pid).toBe(1425);
    expect(snapshot.sampling.source).toBe("sysinfo");
    expect(snapshot.storage.appLogFile).toMatch(/kerminal\.log$/);
    expect(snapshot.storage.appLogRotationKeepFiles).toBe(5);
    expect(snapshot.system.cpuCoreUsagePercents).toHaveLength(8);
    expect(snapshot.system.gpus[0]?.name).toBe("NVIDIA GeForce RTX 4060");
    expect(invokeMock).toHaveBeenCalledWith("diagnostics_runtime_health");
  });

  it("returns browser preview runtime health outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { getRuntimeHealthSnapshot } = await import("./diagnosticsApi");

    const snapshot = await getRuntimeHealthSnapshot();

    expect(snapshot.process.pid).toBe(1425);
    expect(snapshot.system.cpuCoreUsagePercents).toHaveLength(
      snapshot.system.cpuCount,
    );
    expect(snapshot.system.gpus.length).toBeGreaterThan(0);
    expect(snapshot.storage.appLogFile).toMatch(/kerminal\.log$/);
    expect(snapshot.storage.appLogMaxFileSizeBytes).toBe(1_000_000);
    expect(snapshot.storage.root).toMatch(/^browser-preview:\/\/\.kerminal/);
    expect(snapshot.redacted).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads config watcher status through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      backend: "native",
      enabled: true,
      fallbackReason: null,
      ignoredGlobs: ["agents/**", "data/**"],
      lastBatchAt: "2026-06-26T00:00:00+08:00",
      lastDomains: ["hosts"],
      lastError: null,
      lastSequence: 7,
      lastStatus: "ready",
      watchedRoots: [".", "hosts"],
    });
    const { getConfigWatchStatus } = await import("./diagnosticsApi");

    const status = await getConfigWatchStatus();

    expect(status.backend).toBe("native");
    expect(status.lastDomains).toEqual(["hosts"]);
    expect(status.watchedRoots).not.toContain("secrets/hosts");
    expect(JSON.stringify(status)).not.toContain("password");
    expect(JSON.stringify(status)).not.toContain("secret-host.toml");
    expect(invokeMock).toHaveBeenCalledWith("config_watch_status");
  });

  it("returns redacted config watcher browser preview outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { getConfigWatchStatus } = await import("./diagnosticsApi");

    const status = await getConfigWatchStatus();

    expect(status.enabled).toBe(false);
    expect(status.backend).toBe("unavailable");
    expect(status.fallbackReason).toBe("browser-preview");
    expect(status.watchedRoots).not.toContain("secrets/hosts");
    expect(JSON.stringify(status)).not.toContain("password");
    expect(JSON.stringify(status)).not.toContain("credential");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
