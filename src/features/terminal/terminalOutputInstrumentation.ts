// @author kongweiguang

export type TerminalOutputInstrumentationStep =
  | "commandBlock"
  | "cwdOsc"
  | "history"
  | "remotePrewarmGit"
  | "remotePrewarmPath"
  | "writer";

interface TerminalOutputInstrumentationBucket {
  count: number;
  maxMs: number;
  totalChars: number;
  totalMs: number;
}

export interface TerminalOutputInstrumentationState {
  enabled?: boolean;
  buckets?: Partial<
    Record<TerminalOutputInstrumentationStep, TerminalOutputInstrumentationBucket>
  >;
}

export interface TerminalOutputInstrumentation {
  measure<T>(
    step: TerminalOutputInstrumentationStep,
    chars: number,
    action: () => T,
  ): T;
}

interface TerminalOutputInstrumentationOptions {
  paneId: string;
}

const TERMINAL_OUTPUT_INSTRUMENTATION_GLOBAL =
  "__kerminalTerminalOutputInstrumentation";

function nowMs() {
  if (
    typeof globalThis.performance !== "undefined" &&
    typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }
  return Date.now();
}

function resolveInstrumentationState():
  | TerminalOutputInstrumentationState
  | undefined {
  const target = globalThis as unknown as Record<
    string,
    TerminalOutputInstrumentationState | undefined
  >;
  return target[TERMINAL_OUTPUT_INSTRUMENTATION_GLOBAL];
}

export function createTerminalOutputInstrumentation({
  paneId: _paneId,
}: TerminalOutputInstrumentationOptions): TerminalOutputInstrumentation | null {
  const state = resolveInstrumentationState();
  if (!state?.enabled) {
    return null;
  }
  state.buckets ??= {};

  return {
    measure(step, chars, action) {
      if (!state.enabled) {
        return action();
      }
      const start = nowMs();
      try {
        return action();
      } finally {
        const durationMs = Math.max(0, nowMs() - start);
        const bucket = (state.buckets![step] ??= {
          count: 0,
          maxMs: 0,
          totalChars: 0,
          totalMs: 0,
        });
        bucket.count += 1;
        bucket.totalChars += Math.max(0, chars);
        bucket.totalMs += durationMs;
        bucket.maxMs = Math.max(bucket.maxMs, durationMs);
      }
    },
  };
}

export function runTerminalOutputInstrumentationStep<T>(
  instrumentation: TerminalOutputInstrumentation | null,
  step: TerminalOutputInstrumentationStep,
  chars: number,
  action: () => T,
): T {
  if (!instrumentation) {
    return action();
  }
  return instrumentation.measure(step, chars, action);
}
