/**
 * 前端兼容路径的有界聚合指标。
 *
 * 该边界只接受 registry 中的稳定 ID 与原因，不接受错误正文、路径、主机或
 * 调用方 labels。判定结果只负责授权观测，不替代各调用方原有的主路径决策。
 */
import {
  buildCompatibilityMetricSnapshot,
  compatibilityRegistry,
  evaluateCompatibilityActivation,
  type CompatibilityMetricSnapshot,
} from "../../architecture/compatibility/compatibilityRegistry";

export interface CompatibilityActivationDecision {
  readonly allowed: boolean;
  readonly code: "allowed-by-registry" | "reason-not-registered";
}

export interface RuntimeCompatibilityDiagnostics {
  getSnapshot(): CompatibilityMetricSnapshot;
  recordActivation(
    id: string,
    reason: string,
    count?: number,
  ): CompatibilityActivationDecision;
  recordFailure(id: string, count?: number): void;
}

interface MutableCompatibilityMetric {
  activationCount: number;
  failureCount: number;
}

/** 创建实例级收集器，隔离窗口生命周期并保持计数输入有界。 */
export function createRuntimeCompatibilityDiagnostics(): RuntimeCompatibilityDiagnostics {
  const metrics = new Map<string, MutableCompatibilityMetric>(
    compatibilityRegistry.map((entry) => [
      entry.id,
      { activationCount: 0, failureCount: 0 },
    ]),
  );

  return {
    getSnapshot() {
      return buildCompatibilityMetricSnapshot(
        compatibilityRegistry.map((entry) => ({
          activationCount: metrics.get(entry.id)?.activationCount ?? 0,
          failureCount: metrics.get(entry.id)?.failureCount ?? 0,
          id: entry.id,
        })),
      );
    },
    recordActivation(id, reason, count = 1) {
      const decision = evaluateCompatibilityActivation(id, reason);
      const metric = requireMetric(metrics, id);
      const increment = normalizeCount(count);
      if (decision.allowed) {
        metric.activationCount = addCount(metric.activationCount, increment);
      } else {
        metric.failureCount = addCount(metric.failureCount, increment);
      }
      return decision;
    },
    recordFailure(id, count = 1) {
      const metric = requireMetric(metrics, id);
      metric.failureCount = addCount(
        metric.failureCount,
        normalizeCount(count),
      );
    },
  };
}

export const runtimeCompatibilityDiagnostics =
  createRuntimeCompatibilityDiagnostics();

function requireMetric(
  metrics: Map<string, MutableCompatibilityMetric>,
  id: string,
) {
  const metric = metrics.get(id);
  if (!metric) {
    throw new Error("兼容项未登记");
  }
  return metric;
}

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function addCount(current: number, increment: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, current + increment);
}
