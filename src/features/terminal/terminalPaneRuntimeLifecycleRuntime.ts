import type { TerminalRendererType } from "../settings/contracts/index";
import {
  resolveTerminalPaneRuntimeLifecycle,
  type TerminalPaneRuntimeLifecycleDecision,
} from "./terminalPaneRuntimeLifecycle";

interface RefBox<T> {
  current: T;
}

export interface TerminalPaneRuntimeLifecycleRuntime {
  decisionRef: RefBox<TerminalPaneRuntimeLifecycleDecision>;
  markFocused(focused: boolean, now?: number): TerminalPaneRuntimeLifecycleDecision;
  markRendererType(
    rendererType: TerminalRendererType,
    now?: number,
  ): TerminalPaneRuntimeLifecycleDecision;
  markUserInteraction(now?: number): TerminalPaneRuntimeLifecycleDecision;
  markVisible(
    visible: boolean,
    now?: number,
  ): TerminalPaneRuntimeLifecycleDecision;
  markVisibleRecoveryComplete(now?: number): TerminalPaneRuntimeLifecycleDecision;
  read(now?: number): TerminalPaneRuntimeLifecycleDecision;
}

export interface TerminalPaneRuntimeLifecycleRuntimeOptions {
  activeTab: boolean;
  focused: boolean;
  now?: () => number;
  rendererType: TerminalRendererType;
  visible: boolean;
}

export function createTerminalPaneRuntimeLifecycleRuntime({
  activeTab,
  focused,
  now = () => Date.now(),
  rendererType,
  visible,
}: TerminalPaneRuntimeLifecycleRuntimeOptions): TerminalPaneRuntimeLifecycleRuntime {
  let state = {
    activeTab,
    focused,
    hiddenSince: visible && activeTab ? undefined : now(),
    lastUserInteractionAt: undefined as number | undefined,
    rendererType,
    visible,
  };

  const decisionRef: RefBox<TerminalPaneRuntimeLifecycleDecision> = {
    current: resolveDecision(now()),
  };

  function resolveDecision(timestamp: number) {
    return resolveTerminalPaneRuntimeLifecycle({
      activeTab: state.activeTab,
      focused: state.focused,
      hiddenSince: state.hiddenSince,
      lastUserInteractionAt: state.lastUserInteractionAt,
      now: timestamp,
      rendererType: state.rendererType,
      visible: state.visible,
    });
  }

  function refresh(timestamp = now()) {
    decisionRef.current = resolveDecision(timestamp);
    return decisionRef.current;
  }

  return {
    decisionRef,
    markFocused(nextFocused, timestamp) {
      state = { ...state, focused: nextFocused };
      return refresh(timestamp);
    },
    markRendererType(nextRendererType, timestamp) {
      state = { ...state, rendererType: nextRendererType };
      return refresh(timestamp);
    },
    markUserInteraction(timestamp = now()) {
      state = { ...state, lastUserInteractionAt: timestamp };
      return refresh(timestamp);
    },
    markVisible(nextVisible, timestamp = now()) {
      const nextActiveTab = nextVisible;
      const enteringHidden =
        (state.visible && !nextVisible) || (state.activeTab && !nextActiveTab);
      state = {
        ...state,
        activeTab: nextActiveTab,
        hiddenSince: enteringHidden ? timestamp : state.hiddenSince,
        visible: nextVisible,
      };
      return refresh(timestamp);
    },
    markVisibleRecoveryComplete(timestamp) {
      state = { ...state, hiddenSince: undefined };
      return refresh(timestamp);
    },
    read(timestamp) {
      return refresh(timestamp);
    },
  };
}
