// @author kongweiguang

import type { TerminalSuggestionAcceptance } from "./terminalSuggestionAcceptance";
import type { TerminalSuggestionController } from "./terminalSuggestionController";
import {
  hasTerminalSuggestionPartialBoundary,
} from "./terminalSuggestionAcceptance";
import {
  resolveTerminalSuggestionKeyDecision,
  type TerminalSuggestionKeyAction,
  type TerminalSuggestionKeyEvent,
} from "./terminalSuggestionKeyPolicy";
import {
  DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE,
  type TerminalSuggestionInput,
  type TerminalSuggestionLifecycle,
} from "./terminalSuggestionModel";

export interface TerminalSuggestionRuntimeKeyResult {
  acceptance?: TerminalSuggestionAcceptance;
  action?: TerminalSuggestionKeyAction;
  handled: boolean;
}

/**
 * 运行时桥接只负责把 xterm 生命周期快照和键位动作转成 controller 调用。
 */
export class TerminalSuggestionRuntimeBridge {
  private current: Omit<TerminalSuggestionInput, "lifecycle"> | null = null;
  private lifecycle: TerminalSuggestionLifecycle = {
    ...DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE,
  };

  constructor(private readonly controller: TerminalSuggestionController) {}

  sync(
    input: Omit<TerminalSuggestionInput, "lifecycle">,
    lifecycle: Partial<TerminalSuggestionLifecycle> = {},
  ) {
    this.current = input;
    this.lifecycle = { ...this.lifecycle, ...lifecycle };
    return this.controller.update({ ...input, lifecycle: this.lifecycle });
  }

  setLifecycle(lifecycle: Partial<TerminalSuggestionLifecycle>) {
    this.lifecycle = { ...this.lifecycle, ...lifecycle };
    if (this.current) {
      return this.controller.update({
        ...this.current,
        lifecycle: this.lifecycle,
      });
    }
    return this.controller.getSnapshot();
  }

  handleKey(event: TerminalSuggestionKeyEvent): TerminalSuggestionRuntimeKeyResult {
    const snapshot = this.controller.getSnapshot();
    const candidate = snapshot.inlineCandidate;
    const decision = resolveTerminalSuggestionKeyDecision({
      event,
      hasPartialBoundary: candidate
        ? hasTerminalSuggestionPartialBoundary(
            candidate,
            candidate.replacementRange.end,
          )
        : false,
      hasSuggestion: Boolean(candidate),
      lifecycle: this.lifecycle,
    });
    if (!decision.handled || !decision.action) {
      return { handled: false };
    }
    if (decision.action === "accept-all") {
      const acceptance = this.controller.accept("all");
      this.applyAcceptance(acceptance);
      return {
        acceptance: acceptance ?? undefined,
        action: decision.action,
        handled: Boolean(acceptance),
      };
    }
    if (decision.action === "accept-partial") {
      const acceptance = this.controller.accept("partial");
      this.applyAcceptance(acceptance);
      return {
        acceptance: acceptance ?? undefined,
        action: decision.action,
        handled: Boolean(acceptance),
      };
    }
    return { handled: false };
  }

  sessionClosed() {
    return this.setLifecycle({ sessionOpen: false });
  }

  dispose() {
    this.current = null;
    this.controller.dispose();
  }

  private applyAcceptance(acceptance: TerminalSuggestionAcceptance | null) {
    if (!acceptance || !this.current) {
      return;
    }
    this.current = {
      ...this.current,
      cursor: acceptance.nextCursor,
      input: acceptance.nextInput,
    };
  }
}

export function createTerminalSuggestionRuntimeBridge(
  controller: TerminalSuggestionController,
) {
  return new TerminalSuggestionRuntimeBridge(controller);
}
