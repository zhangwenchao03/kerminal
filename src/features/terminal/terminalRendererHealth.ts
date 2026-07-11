import type { TerminalRendererBackend } from "./terminalRendererPolicy";

export type TerminalRendererHealthSignal =
  | "healthy"
  | "context-lost"
  | "canvas-detached"
  | "canvas-zero-sized"
  | "atlas-operation-failed"
  | "frame-stale"
  | "cell-metric-mismatch";

export type TerminalRendererHealthAction =
  | "none"
  | "wait-for-stable-surface"
  | "refresh"
  | "clear-atlas-and-refresh"
  | "rebuild-renderer"
  | "fallback-cpu";

export type TerminalRendererHealthLevel = 0 | 1 | 2 | 3;

export interface TerminalRendererHealthObservation {
  backend: TerminalRendererBackend;
  now: number;
  signal: TerminalRendererHealthSignal;
  surfaceEpoch: number;
  surfaceStable: boolean;
  visible: boolean;
}

export interface TerminalRendererHealthDecision {
  action: TerminalRendererHealthAction;
  circuitOpen: boolean;
  healthEpoch: number;
  level: TerminalRendererHealthLevel;
  reason: TerminalRendererHealthSignal;
}

export interface TerminalRendererHealthSnapshot {
  circuitOpen: boolean;
  healthEpoch: number;
  l1ActionCount: number;
  l2FaultCount: number;
  surfaceEpoch: number;
}

export interface TerminalRendererHealthController {
  getSnapshot(): TerminalRendererHealthSnapshot;
  observe(
    observation: TerminalRendererHealthObservation,
  ): TerminalRendererHealthDecision;
  resetCircuit(): void;
}

export interface CreateTerminalRendererHealthControllerOptions {
  l2CircuitThreshold?: number;
  l2FaultWindowMs?: number;
}

const DEFAULT_L2_CIRCUIT_THRESHOLD = 3;
const DEFAULT_L2_FAULT_WINDOW_MS = 30_000;

/**
 * 创建 pane 级 renderer 健康分类器。
 *
 * 分类器只接收 DOM/renderer 的低成本状态，不读取终端文本、canvas 像素或
 * GPU vendor。L1 在同一 health epoch 最多执行一次，L2 故障按时间窗熔断。
 */
export function createTerminalRendererHealthController({
  l2CircuitThreshold = DEFAULT_L2_CIRCUIT_THRESHOLD,
  l2FaultWindowMs = DEFAULT_L2_FAULT_WINDOW_MS,
}: CreateTerminalRendererHealthControllerOptions = {}): TerminalRendererHealthController {
  if (!Number.isInteger(l2CircuitThreshold) || l2CircuitThreshold <= 0) {
    throw new RangeError("l2CircuitThreshold must be a positive integer");
  }
  if (!Number.isFinite(l2FaultWindowMs) || l2FaultWindowMs <= 0) {
    throw new RangeError("l2FaultWindowMs must be a positive number");
  }

  let circuitOpen = false;
  let healthEpoch = 0;
  let l1ActionCount = 0;
  let surfaceEpoch = -1;
  const l2Faults: number[] = [];

  const snapshot = (): TerminalRendererHealthSnapshot => ({
    circuitOpen,
    healthEpoch,
    l1ActionCount,
    l2FaultCount: l2Faults.length,
    surfaceEpoch,
  });

  const advanceSurfaceEpoch = (nextSurfaceEpoch: number) => {
    if (nextSurfaceEpoch === surfaceEpoch) {
      return;
    }
    surfaceEpoch = nextSurfaceEpoch;
    healthEpoch += 1;
    l1ActionCount = 0;
  };

  const pruneL2Faults = (now: number) => {
    const earliest = now - l2FaultWindowMs;
    while (l2Faults.length > 0 && (l2Faults[0] ?? 0) < earliest) {
      l2Faults.shift();
    }
  };

  const decision = (
    action: TerminalRendererHealthAction,
    level: TerminalRendererHealthLevel,
    reason: TerminalRendererHealthSignal,
  ): TerminalRendererHealthDecision => ({
    action,
    circuitOpen,
    healthEpoch,
    level,
    reason,
  });

  const l2Decision = (
    observation: TerminalRendererHealthObservation,
  ): TerminalRendererHealthDecision => {
    pruneL2Faults(observation.now);
    l2Faults.push(observation.now);
    if (l2Faults.length >= l2CircuitThreshold) {
      circuitOpen = true;
      return decision("fallback-cpu", 3, observation.signal);
    }
    return decision("rebuild-renderer", 2, observation.signal);
  };

  const observe = (
    observation: TerminalRendererHealthObservation,
  ): TerminalRendererHealthDecision => {
    advanceSurfaceEpoch(observation.surfaceEpoch);
    pruneL2Faults(observation.now);

    if (observation.backend !== "gpu" || observation.signal === "healthy") {
      return decision("none", 0, observation.signal);
    }
    if (circuitOpen) {
      return decision("fallback-cpu", 3, observation.signal);
    }
    if (!observation.visible || !observation.surfaceStable) {
      return decision("wait-for-stable-surface", 0, observation.signal);
    }

    switch (observation.signal) {
      case "context-lost":
      case "canvas-detached":
      case "canvas-zero-sized":
      case "cell-metric-mismatch":
        return l2Decision(observation);
      case "atlas-operation-failed":
        if (l1ActionCount === 0) {
          l1ActionCount += 1;
          return decision("clear-atlas-and-refresh", 1, observation.signal);
        }
        return l2Decision(observation);
      case "frame-stale":
        if (l1ActionCount === 0) {
          l1ActionCount += 1;
          return decision("refresh", 1, observation.signal);
        }
        return l2Decision(observation);
    }
  };

  return {
    getSnapshot: snapshot,
    observe,
    resetCircuit() {
      circuitOpen = false;
      healthEpoch += 1;
      l1ActionCount = 0;
      l2Faults.splice(0);
    },
  };
}
