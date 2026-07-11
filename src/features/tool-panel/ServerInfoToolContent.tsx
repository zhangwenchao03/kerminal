import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  Gpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Network,
  Server,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Select } from "../../components/ui/select";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import {
  type ServerDiskInfo,
  type ServerGpuInfo,
  type ServerInfoSnapshot,
  type ServerProcessInfo,
} from "../../lib/serverInfoApi";
import type { Machine } from "../workspace/types";
import { RuntimeHealthCard } from "./RuntimeHealthCard";
import {
  coreUsages,
  formatBytes,
  formatLoadAverage,
  formatNetworkSample,
  formatPercent,
  formatProcessSummary,
  formatTemperature,
  formatTimestamp,
  formatTrafficRate,
  formatUptime,
  gpuCardHelper,
  gpuMemoryLabel,
  loadAverageValues,
  networkCardHelper,
  networkTrafficFromSnapshot,
  percentOf,
  serverGpuSummaryValue,
  type NetworkInterfaceTraffic,
  type NetworkTrafficSnapshot,
} from "./serverInfoMetricsModel";
import { serverInfoTargetContext } from "./serverInfoTargetModel";
import {
  SystemInfoRow,
  SystemInfoRows,
  SystemMeterBar,
  SystemMetricCard,
  SystemOverviewCard,
  SystemOverviewTile,
} from "./SystemMetricCard";
import {
  serverInfoRefreshOptions,
  useServerInfoSnapshot,
} from "./useServerInfoSnapshot";

export { clearServerInfoSnapshotCacheForTest } from "./useServerInfoSnapshot";

interface ServerInfoToolContentProps {
  selectedMachine?: Machine;
}

type ServerMetricCardId =
  | "cpu"
  | "gpu"
  | "memory"
  | "swap"
  | "disk"
  | "network"
  | "process";

export function ServerInfoToolContent({
  selectedMachine,
}: ServerInfoToolContentProps) {
  const targetContext = useMemo(
    () => serverInfoTargetContext(selectedMachine),
    [selectedMachine],
  );
  const [expandedCards, setExpandedCards] = useState<Set<ServerMetricCardId>>(
    () => new Set(),
  );
  const {
    error,
    loading,
    networkTraffic,
    refresh,
    refreshIntervalMs,
    setRefreshIntervalMs,
    snapshot,
  } = useServerInfoSnapshot(targetContext);
  const snapshotGpus =
    snapshot && Array.isArray(snapshot.gpus) ? snapshot.gpus : undefined;
  const memoryPercent = snapshot
    ? percentOf(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes)
    : undefined;
  const diskPercent = snapshot
    ? percentOf(snapshot.diskUsedBytes, snapshot.diskTotalBytes)
    : undefined;
  const toggleMetricCard = useCallback((cardId: ServerMetricCardId) => {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  if (!targetContext) {
    return <RuntimeHealthCard />;
  }

  return (
    <section className="space-y-3">
      <SystemOverviewCard
        badge={
          targetContext.badgeText ? (
            <span
              className={cn(
                "shrink-0 rounded-lg border px-2 py-1 text-xs",
                selectedMachine?.production
                  ? "border-amber-300/20 bg-amber-400/10 text-amber-700 dark:text-amber-200"
                  : "kerminal-muted-surface text-zinc-500 dark:text-zinc-400",
              )}
            >
              {targetContext.badgeText}
            </span>
          ) : undefined
        }
        footer={
          <>
            {error ? (
              <UserFacingNotice compact message={error} />
            ) : null}
            <details className={cn(error && "mt-3")}>
              <summary className="kerminal-focus-ring kerminal-pressable cursor-pointer rounded-lg text-xs font-medium text-zinc-600 focus-visible:outline-none dark:text-zinc-300">
                系统详情
              </summary>
              <div className="mt-3 space-y-3">
                <SystemInfoRows>
                  <SystemInfoRow
                    label="主机名"
                    value={snapshot?.hostname ?? snapshot?.hostName ?? "-"}
                  />
                  <SystemInfoRow label="系统" value={snapshot?.os ?? "-"} />
                  <SystemInfoRow
                    label="架构"
                    value={snapshot?.architecture ?? "-"}
                  />
                  <SystemInfoRow
                    label="Kernel"
                    value={snapshot?.kernel ?? "-"}
                  />
                  <SystemInfoRow
                    label="运行时间"
                    value={formatUptime(snapshot?.uptimeSeconds) ?? "-"}
                  />
                  <SystemInfoRow
                    label="采样时间"
                    value={
                      snapshot
                        ? formatTimestamp(snapshot.capturedAt)
                        : "等待首次采集"
                    }
                  />
                </SystemInfoRows>
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>采集间隔</span>
                  <Select
                    aria-label="服务器信息采集间隔"
                    className="w-24"
                    onValueChange={(value) =>
                      setRefreshIntervalMs(Number(value))
                    }
                    options={serverInfoRefreshOptions.map((option) => ({
                      label: option.label,
                      value: String(option.value),
                    }))}
                    size="sm"
                    value={String(refreshIntervalMs)}
                  />
                </div>
              </div>
            </details>
          </>
        }
        icon={Server}
        onRefresh={() => void refresh({ force: true })}
        refreshAriaLabel={targetContext.refreshAriaLabel}
        refreshing={loading}
        subtitle={targetContext.subtitle}
        title={targetContext.title}
      >
        <SystemOverviewTile
          label="CPU"
          value={snapshot ? formatPercent(snapshot.cpuUsagePercent) : undefined}
        />
        <SystemOverviewTile
          label="内存"
          value={snapshot ? formatPercent(memoryPercent) : undefined}
        />
        <SystemOverviewTile
          label="磁盘"
          value={snapshot ? formatPercent(diskPercent) : undefined}
        />
        <SystemOverviewTile
          label="GPU"
          value={
            snapshotGpus ? serverGpuSummaryValue(snapshotGpus) : undefined
          }
        />
      </SystemOverviewCard>

      {loading && !snapshot ? (
        <div className="kerminal-solid-surface rounded-2xl border px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          正在读取服务器信息...
        </div>
      ) : null}

      {!loading && !error && !snapshot ? (
        <div className="kerminal-solid-surface rounded-2xl border px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          暂无服务器信息。
        </div>
      ) : null}

      {snapshot ? (
        <ServerMetrics
          expandedCards={expandedCards}
          networkTraffic={networkTraffic}
          onToggleMetric={toggleMetricCard}
          snapshot={snapshot}
        />
      ) : null}
    </section>
  );
}

function ServerMetrics({
  expandedCards,
  onToggleMetric,
  snapshot,
  networkTraffic,
}: {
  expandedCards: Set<ServerMetricCardId>;
  networkTraffic: NetworkTrafficSnapshot | null;
  onToggleMetric: (cardId: ServerMetricCardId) => void;
  snapshot: ServerInfoSnapshot;
}) {
  const memoryPercent = percentOf(
    snapshot.memoryUsedBytes,
    snapshot.memoryTotalBytes,
  );
  const swapPercent = percentOf(
    snapshot.swapUsedBytes,
    snapshot.swapTotalBytes,
  );
  const diskPercent = percentOf(
    snapshot.diskUsedBytes,
    snapshot.diskTotalBytes,
  );
  const gpus = Array.isArray(snapshot.gpus) ? snapshot.gpus : [];
  const disks = Array.isArray(snapshot.disks) ? snapshot.disks : [];
  const loadAverage = loadAverageValues(snapshot.loadAverage);
  const loadAverageLabel = formatLoadAverage(loadAverage);
  const networkTrafficView =
    networkTraffic ?? networkTrafficFromSnapshot(snapshot);
  const networkInterfaces = networkTrafficView.interfaces;
  const topNetworkInterface = networkTrafficView.topInterface;
  const topProcesses = Array.isArray(snapshot.topProcesses)
    ? snapshot.topProcesses
    : [];
  const cpuUsagePercent = snapshot.cpuUsagePercent ?? undefined;
  const cpuCoreUsages = coreUsages(snapshot);
  const processSummary = formatProcessSummary(snapshot);

  return (
    <div className="space-y-3">
      <SystemMetricCard
        expanded={expandedCards.has("cpu")}
        helper={
          loadAverageLabel
            ? `Load ${loadAverageLabel}`
            : `${snapshot.cpuCount ?? "-"} 核`
        }
        icon={Cpu}
        onToggle={() => onToggleMetric("cpu")}
        title="CPU"
        value={formatPercent(cpuUsagePercent)}
      >
        {cpuUsagePercent !== undefined ? (
          <SystemMeterBar value={cpuUsagePercent} />
        ) : null}
        <SystemInfoRows>
          {cpuCoreUsages.length > 0 ? (
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                每核
              </div>
              <div className="space-y-2">
                {cpuCoreUsages.map((value, index) => (
                  <CoreUsageRow index={index + 1} key={index} value={value} />
                ))}
              </div>
            </div>
          ) : null}
          <SystemInfoRow
            label="平均使用"
            value={formatPercent(cpuUsagePercent)}
          />
          <SystemInfoRow
            label="核心数"
            value={snapshot.cpuCount?.toString() ?? "-"}
          />
          <SystemInfoRow label="Load" value={loadAverageLabel ?? "-"} />
          <SystemInfoRow label="型号" value={snapshot.cpuModel ?? "-"} />
          <SystemInfoRow label="架构" value={snapshot.architecture ?? "-"} />
          <SystemInfoRow label="Kernel" value={snapshot.kernel ?? "-"} />
          <SystemInfoRow label="进程" value={processSummary} />
        </SystemInfoRows>
      </SystemMetricCard>
      <SystemMetricCard
        expanded={expandedCards.has("gpu")}
        helper={gpuCardHelper(snapshot, gpus)}
        icon={Gpu}
        onToggle={() => onToggleMetric("gpu")}
        title="GPU"
        value={serverGpuSummaryValue(gpus)}
      >
        {gpus.length > 0 ? (
          <div className="space-y-3">
            {gpus.map((gpu, index) => (
              <ServerGpuRow
                gpu={gpu}
                index={index}
                key={`${gpu.name}-${index}`}
              />
            ))}
          </div>
        ) : null}
      </SystemMetricCard>
      <SystemMetricCard
        expanded={expandedCards.has("memory")}
        helper={`${formatBytes(snapshot.memoryUsedBytes)} / ${formatBytes(
          snapshot.memoryTotalBytes,
        )}`}
        icon={MemoryStick}
        onToggle={() => onToggleMetric("memory")}
        title="内存"
        value={formatPercent(memoryPercent)}
      >
        {memoryPercent !== undefined ? (
          <SystemMeterBar value={memoryPercent} />
        ) : null}
        <SystemInfoRows>
          <SystemInfoRow
            label="已用"
            value={formatBytes(snapshot.memoryUsedBytes)}
          />
          <SystemInfoRow
            label="可用"
            value={formatBytes(snapshot.memoryAvailableBytes)}
          />
          <SystemInfoRow
            label="Buffers"
            value={formatBytes(snapshot.memoryBuffersBytes)}
          />
          <SystemInfoRow
            label="Cached"
            value={formatBytes(snapshot.memoryCachedBytes)}
          />
          <SystemInfoRow
            label="总计"
            value={formatBytes(snapshot.memoryTotalBytes)}
          />
          <SystemInfoRow label="使用率" value={formatPercent(memoryPercent)} />
          <SystemInfoRow
            label="运行时间"
            value={formatUptime(snapshot.uptimeSeconds) ?? "-"}
          />
        </SystemInfoRows>
      </SystemMetricCard>
      <SystemMetricCard
        expanded={expandedCards.has("swap")}
        helper={`${formatBytes(snapshot.swapUsedBytes)} / ${formatBytes(
          snapshot.swapTotalBytes,
        )}`}
        icon={Monitor}
        onToggle={() => onToggleMetric("swap")}
        title="Swap"
        value={formatPercent(swapPercent)}
      >
        {swapPercent !== undefined ? (
          <SystemMeterBar value={swapPercent} />
        ) : null}
        <SystemInfoRows>
          <SystemInfoRow
            label="已用"
            value={formatBytes(snapshot.swapUsedBytes)}
          />
          <SystemInfoRow
            label="总计"
            value={formatBytes(snapshot.swapTotalBytes)}
          />
          <SystemInfoRow label="使用率" value={formatPercent(swapPercent)} />
        </SystemInfoRows>
      </SystemMetricCard>
      <SystemMetricCard
        expanded={expandedCards.has("disk")}
        helper={`${snapshot.diskMount ?? "/"} · ${formatBytes(
          snapshot.diskUsedBytes,
        )} / ${formatBytes(snapshot.diskTotalBytes)}`}
        icon={HardDrive}
        onToggle={() => onToggleMetric("disk")}
        title="磁盘"
        value={formatPercent(diskPercent)}
      >
        {diskPercent !== undefined ? (
          <SystemMeterBar value={diskPercent} />
        ) : null}
        <SystemInfoRows>
          <SystemInfoRow label="挂载点" value={snapshot.diskMount ?? "/"} />
          <SystemInfoRow
            label="已用"
            value={formatBytes(snapshot.diskUsedBytes)}
          />
          <SystemInfoRow
            label="可用"
            value={formatBytes(snapshot.diskAvailableBytes)}
          />
          <SystemInfoRow
            label="总计"
            value={formatBytes(snapshot.diskTotalBytes)}
          />
          <SystemInfoRow label="使用率" value={formatPercent(diskPercent)} />
        </SystemInfoRows>
        {disks.length > 0 ? (
          <div className="mt-3 space-y-2">
            {disks.map((disk, index) => (
              <ServerDiskRow disk={disk} key={`${disk.mount}-${index}`} />
            ))}
          </div>
        ) : null}
      </SystemMetricCard>
      <SystemMetricCard
        expanded={expandedCards.has("network")}
        helper={networkCardHelper(networkTrafficView)}
        icon={Network}
        onToggle={() => onToggleMetric("network")}
        summary={
          <NetworkTopInterfaceRow
            networkInterface={topNetworkInterface}
            sample={formatNetworkSample(networkTrafficView)}
          />
        }
        title="网络"
        value={
          <NetworkRatePair
            emptyLabel="采样中"
            rxBytesPerSecond={networkTrafficView.totalRxBytesPerSecond}
            txBytesPerSecond={networkTrafficView.totalTxBytesPerSecond}
          />
        }
      >
        <SystemInfoRows>
          <SystemInfoRow
            label="排行首位"
            value={topNetworkInterface?.name ?? "-"}
          />
          <SystemInfoRow
            label="上行"
            value={formatTrafficRate(
              topNetworkInterface?.txBytesPerSecond,
              "等待采样",
            )}
          />
          <SystemInfoRow
            label="下行"
            value={formatTrafficRate(
              topNetworkInterface?.rxBytesPerSecond,
              "等待采样",
            )}
          />
          <SystemInfoRow
            label="采样"
            value={formatNetworkSample(networkTrafficView)}
          />
        </SystemInfoRows>
        {networkInterfaces.length > 0 ? (
          <div className="mt-3 space-y-2">
            {networkInterfaces.map((networkInterface, index) => (
              <ServerNetworkInterfaceRow
                key={networkInterface.name}
                networkInterface={networkInterface}
                rank={index + 1}
              />
            ))}
          </div>
        ) : null}
      </SystemMetricCard>
      <SystemMetricCard
        expanded={expandedCards.has("process")}
        helper={processSummary}
        icon={Activity}
        onToggle={() => onToggleMetric("process")}
        title="进程"
        value={snapshot.processCount?.toString() ?? "-"}
      >
        <SystemInfoRows>
          <SystemInfoRow
            label="总数"
            value={snapshot.processCount?.toString() ?? "-"}
          />
          <SystemInfoRow
            label="运行中"
            value={snapshot.runningProcessCount?.toString() ?? "-"}
          />
        </SystemInfoRows>
        {topProcesses.length > 0 ? (
          <div className="mt-3 space-y-2">
            {topProcesses.map((process) => (
              <ServerProcessRow
                key={`${process.pid}-${process.name}`}
                process={process}
              />
            ))}
          </div>
        ) : (
          <p className="kerminal-muted-surface mt-3 rounded-xl border px-3 py-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            未返回进程列表，可能仅有数量。
          </p>
        )}
      </SystemMetricCard>
    </div>
  );
}

function ServerGpuRow({ gpu, index }: { gpu: ServerGpuInfo; index: number }) {
  const memoryPercent = percentOf(
    gpu.memoryUsedBytes ?? undefined,
    gpu.memoryTotalBytes ?? undefined,
  );
  const primaryPercent = gpu.utilizationPercent ?? memoryPercent;

  return (
    <section className="kerminal-muted-surface rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {gpu.name}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            GPU {index + 1}
            {gpu.vendor ? ` · ${gpu.vendor}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
          {formatPercent(gpu.utilizationPercent ?? memoryPercent)}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {gpu.utilizationPercent !== undefined &&
        gpu.utilizationPercent !== null ? (
          <LabeledMeter label="GPU 使用率" value={gpu.utilizationPercent} />
        ) : null}
        {memoryPercent !== undefined ? (
          <LabeledMeter
            helper={gpuMemoryLabel(gpu)}
            label="显存占用"
            value={memoryPercent}
          />
        ) : null}
        {primaryPercent === undefined ? (
          <div className="kerminal-muted-surface rounded-lg border px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            暂无 GPU 使用率或显存。
          </div>
        ) : null}
      </div>
      <SystemInfoRows>
        <SystemInfoRow
          label="使用率"
          value={formatPercent(gpu.utilizationPercent)}
        />
        <SystemInfoRow label="显存" value={gpuMemoryLabel(gpu)} />
        <SystemInfoRow
          label="温度"
          value={formatTemperature(gpu.temperatureCelsius)}
        />
        <SystemInfoRow label="驱动" value={gpu.driverVersion ?? "-"} />
        <SystemInfoRow label="厂商" value={gpu.vendor ?? "-"} />
      </SystemInfoRows>
    </section>
  );
}

function ServerDiskRow({ disk }: { disk: ServerDiskInfo }) {
  const usagePercent = percentOf(disk.usedBytes, disk.totalBytes);

  return (
    <section className="kerminal-muted-surface rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0">
          <div className="break-words font-medium text-zinc-700 dark:text-zinc-200">
            {disk.mount}
          </div>
          <div className="mt-0.5 break-all text-zinc-500 dark:text-zinc-400">
            {disk.filesystem}
          </div>
        </div>
        <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-300">
          {formatPercent(usagePercent)}
        </span>
      </div>
      {usagePercent !== undefined ? (
        <SystemMeterBar value={usagePercent} />
      ) : null}
      <SystemInfoRows>
        <SystemInfoRow label="已用" value={formatBytes(disk.usedBytes)} />
        <SystemInfoRow label="可用" value={formatBytes(disk.availableBytes)} />
        <SystemInfoRow label="总计" value={formatBytes(disk.totalBytes)} />
      </SystemInfoRows>
    </section>
  );
}

function NetworkTopInterfaceRow({
  networkInterface,
  sample,
}: {
  networkInterface?: NetworkInterfaceTraffic;
  sample: string;
}) {
  return (
    <section className="kerminal-muted-surface rounded-xl border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {networkInterface?.name ?? "未识别网卡"}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            流量排行 #1 · {sample}
          </div>
        </div>
        <NetworkRatePair
          emptyLabel="等待采样"
          rxBytesPerSecond={networkInterface?.rxBytesPerSecond}
          txBytesPerSecond={networkInterface?.txBytesPerSecond}
        />
      </div>
    </section>
  );
}

function ServerNetworkInterfaceRow({
  networkInterface,
  rank,
}: {
  networkInterface: NetworkInterfaceTraffic;
  rank: number;
}) {
  return (
    <section className="kerminal-muted-surface rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {networkInterface.name}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            流量排行 #{rank}
          </div>
        </div>
        <NetworkRatePair
          emptyLabel="等待采样"
          rxBytesPerSecond={networkInterface.rxBytesPerSecond}
          txBytesPerSecond={networkInterface.txBytesPerSecond}
        />
      </div>
      <SystemInfoRows>
        <SystemInfoRow
          label="上行"
          value={formatTrafficRate(
            networkInterface.txBytesPerSecond,
            "等待采样",
          )}
        />
        <SystemInfoRow
          label="下行"
          value={formatTrafficRate(
            networkInterface.rxBytesPerSecond,
            "等待采样",
          )}
        />
        <SystemInfoRow
          label="累计接收"
          value={formatBytes(networkInterface.rxBytes)}
        />
        <SystemInfoRow
          label="累计发送"
          value={formatBytes(networkInterface.txBytes)}
        />
      </SystemInfoRows>
    </section>
  );
}

function NetworkRatePair({
  emptyLabel = "-",
  rxBytesPerSecond,
  txBytesPerSecond,
}: {
  emptyLabel?: string;
  rxBytesPerSecond?: number;
  txBytesPerSecond?: number;
}) {
  if (rxBytesPerSecond === undefined && txBytesPerSecond === undefined) {
    return (
      <span className="font-mono text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {emptyLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap justify-end gap-x-2 gap-y-1 font-mono text-xs leading-5">
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
        <ArrowUp className="h-3 w-3" />
        {formatTrafficRate(txBytesPerSecond)}
      </span>
      <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-300">
        <ArrowDown className="h-3 w-3" />
        {formatTrafficRate(rxBytesPerSecond)}
      </span>
    </span>
  );
}

function ServerProcessRow({ process }: { process: ServerProcessInfo }) {
  return (
    <section className="kerminal-muted-surface rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0">
          <div className="break-words text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {process.name}
          </div>
          <div className="mt-0.5 text-zinc-500 dark:text-zinc-400">
            PID {process.pid}
          </div>
        </div>
        <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-300">
          {formatPercent(process.cpuUsagePercent)}
        </span>
      </div>
      <SystemInfoRows>
        <SystemInfoRow
          label="CPU"
          value={formatPercent(process.cpuUsagePercent)}
        />
        <SystemInfoRow
          label="内存"
          value={formatPercent(process.memoryPercent)}
        />
        <SystemInfoRow label="RSS" value={formatBytes(process.memoryBytes)} />
      </SystemInfoRows>
    </section>
  );
}

function LabeledMeter({
  helper,
  label,
  value,
}: {
  helper?: string;
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">
          {label}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {helper
            ? `${formatPercent(value)} · ${helper}`
            : formatPercent(value)}
        </span>
      </div>
      <SystemMeterBar value={value} />
    </div>
  );
}

function CoreUsageRow({ index, value }: { index: number; value: number }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
      <span className="text-right text-zinc-500 dark:text-zinc-400">
        {index}
      </span>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
        <div
          className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
          style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
        />
      </div>
      <span className="text-right font-medium text-zinc-600 dark:text-zinc-300">
        {formatPercent(value)}
      </span>
    </div>
  );
}
