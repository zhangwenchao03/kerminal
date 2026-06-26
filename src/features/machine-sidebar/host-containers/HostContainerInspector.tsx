/**
 * Host-scoped container inspector panel.
 *
 * @author kongweiguang
 */

import { RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type {
  DockerContainerInspectSummary,
  DockerContainerStatsResult,
} from "../../../lib/dockerApi";
import type {
  HostContainerInspectorTab,
  HostContainerMetadata,
} from "./hostContainerDialogModel";

const inspectorTabs: Array<{
  id: HostContainerInspectorTab;
  label: string;
}> = [
  { id: "details", label: "详情" },
  { id: "stats", label: "监控" },
];

const inspectorIconButtonClassName =
  "h-8 w-8 rounded-lg text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
const inspectorPanelClassName =
  "grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-overlay)]/88 p-3 shadow-sm shadow-black/5 dark:shadow-black/20";
const inspectorHeaderClassName =
  "grid h-[5.75rem] grid-rows-[minmax(0,2.25rem)_2rem] gap-3 border-b border-[var(--border-subtle)] pb-3";
const inspectorTabsClassName =
  "grid h-8 w-full max-w-[22rem] justify-self-end rounded-xl bg-black/5 p-0.5 dark:bg-white/10";
const inspectorBodyClassName =
  "min-h-0 overflow-y-auto pt-3 [scrollbar-gutter:stable]";

export function HostContainerInspector({
  container,
  error,
  inspectSummary,
  loading,
  onRefresh,
  onTabChange,
  statsResult,
  tab,
}: {
  container?: HostContainerMetadata;
  error: string | null;
  inspectSummary: DockerContainerInspectSummary | null;
  loading: boolean;
  onRefresh: () => void;
  onTabChange: (tab: HostContainerInspectorTab) => void;
  statsResult: DockerContainerStatsResult | null;
  tab: HostContainerInspectorTab;
}) {
  return (
    <aside className={inspectorPanelClassName}>
      <div className={inspectorHeaderClassName}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              {container?.name ?? "容器信息"}
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {container?.shortId ?? "未选择"}
            </div>
          </div>
          <Button
            aria-label="刷新容器信息"
            className={inspectorIconButtonClassName}
            disabled={!container || loading}
            onClick={onRefresh}
            size="icon"
            title="刷新容器信息"
            type="button"
            variant="ghost"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        <div
          aria-label="容器信息视图"
          className={cn(inspectorTabsClassName, "grid-cols-2")}
          role="tablist"
        >
          {inspectorTabs.map((item) => (
            <button
              aria-selected={tab === item.id}
              className={cn(
                "kerminal-focus-ring h-7 rounded-lg text-xs font-medium transition",
                tab === item.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
              key={item.id}
              onClick={() => onTabChange(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={inspectorBodyClassName}>
        {!container ? (
          <StateMessage>选择容器后查看详情。</StateMessage>
        ) : error ? (
          <StateMessage tone="danger">{error}</StateMessage>
        ) : loading &&
          !hasInspectorData(tab, inspectSummary, statsResult) ? (
          <StateMessage>正在读取容器信息...</StateMessage>
        ) : tab === "details" ? (
          <InspectDetailsPanel container={container} summary={inspectSummary} />
        ) : (
          <InspectStatsPanel stats={statsResult} />
        )}
      </div>
    </aside>
  );
}

function InspectDetailsPanel({
  container,
  summary,
}: {
  container: HostContainerMetadata;
  summary: DockerContainerInspectSummary | null;
}) {
  const ports = summary?.ports.length ? summary.ports : container.ports;
  const labels = summary ? Object.entries(summary.labels).slice(0, 6) : [];
  return (
    <div className="grid gap-3 text-xs">
      <div className="grid gap-1.5">
        <InspectorField label="镜像" value={summary?.image ?? container.image} />
        <InspectorField
          label="状态"
          value={summary?.status ?? container.statusText}
        />
        <InspectorField label="运行时" value={container.runtime} />
        <InspectorField
          label="完整 ID"
          mono
          value={summary?.id ?? container.id}
        />
        <InspectorField label="工作目录" value={summary?.workingDir ?? "-"} />
        <InspectorField label="用户" value={summary?.user ?? "-"} />
      </div>
      <InspectorList label="端口" values={ports} />
      <InspectorList label="网络" values={summary?.networks ?? []} />
      <InspectorList
        label="命令"
        values={[...(summary?.entrypoint ?? []), ...(summary?.command ?? [])]}
      />
      {labels.length ? (
        <div className="grid gap-1.5">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            Labels
          </div>
          <div className="grid gap-1">
            {labels.map(([key, value]) => (
              <div
                className="min-w-0 rounded-lg bg-black/5 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                key={key}
                title={`${key}=${value}`}
              >
                <span className="truncate">{key}</span>
                <span className="text-zinc-400"> = </span>
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InspectStatsPanel({
  stats,
}: {
  stats: DockerContainerStatsResult | null;
}) {
  return (
    <div className="grid gap-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <StatsMetric label="CPU" value={stats?.cpuPercent} />
        <StatsMetric label="内存" value={stats?.memoryPercent} />
        <StatsMetric label="PIDs" value={stats?.pids} />
        <StatsMetric label="网络" value={stats?.networkIo} />
      </div>
      <InspectorField label="内存使用" value={stats?.memoryUsage ?? "-"} />
      <InspectorField label="Block IO" value={stats?.blockIo ?? "-"} />
      <pre className="max-h-28 overflow-auto rounded-xl bg-black/5 p-2 font-mono text-[11px] text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
        {stats?.raw || "暂无 stats 数据。"}
      </pre>
    </div>
  );
}

function InspectorField({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-zinc-800 dark:text-zinc-200",
          mono && "font-mono text-[11px]",
        )}
        title={value}
      >
        {value || "-"}
      </span>
    </div>
  );
}

function InspectorList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {values.length ? (
          values.map((value) => (
            <span
              className="max-w-full truncate rounded-lg bg-black/5 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
              key={value}
              title={value}
            >
              {value}
            </span>
          ))
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">-</span>
        )}
      </div>
    </div>
  );
}

function StatsMetric({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl bg-black/5 px-2.5 py-2 dark:bg-white/10">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="truncate font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value ?? "-"}
      </div>
    </div>
  );
}

function StateMessage({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 items-center justify-center rounded-2xl border px-4 py-8 text-center text-sm",
        tone === "danger"
          ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200"
          : "border-dashed border-[var(--border-subtle)] text-zinc-500 dark:text-zinc-400",
      )}
    >
      {children}
    </div>
  );
}

function hasInspectorData(
  tab: HostContainerInspectorTab,
  inspectSummary: DockerContainerInspectSummary | null,
  statsResult: DockerContainerStatsResult | null,
) {
  if (tab === "details") {
    return Boolean(inspectSummary);
  }
  return Boolean(statsResult);
}
