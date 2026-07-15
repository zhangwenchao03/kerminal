// @author kongweiguang

import type {
  CommandSuggestionCandidate,
  CommandSuggestionProvider,
} from "../../lib/terminalSuggestionApi";

export const TERMINAL_SUGGESTION_MENU_MAX_ITEMS = 8;

export type TerminalSuggestionMenuIntent =
  | { type: "close" }
  | { candidate: CommandSuggestionCandidate; type: "accept" }
  | { candidate: CommandSuggestionCandidate; type: "openSnippetPanel" }
  | { index: number; type: "move" }
  | { type: "open" };

export interface TerminalSuggestionMenuState {
  candidates: readonly CommandSuggestionCandidate[];
  open: boolean;
  selectedIndex: number;
  stale: boolean;
}

export type TerminalSuggestionMenuEvent =
  | {
      candidates: readonly CommandSuggestionCandidate[];
      stale?: boolean;
      type: "open";
    }
  | {
      candidates: readonly CommandSuggestionCandidate[];
      stale?: boolean;
      type: "candidates";
    }
  | { direction: -1 | 1; type: "move" }
  | { index: number; type: "select" }
  | { type: "close" };

export interface TerminalSuggestionMenuKeyEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface TerminalSuggestionMenuCandidateView {
  candidate: CommandSuggestionCandidate;
  dangerous: boolean;
  description?: string;
  providerLabel: string;
  stale: boolean;
}

export function createTerminalSuggestionMenuState(
  overrides: Partial<TerminalSuggestionMenuState> = {},
): TerminalSuggestionMenuState {
  const candidates = normalizeMenuCandidates(overrides.candidates ?? []);
  return {
    candidates,
    open: Boolean(overrides.open && candidates.length > 0),
    selectedIndex: clampSelection(overrides.selectedIndex ?? 0, candidates),
    stale: overrides.stale ?? false,
  };
}

/**
 * 菜单状态只保存候选和选中索引；请求、终端输入与接受副作用由接线层负责。
 */
export function reduceTerminalSuggestionMenuState(
  state: TerminalSuggestionMenuState,
  event: TerminalSuggestionMenuEvent,
): TerminalSuggestionMenuState {
  switch (event.type) {
    case "open": {
      const candidates = normalizeMenuCandidates(event.candidates);
      return {
        candidates,
        open: candidates.length > 0,
        selectedIndex: 0,
        stale: event.stale ?? false,
      };
    }
    case "candidates": {
      const candidates = normalizeMenuCandidates(event.candidates);
      const selectedId = state.candidates[state.selectedIndex]?.id;
      const preservedIndex = selectedId
        ? candidates.findIndex((candidate) => candidate.id === selectedId)
        : -1;
      return {
        candidates,
        open: state.open && candidates.length > 0,
        selectedIndex: clampSelection(
          preservedIndex >= 0 ? preservedIndex : state.selectedIndex,
          candidates,
        ),
        stale: event.stale ?? false,
      };
    }
    case "move":
      if (!state.open || state.candidates.length === 0) {
        return state;
      }
      return {
        ...state,
        selectedIndex:
          (state.selectedIndex + event.direction + state.candidates.length) %
          state.candidates.length,
      };
    case "select":
      return state.open
        ? {
            ...state,
            selectedIndex: clampSelection(event.index, state.candidates),
          }
        : state;
    case "close":
      return state.open ? { ...state, open: false } : state;
  }
}

/**
 * Ctrl+Space、导航和接受键先映射成意图，接线层据此决定是否拦截 xterm 键盘事件。
 */
export function resolveTerminalSuggestionMenuKeyIntent(
  state: TerminalSuggestionMenuState,
  event: TerminalSuggestionMenuKeyEvent,
): TerminalSuggestionMenuIntent | null {
  if (event.isComposing) {
    return null;
  }
  if (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.key === " " || event.key === "Spacebar")
  ) {
    return state.open ? { type: "close" } : { type: "open" };
  }
  if (!state.open || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const index =
      (state.selectedIndex + direction + state.candidates.length) %
      state.candidates.length;
    return state.candidates.length > 0 ? { index, type: "move" } : null;
  }
  if (event.key === "Escape") {
    return { type: "close" };
  }
  if (event.key === "Enter" || event.key === "ArrowRight") {
    const candidate = state.candidates[state.selectedIndex];
    return candidate ? terminalSuggestionMenuCandidateIntent(candidate) : null;
  }
  return null;
}

export function terminalSuggestionMenuCandidateView(
  candidate: CommandSuggestionCandidate,
  menuStale: boolean,
): TerminalSuggestionMenuCandidateView {
  const snippetOrigin = candidate.metadata?.origin;
  return {
    candidate,
    dangerous: candidate.sensitivity === "dangerous",
    description: [
      candidate.description,
      candidate.sourceExplanation,
      ...(candidate.mergedSourceExplanations ?? []),
    ]
      .filter((value, index, values): value is string =>
        Boolean(value && values.indexOf(value) === index),
      )
      .join(" · ") || undefined,
    providerLabel:
      candidate.activation === "openSnippetPanel"
        ? `${snippetOrigin === "user" ? "我的片段" : "内置片段"} · 配置`
        : terminalSuggestionProviderLabel(candidate.provider),
    stale: menuStale || candidate.metadata?.stale === true,
  };
}

function terminalSuggestionProviderLabel(
  provider: CommandSuggestionProvider,
): string {
  switch (provider) {
    case "history":
      return "历史";
    case "spec":
      return "命令规范";
    case "remoteCommand":
      return "远端命令";
    case "remotePath":
      return "远端路径";
    case "snippet":
      return "片段";
    case "git":
      return "Git";
  }
}

export function terminalSuggestionMenuCandidateIntent(
  candidate: CommandSuggestionCandidate,
): TerminalSuggestionMenuIntent {
  return candidate.activation === "openSnippetPanel"
    ? { candidate, type: "openSnippetPanel" }
    : { candidate, type: "accept" };
}

function normalizeMenuCandidates(
  candidates: readonly CommandSuggestionCandidate[],
) {
  return candidates
    .filter(
      (candidate) =>
        candidate.sensitivity !== "sensitive" &&
        candidate.allowedPresentations.includes("menu"),
    )
    .slice(0, TERMINAL_SUGGESTION_MENU_MAX_ITEMS);
}

function clampSelection(
  selectedIndex: number,
  candidates: readonly CommandSuggestionCandidate[],
) {
  if (candidates.length === 0) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(selectedIndex), 0), candidates.length - 1);
}
