import type { TerminalRendererType } from "../settings/settingsModel";

export type TerminalRendererBackend = "cpu" | "gpu";

export type TerminalRendererFallbackReason =
  | "atlas-clear-failed"
  | "auto-suggested-cpu"
  | "budget-limited"
  | "context-lost"
  | "cooldown"
  | "hidden-reaped"
  | "import-failed"
  | "load-failed"
  | "mode-cpu"
  | "not-visible"
  | "recovery-storm"
  | "retry-exhausted"
  | "software-gpu";

export interface TerminalRendererPolicyConfig {
  autoFailureCooldownMs: number;
  contextLossRetryDelaysMs: readonly number[];
  globalFailureThreshold: number;
  globalFailureWindowMs: number;
  hiddenStaleRefreshMs: number;
  maxActiveGpuPanes: number;
  webglReapGraceMs: number;
}

export interface TerminalRendererPanePolicyInput {
  currentBackend: TerminalRendererBackend;
  failureCount?: number;
  focused: boolean;
  /** GPU attach 已发起但尚未提交，期间仍占用预算，避免重复 attach。 */
  gpuAttachPending?: boolean;
  /** GPU lease 首次授予时间；存在该值即视为稳定 owner。 */
  gpuOwnerSince?: number;
  hiddenSince?: number;
  lastFailureAt?: number;
  lastFailureReason?: TerminalRendererFallbackReason;
  lastUsedAt?: number;
  paneId: string;
  retryCount?: number;
  visible: boolean;
}

export interface TerminalRendererFailureEvent {
  at: number;
  reason: TerminalRendererFallbackReason;
}

export interface TerminalRendererPolicyInput {
  config?: Partial<TerminalRendererPolicyConfig>;
  failureEvents?: readonly TerminalRendererFailureEvent[];
  now: number;
  panes: readonly TerminalRendererPanePolicyInput[];
  requestedMode: TerminalRendererType;
  suggestedFallback?: "cpu";
}

export interface TerminalRendererPanePolicyDecision {
  fallbackReason?: TerminalRendererFallbackReason;
  needsVisibleRefresh: boolean;
  paneId: string;
  priority: number;
  retryDelayMs?: number;
  shouldAttemptImport: boolean;
  shouldReapWebgl: boolean;
  targetBackend: TerminalRendererBackend;
}

export interface TerminalRendererPolicyDecision {
  decisions: TerminalRendererPanePolicyDecision[];
  effectiveGpuPanes: number;
  suggestedFallback?: "cpu";
}

export const TERMINAL_RENDERER_DEFAULT_POLICY: TerminalRendererPolicyConfig = {
  autoFailureCooldownMs: 60_000,
  contextLossRetryDelaysMs: [250, 1_000, 5_000, 30_000, 30_000],
  globalFailureThreshold: 3,
  globalFailureWindowMs: 5 * 60_000,
  hiddenStaleRefreshMs: 10_000,
  maxActiveGpuPanes: 6,
  webglReapGraceMs: 30_000,
};

export function resolveTerminalRendererPolicy({
  config,
  failureEvents = [],
  now,
  panes,
  requestedMode,
  suggestedFallback,
}: TerminalRendererPolicyInput): TerminalRendererPolicyDecision {
  const resolvedConfig = resolveTerminalRendererPolicyConfig(config);
  const resolvedFallback =
    suggestedFallback ??
    resolveSuggestedRendererFallback({
      config: resolvedConfig,
      failureEvents,
      now,
      requestedMode,
    });
  const baseDecisions = panes.map((pane) =>
    resolveBasePaneDecision({
      config: resolvedConfig,
      now,
      pane,
      requestedMode,
      suggestedFallback: resolvedFallback,
    }),
  );
  const panesById = new Map(panes.map((pane) => [pane.paneId, pane]));
  const gpuCandidates = baseDecisions.filter(
    (decision) => decision.targetBackend === "gpu",
  );
  const stableGpuOwners = gpuCandidates
    .filter((decision) => {
      const pane = panesById.get(decision.paneId);
      return Boolean(
        pane &&
        (pane.currentBackend === "gpu" ||
          typeof pane.gpuOwnerSince === "number"),
      );
    })
    .sort((left, right) => compareStableGpuOwners(left, right, panesById));
  const newGpuCandidates = gpuCandidates
    .filter((decision) => !stableGpuOwners.includes(decision))
    .sort(comparePanePriority);

  // 健康 owner 优先稳定驻留；focus 只用于填充空闲预算，不触发 renderer 抢占。
  const selectedGpuPaneIds = new Set(
    [...stableGpuOwners, ...newGpuCandidates]
      .slice(0, resolvedConfig.maxActiveGpuPanes)
      .map((decision) => decision.paneId),
  );
  const decisions = baseDecisions.map((decision) => {
    if (
      decision.targetBackend !== "gpu" ||
      selectedGpuPaneIds.has(decision.paneId)
    ) {
      return decision;
    }
    return {
      ...decision,
      fallbackReason: "budget-limited" as const,
      shouldAttemptImport: false,
      shouldReapWebgl: panesById.get(decision.paneId)?.currentBackend === "gpu",
      targetBackend: "cpu" as const,
    };
  });

  return {
    decisions,
    effectiveGpuPanes: decisions.filter(
      (decision) => decision.targetBackend === "gpu",
    ).length,
    suggestedFallback: resolvedFallback,
  };
}

export function resolveTerminalRendererPolicyConfig(
  config: Partial<TerminalRendererPolicyConfig> = {},
): TerminalRendererPolicyConfig {
  return {
    ...TERMINAL_RENDERER_DEFAULT_POLICY,
    ...config,
  };
}

export function resolveContextLossRetryDelay(
  retryCount: number,
  config: Partial<TerminalRendererPolicyConfig> = {},
): number | undefined {
  const { contextLossRetryDelaysMs } =
    resolveTerminalRendererPolicyConfig(config);
  return contextLossRetryDelaysMs[retryCount];
}

export function resolveSuggestedRendererFallback({
  config = TERMINAL_RENDERER_DEFAULT_POLICY,
  failureEvents,
  now,
  requestedMode,
}: {
  config?: TerminalRendererPolicyConfig;
  failureEvents: readonly TerminalRendererFailureEvent[];
  now: number;
  requestedMode: TerminalRendererType;
}): "cpu" | undefined {
  if (requestedMode !== "auto") {
    return undefined;
  }
  const windowStart = now - config.globalFailureWindowMs;
  const recentLoadFailures = failureEvents.filter(
    (event) =>
      event.at >= windowStart &&
      (event.reason === "import-failed" || event.reason === "load-failed"),
  );
  return recentLoadFailures.length >= config.globalFailureThreshold
    ? "cpu"
    : undefined;
}

function resolveBasePaneDecision({
  config,
  now,
  pane,
  requestedMode,
  suggestedFallback,
}: {
  config: TerminalRendererPolicyConfig;
  now: number;
  pane: TerminalRendererPanePolicyInput;
  requestedMode: TerminalRendererType;
  suggestedFallback?: "cpu";
}): TerminalRendererPanePolicyDecision {
  const hiddenAge =
    typeof pane.hiddenSince === "number" ? now - pane.hiddenSince : 0;
  const needsVisibleRefresh =
    pane.visible &&
    pane.currentBackend === "gpu" &&
    hiddenAge >= config.hiddenStaleRefreshMs;
  const priority = resolvePanePriority(pane);

  if (requestedMode === "cpu") {
    return cpuDecision(pane, priority, needsVisibleRefresh, "mode-cpu");
  }
  if (requestedMode === "auto" && suggestedFallback === "cpu") {
    return cpuDecision(
      pane,
      priority,
      needsVisibleRefresh,
      "auto-suggested-cpu",
    );
  }
  if (!pane.visible) {
    const shouldReapWebgl =
      pane.currentBackend === "gpu" && hiddenAge >= config.webglReapGraceMs;
    return {
      fallbackReason: shouldReapWebgl ? "hidden-reaped" : "not-visible",
      needsVisibleRefresh: false,
      paneId: pane.paneId,
      priority,
      shouldAttemptImport: false,
      shouldReapWebgl,
      targetBackend:
        pane.currentBackend === "gpu" && !shouldReapWebgl ? "gpu" : "cpu",
    };
  }

  const retryDelayMs = resolveRetryDelayMs({
    config,
    now,
    pane,
    requestedMode,
  });
  if (retryDelayMs === null) {
    return cpuDecision(pane, priority, needsVisibleRefresh, "retry-exhausted");
  }
  if (typeof retryDelayMs === "number" && retryDelayMs > 0) {
    return {
      fallbackReason: "cooldown",
      needsVisibleRefresh,
      paneId: pane.paneId,
      priority,
      retryDelayMs,
      shouldAttemptImport: false,
      shouldReapWebgl: pane.currentBackend === "gpu",
      targetBackend: "cpu",
    };
  }

  return {
    needsVisibleRefresh,
    paneId: pane.paneId,
    priority,
    shouldAttemptImport:
      pane.currentBackend !== "gpu" && !pane.gpuAttachPending,
    shouldReapWebgl: false,
    targetBackend: "gpu",
  };
}

function resolveRetryDelayMs({
  config,
  now,
  pane,
  requestedMode,
}: {
  config: TerminalRendererPolicyConfig;
  now: number;
  pane: TerminalRendererPanePolicyInput;
  requestedMode: TerminalRendererType;
}): number | null | undefined {
  if (
    (requestedMode === "auto" || requestedMode === "gpu") &&
    (pane.lastFailureReason === "atlas-clear-failed" ||
      pane.lastFailureReason === "import-failed" ||
      pane.lastFailureReason === "load-failed" ||
      pane.lastFailureReason === "recovery-storm") &&
    typeof pane.lastFailureAt === "number"
  ) {
    return Math.max(0, pane.lastFailureAt + config.autoFailureCooldownMs - now);
  }
  if (
    pane.lastFailureReason !== "context-lost" ||
    typeof pane.lastFailureAt !== "number"
  ) {
    return undefined;
  }
  const retryDelayMs = resolveContextLossRetryDelay(
    pane.retryCount ?? 0,
    config,
  );
  if (typeof retryDelayMs !== "number") {
    return null;
  }
  return Math.max(0, pane.lastFailureAt + retryDelayMs - now);
}

function cpuDecision(
  pane: TerminalRendererPanePolicyInput,
  priority: number,
  needsVisibleRefresh: boolean,
  fallbackReason: TerminalRendererFallbackReason,
): TerminalRendererPanePolicyDecision {
  return {
    fallbackReason,
    needsVisibleRefresh,
    paneId: pane.paneId,
    priority,
    shouldAttemptImport: false,
    shouldReapWebgl: pane.currentBackend === "gpu",
    targetBackend: "cpu",
  };
}

function resolvePanePriority(pane: TerminalRendererPanePolicyInput): number {
  const visiblePriority = pane.visible ? 100_000 : 0;
  const focusedPriority = pane.focused ? 1_000_000 : 0;
  return focusedPriority + visiblePriority + (pane.lastUsedAt ?? 0);
}

function comparePanePriority(
  left: TerminalRendererPanePolicyDecision,
  right: TerminalRendererPanePolicyDecision,
) {
  if (right.priority !== left.priority) {
    return right.priority - left.priority;
  }
  return left.paneId.localeCompare(right.paneId);
}

/**
 * 稳定 owner 以 lease 授予顺序为主，避免 focus/last-used 抖动改变 GPU 归属。
 * 只有预算被主动缩小时才会淘汰较新的 owner。
 */
function compareStableGpuOwners(
  left: TerminalRendererPanePolicyDecision,
  right: TerminalRendererPanePolicyDecision,
  panesById: ReadonlyMap<string, TerminalRendererPanePolicyInput>,
) {
  const leftOwnerSince = panesById.get(left.paneId)?.gpuOwnerSince ?? 0;
  const rightOwnerSince = panesById.get(right.paneId)?.gpuOwnerSince ?? 0;
  if (leftOwnerSince !== rightOwnerSince) {
    return leftOwnerSince - rightOwnerSince;
  }
  return comparePanePriority(left, right);
}
