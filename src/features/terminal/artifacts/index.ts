// @author kongweiguang

import {
  classifyTerminalArtifactSensitivity,
  resolveTerminalArtifactPathStyle,
  terminalArtifactActions,
} from "./policy";
import type {
  TerminalArtifact,
  TerminalArtifactCandidate,
  TerminalArtifactIndexSnapshot,
  TerminalArtifactTargetIdentity,
} from "./types";

export interface TerminalArtifactIndexOptions {
  maxArtifacts?: number;
  maxCandidatesPerBatch?: number;
  now?: () => number;
  paneId: string;
  target: TerminalArtifactTargetIdentity;
}

export interface TerminalArtifactIndex {
  accept(candidates: readonly TerminalArtifactCandidate[]): void;
  dispose(): void;
  evictBeforeRevision(minimumRevision: number): void;
  getSnapshot(): TerminalArtifactIndexSnapshot;
  invalidate(revision: number): void;
}

const DEFAULT_MAX_ARTIFACTS = 200;
const DEFAULT_MAX_CANDIDATES_PER_BATCH = 100;
const MAX_SAFE_LABEL_LENGTH = 160;
const LABEL_ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b](?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)?)/g;
// eslint-disable-next-line no-control-regex
const LABEL_CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** 每 pane 独立的易失索引；只保存产物元数据，不保存终端正文或输出快照。 */
export function createTerminalArtifactIndex(
  options: TerminalArtifactIndexOptions,
): TerminalArtifactIndex {
  const maxArtifacts = positiveInteger(options.maxArtifacts, DEFAULT_MAX_ARTIFACTS);
  const batchLimit = positiveInteger(
    options.maxCandidatesPerBatch,
    DEFAULT_MAX_CANDIDATES_PER_BATCH,
  );
  const now = options.now ?? Date.now;
  const artifacts = new Map<string, TerminalArtifact>();
  let degraded = false;
  let disposed = false;
  let evictions = 0;
  let rejected = 0;
  let revision = 0;
  let sequence = 0;

  const snapshot = (): TerminalArtifactIndexSnapshot => ({
    artifacts: Array.from(artifacts.values()),
    degraded,
    disposed,
    evictions,
    paneId: options.paneId,
    rejected,
    revision,
  });

  return {
    accept(candidates) {
      if (disposed || candidates.length === 0) {
        return;
      }
      // 超量批次只处理稳定前缀并暴露 degraded，防止异常长行阻塞渲染线程。
      const accepted = candidates.slice(0, batchLimit);
      if (accepted.length < candidates.length) {
        degraded = true;
        rejected += candidates.length - accepted.length;
      }
      for (const candidate of accepted) {
        const value = candidate.value.trim();
        if (!value) {
          rejected += 1;
          continue;
        }
        const valueSensitivity = classifyTerminalArtifactSensitivity(
          value,
          candidate.source,
        );
        const normalizedLabel = normalizeCandidateLabel(candidate.label);
        const candidateLabel = normalizedLabel.label;
        const labelSensitivity = candidateLabel
          ? classifyTerminalArtifactSensitivity(candidateLabel, candidate.source)
          : "normal";
        if (valueSensitivity === "blocked" || labelSensitivity === "blocked") {
          rejected += 1;
          continue;
        }
        const sensitivity =
          valueSensitivity === "sensitive" ||
          labelSensitivity === "sensitive" ||
          normalizedLabel.truncated
            ? "sensitive"
            : "normal";
        // 协议 label 来自终端正文；疑似敏感时只保存固定标签，避免正文旁路进入索引。
        const label =
          labelSensitivity === "sensitive" || normalizedLabel.truncated
            ? safeArtifactLabel(candidate.kind)
            : candidateLabel || value;
        const dedupeKey = [
          candidate.kind,
          candidate.source,
          options.target.kind,
          options.target.id,
          value,
        ].join("\u0000");
        const existing = artifacts.get(dedupeKey);
        const artifact: TerminalArtifact = {
          actions: terminalArtifactActions(candidate, options.target, sensitivity),
          createdAt: existing?.createdAt ?? now(),
          dedupeKey,
          id: existing?.id ?? `${options.paneId}:artifact:${++sequence}`,
          kind: candidate.kind,
          label,
          paneId: options.paneId,
          pathStyle:
            candidate.pathStyle ?? resolveTerminalArtifactPathStyle(value),
          revision,
          sensitivity,
          source: candidate.source,
          target: options.target,
          value,
          ...(candidate.range ? { range: candidate.range } : {}),
        };
        // delete + set 将重复命中移动到尾部，限制淘汰遵循最近观测顺序。
        artifacts.delete(dedupeKey);
        artifacts.set(dedupeKey, artifact);
      }
      while (artifacts.size > maxArtifacts) {
        const oldestKey = artifacts.keys().next().value as string | undefined;
        if (!oldestKey) {
          break;
        }
        artifacts.delete(oldestKey);
        evictions += 1;
      }
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        artifacts.clear();
        revision += 1;
      }
    },
    evictBeforeRevision(minimumRevision) {
      if (disposed) {
        return;
      }
      for (const [key, artifact] of artifacts) {
        if (artifact.revision < minimumRevision) {
          artifacts.delete(key);
          evictions += 1;
        }
      }
    },
    getSnapshot: snapshot,
    invalidate(nextRevision) {
      if (disposed) {
        return;
      }
      artifacts.clear();
      revision = Math.max(revision + 1, nextRevision);
      degraded = false;
    },
  };
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : fallback;
}

function safeArtifactLabel(kind: TerminalArtifactCandidate["kind"]) {
  switch (kind) {
    case "url":
    case "link":
      return "安全链接";
    case "command":
      return "敏感命令";
    case "directory":
      return "敏感目录";
    case "log":
      return "敏感日志";
    case "path":
      return "敏感路径";
  }
}

function normalizeCandidateLabel(label: string | undefined) {
  const normalized = label
    ?.replace(LABEL_ANSI_RE, "")
    .replace(LABEL_CONTROL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    label: normalized,
    truncated: (normalized?.length ?? 0) > MAX_SAFE_LABEL_LENGTH,
  };
}
