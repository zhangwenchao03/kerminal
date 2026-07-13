// @author kongweiguang

import type {
  CommandSuggestionCandidate,
  CommandSuggestionQueryMode,
} from "../../lib/terminalSuggestionApi";
import type { CachedTerminalSuggestion } from "./terminalSuggestionCache";
import {
  terminalSuggestionProviderPriority,
  type TerminalSuggestionQuery,
} from "./terminalSuggestionModel";

export interface RankedTerminalSuggestion {
  candidate: CommandSuggestionCandidate;
  score: number;
  stale: boolean;
}

/**
 * 热路径只扫描有界缓存，执行前缀校验、稳定去重和轻量重排。
 */
export function rankTerminalSuggestions(
  cached: readonly CachedTerminalSuggestion[],
  query: Pick<
    TerminalSuggestionQuery,
    "contextKey" | "cursor" | "input" | "mode"
  >,
  limit = query.mode === "inline" ? 8 : 64,
): RankedTerminalSuggestion[] {
  const deduped = new Map<string, RankedTerminalSuggestion>();
  for (const item of cached) {
    const candidate = adaptCandidateForQuery(item.candidate, query, {
      cursor: item.sourceCursor,
      input: item.sourceInput,
    });
    if (!candidate) {
      continue;
    }
    const ranked = {
      candidate,
      score: frontendScore(candidate, query.mode, item.stale),
      stale: item.stale,
    };
    const key = [
      candidate.replacementRange.start,
      candidate.replacementRange.end,
      normalizeReplacement(candidate.replacementText),
    ].join("\u0000");
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, ranked);
    } else {
      const winner = compareRanked(ranked, current) < 0 ? ranked : current;
      deduped.set(key, mergeSourceExplanations(winner, ranked, current));
    }
  }
  return Array.from(deduped.values()).sort(compareRanked).slice(0, limit);
}

export function adaptCandidateForQuery(
  candidate: CommandSuggestionCandidate,
  query: Pick<
    TerminalSuggestionQuery,
    "contextKey" | "cursor" | "input" | "mode"
  >,
  sourceQuery: { cursor?: number; input?: string } = {},
): CommandSuggestionCandidate | null {
  if (!candidate.allowedPresentations.includes(query.mode)) {
    return null;
  }
  if (
    query.mode === "inline" &&
    candidate.activation === "openSnippetPanel"
  ) {
    return null;
  }
  if (
    candidate.sensitivity === "sensitive" ||
    (query.mode === "inline" && candidate.sensitivity === "dangerous")
  ) {
    return null;
  }
  if (candidate.contextKey && candidate.contextKey !== query.contextKey) {
    return null;
  }
  if (
    query.mode === "menu" &&
    candidate.activation === "openSnippetPanel"
  ) {
    if (
      (sourceQuery.input !== undefined && sourceQuery.input !== query.input) ||
      (sourceQuery.cursor !== undefined && sourceQuery.cursor !== query.cursor)
    ) {
      return null;
    }
    return {
      ...candidate,
      replacementRange: { start: 0, end: query.cursor },
      suffix: "",
    };
  }

  const input = Array.from(query.input);
  const replacement = Array.from(candidate.replacementText);
  const start = candidate.replacementRange.start;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > query.cursor ||
    query.cursor > input.length ||
    query.cursor >= replacement.length
  ) {
    return null;
  }
  if (!sameSlice(input, replacement, 0, start)) {
    return null;
  }
  if (!sameSlice(input, replacement, start, query.cursor)) {
    return null;
  }

  const suffix = replacement.slice(query.cursor).join("");
  if (!suffix) {
    return null;
  }
  return {
    ...candidate,
    replacementRange: { start, end: query.cursor },
    suffix,
  };
}

/** 相同替换文本只展示一次，但保留各 provider 对该候选的来源解释。 */
function mergeSourceExplanations(
  winner: RankedTerminalSuggestion,
  ...items: readonly RankedTerminalSuggestion[]
): RankedTerminalSuggestion {
  const explanations = Array.from(
    new Set(
      items.flatMap(({ candidate }) => [
        ...(candidate.mergedSourceExplanations ?? []),
        ...(candidate.sourceExplanation ? [candidate.sourceExplanation] : []),
      ]),
    ),
  ).sort();
  return explanations.length > 0
    ? {
        ...winner,
        candidate: {
          ...winner.candidate,
          mergedSourceExplanations: explanations,
        },
      }
    : winner;
}

function frontendScore(
  candidate: CommandSuggestionCandidate,
  mode: CommandSuggestionQueryMode,
  stale: boolean,
) {
  return (
    candidate.score +
    terminalSuggestionProviderPriority(candidate.provider) * 0.001 +
    (mode === "inline" ? 0.02 : 0) -
    (stale ? 0.08 : 0)
  );
}

function compareRanked(
  left: RankedTerminalSuggestion,
  right: RankedTerminalSuggestion,
) {
  return (
    right.score - left.score ||
    Number(left.stale) - Number(right.stale) ||
    terminalSuggestionProviderPriority(right.candidate.provider) -
      terminalSuggestionProviderPriority(left.candidate.provider) ||
    normalizeReplacement(left.candidate.replacementText).localeCompare(
      normalizeReplacement(right.candidate.replacementText),
    ) ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

function normalizeReplacement(value: string) {
  return value.normalize("NFC");
}

function sameSlice(
  input: readonly string[],
  replacement: readonly string[],
  start: number,
  end: number,
) {
  for (let index = start; index < end; index += 1) {
    if (input[index] !== replacement[index]) {
      return false;
    }
  }
  return true;
}
