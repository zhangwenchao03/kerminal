// @author kongweiguang

import type { CommandSuggestionCandidate } from "../../lib/terminalSuggestionApi";
import {
  createTerminalSuggestionViewState,
  type TerminalSuggestionPhase,
  type TerminalSuggestionViewState,
} from "./terminalSuggestionModel";

export type TerminalSuggestionStateEvent =
  | { generation: number; type: "disabled" }
  | { generation: number; type: "input" }
  | { type: "scheduled" }
  | { type: "request-started" }
  | {
      candidates: readonly CommandSuggestionCandidate[];
      generation: number;
      menuOpen?: boolean;
      stale: boolean;
      type: "candidates";
    }
  | { generation: number; type: "request-failed" }
  | { type: "clear" }
  | { type: "disposed" };

/**
 * 纯状态机只描述可见状态，不持有 timer、Promise 或终端对象。
 */
export function reduceTerminalSuggestionState(
  state: TerminalSuggestionViewState,
  event: TerminalSuggestionStateEvent,
): TerminalSuggestionViewState {
  switch (event.type) {
    case "disabled":
      return emptyState("disabled", event.generation);
    case "input":
      return emptyState("idle", event.generation);
    case "scheduled":
      return withPhase(state, "scheduled");
    case "request-started":
      return withPhase(state, "requesting");
    case "candidates": {
      const inlineCandidate =
        event.candidates.find((candidate) =>
          candidate.allowedPresentations.includes("inline"),
        ) ?? null;
      return createTerminalSuggestionViewState({
        candidates: event.candidates,
        generation: event.generation,
        inlineCandidate,
        inlineSuffix: inlineCandidate?.suffix ?? "",
        phase: event.menuOpen
          ? "menu-open"
          : event.candidates.length > 0
            ? "cache-visible"
            : "idle",
        stale: event.stale,
      });
    }
    case "request-failed":
      if (event.generation !== state.generation) {
        return state;
      }
      return withPhase(state, state.candidates.length > 0 ? "backoff" : "idle");
    case "clear":
      return emptyState("idle", state.generation);
    case "disposed":
      return emptyState("disposed", state.generation);
  }
}

function emptyState(
  phase: TerminalSuggestionPhase,
  generation: number,
): TerminalSuggestionViewState {
  return createTerminalSuggestionViewState({ generation, phase });
}

function withPhase(
  state: TerminalSuggestionViewState,
  phase: TerminalSuggestionPhase,
) {
  return state.phase === phase ? state : { ...state, phase };
}
