// @author kongweiguang

import type {
  CommandSuggestionCandidate,
  CommandSuggestionProvider,
  CommandSuggestionQueryMode,
  CommandSuggestionRequest,
} from "../../lib/terminalSuggestionApi";

export type TerminalSuggestionPhase =
  | "backoff"
  | "cache-visible"
  | "disabled"
  | "disposed"
  | "idle"
  | "menu-open"
  | "requesting"
  | "scheduled";

export type TerminalSuggestionFeedbackKind = "all" | "dismissed" | "partial";

export interface TerminalSuggestionLifecycle {
  alternateScreen: boolean;
  enabled: boolean;
  hidden: boolean;
  imeComposing: boolean;
  inputCompatibilityMode: "agentTui" | "shell";
  pasting: boolean;
  searchFocused: boolean;
  selectionActive: boolean;
  sessionOpen: boolean;
}

export interface TerminalSuggestionInput {
  contextKey: string;
  cursor: number;
  input: string;
  lifecycle: TerminalSuggestionLifecycle;
  mode?: CommandSuggestionQueryMode;
  request?: Omit<
    CommandSuggestionRequest,
    "contextKey" | "cursor" | "generation" | "input" | "mode" | "paneId"
  >;
}

export interface TerminalSuggestionQuery {
  contextKey: string;
  cursor: number;
  generation: number;
  input: string;
  mode: CommandSuggestionQueryMode;
  paneId: string;
  request: CommandSuggestionRequest;
}

export interface TerminalSuggestionViewState {
  candidates: readonly CommandSuggestionCandidate[];
  generation: number;
  inlineCandidate: CommandSuggestionCandidate | null;
  inlineSuffix: string;
  phase: TerminalSuggestionPhase;
  stale: boolean;
}

export interface TerminalSuggestionFeedback {
  candidate: CommandSuggestionCandidate;
  input: string;
  kind: TerminalSuggestionFeedbackKind;
  paneId: string;
}

export interface TerminalSuggestionCacheStats {
  bucketCount: number;
  candidateCount: number;
  evictions: number;
  expiredBuckets: number;
  hits: number;
  misses: number;
  paneCount: number;
  staleHits: number;
}

export const DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE: TerminalSuggestionLifecycle =
  {
    alternateScreen: false,
    enabled: true,
    hidden: false,
    imeComposing: false,
    inputCompatibilityMode: "shell",
    pasting: false,
    searchFocused: false,
    selectionActive: false,
    sessionOpen: true,
  };

export function createTerminalSuggestionViewState(
  overrides: Partial<TerminalSuggestionViewState> = {},
): TerminalSuggestionViewState {
  const candidates = overrides.candidates ?? [];
  const inlineCandidate =
    overrides.inlineCandidate ??
    candidates.find((candidate) =>
      candidate.allowedPresentations.includes("inline"),
    ) ??
    null;
  return {
    candidates,
    generation: overrides.generation ?? 0,
    inlineCandidate,
    inlineSuffix: overrides.inlineSuffix ?? inlineCandidate?.suffix ?? "",
    phase: overrides.phase ?? "idle",
    stale: overrides.stale ?? false,
  };
}

export function createTerminalSuggestionQuery(
  paneId: string,
  generation: number,
  input: TerminalSuggestionInput,
): TerminalSuggestionQuery {
  const mode = input.mode ?? "inline";
  const cursor = clamp(input.cursor, 0, Array.from(input.input).length);
  return {
    contextKey: input.contextKey,
    cursor,
    generation,
    input: input.input,
    mode,
    paneId,
    request: {
      ...input.request,
      contextKey: input.contextKey,
      cursor,
      generation,
      input: input.input,
      mode,
      paneId,
    },
  };
}

export function terminalSuggestionQueryIdentity(
  query: Pick<
    TerminalSuggestionQuery,
    "contextKey" | "cursor" | "input" | "mode" | "paneId"
  >,
) {
  return [
    query.paneId,
    query.contextKey,
    query.mode,
    query.cursor,
    query.input,
  ].join("\u0000");
}

export function terminalSuggestionProviderPriority(
  provider: CommandSuggestionProvider,
) {
  switch (provider) {
    case "history":
      return 5;
    case "spec":
      return 4;
    case "remoteCommand":
      return 3;
    case "remotePath":
      return 2;
    case "git":
      return 1;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
