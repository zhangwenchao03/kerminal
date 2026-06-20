import {
  Activity,
  Cpu,
  Database,
  Gpu,
  HardDrive,
  MemoryStick,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRuntimeHealthSnapshot,
  type RuntimeGpuHealth,
  type RuntimeHealthSnapshot,
} from "../../lib/diagnosticsApi";
import { Select } from "../../components/ui/select";
import {
  SystemOverviewCard,
  SystemOverviewTile,
  SystemInfoRow,
  SystemInfoRows,
  SystemMeterBar,
  SystemMetricCard,
} from "./SystemMetricCard";

type RuntimeCardId = "cpu" | "gpu" | "memory" | "process" | "storage" | "system";

const refreshOptions = [
  { label: "1s", value: 1000 },
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
];

export function RuntimeHealthCard() {
  const [snapshot, setSnapshot] = useState<RuntimeHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(3000);
  const [expandedCards, setExpandedCards] = useState<Set<RuntimeCardId>>(
    () => new Set(),
  );
  const loadingRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getRuntimeHealthSnapshot());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadSnapshot();
    }, refreshIntervalMs);

    return () => window.clearInterval(interval);
  }, [loadSnapshot, refreshIntervalMs]);

  const toggleCard = (cardId: RuntimeCardId) => {
    setExpandedCards((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const memoryPercent = snapshot
    ? percentOf(snapshot.system.usedMemoryBytes, snapshot.system.totalMemoryBytes)
    : 0;
  const swapPercent = snapshot
    ? percentOf(snapshot.system.usedSwapBytes, snapshot.system.totalSwapBytes)
    : 0;
  const gpus = snapshot?.system.gpus ?? [];

  return (
    <section className="space-y-3">
      <SystemOverviewCard
        footer={
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
                {snapshot
                  ? `上次采集 ${formatTimestamp(snapshot.capturedAt)}`
                  : "等待首次采集"}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                自动刷新
                <Select
                  aria-label="自动刷新间隔"
                  className="w-24"
                  onValueChange={(value) =>
                    setRefreshIntervalMs(Number(value))
                  }
                  options={refreshOptions.map((option) => ({
                    label: option.label,
                    value: String(option.value),
                  }))}
                  size="sm"
                  value={String(refreshIntervalMs)}
                />
              </div>
            </div>
            {error ? (
              <div
                className="mt-3 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            {!snapshot && !error ? (
              <div className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2 text-sm text-zinc-500 dark:bg-black/20 dark:text-zinc-400">
                {loading ? "正在采集运行体验..." : "等待运行体验数据。"}
              </div>
            ) : null}
          </>
        }
        icon={Activity}
        onRefresh={() => void loadSnapshot()}
        refreshAriaLabel="刷新运行体验"
        refreshing={loading}
        subtitle="当前应用进程、本机资源和 Kerminal 数据目录会按选定间隔自动刷新。"
        title="本机运行体验"
      >
        <SystemOverviewTile
          label="主机名"
          value={snapshot?.system.hostName ?? "本机"}
        />
        <SystemOverviewTile
          label="系统"
          value={
            snapshot
              ? joinDefined([snapshot.system.os, snapshot.system.arch])
              : undefined
          }
        />
        <SystemOverviewTile
          label="Kernel"
          value={
            snapshot?.system.kernelVersion ??
            snapshot?.system.osVersion ??
            undefined
          }
        />
        <SystemOverviewTile
          label="运行时间"
          value={snapshot ? formatDuration(snapshot.system.uptimeSeconds) : undefined}
        />
      </SystemOverviewCard>

      {snapshot ? (
        <div className="space-y-3">
          <SystemMetricCard
            expanded={expandedCards.has("cpu")}
            helper={`${snapshot.system.cpuCount} 核`}
            icon={Cpu}
            onToggle={() => toggleCard("cpu")}
            title="CPU"
            value={formatPercent(snapshot.system.globalCpuUsagePercent)}
          >
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4">
              <CircularMeter value={snapshot.system.globalCpuUsagePercent} />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-zinc-950 dark:text-zinc-50">
                    平均使用率
                  </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-300">
                    {formatPercent(snapshot.system.globalCpuUsagePercent)}
                  </span>
                </div>
                <SystemMeterBar value={snapshot.system.globalCpuUsagePercent} />
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  采样 {snapshot.sampling.cpuSampleIntervalMs}ms ·{" "}
                  {snapshot.sampling.source}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-black/8 pt-3 dark:border-white/8">
              {coreUsages(snapshot).map((value, index) => (
                <CoreUsageRow index={index + 1} key={index} value={value} />
              ))}
            </div>
          </SystemMetricCard>

          <SystemMetricCard
            expanded={expandedCards.has("gpu")}
            helper={gpus.length > 0 ? `${gpus.length} 张显卡` : "未采集到显卡信息"}
            icon={Gpu}
            onToggle={() => toggleCard("gpu")}
            title="GPU"
            value={gpus.length > 0 ? gpuSummaryValue(gpus) : "未识别"}
          >
            {gpus.length > 0 ? (
              <div className="space-y-3">
                {gpus.map((gpu, index) => (
                  <GpuDetail key={`${gpu.name}-${index}`} gpu={gpu} index={index} />
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-black/[0.03] px-3 py-2 text-xs leading-5 text-zinc-500 dark:bg-black/20 dark:text-zinc-400">
                当前系统未返回可展示的 GPU。Windows 会尝试读取显卡控制器和性能计数器；受限环境、驱动不支持或无独显时可能为空。
              </p>
            )}
          </SystemMetricCard>

          <SystemMetricCard
            expanded={expandedCards.has("memory")}
            helper={`${formatBytes(snapshot.system.usedMemoryBytes)} / ${formatBytes(
              snapshot.system.totalMemoryBytes,
            )}`}
            icon={MemoryStick}
            onToggle={() => toggleCard("memory")}
            title="内存"
            value={formatPercent(memoryPercent)}
          >
            <SystemMeterBar value={memoryPercent} />
            <SystemInfoRows>
              <SystemInfoRow label="已用内存" value={formatBytes(snapshot.system.usedMemoryBytes)} />
              <SystemInfoRow label="总内存" value={formatBytes(snapshot.system.totalMemoryBytes)} />
              <SystemInfoRow label="可用内存" value={formatBytes(snapshot.system.availableMemoryBytes)} />
              <SystemInfoRow label="使用率" value={formatPercent(memoryPercent)} />
              <SystemInfoRow
                label="Swap"
                value={`${formatPercent(swapPercent)} · ${formatBytes(
                  snapshot.system.usedSwapBytes,
                )} / ${formatBytes(snapshot.system.totalSwapBytes)}`}
              />
              <SystemInfoRow
                label="系统运行"
                value={formatDuration(snapshot.system.uptimeSeconds)}
              />
              <SystemInfoRow
                label="启动时间"
                value={formatDateTime(snapshot.system.bootTimeSeconds)}
              />
            </SystemInfoRows>
          </SystemMetricCard>

          <SystemMetricCard
            expanded={expandedCards.has("process")}
            helper={`PID ${snapshot.process.pid}`}
            icon={Activity}
            onToggle={() => toggleCard("process")}
            title="Kerminal 进程"
            value={formatPercent(snapshot.process.cpuUsagePercent)}
          >
            <SystemInfoRows>
              <SystemInfoRow label="进程名" value={snapshot.process.name} />
              <SystemInfoRow label="常驻内存" value={formatBytes(snapshot.process.memoryBytes)} />
              <SystemInfoRow
                label="虚拟内存"
                value={formatBytes(snapshot.process.virtualMemoryBytes)}
              />
              <SystemInfoRow
                label="运行时长"
                value={formatDuration(snapshot.process.uptimeSeconds)}
              />
              <SystemInfoRow
                label="磁盘读写"
                value={`${formatBytes(snapshot.process.diskReadBytes)} / ${formatBytes(
                  snapshot.process.diskWrittenBytes,
                )}`}
              />
            </SystemInfoRows>
          </SystemMetricCard>

          <SystemMetricCard
            expanded={expandedCards.has("storage")}
            helper={`数据库 ${formatBytes(snapshot.storage.databaseFileSizeBytes)}`}
            icon={HardDrive}
            onToggle={() => toggleCard("storage")}
            title="数据目录"
            value={formatBytes(snapshot.storage.rootSizeBytes)}
          >
            <SystemInfoRows>
              <SystemInfoRow label="根目录" value={snapshot.storage.root} wide />
              <SystemInfoRow label="数据库" value={snapshot.storage.databaseFile} wide />
              <SystemInfoRow label="日志" value={snapshot.storage.logs} wide />
              <SystemInfoRow label="诊断包" value={snapshot.storage.diagnostics} wide />
              <SystemInfoRow label="脱敏" value={snapshot.redacted ? "已启用" : "未启用"} />
            </SystemInfoRows>
          </SystemMetricCard>

          <SystemMetricCard
            expanded={expandedCards.has("system")}
            helper={snapshot.system.kernelVersion ?? snapshot.system.osVersion ?? "-"}
            icon={Database}
            onToggle={() => toggleCard("system")}
            title="系统版本"
            value={snapshot.system.os}
          >
            <SystemInfoRows>
              <SystemInfoRow label="操作系统" value={snapshot.system.os} />
              <SystemInfoRow label="架构" value={snapshot.system.arch} />
              <SystemInfoRow label="主机名" value={snapshot.system.hostName ?? "-"} />
              <SystemInfoRow label="Kernel" value={snapshot.system.kernelVersion ?? "-"} />
              <SystemInfoRow label="系统版本" value={snapshot.system.osVersion ?? "-"} />
              <SystemInfoRow
                label="运行时间"
                value={formatDuration(snapshot.system.uptimeSeconds)}
              />
              <SystemInfoRow
                label="启动时间"
                value={formatDateTime(snapshot.system.bootTimeSeconds)}
              />
              <SystemInfoRow
                label="采样"
                value={`${snapshot.sampling.cpuSampleIntervalMs}ms · ${snapshot.sampling.source}`}
              />
            </SystemInfoRows>
          </SystemMetricCard>
        </div>
      ) : null}
    </section>
  );
}

function CircularMeter({ value }: { value: number }) {
  const percent = clampPercent(value);
  return (
    <div
      aria-label={`CPU 平均使用率 ${formatPercent(percent)}`}
      className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(rgb(16 185 129) ${percent * 3.6}deg, rgba(113, 113, 122, 0.22) 0deg)`,
      }}
    >
      <div className="absolute inset-1.5 rounded-full bg-white/95 dark:bg-zinc-950/95" />
      <div className="relative text-center">
        <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-300">
          {Math.round(percent)}
        </div>
        <div className="-mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">%</div>
      </div>
    </div>
  );
}

function CoreUsageRow({ index, value }: { index: number; value: number }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
      <span className="text-right text-zinc-500 dark:text-zinc-400">{index}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-black/30">
        <div
          className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
          style={{ width: `${clampPercent(value)}%` }}
        />
      </div>
      <span className="text-right font-medium text-zinc-600 dark:text-zinc-300">
        {formatPercent(value)}
      </span>
    </div>
  );
}

function GpuDetail({ gpu, index }: { gpu: RuntimeGpuHealth; index: number }) {
  const memoryPercent = gpuMemoryPercent(gpu);
  const primaryPercent = gpu.utilizationPercent ?? memoryPercent;

  return (
    <section className="rounded-xl bg-black/[0.03] p-3 dark:bg-black/20">
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
          {formatOptionalPercent(gpu.utilizationPercent ?? memoryPercent)}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {gpu.utilizationPercent !== undefined && gpu.utilizationPercent !== null ? (
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
          <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-zinc-500 dark:bg-black/20 dark:text-zinc-400">
            暂未采集到可绘制的 GPU 使用率或显存占用。
          </div>
        ) : null}
      </div>
      <SystemInfoRows>
        <SystemInfoRow label="使用率" value={formatOptionalPercent(gpu.utilizationPercent)} />
        <SystemInfoRow label="显存" value={gpuMemoryLabel(gpu)} />
        <SystemInfoRow label="温度" value={formatTemperature(gpu.temperatureCelsius)} />
        <SystemInfoRow label="驱动" value={gpu.driverVersion ?? "-"} />
        <SystemInfoRow label="厂商" value={gpu.vendor ?? "-"} />
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
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {helper ? `${formatPercent(value)} · ${helper}` : formatPercent(value)}
        </span>
      </div>
      <SystemMeterBar value={value} />
    </div>
  );
}

function coreUsages(snapshot: RuntimeHealthSnapshot) {
  if (snapshot.system.cpuCoreUsagePercents.length > 0) {
    return snapshot.system.cpuCoreUsagePercents;
  }

  return Array.from({ length: snapshot.system.cpuCount }, () =>
    snapshot.system.globalCpuUsagePercent,
  );
}

function percentOf(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return (used / total) * 100;
}

function optionalPercentOf(used?: number | null, total?: number | null) {
  if (used === undefined || used === null || total === undefined || total === null || total <= 0) {
    return undefined;
  }
  return (used / total) * 100;
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 100));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatOptionalPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return formatPercent(value);
}

function formatOptionalBytes(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return formatBytes(value);
}

function gpuMemoryPercent(gpu: RuntimeGpuHealth) {
  return optionalPercentOf(gpu.memoryUsedBytes, gpu.memoryTotalBytes);
}

function gpuMemoryLabel(gpu: RuntimeGpuHealth) {
  if (gpu.memoryUsedBytes !== undefined && gpu.memoryUsedBytes !== null) {
    return `${formatOptionalBytes(gpu.memoryUsedBytes)} / ${formatOptionalBytes(
      gpu.memoryTotalBytes,
    )}`;
  }
  if (gpu.memoryTotalBytes !== undefined && gpu.memoryTotalBytes !== null) {
    return `总显存 ${formatBytes(gpu.memoryTotalBytes)}`;
  }
  return "-";
}

function gpuSummaryValue(gpus: RuntimeGpuHealth[]) {
  const usageGpu = gpus.find((gpu) => gpu.utilizationPercent !== undefined && gpu.utilizationPercent !== null);
  if (usageGpu) {
    return formatPercent(usageGpu.utilizationPercent ?? 0);
  }

  const memoryGpu = gpus.find((gpu) => gpuMemoryPercent(gpu) !== undefined);
  const memoryPercent = memoryGpu ? gpuMemoryPercent(memoryGpu) : undefined;
  if (memoryPercent !== undefined) {
    return formatPercent(memoryPercent);
  }

  return "可用";
}

function formatTemperature(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(0)} °C`;
}

function formatTimestamp(value: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return value;
  }
  return new Date(seconds * 1000).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
}

function formatDateTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function joinDefined(parts: Array<string | undefined>) {
  const values = parts.filter(Boolean);
  return values.length > 0 ? values.join(" · ") : undefined;
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分钟`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
  }
  return `${Math.floor(seconds / 86_400)} 天 ${Math.floor((seconds % 86_400) / 3600)} 小时`;
}
