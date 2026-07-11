// @author kongweiguang

import type { CommandSuggestionCandidate } from "../../lib/terminalSuggestionApi";
import {
  resolveTerminalSuggestionAcceptance,
  type TerminalSuggestionAcceptance,
  type TerminalSuggestionAcceptUnit,
} from "./terminalSuggestionAcceptance";
import {
  terminalSuggestionCache,
  type TerminalSuggestionCache,
} from "./terminalSuggestionCache";
import { terminalSuggestionYieldReason } from "./terminalSuggestionKeyPolicy";
import {
  createTerminalSuggestionQuery,
  createTerminalSuggestionViewState,
  terminalSuggestionQueryIdentity,
  type TerminalSuggestionFeedback,
  type TerminalSuggestionInput,
  type TerminalSuggestionQuery,
  type TerminalSuggestionViewState,
} from "./terminalSuggestionModel";
import { rankTerminalSuggestions } from "./terminalSuggestionRanking";
import { reduceTerminalSuggestionState } from "./terminalSuggestionStateMachine";

export interface TerminalSuggestionControllerClock {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface TerminalSuggestionControllerOptions {
  cache?: TerminalSuggestionCache;
  clock?: TerminalSuggestionControllerClock;
  debounceMs?: number;
  onFeedback?: (feedback: TerminalSuggestionFeedback) => void;
  paneId: string;
  requestSuggestions: (
    query: TerminalSuggestionQuery,
    signal: AbortSignal,
  ) => Promise<readonly CommandSuggestionCandidate[]>;
}

interface InFlightRequest {
  abortController: AbortController;
  query: TerminalSuggestionQuery;
}

/**
 * 每个 pane 一个 controller；React 只通过 subscribe/getSnapshot 订阅轻量 view state。
 */
export class TerminalSuggestionController {
  private readonly cache: TerminalSuggestionCache;
  private readonly clock: TerminalSuggestionControllerClock;
  private readonly debounceMs: number;
  private disposed = false;
  private generation = 0;
  private inFlight: InFlightRequest | null = null;
  private readonly listeners = new Set<() => void>();
  private latestInput: TerminalSuggestionInput | null = null;
  private readonly onFeedback?: (feedback: TerminalSuggestionFeedback) => void;
  private readonly paneId: string;
  private pending: TerminalSuggestionQuery | null = null;
  private query: TerminalSuggestionQuery | null = null;
  private readonly requestSuggestions: TerminalSuggestionControllerOptions["requestSuggestions"];
  private timer: unknown | null = null;
  private view = createTerminalSuggestionViewState();

  constructor(options: TerminalSuggestionControllerOptions) {
    this.cache = options.cache ?? terminalSuggestionCache;
    this.clock = options.clock ?? browserClock;
    this.debounceMs = Math.max(0, options.debounceMs ?? 60);
    this.onFeedback = options.onFeedback;
    this.paneId = options.paneId;
    this.requestSuggestions = options.requestSuggestions;
  }

  getSnapshot = (): TerminalSuggestionViewState => this.view;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(input: TerminalSuggestionInput) {
    if (this.disposed) {
      return this.view;
    }
    this.latestInput = input;
    const nextGeneration = this.generation + 1;
    const next = createTerminalSuggestionQuery(
      this.paneId,
      nextGeneration,
      input,
    );
    const identityChanged =
      !this.query ||
      terminalSuggestionQueryIdentity(this.query) !==
        terminalSuggestionQueryIdentity(next);
    if (identityChanged) {
      this.generation = nextGeneration;
    } else {
      next.generation = this.generation;
      next.request.generation = this.generation;
    }
    this.query = next;

    const yieldReason = terminalSuggestionYieldReason(input.lifecycle);
    if (yieldReason) {
      this.invalidateWork();
      this.setView(
        reduceTerminalSuggestionState(this.view, {
          generation: this.generation,
          type: "disabled",
        }),
      );
      return this.view;
    }

    if (identityChanged) {
      this.setView(
        reduceTerminalSuggestionState(this.view, {
          generation: this.generation,
          type: "input",
        }),
      );
    }
    this.applyCachedCandidates(next);
    this.pending = next;
    this.schedule(this.debounceMs);
    return this.view;
  }

  accept(unit: TerminalSuggestionAcceptUnit): TerminalSuggestionAcceptance | null {
    const candidate = this.view.inlineCandidate;
    if (!candidate) {
      return null;
    }
    return this.acceptCandidate(candidate, unit);
  }

  /**
   * 菜单可接受当前查询中的任意候选，不把菜单选中项伪装成 inline 首选项。
   */
  acceptCandidate(
    candidate: CommandSuggestionCandidate,
    unit: TerminalSuggestionAcceptUnit,
  ): TerminalSuggestionAcceptance | null {
    const query = this.query;
    if (!query || this.disposed) {
      return null;
    }
    const acceptance = resolveTerminalSuggestionAcceptance({
      candidate,
      cursor: query.cursor,
      input: query.input,
      unit,
    });
    if (!acceptance) {
      return null;
    }
    const latestInput = this.latestInput;
    this.onFeedback?.({
      candidate,
      input: query.input,
      kind: acceptance.feedbackKind,
      paneId: this.paneId,
    });
    this.update({
      contextKey: query.contextKey,
      cursor: acceptance.nextCursor,
      input: acceptance.nextInput,
      lifecycle: latestInput?.lifecycle ?? {
        alternateScreen: false,
        enabled: true,
        hidden: false,
        imeComposing: false,
        inputCompatibilityMode: "shell",
        pasting: false,
        searchFocused: false,
        selectionActive: false,
        sessionOpen: true,
      },
      mode: query.mode,
      request: stripQueryFields(query.request),
    });
    return acceptance;
  }

  dismiss() {
    if (this.view.inlineCandidate && this.query) {
      this.onFeedback?.({
        candidate: this.view.inlineCandidate,
        input: this.query.input,
        kind: "dismissed",
        paneId: this.paneId,
      });
    }
    this.invalidateWork();
    this.setView({
      ...reduceTerminalSuggestionState(this.view, { type: "clear" }),
      generation: this.generation,
    });
  }

  /**
   * 生命周期切换或输入失配时静默清空，不把系统让行误记为用户 dismiss。
   */
  clear() {
    this.invalidateWork();
    this.setView({
      ...reduceTerminalSuggestionState(this.view, { type: "clear" }),
      generation: this.generation,
    });
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.latestInput = null;
    this.invalidateWork();
    this.cache.clearPane(this.paneId);
    this.setView(
      reduceTerminalSuggestionState(this.view, { type: "disposed" }),
    );
    this.listeners.clear();
  }

  private applyCachedCandidates(query: TerminalSuggestionQuery) {
    const ranked = rankTerminalSuggestions(
      this.cache.get({
        contextKey: query.contextKey,
        mode: query.mode,
        now: this.clock.now(),
        paneId: this.paneId,
      }),
      query,
    );
    this.setView(
      reduceTerminalSuggestionState(this.view, {
        candidates: ranked.map((item) => item.candidate),
        generation: query.generation,
        stale: ranked.some((item) => item.stale),
        type: "candidates",
      }),
    );
  }

  private schedule(delayMs: number) {
    this.clearTimer();
    if (this.inFlight || !this.pending) {
      return;
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.startPendingRequest();
    }, delayMs);
    this.setView(
      reduceTerminalSuggestionState(this.view, { type: "scheduled" }),
    );
  }

  private startPendingRequest() {
    if (this.disposed || this.inFlight || !this.pending) {
      return;
    }
    const query = this.pending;
    this.pending = null;
    const abortController = new AbortController();
    this.inFlight = { abortController, query };
    this.setView(
      reduceTerminalSuggestionState(this.view, { type: "request-started" }),
    );
    void this.requestSuggestions(query, abortController.signal)
      .then((candidates) => {
        if (abortController.signal.aborted || this.disposed) {
          return;
        }
        this.cache.put({
          candidates,
          contextKey: query.contextKey,
          cursor: query.cursor,
          input: query.input,
          mode: query.mode,
          now: this.clock.now(),
          paneId: this.paneId,
        });
        if (!this.isCurrent(query)) {
          return;
        }
        this.applyCachedCandidates(query);
      })
      .catch(() => {
        if (!abortController.signal.aborted && this.isCurrent(query)) {
          this.setView(
            reduceTerminalSuggestionState(this.view, {
              generation: query.generation,
              type: "request-failed",
            }),
          );
        }
      })
      .finally(() => {
        if (this.inFlight?.query === query) {
          this.inFlight = null;
        }
        if (this.pending && !this.disposed) {
          this.schedule(0);
        }
      });
  }

  private isCurrent(query: TerminalSuggestionQuery) {
    return (
      this.query !== null &&
      query.generation === this.generation &&
      terminalSuggestionQueryIdentity(query) ===
        terminalSuggestionQueryIdentity(this.query)
    );
  }

  private invalidateWork() {
    this.clearTimer();
    this.pending = null;
    this.inFlight?.abortController.abort();
    this.inFlight = null;
    this.generation += 1;
  }

  private clearTimer() {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setView(next: TerminalSuggestionViewState) {
    if (next === this.view) {
      return;
    }
    this.view = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createTerminalSuggestionController(
  options: TerminalSuggestionControllerOptions,
) {
  return new TerminalSuggestionController(options);
}

const browserClock: TerminalSuggestionControllerClock = {
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

function stripQueryFields(
  request: TerminalSuggestionQuery["request"],
): NonNullable<TerminalSuggestionInput["request"]> {
  const {
    contextKey: _contextKey,
    cursor: _cursor,
    generation: _generation,
    input: _input,
    mode: _mode,
    paneId: _paneId,
    ...rest
  } = request;
  return rest;
}
