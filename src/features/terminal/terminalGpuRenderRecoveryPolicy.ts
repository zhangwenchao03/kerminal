import type { TerminalRendererType } from "../settings/settingsModel";
import type { TerminalRendererBackend } from "./terminalRendererPolicy";

export type TerminalGpuRenderRecoveryAction =
  | "none"
  | "refresh"
  | "clearAtlasAndRefresh"
  | "fallbackCpu";

export type TerminalGpuRenderRecoveryTrigger =
  | "atlas-clear-failed"
  | "buffer-changed"
  | "context-lost"
  | "device-pixel-ratio-changed"
  | "font-changed"
  | "manual-recover"
  | "renderer-attached"
  | "renderer-disposed"
  | "resize"
  | "theme-changed"
  | "visible-recovered"
  | "write-parsed";

export type TerminalGpuRenderRecoveryReason =
  | "atlas-clear-cooldown"
  | "atlas-clear-failed"
  | "context-lost"
  | "cpu-mode"
  | "gpu-inactive"
  | "manual-recover"
  | "refresh-cooldown"
  | "recovery-storm"
  | "renderer-invalidated"
  | "renderer-recovered"
  | "write-parsed";

export interface TerminalGpuRenderRecoveryPolicyConfig {
  atlasClearCooldownMs: number;
  fallbackRecoveryWindowMs: number;
  maxAtlasClearFailuresBeforeFallback: number;
  maxRecoveriesBeforeFallback: number;
  refreshThrottleMs: number;
}

export interface TerminalGpuRenderRecoveryPolicyInput {
  atlasClearFailureCount?: number;
  backend: TerminalRendererBackend;
  lastAtlasClearAt?: number;
  lastRefreshAt?: number;
  now: number;
  recoveryCount?: number;
  recoveryWindowStartedAt?: number;
  rendererType: TerminalRendererType;
  trigger: TerminalGpuRenderRecoveryTrigger;
}

export interface TerminalGpuRenderRecoveryDecision {
  action: TerminalGpuRenderRecoveryAction;
  advanceAtlasEpoch: boolean;
  reason?: TerminalGpuRenderRecoveryReason;
  retryAfterMs?: number;
}

export const TERMINAL_GPU_RENDER_RECOVERY_DEFAULT_CONFIG: TerminalGpuRenderRecoveryPolicyConfig =
  {
    atlasClearCooldownMs: 2_000,
    fallbackRecoveryWindowMs: 60_000,
    maxAtlasClearFailuresBeforeFallback: 2,
    maxRecoveriesBeforeFallback: 12,
    refreshThrottleMs: 250,
  };

export function resolveTerminalGpuRenderRecovery({
  atlasClearFailureCount = 0,
  backend,
  config,
  lastAtlasClearAt,
  lastRefreshAt,
  now,
  recoveryCount = 0,
  recoveryWindowStartedAt,
  rendererType,
  trigger,
}: TerminalGpuRenderRecoveryPolicyInput & {
  config?: Partial<TerminalGpuRenderRecoveryPolicyConfig>;
}): TerminalGpuRenderRecoveryDecision {
  const resolvedConfig = resolveTerminalGpuRenderRecoveryConfig(config);
  if (rendererType === "cpu") {
    return decision("none", "cpu-mode");
  }
  if (backend !== "gpu") {
    return decision("none", "gpu-inactive");
  }
  if (trigger === "context-lost") {
    return decision("fallbackCpu", "context-lost");
  }
  if (
    trigger === "atlas-clear-failed" &&
    atlasClearFailureCount >= resolvedConfig.maxAtlasClearFailuresBeforeFallback
  ) {
    return decision("fallbackCpu", "atlas-clear-failed");
  }
  if (
    recoveryWindowStartedAt !== undefined &&
    now - recoveryWindowStartedAt <= resolvedConfig.fallbackRecoveryWindowMs &&
    recoveryCount >= resolvedConfig.maxRecoveriesBeforeFallback
  ) {
    return decision("fallbackCpu", "recovery-storm");
  }

  if (requiresAtlasInvalidation(trigger)) {
    const retryAfterMs = retryAfter(lastAtlasClearAt, now, resolvedConfig.atlasClearCooldownMs);
    if (retryAfterMs > 0) {
      return {
        action: "refresh",
        advanceAtlasEpoch: false,
        reason: "atlas-clear-cooldown",
        retryAfterMs,
      };
    }
    return decision("clearAtlasAndRefresh", reasonForAtlasInvalidation(trigger), true);
  }

  if (requiresRefresh(trigger)) {
    const retryAfterMs = retryAfter(lastRefreshAt, now, resolvedConfig.refreshThrottleMs);
    if (retryAfterMs > 0) {
      return {
        action: "none",
        advanceAtlasEpoch: false,
        reason: "refresh-cooldown",
        retryAfterMs,
      };
    }
    return decision("refresh", reasonForRefresh(trigger));
  }

  return decision("none");
}

export function strongestTerminalGpuRenderRecoveryAction(
  left: TerminalGpuRenderRecoveryAction,
  right: TerminalGpuRenderRecoveryAction,
): TerminalGpuRenderRecoveryAction {
  return actionRank(right) > actionRank(left) ? right : left;
}

export function resolveTerminalGpuRenderRecoveryConfig(
  config: Partial<TerminalGpuRenderRecoveryPolicyConfig> = {},
): TerminalGpuRenderRecoveryPolicyConfig {
  return {
    ...TERMINAL_GPU_RENDER_RECOVERY_DEFAULT_CONFIG,
    ...config,
  };
}

function requiresAtlasInvalidation(trigger: TerminalGpuRenderRecoveryTrigger) {
  return (
    trigger === "device-pixel-ratio-changed" ||
    trigger === "font-changed" ||
    trigger === "manual-recover" ||
    trigger === "renderer-attached" ||
    trigger === "resize"
  );
}

function requiresRefresh(trigger: TerminalGpuRenderRecoveryTrigger) {
  return (
    trigger === "buffer-changed" ||
    trigger === "renderer-disposed" ||
    trigger === "theme-changed" ||
    trigger === "visible-recovered" ||
    trigger === "write-parsed"
  );
}

function reasonForAtlasInvalidation(
  trigger: TerminalGpuRenderRecoveryTrigger,
): TerminalGpuRenderRecoveryReason {
  if (trigger === "manual-recover") {
    return "manual-recover";
  }
  return trigger === "renderer-attached"
    ? "renderer-recovered"
    : "renderer-invalidated";
}

function reasonForRefresh(
  trigger: TerminalGpuRenderRecoveryTrigger,
): TerminalGpuRenderRecoveryReason {
  return trigger === "write-parsed" ? "write-parsed" : "renderer-recovered";
}

function retryAfter(
  lastAt: number | undefined,
  now: number,
  intervalMs: number,
) {
  return typeof lastAt === "number" ? Math.max(0, lastAt + intervalMs - now) : 0;
}

function decision(
  action: TerminalGpuRenderRecoveryAction,
  reason?: TerminalGpuRenderRecoveryReason,
  advanceAtlasEpoch = false,
): TerminalGpuRenderRecoveryDecision {
  return { action, advanceAtlasEpoch, ...(reason ? { reason } : {}) };
}

function actionRank(action: TerminalGpuRenderRecoveryAction) {
  switch (action) {
    case "fallbackCpu":
      return 3;
    case "clearAtlasAndRefresh":
      return 2;
    case "refresh":
      return 1;
    case "none":
      return 0;
  }
}
