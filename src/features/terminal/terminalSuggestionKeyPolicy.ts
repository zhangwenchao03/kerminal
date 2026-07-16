// @author kongweiguang

import type { TerminalSuggestionLifecycle } from "./terminalSuggestionModel";

export type TerminalSuggestionKeyAction =
  | "accept-all"
  | "accept-partial";

export interface TerminalSuggestionKeyEvent {
  altKey?: boolean;
  code?: string;
  ctrlKey?: boolean;
  isComposing?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface TerminalSuggestionKeyDecision {
  action?: TerminalSuggestionKeyAction;
  handled: boolean;
  reason?: string;
}

export function resolveTerminalSuggestionKeyDecision({
  event,
  hasPartialBoundary,
  hasSuggestion,
  lifecycle,
}: {
  event: TerminalSuggestionKeyEvent;
  hasPartialBoundary: boolean;
  hasSuggestion: boolean;
  lifecycle: TerminalSuggestionLifecycle;
}): TerminalSuggestionKeyDecision {
  const yieldReason = terminalSuggestionYieldReason(lifecycle, event);
  if (yieldReason) {
    return { handled: false, reason: yieldReason };
  }

  if (event.key !== "ArrowRight" || event.ctrlKey || event.metaKey) {
    return { handled: false, reason: "unrelated-key" };
  }
  if (event.altKey) {
    return hasSuggestion && hasPartialBoundary
      ? { action: "accept-partial", handled: true }
      : { handled: false, reason: "no-partial-suggestion" };
  }
  return hasSuggestion
    ? { action: "accept-all", handled: true }
    : { handled: false, reason: "no-suggestion" };
}

export function terminalSuggestionYieldReason(
  lifecycle: TerminalSuggestionLifecycle,
  event?: Pick<TerminalSuggestionKeyEvent, "isComposing">,
) {
  if (!lifecycle.enabled) return "disabled";
  if (!lifecycle.sessionOpen) return "session-closed";
  if (lifecycle.hidden) return "hidden";
  if (lifecycle.inputCompatibilityMode === "agentTui") return "agent-tui";
  if (lifecycle.alternateScreen) return "alternate-screen";
  if (lifecycle.imeComposing || event?.isComposing) return "ime-composition";
  if (lifecycle.pasting) return "paste";
  if (lifecycle.selectionActive) return "selection";
  if (lifecycle.searchFocused) return "search-focus";
  return undefined;
}
