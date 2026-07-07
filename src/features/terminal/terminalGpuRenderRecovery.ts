import type { TerminalRendererType } from "../settings/settingsModel";
import type { TerminalRendererBackend } from "./terminalRendererPolicy";
import {
  resolveTerminalGpuRenderRecovery,
  strongestTerminalGpuRenderRecoveryAction,
  type TerminalGpuRenderRecoveryAction,
  type TerminalGpuRenderRecoveryPolicyConfig,
  type TerminalGpuRenderRecoveryReason,
  type TerminalGpuRenderRecoveryTrigger,
} from "./terminalGpuRenderRecoveryPolicy";

interface TerminalGpuRecoveryTerminal {
  refresh?(start: number, end: number): void;
  rows: number;
}

interface TerminalGpuRecoveryRenderer {
  clearTextureAtlas?(): void;
  getState(): { backend: TerminalRendererBackend; mode: TerminalRendererType };
}

export interface TerminalGpuRenderRecoveryScheduler {
  cancelFrame(handle: number): void;
  requestFrame(callback: () => void): number;
}

export interface TerminalGpuRenderRecoveryController {
  dispose(): void;
  trigger(trigger: TerminalGpuRenderRecoveryTrigger, now?: number): void;
}

export interface TerminalGpuRenderRecoveryControllerOptions {
  clearTextureAtlas?: () => void;
  config?: Partial<TerminalGpuRenderRecoveryPolicyConfig>;
  now?: () => number;
  onFallbackCpu?: (reason: TerminalGpuRenderRecoveryReason) => void;
  onRecovery?: (event: TerminalGpuRenderRecoveryEvent) => void;
  renderer: TerminalGpuRecoveryRenderer;
  scheduler?: TerminalGpuRenderRecoveryScheduler;
  terminal: TerminalGpuRecoveryTerminal;
}

export interface TerminalGpuRenderRecoveryEvent {
  action: TerminalGpuRenderRecoveryAction;
  atlasEpoch: number;
  reason?: TerminalGpuRenderRecoveryReason;
}

export function createTerminalGpuRenderRecoveryController({
  clearTextureAtlas,
  config,
  now = () => Date.now(),
  onFallbackCpu,
  onRecovery,
  renderer,
  scheduler = browserRecoveryScheduler,
  terminal,
}: TerminalGpuRenderRecoveryControllerOptions): TerminalGpuRenderRecoveryController {
  let atlasClearFailureCount = 0;
  let atlasEpoch = 0;
  let disposed = false;
  let frameHandle: number | null = null;
  let lastAtlasClearAt: number | undefined;
  let lastRefreshAt: number | undefined;
  let pendingAction: TerminalGpuRenderRecoveryAction = "none";
  let pendingReason: TerminalGpuRenderRecoveryReason | undefined;
  let recoveryCount = 0;
  let recoveryWindowStartedAt: number | undefined;

  const clearFrame = () => {
    if (frameHandle === null) {
      return;
    }
    scheduler.cancelFrame(frameHandle);
    frameHandle = null;
  };

  const scheduleFlush = () => {
    if (disposed || frameHandle !== null || pendingAction === "none") {
      return;
    }
    frameHandle = scheduler.requestFrame(() => {
      frameHandle = null;
      flushPendingAction(now());
    });
  };

  const rememberRecovery = (timestamp: number) => {
    if (
      recoveryWindowStartedAt === undefined ||
      timestamp - recoveryWindowStartedAt > (config?.fallbackRecoveryWindowMs ?? 60_000)
    ) {
      recoveryWindowStartedAt = timestamp;
      recoveryCount = 0;
    }
    recoveryCount += 1;
  };

  const refreshTerminal = (timestamp: number) => {
    if (terminal.rows <= 0) {
      return;
    }
    terminal.refresh?.(0, terminal.rows - 1);
    lastRefreshAt = timestamp;
  };

  const flushPendingAction = (timestamp: number) => {
    const action = pendingAction;
    const reason = pendingReason;
    pendingAction = "none";
    pendingReason = undefined;

    if (disposed || action === "none") {
      return;
    }
    rememberRecovery(timestamp);
    if (action === "fallbackCpu") {
      onFallbackCpu?.(reason ?? "recovery-storm");
      onRecovery?.({ action, atlasEpoch, reason });
      return;
    }
    if (action === "clearAtlasAndRefresh") {
      try {
        (clearTextureAtlas ?? renderer.clearTextureAtlas)?.();
        atlasClearFailureCount = 0;
        atlasEpoch += 1;
        lastAtlasClearAt = timestamp;
      } catch {
        atlasClearFailureCount += 1;
        trigger("atlas-clear-failed", timestamp);
      }
    }
    refreshTerminal(timestamp);
    onRecovery?.({ action, atlasEpoch, reason });
  };

  const trigger = (
    triggerName: TerminalGpuRenderRecoveryTrigger,
    timestamp = now(),
  ) => {
    if (disposed) {
      return;
    }
    const state = renderer.getState();
    const decision = resolveTerminalGpuRenderRecovery({
      atlasClearFailureCount,
      backend: state.backend,
      config,
      lastAtlasClearAt,
      lastRefreshAt,
      now: timestamp,
      recoveryCount,
      recoveryWindowStartedAt,
      rendererType: state.mode,
      trigger: triggerName,
    });
    if (decision.action === "none") {
      return;
    }
    pendingAction = strongestTerminalGpuRenderRecoveryAction(
      pendingAction,
      decision.action,
    );
    pendingReason = decision.reason ?? pendingReason;
    scheduleFlush();
  };

  return {
    dispose() {
      disposed = true;
      clearFrame();
      pendingAction = "none";
      pendingReason = undefined;
    },
    trigger,
  };
}

const browserRecoveryScheduler: TerminalGpuRenderRecoveryScheduler = {
  cancelFrame(handle) {
    window.cancelAnimationFrame(handle);
  },
  requestFrame(callback) {
    return window.requestAnimationFrame(callback);
  },
};
