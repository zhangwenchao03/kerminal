// @author kongweiguang

export type TerminalSuggestionProbeDisabledReason =
  | "failure-backoff"
  | "hidden-pane"
  | "lifecycle-gate"
  | "rapid-input"
  | "slow-probe"
  | "visible-degraded";

export type TerminalSuggestionProbeWorkMode = "active" | "deferred" | "paused";

export interface TerminalSuggestionProbePolicyConfig {
  baseDelayMs: number;
  failureBackoffBaseMs: number;
  failureBackoffMaxMs: number;
  failurePauseAfter: number;
  rapidInputDelayMs: number;
  rapidInputMinCount: number;
  rapidInputWindowMs: number;
  slowProbeDelayMs: number;
  slowProbeMs: number;
}

export interface TerminalSuggestionProbePolicyInput {
  config?: Partial<TerminalSuggestionProbePolicyConfig>;
  consecutiveFailures?: number;
  inputBurstCount?: number;
  lastFailureAt?: number;
  lastInputAt?: number;
  lastProbeDurationMs?: number;
  lifecycleEnabled: boolean;
  lifecycleReason?: TerminalSuggestionProbeDisabledReason;
  now: number;
}

export interface TerminalSuggestionProbePolicyDecision {
  delayMs: number;
  disabledReason?: TerminalSuggestionProbeDisabledReason;
  retryAfterMs?: number;
  shouldSchedule: boolean;
  workMode: TerminalSuggestionProbeWorkMode;
}

export const TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG: TerminalSuggestionProbePolicyConfig =
  {
    baseDelayMs: 60,
    failureBackoffBaseMs: 1_000,
    failureBackoffMaxMs: 30_000,
    failurePauseAfter: 2,
    rapidInputDelayMs: 300,
    rapidInputMinCount: 3,
    rapidInputWindowMs: 220,
    slowProbeDelayMs: 750,
    slowProbeMs: 1_200,
  };

export function resolveTerminalSuggestionProbePolicy({
  config,
  consecutiveFailures = 0,
  inputBurstCount = 0,
  lastFailureAt,
  lastInputAt,
  lastProbeDurationMs = 0,
  lifecycleEnabled,
  lifecycleReason = "lifecycle-gate",
  now,
}: TerminalSuggestionProbePolicyInput): TerminalSuggestionProbePolicyDecision {
  const resolvedConfig = resolveTerminalSuggestionProbePolicyConfig(config);
  if (!lifecycleEnabled) {
    return pause(lifecycleReason, resolvedConfig.baseDelayMs);
  }

  if (consecutiveFailures >= resolvedConfig.failurePauseAfter) {
    const retryAfterMs = failureBackoffMs(consecutiveFailures, resolvedConfig);
    const remainingRetryMs =
      typeof lastFailureAt === "number"
        ? retryAfterMs - Math.max(0, now - lastFailureAt)
        : retryAfterMs;
    if (remainingRetryMs > 0) {
      return pause("failure-backoff", resolvedConfig.baseDelayMs, {
        retryAfterMs: remainingRetryMs,
      });
    }
  }

  if (consecutiveFailures >= resolvedConfig.failurePauseAfter) {
    return defer("failure-backoff", resolvedConfig.baseDelayMs);
  }

  if (
    inputBurstCount >= resolvedConfig.rapidInputMinCount &&
    typeof lastInputAt === "number" &&
    now - lastInputAt <= resolvedConfig.rapidInputWindowMs
  ) {
    return defer("rapid-input", resolvedConfig.rapidInputDelayMs);
  }

  if (lastProbeDurationMs >= resolvedConfig.slowProbeMs) {
    return defer("slow-probe", resolvedConfig.slowProbeDelayMs);
  }

  return {
    delayMs: resolvedConfig.baseDelayMs,
    shouldSchedule: true,
    workMode: "active",
  };
}

export function resolveTerminalSuggestionProbePolicyConfig(
  config: Partial<TerminalSuggestionProbePolicyConfig> = {},
): TerminalSuggestionProbePolicyConfig {
  return {
    baseDelayMs: positiveNumber(
      config.baseDelayMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.baseDelayMs,
    ),
    failureBackoffBaseMs: positiveNumber(
      config.failureBackoffBaseMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.failureBackoffBaseMs,
    ),
    failureBackoffMaxMs: positiveNumber(
      config.failureBackoffMaxMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.failureBackoffMaxMs,
    ),
    failurePauseAfter: positiveNumber(
      config.failurePauseAfter,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.failurePauseAfter,
    ),
    rapidInputDelayMs: positiveNumber(
      config.rapidInputDelayMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.rapidInputDelayMs,
    ),
    rapidInputMinCount: positiveNumber(
      config.rapidInputMinCount,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.rapidInputMinCount,
    ),
    rapidInputWindowMs: positiveNumber(
      config.rapidInputWindowMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.rapidInputWindowMs,
    ),
    slowProbeDelayMs: positiveNumber(
      config.slowProbeDelayMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.slowProbeDelayMs,
    ),
    slowProbeMs: positiveNumber(
      config.slowProbeMs,
      TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.slowProbeMs,
    ),
  };
}

function defer(
  disabledReason: TerminalSuggestionProbeDisabledReason,
  delayMs: number,
): TerminalSuggestionProbePolicyDecision {
  return {
    delayMs,
    disabledReason,
    shouldSchedule: true,
    workMode: "deferred",
  };
}

function pause(
  disabledReason: TerminalSuggestionProbeDisabledReason,
  delayMs: number,
  extras: Pick<TerminalSuggestionProbePolicyDecision, "retryAfterMs"> = {},
): TerminalSuggestionProbePolicyDecision {
  return {
    delayMs,
    disabledReason,
    shouldSchedule: false,
    workMode: "paused",
    ...extras,
  };
}

function failureBackoffMs(
  consecutiveFailures: number,
  config: TerminalSuggestionProbePolicyConfig,
) {
  return Math.min(
    config.failureBackoffMaxMs,
    config.failureBackoffBaseMs *
      2 ** Math.max(0, consecutiveFailures - config.failurePauseAfter),
  );
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
