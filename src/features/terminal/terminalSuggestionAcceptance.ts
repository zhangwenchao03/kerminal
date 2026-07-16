// @author kongweiguang

import type { CommandSuggestionCandidate } from "../../lib/terminalSuggestionApi";

export type TerminalSuggestionAcceptUnit = "all" | "partial";

export interface TerminalSuggestionAcceptance {
  acceptedBoundary: number;
  feedbackKind: "all" | "partial";
  insertedText: string;
  nextCursor: number;
  nextInput: string;
}

/**
 * 接受边界完全依赖后端合同，不在前端猜测 shell 的空格、引号或路径语义。
 */
export function resolveTerminalSuggestionAcceptance({
  candidate,
  cursor,
  input,
  unit,
}: {
  candidate: CommandSuggestionCandidate;
  cursor: number;
  input: string;
  unit: TerminalSuggestionAcceptUnit;
}): TerminalSuggestionAcceptance | null {
  if (candidate.activation === "openSnippetPanel") {
    return null;
  }
  const inputChars = Array.from(input);
  const replacement = Array.from(candidate.replacementText);
  const range = candidate.replacementRange;
  if (
    range.end !== cursor ||
    range.start < 0 ||
    range.start > range.end ||
    cursor > inputChars.length ||
    cursor >= replacement.length
  ) {
    return null;
  }
  if (!sameSlice(inputChars, replacement, 0, range.start)) {
    return null;
  }
  if (!sameSlice(inputChars, replacement, range.start, range.end)) {
    return null;
  }

  const boundary =
    unit === "all"
      ? replacement.length
      : candidate.acceptBoundaries
          .filter(
            (candidateBoundary) =>
            Number.isSafeInteger(candidateBoundary) &&
            candidateBoundary > cursor &&
            candidateBoundary <= replacement.length,
          )
          .sort((left, right) => left - right)[0];
  if (typeof boundary !== "number") {
    return null;
  }

  const insertedText = replacement.slice(cursor, boundary).join("");
  if (!insertedText) {
    return null;
  }
  const nextChars = [
    ...inputChars.slice(0, range.start),
    ...replacement.slice(range.start, boundary),
    ...inputChars.slice(range.end),
  ];
  return {
    acceptedBoundary: boundary,
    feedbackKind: boundary === replacement.length ? "all" : "partial",
    insertedText,
    nextCursor: boundary,
    nextInput: nextChars.join(""),
  };
}

export function hasTerminalSuggestionPartialBoundary(
  candidate: CommandSuggestionCandidate,
  cursor: number,
) {
  const replacementLength = Array.from(candidate.replacementText).length;
  return candidate.acceptBoundaries.some(
    (boundary) => boundary > cursor && boundary <= replacementLength,
  );
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
