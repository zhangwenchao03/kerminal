import type { TerminalRendererType } from "../settings/contracts/index";
import type { RuntimeDiagnosticsWorkMode } from "./terminalRuntimeDiagnostics";

export type TerminalPaneRuntimeWorkMode = RuntimeDiagnosticsWorkMode;

export type TerminalPaneRuntimeLifecycleReason =
  | "focused-visible"
  | "hidden"
  | "hidden-stale"
  | "high-output"
  | "inactive-tab"
  | "visible-unfocused";

export type TerminalPaneRendererResourceMode =
  | "active"
  | "cpu-only"
  | "parked"
  | "release-webgl";

export type TerminalPaneSuggestionWorkMode =
  | "active"
  | "deferred"
  | "paused";

export type TerminalPaneOutputHistoryWorkMode =
  | "live"
  | "tail-only"
  | "throttled";

export interface TerminalPaneRuntimeLifecycleConfig {
  fullOutputHistoryFlushMs: number;
  hiddenTailFlushMs: number;
  hiddenSuspendAfterMs: number;
  highOutputBytesPerSecond: number;
  recentInteractionGraceMs: number;
  suspendedRendererFlushMs: number;
  visibleDegradedOutputHistoryFlushMs: number;
  visibleRecoveryAfterMs: number;
}

export interface TerminalPaneRuntimeLifecycleInput {
  activeTab: boolean;
  config?: Partial<TerminalPaneRuntimeLifecycleConfig>;
  focused: boolean;
  hiddenSince?: number;
  lastUserInteractionAt?: number;
  now: number;
  outputRateBytesPerSecond?: number;
  rendererType: TerminalRendererType;
  visible: boolean;
}

export interface TerminalPaneRuntimeLifecycleDecision {
  allowGpuRenderer: boolean;
  captureOutputTail: boolean;
  hiddenAgeMs: number;
  needsVisibleRecovery: boolean;
  outputHistoryFlushIntervalMs: number;
  outputHistoryWorkMode: TerminalPaneOutputHistoryWorkMode;
  reason: TerminalPaneRuntimeLifecycleReason;
  releaseGpuRenderer: boolean;
  rendererResourceMode: TerminalPaneRendererResourceMode;
  shouldRunSuggestionProbe: boolean;
  suggestionWorkMode: TerminalPaneSuggestionWorkMode;
  workMode: TerminalPaneRuntimeWorkMode;
}

export const TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG: TerminalPaneRuntimeLifecycleConfig =
  {
    fullOutputHistoryFlushMs: 100,
    hiddenTailFlushMs: 2_000,
    hiddenSuspendAfterMs: 30_000,
    highOutputBytesPerSecond: 256 * 1024,
    recentInteractionGraceMs: 2_000,
    suspendedRendererFlushMs: 5_000,
    visibleDegradedOutputHistoryFlushMs: 500,
    visibleRecoveryAfterMs: 250,
  };

export function resolveTerminalPaneRuntimeLifecycle({
  activeTab,
  config,
  focused,
  hiddenSince,
  lastUserInteractionAt,
  now,
  outputRateBytesPerSecond = 0,
  rendererType,
  visible,
}: TerminalPaneRuntimeLifecycleInput): TerminalPaneRuntimeLifecycleDecision {
  const resolvedConfig = resolveTerminalPaneRuntimeLifecycleConfig(config);
  const hiddenAgeMs = resolveHiddenAgeMs(now, hiddenSince);
  const visibleInActiveTab = visible && activeTab;
  const highOutput =
    outputRateBytesPerSecond >= resolvedConfig.highOutputBytesPerSecond;
  const recentInteraction =
    typeof lastUserInteractionAt === "number" &&
    now - lastUserInteractionAt <= resolvedConfig.recentInteractionGraceMs;

  if (!visibleInActiveTab) {
    const staleHidden = hiddenAgeMs >= resolvedConfig.hiddenSuspendAfterMs;
    return createDecision({
      allowGpuRenderer: false,
      config: resolvedConfig,
      hiddenAgeMs,
      reason: staleHidden ? "hidden-stale" : activeTab ? "hidden" : "inactive-tab",
      rendererType,
      workMode: staleHidden ? "suspended-renderer" : "hidden-tail-only",
    });
  }

  const needsVisibleRecovery =
    hiddenAgeMs >= resolvedConfig.visibleRecoveryAfterMs;
  const workMode =
    focused && (!highOutput || recentInteraction)
      ? "full"
      : "visible-degraded";
  const reason: TerminalPaneRuntimeLifecycleReason =
    workMode === "full"
      ? "focused-visible"
      : highOutput
        ? "high-output"
        : "visible-unfocused";

  return createDecision({
    allowGpuRenderer: rendererType !== "cpu",
    config: resolvedConfig,
    hiddenAgeMs,
    needsVisibleRecovery,
    reason,
    rendererType,
    workMode,
  });
}

export function resolveTerminalPaneRuntimeLifecycleConfig(
  config: Partial<TerminalPaneRuntimeLifecycleConfig> = {},
): TerminalPaneRuntimeLifecycleConfig {
  return {
    fullOutputHistoryFlushMs: positiveNumber(
      config.fullOutputHistoryFlushMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.fullOutputHistoryFlushMs,
    ),
    hiddenTailFlushMs: positiveNumber(
      config.hiddenTailFlushMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.hiddenTailFlushMs,
    ),
    hiddenSuspendAfterMs: positiveNumber(
      config.hiddenSuspendAfterMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.hiddenSuspendAfterMs,
    ),
    highOutputBytesPerSecond: positiveNumber(
      config.highOutputBytesPerSecond,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.highOutputBytesPerSecond,
    ),
    recentInteractionGraceMs: positiveNumber(
      config.recentInteractionGraceMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.recentInteractionGraceMs,
    ),
    suspendedRendererFlushMs: positiveNumber(
      config.suspendedRendererFlushMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.suspendedRendererFlushMs,
    ),
    visibleDegradedOutputHistoryFlushMs: positiveNumber(
      config.visibleDegradedOutputHistoryFlushMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG
        .visibleDegradedOutputHistoryFlushMs,
    ),
    visibleRecoveryAfterMs: positiveNumber(
      config.visibleRecoveryAfterMs,
      TERMINAL_PANE_RUNTIME_LIFECYCLE_DEFAULT_CONFIG.visibleRecoveryAfterMs,
    ),
  };
}

function createDecision({
  allowGpuRenderer,
  config,
  hiddenAgeMs,
  needsVisibleRecovery = false,
  reason,
  rendererType,
  workMode,
}: {
  allowGpuRenderer: boolean;
  config: TerminalPaneRuntimeLifecycleConfig;
  hiddenAgeMs: number;
  needsVisibleRecovery?: boolean;
  reason: TerminalPaneRuntimeLifecycleReason;
  rendererType: TerminalRendererType;
  workMode: TerminalPaneRuntimeWorkMode;
}): TerminalPaneRuntimeLifecycleDecision {
  const rendererResourceMode = resolveRendererResourceMode(
    rendererType,
    workMode,
  );
  const releaseGpuRenderer =
    rendererType === "cpu" || rendererResourceMode === "release-webgl";

  return {
    allowGpuRenderer: allowGpuRenderer && rendererType !== "cpu",
    captureOutputTail: true,
    hiddenAgeMs,
    needsVisibleRecovery,
    outputHistoryFlushIntervalMs: resolveOutputHistoryFlushIntervalMs(
      config,
      workMode,
    ),
    outputHistoryWorkMode: resolveOutputHistoryWorkMode(workMode),
    reason,
    releaseGpuRenderer,
    rendererResourceMode,
    shouldRunSuggestionProbe: workMode === "full",
    suggestionWorkMode: resolveSuggestionWorkMode(workMode),
    workMode,
  };
}

function resolveRendererResourceMode(
  rendererType: TerminalRendererType,
  workMode: TerminalPaneRuntimeWorkMode,
): TerminalPaneRendererResourceMode {
  if (rendererType === "cpu") {
    return "cpu-only";
  }
  if (workMode === "suspended-renderer") {
    return "release-webgl";
  }
  if (workMode === "hidden-tail-only") {
    return "parked";
  }
  return "active";
}

function resolveOutputHistoryFlushIntervalMs(
  config: TerminalPaneRuntimeLifecycleConfig,
  workMode: TerminalPaneRuntimeWorkMode,
): number {
  if (workMode === "full") {
    return config.fullOutputHistoryFlushMs;
  }
  if (workMode === "visible-degraded") {
    return config.visibleDegradedOutputHistoryFlushMs;
  }
  if (workMode === "hidden-tail-only") {
    return config.hiddenTailFlushMs;
  }
  return config.suspendedRendererFlushMs;
}

function resolveOutputHistoryWorkMode(
  workMode: TerminalPaneRuntimeWorkMode,
): TerminalPaneOutputHistoryWorkMode {
  if (workMode === "full") {
    return "live";
  }
  if (workMode === "visible-degraded") {
    return "throttled";
  }
  return "tail-only";
}

function resolveSuggestionWorkMode(
  workMode: TerminalPaneRuntimeWorkMode,
): TerminalPaneSuggestionWorkMode {
  if (workMode === "full") {
    return "active";
  }
  if (workMode === "visible-degraded") {
    return "deferred";
  }
  return "paused";
}

function resolveHiddenAgeMs(now: number, hiddenSince: number | undefined) {
  return typeof hiddenSince === "number" ? Math.max(0, now - hiddenSince) : 0;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
