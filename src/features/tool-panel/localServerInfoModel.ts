import type { RuntimeHealthSnapshot } from "../../lib/diagnosticsApi";
import type { ServerInfoSnapshot } from "../../lib/serverInfoApi";

/**
 * 将既有本机诊断快照适配为统一系统信息展示契约。
 *
 * 本机诊断接口没有磁盘容量、网络 counter 和全量进程统计，因此这些字段保持未知，
 * 不能用 Kerminal 数据目录大小或单个应用进程冒充系统级指标。
 */
export function localServerInfoSnapshot(
  snapshot: RuntimeHealthSnapshot,
  hostId: string,
): ServerInfoSnapshot {
  const hostName = snapshot.system.hostName || "本机";
  const totalMemoryBytes = snapshot.system.totalMemoryBytes;
  const processMemoryPercent =
    totalMemoryBytes > 0
      ? (snapshot.process.memoryBytes / totalMemoryBytes) * 100
      : undefined;

  return {
    architecture: snapshot.system.arch,
    capturedAt: snapshot.capturedAt,
    cpuCoreUsagePercents: snapshot.system.cpuCoreUsagePercents,
    cpuCount: snapshot.system.cpuCount,
    cpuUsagePercent: snapshot.system.globalCpuUsagePercent,
    disks: [],
    gpuProbeStatus:
      snapshot.system.gpus.length > 0 ? snapshot.sampling.source : undefined,
    gpus: snapshot.system.gpus.map((gpu) => ({ ...gpu })),
    host: "localhost",
    hostId,
    hostName,
    hostname: hostName,
    kernel: snapshot.system.kernelVersion ?? snapshot.system.osVersion,
    memoryAvailableBytes: snapshot.system.availableMemoryBytes,
    memoryTotalBytes: totalMemoryBytes,
    memoryUsedBytes: snapshot.system.usedMemoryBytes,
    networkInterfaces: [],
    os: joinSystemName(snapshot.system.os, snapshot.system.osVersion),
    port: 0,
    swapTotalBytes: snapshot.system.totalSwapBytes,
    swapUsedBytes: snapshot.system.usedSwapBytes,
    topProcesses: [
      {
        cpuUsagePercent: snapshot.process.cpuUsagePercent,
        memoryBytes: snapshot.process.memoryBytes,
        memoryPercent: processMemoryPercent,
        name: snapshot.process.name,
        pid: snapshot.process.pid,
      },
    ],
    uptimeSeconds: snapshot.system.uptimeSeconds,
    username: "",
  };
}

/** 合并系统名和版本，并避免平台返回重复文本。 */
function joinSystemName(os: string, version?: string | null) {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion || os.includes(normalizedVersion)) {
    return os;
  }
  return `${os} ${normalizedVersion}`;
}
