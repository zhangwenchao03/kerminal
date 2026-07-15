import type {
  QuickOpenCandidate,
  QuickOpenResult,
} from "./types";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function fuzzyScore(value: string, query: string): number {
  if (!query) {
    return 1;
  }
  const normalized = normalize(value);
  if (normalized === query) {
    return 1_000;
  }
  if (normalized.startsWith(query)) {
    return 800 - Math.min(normalized.length - query.length, 100);
  }
  const substringIndex = normalized.indexOf(query);
  if (substringIndex >= 0) {
    return 600 - Math.min(substringIndex, 100);
  }

  let cursor = 0;
  let gap = 0;
  for (const character of query) {
    const index = normalized.indexOf(character, cursor);
    if (index < 0) {
      return 0;
    }
    gap += index - cursor;
    cursor = index + 1;
  }
  return 300 - Math.min(gap, 250);
}

/**
 * 排序首先尊重当前目标，再比较文本相关性，避免同名对象跨机器误选。
 */
function scoreQuickOpenCandidate(
  candidate: QuickOpenCandidate,
  query: string,
  activeTargetId?: string,
): number {
  const normalizedQuery = normalize(query);
  const targetScore =
    activeTargetId &&
    (candidate.targetId === activeTargetId ||
      candidate.reference.targetId === activeTargetId)
      ? 10_000
      : 0;
  const fields = [
    candidate.label,
    candidate.description ?? "",
    candidate.targetLabel ?? "",
    ...(candidate.keywords ?? []),
  ];
  return targetScore + Math.max(...fields.map((field) => fuzzyScore(field, normalizedQuery)));
}

export function rankQuickOpenResults(
  providerId: string,
  candidates: readonly QuickOpenCandidate[],
  query: string,
  activeTargetId: string | undefined,
): readonly QuickOpenResult[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      providerId,
      score: scoreQuickOpenCandidate(candidate, query, activeTargetId),
    }))
    .filter((candidate) => candidate.score > 0);
}

