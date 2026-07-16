import { describe, expect, it } from "vitest";
import type { RuntimeHealthSnapshot } from "../../../../src/lib/diagnosticsApi";
import { localServerInfoSnapshot } from "../../../../src/features/tool-panel/localServerInfoModel";

describe("localServerInfoModel", () => {
  it("maps the local runtime snapshot into the redesigned monitor contract", () => {
    const snapshot: RuntimeHealthSnapshot = {
      capturedAt: "1720836000",
      process: {
        cpuUsagePercent: 4.5,
        diskReadBytes: 1024,
        diskWrittenBytes: 2048,
        memoryBytes: 256 * 1024 * 1024,
        name: "kerminal.exe",
        pid: 1425,
        startedAtSeconds: 1720835000,
        uptimeSeconds: 1000,
        virtualMemoryBytes: 512 * 1024 * 1024,
      },
      redacted: true,
      sampling: {
        cpuRefreshedTwice: true,
        cpuSampleIntervalMs: 200,
        source: "sysinfo",
      },
      storage: {
        appLogFile: "[redacted]",
        appLogFileSizeBytes: 0,
        appLogMaxFileSizeBytes: 1_000_000,
        appLogRotationKeepFiles: 5,
        commandDatabaseFile: "[redacted]",
        commandDatabaseFileSizeBytes: 0,
        diagnostics: "[redacted]",
        logs: "[redacted]",
        root: "[redacted]",
        rootSizeBytes: 0,
      },
      system: {
        arch: "x86_64",
        availableMemoryBytes: 12 * 1024 * 1024 * 1024,
        bootTimeSeconds: 1720750000,
        cpuCoreUsagePercents: [12.5, 18.5],
        cpuCount: 2,
        globalCpuUsagePercent: 15.5,
        gpus: [
          {
            memoryTotalBytes: 8 * 1024 * 1024 * 1024,
            memoryUsedBytes: 2 * 1024 * 1024 * 1024,
            name: "Local GPU",
            utilizationPercent: 25,
          },
        ],
        hostName: "workstation",
        kernelVersion: "10.0.26100",
        os: "Windows",
        osVersion: "11",
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        totalSwapBytes: 4 * 1024 * 1024 * 1024,
        uptimeSeconds: 86_400,
        usedMemoryBytes: 4 * 1024 * 1024 * 1024,
        usedSwapBytes: 512 * 1024 * 1024,
      },
    };

    expect(localServerInfoSnapshot(snapshot, "profile:powershell")).toEqual(
      expect.objectContaining({
        architecture: "x86_64",
        capturedAt: "1720836000",
        cpuCoreUsagePercents: [12.5, 18.5],
        cpuCount: 2,
        cpuUsagePercent: 15.5,
        gpus: snapshot.system.gpus,
        host: "localhost",
        hostId: "profile:powershell",
        hostName: "workstation",
        hostname: "workstation",
        kernel: "10.0.26100",
        memoryAvailableBytes: 12 * 1024 * 1024 * 1024,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        memoryUsedBytes: 4 * 1024 * 1024 * 1024,
        networkInterfaces: [],
        os: "Windows 11",
        port: 0,
        swapTotalBytes: 4 * 1024 * 1024 * 1024,
        swapUsedBytes: 512 * 1024 * 1024,
        topProcesses: [
          expect.objectContaining({
            cpuUsagePercent: 4.5,
            memoryBytes: 256 * 1024 * 1024,
            name: "kerminal.exe",
            pid: 1425,
          }),
        ],
        username: "",
      }),
    );
  });

  it("keeps unavailable disk and network values unknown", () => {
    const snapshot = localServerInfoSnapshot(runtimeSnapshot(), "local");

    expect(snapshot.diskTotalBytes).toBeUndefined();
    expect(snapshot.diskUsedBytes).toBeUndefined();
    expect(snapshot.networkRxBytes).toBeUndefined();
    expect(snapshot.networkTxBytes).toBeUndefined();
    expect(snapshot.disks).toEqual([]);
    expect(snapshot.networkInterfaces).toEqual([]);
  });
});

function runtimeSnapshot(): RuntimeHealthSnapshot {
  return {
    capturedAt: "1",
    process: {
      cpuUsagePercent: 0,
      diskReadBytes: 0,
      diskWrittenBytes: 0,
      memoryBytes: 0,
      name: "kerminal",
      pid: 1,
      startedAtSeconds: 1,
      uptimeSeconds: 0,
      virtualMemoryBytes: 0,
    },
    redacted: true,
    sampling: {
      cpuRefreshedTwice: true,
      cpuSampleIntervalMs: 200,
      source: "test",
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
      availableMemoryBytes: 1,
      bootTimeSeconds: 1,
      cpuCoreUsagePercents: [],
      cpuCount: 1,
      globalCpuUsagePercent: 0,
      gpus: [],
      os: "Test OS",
      totalMemoryBytes: 1,
      totalSwapBytes: 0,
      uptimeSeconds: 1,
      usedMemoryBytes: 0,
      usedSwapBytes: 0,
    },
  };
}
