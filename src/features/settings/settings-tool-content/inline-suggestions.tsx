import { useState } from "react";
import {
  Activity,
  Clipboard,
  Network,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import {
  getTerminalSuggestionTelemetryExport,
  type CommandSuggestionDiagnosticsCleanupResult,
  type CommandSuggestionTelemetryExport,
  type CommandSuggestionTelemetrySummary,
} from "../../../lib/terminalSuggestionApi";
import {
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
  type TerminalInlineSuggestionSettings,
} from "../settingsModel";
import { commandSuggestionProviderLabels } from "./options";
import { writeTextToClipboard } from "./clipboard";
import type {
  SuggestionCleanupState,
  SuggestionTelemetryLoadState,
} from "./types";

const inlineSuggestionButtonClassName =
  "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs text-zinc-600 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-300";
const inlineSuggestionActionButtonClassName =
  "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs text-zinc-600 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-300";
const inlineSuggestionTileClassName = "kerminal-muted-surface rounded-xl border";

export function InlineSuggestionPolicyStatus({
  inlineSuggestion,
}: {
  inlineSuggestion: TerminalInlineSuggestionSettings;
}) {
  const productionRestricted =
    inlineSuggestion.productionHostPolicy === "restricted";
  const statusItems: Array<{
    icon: LucideIcon;
    label: string;
    tone: "emerald" | "sky" | "zinc";
    value: string;
  }> = [
    {
      icon: ShieldCheck,
      label: "主机安装",
      tone: "emerald",
      value: "不需要插件",
    },
    {
      icon: Network,
      label: "远端探测",
      tone: inlineSuggestion.remoteProbeEnabled ? "sky" : "zinc",
      value: inlineSuggestion.remoteProbeEnabled ? "后台只读" : "已关闭",
    },
    {
      icon: Server,
      label: "生产主机",
      tone: productionRestricted ? "emerald" : "sky",
      value: productionRestricted ? "限制预热" : "普通策略",
    },
    {
      icon: Activity,
      label: "反馈调权",
      tone: inlineSuggestion.enabled ? "sky" : "zinc",
      value: inlineSuggestion.enabled ? "接受/忽略" : "暂停",
    },
  ];

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {statusItems.map((item) => {
        const Icon = item.icon;
        return (
          <div
            className={cn(
              inlineSuggestionTileClassName,
              "flex min-h-9 items-center justify-between gap-3 px-2.5 py-2",
            )}
            key={item.label}
          >
            <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                item.tone === "emerald"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                  : item.tone === "sky"
                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-100"
                    : "bg-[var(--surface-hover)] text-zinc-500 dark:text-zinc-400",
              )}
            >
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InlineSuggestionProviderToggle({
  checked,
  icon: Icon,
  label,
  onChange,
}: {
  checked: boolean;
  icon: LucideIcon;
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div
      className={cn(
        inlineSuggestionTileClassName,
        "flex min-h-10 items-center justify-between gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="min-w-0 truncate text-left leading-5">{label}</span>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export function InlineSuggestionTelemetryPanel({
  auditRetentionDays,
  cleanupError,
  cleanupResult,
  cleanupState,
  error,
  feedbackRetentionDays,
  onAuditRetentionDaysChange,
  onCleanupExpired,
  onFeedbackRetentionDaysChange,
  onRefresh,
  onResetTelemetry,
  state,
  telemetry,
}: {
  auditRetentionDays: number;
  cleanupError: string | null;
  cleanupResult: CommandSuggestionDiagnosticsCleanupResult | null;
  cleanupState: SuggestionCleanupState;
  error: string | null;
  feedbackRetentionDays: number;
  onAuditRetentionDaysChange: (value: number) => void;
  onCleanupExpired: () => void;
  onFeedbackRetentionDaysChange: (value: number) => void;
  onRefresh: () => void;
  onResetTelemetry: () => void;
  state: SuggestionTelemetryLoadState;
  telemetry: CommandSuggestionTelemetrySummary | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  const providers = telemetry?.providers ?? [];
  const activeProviders = providers.filter(
    (provider) => suggestionProviderTelemetryTotal(provider) > 0,
  );
  const cacheHitCount = providers.reduce(
    (total, provider) => total + provider.cacheHitCount,
    0,
  );
  const cacheMissCount = providers.reduce(
    (total, provider) => total + provider.cacheMissCount,
    0,
  );
  const feedbackCount = providers.reduce(
    (total, provider) =>
      total +
      provider.feedbackAcceptedCount +
      provider.feedbackDismissedCount +
      provider.feedbackSkippedCount,
    0,
  );
  const refreshFailureCount = providers.reduce(
    (total, provider) => total + provider.refreshFailureCount,
    0,
  );
  const cleanupRunning = cleanupState === "running";
  const handleCopyExport = async () => {
    setCopyState("copying");
    try {
      const telemetryExport = await getTerminalSuggestionTelemetryExport();
      await writeTelemetryExportToClipboard(telemetryExport);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className={cn(inlineSuggestionTileClassName, "p-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <Activity className="h-4 w-4 text-zinc-400" />
          灰色提示诊断
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            aria-label="复制灰色提示诊断"
            className={inlineSuggestionButtonClassName}
            disabled={copyState === "copying"}
            onClick={handleCopyExport}
            type="button"
          >
            <Clipboard className="h-3.5 w-3.5" />
            {copyState === "copied"
              ? "已复制"
              : copyState === "error"
                ? "复制失败"
                : "复制"}
          </button>
          <button
            aria-label="刷新灰色提示诊断"
            className={inlineSuggestionButtonClassName}
            disabled={state === "loading"}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")}
            />
            刷新
          </button>
        </div>
      </div>

      {error ? (
        <div
          className="mt-3 rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <InlineSuggestionTelemetryMetric
              label="查询"
              value={telemetry?.totalQueryCount ?? 0}
            />
            <InlineSuggestionTelemetryMetric
              label="候选"
              value={telemetry?.totalCandidateCount ?? 0}
            />
            <InlineSuggestionTelemetryMetric
              label="缓存"
              value={`${cacheHitCount}/${cacheMissCount}`}
            />
            <InlineSuggestionTelemetryMetric
              label="反馈"
              value={feedbackCount}
            />
          </div>

          <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              数据保留
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content_max-content]">
              <RetentionDaysInput
                label="审计保留"
                onChange={onAuditRetentionDaysChange}
                value={auditRetentionDays}
              />
              <RetentionDaysInput
                label="反馈保留"
                onChange={onFeedbackRetentionDaysChange}
                value={feedbackRetentionDays}
              />
              <button
                aria-label="清理灰色提示过期诊断"
                className={inlineSuggestionActionButtonClassName}
                disabled={cleanupRunning}
                onClick={onCleanupExpired}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清理过期
              </button>
              <button
                aria-label="重置灰色提示聚合统计"
                className={inlineSuggestionActionButtonClassName}
                disabled={cleanupRunning}
                onClick={onResetTelemetry}
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重置统计
              </button>
            </div>
          </div>

          {cleanupError ? (
            <div
              className="mt-2 rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100"
              role="alert"
            >
              {cleanupError}
            </div>
          ) : cleanupResult ? (
            <div className="mt-2 rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-700 dark:text-emerald-100">
              已清理 审计 {cleanupResult.auditEventsDeleted} / 反馈{" "}
              {cleanupResult.feedbackDeleted} / 缓存{" "}
              {cleanupResult.providerCacheDeleted} / 统计{" "}
              {cleanupResult.telemetryRowsDeleted}
            </div>
          ) : null}

          {refreshFailureCount > 0 ? (
            <div className="mt-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-100">
              远端刷新失败 {refreshFailureCount} 次
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2">
            {activeProviders.length === 0 ? (
              <div className="kerminal-muted-surface col-span-full rounded-xl border border-dashed px-3 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
                暂无运行期数据
              </div>
            ) : (
              activeProviders.map((provider) => (
                <InlineSuggestionProviderTelemetryRow
                  key={provider.provider}
                  provider={provider}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InlineSuggestionTelemetryMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className={cn(inlineSuggestionTileClassName, "px-3 py-2")}>
      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}

function RetentionDaysInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label
      className={cn(
        "kerminal-field-surface",
        "flex min-h-10 items-center justify-between gap-2 rounded-xl border px-3 py-2",
      )}
    >
      <span className="shrink-0 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1">
        <input
          aria-label={`${label}天数`}
          className="w-12 bg-transparent text-right text-sm font-semibold text-zinc-900 outline-none dark:text-zinc-100"
          max={TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX}
          min={TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN}
          onChange={(event) =>
            onChange(
              clampNumber(
                Number.parseInt(event.currentTarget.value, 10),
                TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
                TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
              ),
            )
          }
          type="number"
          value={value}
        />
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">天</span>
      </span>
    </label>
  );
}

function InlineSuggestionProviderTelemetryRow({
  provider,
}: {
  provider: CommandSuggestionTelemetrySummary["providers"][number];
}) {
  const totalFeedback =
    provider.feedbackAcceptedCount +
    provider.feedbackDismissedCount +
    provider.feedbackSkippedCount;
  const cacheText = `${provider.cacheHitCount}/${provider.cacheMissCount}`;
  const averageElapsed =
    provider.queryCount > 0 ? `${provider.averageElapsedMs.toFixed(1)} ms` : "-";

  return (
    <div className={cn(inlineSuggestionTileClassName, "grid gap-2 px-3 py-2 text-xs")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {commandSuggestionProviderLabels[provider.provider]}
        </span>
        <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {provider.queryCount} 次
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-zinc-500 dark:text-zinc-400">
        <span>候选 {provider.candidateCount}</span>
        <span>缓存 {cacheText}</span>
        <span>反馈 {totalFeedback}</span>
      </div>
      {provider.lastError ? (
        <div className="truncate text-[11px] text-rose-600 dark:text-rose-200">
          {provider.lastError}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-500">
          平均 {averageElapsed}
        </div>
      )}
    </div>
  );
}

async function writeTelemetryExportToClipboard(
  telemetryExport: CommandSuggestionTelemetryExport,
) {
  await writeTextToClipboard(JSON.stringify(telemetryExport, null, 2));
}
function suggestionProviderTelemetryTotal(
  provider: CommandSuggestionTelemetrySummary["providers"][number],
) {
  return (
    provider.queryCount +
    provider.candidateCount +
    provider.cacheHitCount +
    provider.cacheMissCount +
    provider.refreshSuccessCount +
    provider.refreshFailureCount +
    provider.feedbackAcceptedCount +
    provider.feedbackDismissedCount +
    provider.feedbackSkippedCount
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}
