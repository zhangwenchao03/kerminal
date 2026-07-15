export const DEFAULT_ATTACH_TIMEOUT_MS = 5_000;
export const DEFAULT_CONTEXT_LOSS_WINDOW_MS = 30_000;
export const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
export const DEFAULT_MAX_RECOVERY_ELAPSED_MS = 30_000;
export const DEFAULT_RECOVERY_RETRY_DELAYS_MS = [250, 1_000, 5_000] as const;
export const DEFAULT_RECOVERY_JITTER_RATIO = 0.1;

export function normalizeRetryDelays(delays: readonly number[]) {
  if (delays.length === 0) {
    return [0];
  }
  return delays.map((delay, index) => {
    if (!Number.isFinite(delay) || delay < 0) {
      throw new RangeError(`retryDelaysMs[${index}] must be non-negative`);
    }
    return delay;
  });
}

export function jitterDelay(
  baseDelay: number,
  ratio: number,
  random: () => number,
) {
  if (baseDelay === 0 || ratio === 0) {
    return baseDelay;
  }
  const normalizedRandom = Math.min(1, Math.max(0, random()));
  return Math.max(
    0,
    Math.round(baseDelay * (1 + (normalizedRandom * 2 - 1) * ratio)),
  );
}

export function validatePositiveDuration(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export function validatePositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function validateRatio(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}
