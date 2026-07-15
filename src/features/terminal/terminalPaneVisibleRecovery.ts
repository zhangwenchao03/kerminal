import type { TerminalPaneRuntimeLifecycleDecision } from "./terminalPaneRuntimeLifecycle";
import type { XtermPaneDimensions } from "./XtermPane";

type RecoveryFrameId = number;

interface TerminalPaneVisibleRecoveryTerminal {
  cols: number;
  refresh?(start: number, end: number): void;
  rows: number;
}
interface TerminalPaneVisibleRecoveryFitAddon {
  fit(): void;
}

export interface TerminalPaneVisibleRecoveryScheduler {
  cancelFrame(handle: RecoveryFrameId): void;
  scheduleFrame(callback: FrameRequestCallback): RecoveryFrameId;
}

export interface TerminalPaneVisibleRecoveryOptions {
  cancelHiddenResourceReaper?: () => void;
  fitAddon: () => TerminalPaneVisibleRecoveryFitAddon | null | undefined;
  markVisibleRecoveryComplete?: () =>
    | TerminalPaneRuntimeLifecycleDecision
    | undefined;
  onDimensionsChange?: (dimensions: XtermPaneDimensions) => void;
  onSuggestionsRestored?: (
    decision: TerminalPaneRuntimeLifecycleDecision | undefined,
  ) => void;
  resizeTerminal?: (
    sessionId: string,
    dimensions: XtermPaneDimensions,
  ) => Promise<unknown>;
  scheduler: TerminalPaneVisibleRecoveryScheduler;
  sessionId?: () => string | null | undefined;
  terminal: () => TerminalPaneVisibleRecoveryTerminal | null | undefined;
}

export interface TerminalPaneVisibleRecoveryResult {
  dimensionsChanged: boolean;
  recovered: boolean;
}

export function scheduleTerminalPaneVisibleRecovery({
  cancelHiddenResourceReaper,
  scheduler,
  ...recoveryOptions
}: TerminalPaneVisibleRecoveryOptions): () => void {
  cancelHiddenResourceReaper?.();

  let firstFrameId: RecoveryFrameId | null = null;
  let secondFrameId: RecoveryFrameId | null = null;

  firstFrameId = scheduler.scheduleFrame(() => {
    firstFrameId = null;
    secondFrameId = scheduler.scheduleFrame(() => {
      secondFrameId = null;
      runTerminalPaneVisibleRecovery(recoveryOptions);
    });
  });

  return () => {
    if (firstFrameId !== null) {
      scheduler.cancelFrame(firstFrameId);
      firstFrameId = null;
    }
    if (secondFrameId !== null) {
      scheduler.cancelFrame(secondFrameId);
      secondFrameId = null;
    }
  };
}

export function runTerminalPaneVisibleRecovery({
  fitAddon,
  markVisibleRecoveryComplete,
  onDimensionsChange,
  onSuggestionsRestored,
  resizeTerminal,
  sessionId,
  terminal,
}: Omit<
  TerminalPaneVisibleRecoveryOptions,
  "cancelHiddenResourceReaper" | "scheduler"
>): TerminalPaneVisibleRecoveryResult {
  const xterm = terminal();
  if (!xterm) {
    return { dimensionsChanged: false, recovered: false };
  }

  const addon = fitAddon();
  if (!addon) {
    return { dimensionsChanged: false, recovered: false };
  }

  const previousDimensions = { cols: xterm.cols, rows: xterm.rows };
  addon.fit();
  const nextDimensions = { cols: xterm.cols, rows: xterm.rows };
  const dimensionsChanged =
    nextDimensions.cols !== previousDimensions.cols ||
    nextDimensions.rows !== previousDimensions.rows;

  if (dimensionsChanged) {
    onDimensionsChange?.(nextDimensions);
    const activeSessionId = sessionId?.();
    if (activeSessionId) {
      void resizeTerminal?.(activeSessionId, nextDimensions);
    }
  }

  xterm.refresh?.(0, Math.max(0, xterm.rows - 1));
  const decision = markVisibleRecoveryComplete?.();
  onSuggestionsRestored?.(decision);

  return { dimensionsChanged, recovered: true };
}
