import type { IDisposable, ITerminalAddon } from "@xterm/xterm";
import type { TerminalRendererType } from "../settings/settingsModel";
import {
  createXtermWebglCompatibilityAdapter,
  VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
  type XtermWebglCompatibilityAdapter,
  type XtermWebglCompatibilityCapabilityGate,
} from "./terminalRendererCompatibility";
import {
  createTerminalRendererLifecycle,
  type TerminalRendererGenerationToken,
  type TerminalRendererLifecycleSnapshot,
  type TerminalRendererTransitionLedgerEntry,
} from "./terminalRendererLifecycle";
import {
  createTerminalRendererHealthController,
  type TerminalRendererHealthDecision,
  type TerminalRendererHealthObservation,
  type TerminalRendererHealthSnapshot,
} from "./terminalRendererHealth";
import {
  createTerminalRendererPerformanceTelemetry,
  type TerminalRendererPerformanceSnapshot,
  type TerminalRendererPerformanceTelemetry,
} from "./terminalRendererPerformanceTelemetry";
import type {
  TerminalRendererBackend,
  TerminalRendererFallbackReason,
} from "./terminalRendererPolicy";
import {
  detectTerminalGpuPlatform,
  shouldUseAutoGpuRenderer,
  type TerminalGpuPlatformClass,
} from "./terminalRendererPlatform";

export interface TerminalRendererState {
  backend: TerminalRendererBackend;
  canvasCount: number;
  fallbackReason?: TerminalRendererFallbackReason;
  mode: TerminalRendererType;
}

export interface TerminalRendererDiagnostics {
  activeTimerCount: number;
  circuitOpen: boolean;
  contextLossCount: number;
  gpuPlatformClass: TerminalGpuPlatformClass;
  health: TerminalRendererHealthSnapshot;
  lifecycle: TerminalRendererLifecycleSnapshot;
  retryCount: number;
  telemetry: TerminalRendererPerformanceSnapshot;
  transitions: readonly TerminalRendererTransitionLedgerEntry[];
}

export interface TerminalRendererTerminal {
  element?: HTMLElement | null;
  loadAddon(addon: ITerminalAddon): void;
  refresh?(start: number, end: number): void;
  rows: number;
}

export interface TerminalRendererLogger {
  warn(message: string, error?: unknown): void;
}

interface WebglAddonLike extends ITerminalAddon {
  clearTextureAtlas?: () => void;
  onAddTextureAtlasCanvas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  onChangeTextureAtlas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  onContextLoss: (listener: () => void) => IDisposable;
  onRemoveTextureAtlasCanvas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  textureAtlas?: HTMLCanvasElement;
}

type WebglAddonConstructor = new () => WebglAddonLike;
type TimerHandle = ReturnType<typeof window.setTimeout>;
type GpuOperationKind = "attach" | "recovery";

interface ActiveWebglRenderer {
  addon: WebglAddonLike;
  canvases: Set<HTMLCanvasElement>;
  disposables: IDisposable[];
  rendererCanvases: Set<HTMLCanvasElement>;
}

interface GpuOperation {
  attempt: number;
  kind: GpuOperationKind;
  startedAt: number;
  token: TerminalRendererGenerationToken;
}

export interface TerminalRendererController {
  attach(): void;
  /** 返回当前灰度配置是否允许发起 GPU attach。 */
  canAttemptGpu(): boolean;
  clearTextureAtlas(): void;
  dispose(): void;
  getDiagnostics(): TerminalRendererDiagnostics;
  /** 返回主 WebGL renderer canvas，不包含 texture atlas 等辅助 canvas。 */
  getTrackedRendererCanvases(): readonly HTMLCanvasElement[];
  getState(): TerminalRendererState;
  reportHealth(
    observation: Omit<TerminalRendererHealthObservation, "backend">,
  ): TerminalRendererHealthDecision;
  resume(): void;
  retryGpu(): void;
  suspend(): void;
  updateMode(mode: TerminalRendererType): void;
}

interface CreateTerminalRendererControllerOptions {
  attachTimeoutMs?: number;
  cancelRetry?: (handle: TimerHandle) => void;
  compatibilityAdapter?: XtermWebglCompatibilityAdapter;
  compatibilityGate?: XtermWebglCompatibilityCapabilityGate;
  contextLossCircuitThreshold?: number;
  contextLossWindowMs?: number;
  healthWatchdogEnabled?: boolean;
  gpuPlatformClass?: TerminalGpuPlatformClass;
  lifecycleV2Enabled?: boolean;
  loadWebglAddon?: () => Promise<{ WebglAddon: WebglAddonConstructor }>;
  logger?: TerminalRendererLogger;
  maxRecoveryAttempts?: number;
  maxRecoveryElapsedMs?: number;
  now?: () => number;
  onStateChange?: (state: TerminalRendererState) => void;
  shouldUseAutoGpu?: (platformClass: TerminalGpuPlatformClass) => boolean;
  paneId: string;
  random?: () => number;
  recoveryJitterRatio?: number;
  rendererType: TerminalRendererType;
  retryDelayMs?: number;
  retryDelaysMs?: readonly number[];
  scheduleRetry?: (callback: () => void, delayMs: number) => TimerHandle;
  telemetry?: TerminalRendererPerformanceTelemetry;
  terminal: TerminalRendererTerminal;
}

const DEFAULT_ATTACH_TIMEOUT_MS = 5_000;
const DEFAULT_CONTEXT_LOSS_WINDOW_MS = 30_000;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
const DEFAULT_MAX_RECOVERY_ELAPSED_MS = 30_000;
const DEFAULT_RECOVERY_RETRY_DELAYS_MS = [250, 1_000, 5_000] as const;
const DEFAULT_RECOVERY_JITTER_RATIO = 0.1;

/**
 * 创建 pane 级 renderer controller。
 *
 * xterm core、buffer 和 PTY 始终由调用方持有；本控制器只管理可替换的
 * WebGL addon，因此任何 GPU 故障都只能回退 CPU，不能销毁终端会话。
 */
export function createTerminalRendererController({
  attachTimeoutMs = DEFAULT_ATTACH_TIMEOUT_MS,
  cancelRetry = window.clearTimeout.bind(window),
  compatibilityAdapter,
  compatibilityGate,
  contextLossCircuitThreshold = DEFAULT_MAX_RECOVERY_ATTEMPTS,
  contextLossWindowMs = DEFAULT_CONTEXT_LOSS_WINDOW_MS,
  healthWatchdogEnabled = true,
  gpuPlatformClass,
  lifecycleV2Enabled = true,
  loadWebglAddon = defaultLoadWebglAddon,
  logger = console,
  maxRecoveryAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS,
  maxRecoveryElapsedMs = DEFAULT_MAX_RECOVERY_ELAPSED_MS,
  now = () => Date.now(),
  onStateChange,
  paneId,
  random = Math.random,
  recoveryJitterRatio = DEFAULT_RECOVERY_JITTER_RATIO,
  rendererType,
  retryDelayMs,
  retryDelaysMs = retryDelayMs === undefined
    ? DEFAULT_RECOVERY_RETRY_DELAYS_MS
    : [retryDelayMs],
  scheduleRetry = window.setTimeout.bind(window),
  shouldUseAutoGpu = shouldUseAutoGpuRenderer,
  telemetry = createTerminalRendererPerformanceTelemetry(),
  terminal,
}: CreateTerminalRendererControllerOptions): TerminalRendererController {
  validatePositiveDuration("attachTimeoutMs", attachTimeoutMs);
  validatePositiveInteger(
    "contextLossCircuitThreshold",
    contextLossCircuitThreshold,
  );
  validatePositiveDuration("contextLossWindowMs", contextLossWindowMs);
  validatePositiveInteger("maxRecoveryAttempts", maxRecoveryAttempts);
  validatePositiveDuration("maxRecoveryElapsedMs", maxRecoveryElapsedMs);
  validateRatio("recoveryJitterRatio", recoveryJitterRatio);

  const lifecycle = createTerminalRendererLifecycle({ now, paneId });
  const health = createTerminalRendererHealthController({
    l2CircuitThreshold: contextLossCircuitThreshold,
    l2FaultWindowMs: contextLossWindowMs,
  });
  const compat =
    compatibilityAdapter ??
    createXtermWebglCompatibilityAdapter({
      capabilityGate: compatibilityGate,
      logger,
      versions: VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
    });
  const resolvedRetryDelays = normalizeRetryDelays(retryDelaysMs);
  const resolvedGpuPlatformClass =
    gpuPlatformClass ?? detectTerminalGpuPlatform();
  const autoGpuAllowed = shouldUseAutoGpu(resolvedGpuPlatformClass);

  let activeWebgl: ActiveWebglRenderer | null = null;
  let attachTimeoutHandle: TimerHandle | null = null;
  let circuitOpen = false;
  let contextLossCount = 0;
  let contextLossWindowStartedAt: number | undefined;
  let disposed = false;
  let fallbackReason: TerminalRendererFallbackReason | undefined =
    rendererType === "auto" && !autoGpuAllowed ? "software-gpu" : undefined;
  let mode = rendererType;
  let recoveryStartedAt: number | undefined;
  let retryCount = 0;
  let retryHandle: TimerHandle | null = null;

  const state = (): TerminalRendererState => ({
    backend: activeWebgl ? "gpu" : "cpu",
    canvasCount: activeWebgl?.canvases.size ?? 0,
    fallbackReason,
    mode,
  });

  const syncTelemetryResources = () => {
    telemetry.setResources({
      activeCanvases: activeWebgl?.canvases.size ?? 0,
      activeContexts: activeWebgl ? 1 : 0,
      activeGpuPanes: activeWebgl ? 1 : 0,
    });
  };

  const emitStateChange = () => {
    syncTelemetryResources();
    onStateChange?.(state());
  };

  const clearAttachTimeout = () => {
    if (attachTimeoutHandle === null) {
      return;
    }
    cancelRetry(attachTimeoutHandle);
    attachTimeoutHandle = null;
  };

  const clearRetry = () => {
    if (retryHandle === null) {
      return;
    }
    cancelRetry(retryHandle);
    retryHandle = null;
  };

  const clearTimers = () => {
    clearAttachTimeout();
    clearRetry();
  };

  const recordStaleCommit = () => {
    telemetry.increment("staleCommitRejectedCount");
  };

  const canCommit = (token: TerminalRendererGenerationToken) => {
    const accepted = lifecycle.canCommitGeneration(token);
    if (!accepted) {
      recordStaleCommit();
    }
    return accepted;
  };

  const setFallbackReason = (reason: TerminalRendererFallbackReason) => {
    fallbackReason = reason;
    emitStateChange();
  };

  const disposeRendererResources = (
    renderer: ActiveWebglRenderer,
    options: { clearAtlas: boolean },
  ) => {
    for (const disposable of renderer.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        logger.warn("[kerminal-terminal-renderer] dispose event failed", error);
      }
    }
    if (options.clearAtlas) {
      try {
        renderer.addon.clearTextureAtlas?.();
      } catch (error) {
        logger.warn(
          "[kerminal-terminal-renderer] WebGL texture atlas cleanup failed",
          error,
        );
      }
    }
    compat.dispose({
      addon: renderer.addon,
      canvases: renderer.canvases,
    });
  };

  const disposeActiveWebgl = (options: { clearAtlas: boolean }) => {
    const active = activeWebgl;
    if (!active) {
      return;
    }
    activeWebgl = null;
    disposeRendererResources(active, options);
    telemetry.increment("rendererSwapCount");
    emitStateChange();
  };

  const disposeCandidate = (
    addon: WebglAddonLike,
    canvases: Set<HTMLCanvasElement>,
    disposables: IDisposable[],
  ) => {
    disposeRendererResources(
      { addon, canvases, disposables, rendererCanvases: new Set() },
      { clearAtlas: false },
    );
  };

  const transitionToCpuReady = (
    reason: "mode-cpu" | "operation-cancelled" | "hidden-reaped",
  ) => {
    const snapshot = lifecycle.getSnapshot();
    if (
      snapshot.state === "cpu-ready" ||
      snapshot.state === "disposing" ||
      snapshot.state === "disposed"
    ) {
      return;
    }
    lifecycle.transition({ reason, to: "cpu-ready" });
  };

  const finishFailedOperation = (
    operation: GpuOperation,
    reason: TerminalRendererFallbackReason,
    error: unknown,
  ) => {
    clearAttachTimeout();
    if (!canCommit(operation.token)) {
      return;
    }
    lifecycle.transition({
      attempt: operation.attempt,
      durationMs: Math.max(0, now() - operation.startedAt),
      fallbackReason: reason,
      reason:
        operation.kind === "recovery" ? "recovery-failed" : "gpu-attach-failed",
      to: "cpu-cooldown",
      token: operation.token,
    });
    setFallbackReason(reason);
    const message =
      reason === "import-failed"
        ? `[kerminal-terminal-renderer] WebGL renderer chunk failed in pane ${paneId}; using CPU renderer.`
        : operation.kind === "recovery"
          ? `[kerminal-terminal-renderer] WebGL recovery failed in pane ${paneId}; using CPU renderer.`
          : `[kerminal-terminal-renderer] WebGL renderer unavailable in pane ${paneId}; using CPU renderer.`;
    logger.warn(message, error);
  };

  const recoveryElapsed = () =>
    recoveryStartedAt === undefined
      ? 0
      : Math.max(0, now() - recoveryStartedAt);

  const canRetryRecovery = (nextAttempt: number) =>
    !disposed &&
    !circuitOpen &&
    shouldAttemptGpuRenderer(mode) &&
    nextAttempt <= maxRecoveryAttempts &&
    recoveryElapsed() <= maxRecoveryElapsedMs;

  const openCircuit = (
    operation: GpuOperation | undefined,
    reason: TerminalRendererFallbackReason,
  ) => {
    circuitOpen = true;
    clearTimers();
    if (operation && lifecycle.canCommitGeneration(operation.token)) {
      lifecycle.transition({
        attempt: operation.attempt,
        durationMs: Math.max(0, now() - operation.startedAt),
        fallbackReason: reason,
        reason:
          operation.kind === "recovery"
            ? "recovery-failed"
            : "gpu-attach-failed",
        to: "cpu-cooldown",
        token: operation.token,
      });
    } else {
      transitionToCpuReady("operation-cancelled");
    }
    setFallbackReason(reason);
  };

  let runGpuOperation: (operation: GpuOperation) => void;

  const scheduleRecoveryAttempt = (
    operation: GpuOperation | undefined,
    attempt: number,
  ) => {
    if (!canRetryRecovery(attempt)) {
      openCircuit(operation, "retry-exhausted");
      return;
    }
    clearRetry();
    retryCount = attempt;
    const baseDelay =
      resolvedRetryDelays[
        Math.min(attempt - 1, resolvedRetryDelays.length - 1)
      ] ?? 0;
    const delayMs = jitterDelay(baseDelay, recoveryJitterRatio, random);
    retryHandle = scheduleRetry(() => {
      retryHandle = null;
      if (
        disposed ||
        circuitOpen ||
        !shouldAttemptGpuRenderer(mode) ||
        lifecycle.getSnapshot().state === "suspended"
      ) {
        return;
      }

      if (operation && lifecycle.canCommitGeneration(operation.token)) {
        runGpuOperation(operation);
        return;
      }

      const result = lifecycle.transition({
        attempt,
        reason: "request-gpu",
        to: "gpu-attaching",
      });
      if (!result.accepted || !result.generationToken) {
        return;
      }
      runGpuOperation({
        attempt,
        kind: "recovery",
        startedAt: now(),
        token: result.generationToken,
      });
    }, delayMs);
    emitStateChange();
  };

  const handleOperationFailure = (
    operation: GpuOperation,
    reason: TerminalRendererFallbackReason,
    error: unknown,
  ) => {
    finishFailedOperation(operation, reason, error);
    if (
      operation.kind !== "recovery" ||
      disposed ||
      !shouldAttemptGpuRenderer(mode)
    ) {
      return;
    }
    const nextAttempt = operation.attempt + 1;
    if (!canRetryRecovery(nextAttempt)) {
      openCircuit(undefined, "retry-exhausted");
      return;
    }
    scheduleRecoveryAttempt(undefined, nextAttempt);
  };

  const handleContextLoss = (addon: WebglAddonLike) => {
    if (!activeWebgl || activeWebgl.addon !== addon || disposed) {
      return;
    }
    const timestamp = now();
    if (
      contextLossWindowStartedAt === undefined ||
      timestamp - contextLossWindowStartedAt > contextLossWindowMs
    ) {
      contextLossWindowStartedAt = timestamp;
      contextLossCount = 0;
    }
    contextLossCount += 1;
    fallbackReason = "context-lost";
    logger.warn(
      `[kerminal-terminal-renderer] WebGL context lost in pane ${paneId}; falling back to CPU renderer.`,
    );

    const lifecycleState = lifecycle.getSnapshot().state;
    if (lifecycleState === "suspended") {
      transitionToCpuReady("hidden-reaped");
      disposeActiveWebgl({ clearAtlas: false });
      refreshTerminal(terminal, telemetry);
      return;
    }

    const transition = lifecycle.transition({
      attempt: 1,
      fallbackReason: "context-lost",
      reason: "gpu-fault",
      to: "recovering",
    });
    disposeActiveWebgl({ clearAtlas: false });
    refreshTerminal(terminal, telemetry);

    if (!transition.accepted || !transition.generationToken) {
      return;
    }
    const operation: GpuOperation = {
      attempt: 1,
      kind: "recovery",
      startedAt: timestamp,
      token: transition.generationToken,
    };
    recoveryStartedAt = timestamp;
    if (
      contextLossCount >= contextLossCircuitThreshold ||
      !shouldAttemptGpuRenderer(mode)
    ) {
      openCircuit(operation, "recovery-storm");
      return;
    }
    scheduleRecoveryAttempt(operation, 1);
  };

  const beginControlledRecovery = (
    fallback: TerminalRendererFallbackReason,
    openHealthCircuit: boolean,
  ) => {
    if (!activeWebgl || lifecycle.getSnapshot().state !== "gpu-ready") {
      return;
    }
    const timestamp = now();
    const transition = lifecycle.transition({
      attempt: 1,
      fallbackReason: fallback,
      reason: "gpu-fault",
      to: "recovering",
    });
    if (!transition.accepted || !transition.generationToken) {
      return;
    }
    const operation: GpuOperation = {
      attempt: 1,
      kind: "recovery",
      startedAt: timestamp,
      token: transition.generationToken,
    };
    fallbackReason = fallback;
    recoveryStartedAt = timestamp;
    disposeActiveWebgl({ clearAtlas: false });
    refreshTerminal(terminal, telemetry);
    if (openHealthCircuit) {
      openCircuit(operation, "recovery-storm");
      return;
    }
    scheduleRecoveryAttempt(operation, 1);
  };

  runGpuOperation = (operation) => {
    if (!canCommit(operation.token) || disposed) {
      return;
    }
    const element = terminal.element;
    if (!element || !shouldAttemptGpuRenderer(mode)) {
      transitionToCpuReady("operation-cancelled");
      return;
    }

    clearAttachTimeout();
    attachTimeoutHandle = scheduleRetry(() => {
      attachTimeoutHandle = null;
      if (!canCommit(operation.token)) {
        return;
      }
      handleOperationFailure(
        operation,
        "retry-exhausted",
        new Error(`WebGL attach timed out after ${attachTimeoutMs}ms`),
      );
    }, attachTimeoutMs);

    void loadWebglAddon()
      .then(({ WebglAddon }) => {
        if (!canCommit(operation.token) || disposed) {
          clearAttachTimeout();
          return;
        }

        let addon: WebglAddonLike;
        try {
          addon = new WebglAddon();
        } catch (error) {
          handleOperationFailure(operation, "load-failed", error);
          return;
        }

        const canvases = new Set<HTMLCanvasElement>();
        const rendererCanvases = new Set<HTMLCanvasElement>();
        const textureAtlasCanvases = new Set<HTMLCanvasElement>();
        const disposables: IDisposable[] = [];
        const before = new Set(
          element.querySelectorAll<HTMLCanvasElement>("canvas"),
        );
        const trackTextureAtlasCanvas = (canvas: HTMLCanvasElement) => {
          textureAtlasCanvases.add(canvas);
          rendererCanvases.delete(canvas);
          canvases.add(canvas);
          emitStateChange();
        };
        try {
          disposables.push(addon.onContextLoss(() => handleContextLoss(addon)));
          if (addon.onAddTextureAtlasCanvas) {
            disposables.push(
              addon.onAddTextureAtlasCanvas(trackTextureAtlasCanvas),
            );
          }
          if (addon.onChangeTextureAtlas) {
            disposables.push(
              addon.onChangeTextureAtlas(trackTextureAtlasCanvas),
            );
          }
          if (addon.onRemoveTextureAtlasCanvas) {
            disposables.push(
              addon.onRemoveTextureAtlasCanvas((canvas) => {
                textureAtlasCanvases.delete(canvas);
                rendererCanvases.delete(canvas);
                canvases.delete(canvas);
                emitStateChange();
              }),
            );
          }
          terminal.loadAddon(addon);
        } catch (error) {
          disposeCandidate(addon, canvases, disposables);
          handleOperationFailure(operation, "load-failed", error);
          return;
        }

        for (const canvas of element.querySelectorAll<HTMLCanvasElement>(
          "canvas",
        )) {
          if (!before.has(canvas)) {
            canvases.add(canvas);
            if (!textureAtlasCanvases.has(canvas)) {
              rendererCanvases.add(canvas);
            }
          }
        }
        if (addon.textureAtlas) {
          trackTextureAtlasCanvas(addon.textureAtlas);
        }

        clearAttachTimeout();
        if (!canCommit(operation.token) || disposed) {
          disposeCandidate(addon, canvases, disposables);
          return;
        }

        const transition = lifecycle.transition({
          attempt: operation.attempt,
          durationMs: Math.max(0, now() - operation.startedAt),
          reason:
            operation.kind === "recovery"
              ? "recovery-succeeded"
              : "gpu-attached",
          to: "gpu-ready",
          token: operation.token,
        });
        if (!transition.accepted) {
          recordStaleCommit();
          disposeCandidate(addon, canvases, disposables);
          return;
        }

        activeWebgl = { addon, canvases, disposables, rendererCanvases };
        fallbackReason = undefined;
        recoveryStartedAt = undefined;
        retryCount = 0;
        telemetry.increment("rendererRebuildCount");
        emitStateChange();
      })
      .catch((error: unknown) => {
        if (!canCommit(operation.token) || disposed) {
          clearAttachTimeout();
          return;
        }
        handleOperationFailure(operation, "import-failed", error);
      });
  };

  const beginAttach = (
    reason: "manual-retry" | "request-gpu",
    kind: GpuOperationKind,
    attempt: number,
  ) => {
    if (
      disposed ||
      activeWebgl ||
      !lifecycleV2Enabled ||
      !shouldAttemptGpuRenderer(mode) ||
      lifecycle.getSnapshot().state === "suspended"
    ) {
      return;
    }
    if (circuitOpen && reason !== "manual-retry") {
      return;
    }
    const element = terminal.element;
    if (!element) {
      return;
    }
    clearRetry();
    const result = lifecycle.transition({
      attempt,
      reason,
      to: "gpu-attaching",
    });
    if (!result.accepted || !result.generationToken) {
      return;
    }
    runGpuOperation({
      attempt,
      kind,
      startedAt: now(),
      token: result.generationToken,
    });
  };

  const attach = () => {
    if (mode === "auto" && !autoGpuAllowed) {
      return;
    }
    beginAttach("request-gpu", "attach", 1);
  };

  const updateMode = (nextMode: TerminalRendererType) => {
    if (mode === nextMode) {
      return;
    }
    mode = nextMode;
    clearTimers();
    if (mode === "auto" && !autoGpuAllowed) {
      fallbackReason = "software-gpu";
      circuitOpen = false;
      recoveryStartedAt = undefined;
      retryCount = 0;
      transitionToCpuReady("operation-cancelled");
      disposeActiveWebgl({ clearAtlas: true });
      refreshTerminal(terminal, telemetry);
      emitStateChange();
      return;
    }
    if (!shouldAttemptGpuRenderer(mode)) {
      fallbackReason = undefined;
      circuitOpen = false;
      recoveryStartedAt = undefined;
      retryCount = 0;
      transitionToCpuReady("mode-cpu");
      disposeActiveWebgl({ clearAtlas: true });
      refreshTerminal(terminal, telemetry);
      emitStateChange();
      return;
    }
    fallbackReason = undefined;
    emitStateChange();
    attach();
  };

  const clearTextureAtlas = () => {
    const active = activeWebgl;
    if (!active) {
      return;
    }
    try {
      active.addon.clearTextureAtlas?.();
      telemetry.increment("atlasClearCount");
      refreshTerminal(terminal, telemetry);
    } catch (error) {
      logger.warn(
        "[kerminal-terminal-renderer] WebGL texture atlas clear failed",
        error,
      );
      emitStateChange();
      throw error;
    }
    emitStateChange();
  };

  const reportHealth = (
    observation: Omit<TerminalRendererHealthObservation, "backend">,
  ) => {
    const healthDecision = health.observe({
      ...observation,
      backend:
        healthWatchdogEnabled && lifecycleV2Enabled && activeWebgl
          ? "gpu"
          : "cpu",
    });
    switch (healthDecision.action) {
      case "refresh":
        refreshTerminal(terminal, telemetry);
        break;
      case "clear-atlas-and-refresh":
        try {
          clearTextureAtlas();
        } catch {
          beginControlledRecovery("atlas-clear-failed", false);
        }
        break;
      case "rebuild-renderer":
        beginControlledRecovery(
          healthDecision.reason === "context-lost"
            ? "context-lost"
            : healthDecision.reason === "atlas-operation-failed"
              ? "atlas-clear-failed"
              : "retry-exhausted",
          false,
        );
        break;
      case "fallback-cpu":
        beginControlledRecovery("recovery-storm", true);
        break;
      case "none":
      case "wait-for-stable-surface":
        break;
    }
    return healthDecision;
  };

  const suspend = () => {
    if (disposed || lifecycle.getSnapshot().state !== "gpu-ready") {
      return;
    }
    lifecycle.transition({ reason: "suspend", to: "suspended" });
    clearTimers();
    emitStateChange();
  };

  const resume = () => {
    if (disposed || lifecycle.getSnapshot().state !== "suspended") {
      return;
    }
    lifecycle.transition({ reason: "resume", to: "gpu-ready" });
    emitStateChange();
  };

  const retryGpu = () => {
    if (
      disposed ||
      activeWebgl ||
      !shouldAttemptGpuRenderer(mode) ||
      (mode === "auto" && !autoGpuAllowed)
    ) {
      return;
    }
    clearTimers();
    circuitOpen = false;
    contextLossCount = 0;
    contextLossWindowStartedAt = undefined;
    health.resetCircuit();
    recoveryStartedAt = now();
    retryCount = 0;
    transitionToCpuReady("operation-cancelled");
    beginAttach("manual-retry", "recovery", 1);
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimers();
    lifecycle.dispose();
    disposeActiveWebgl({ clearAtlas: true });
    emitStateChange();
  };

  const getDiagnostics = (): TerminalRendererDiagnostics => ({
    activeTimerCount:
      Number(attachTimeoutHandle !== null) + Number(retryHandle !== null),
    circuitOpen,
    contextLossCount,
    gpuPlatformClass: resolvedGpuPlatformClass,
    health: health.getSnapshot(),
    lifecycle: lifecycle.getSnapshot(),
    retryCount,
    telemetry: telemetry.snapshot(),
    transitions: lifecycle.getLedger(),
  });

  return {
    attach,
    canAttemptGpu: () =>
      lifecycleV2Enabled && (mode !== "auto" || autoGpuAllowed),
    clearTextureAtlas,
    dispose,
    getDiagnostics,
    getTrackedRendererCanvases: () =>
      activeWebgl ? [...activeWebgl.rendererCanvases] : [],
    getState: state,
    reportHealth,
    resume,
    retryGpu,
    suspend,
    updateMode,
  };
}

export function shouldAttemptGpuRenderer(mode: TerminalRendererType): boolean {
  return mode === "auto" || mode === "gpu";
}

async function defaultLoadWebglAddon() {
  return import("@xterm/addon-webgl");
}

function refreshTerminal(
  terminal: TerminalRendererTerminal,
  telemetry: TerminalRendererPerformanceTelemetry,
) {
  if (terminal.rows <= 0) {
    return;
  }
  try {
    terminal.refresh?.(0, terminal.rows - 1);
    telemetry.increment("fullRefreshCount");
  } catch {
    // CPU fallback 必须继续完成，refresh 失败不能破坏 renderer 状态。
  }
}

function normalizeRetryDelays(delays: readonly number[]) {
  if (delays.length === 0) {
    return [0];
  }
  return delays.map((delay, index) => {
    if (!Number.isFinite(delay) || delay < 0) {
      throw new RangeError(`retryDelaysMs[${index}] must be non-negative`);
    }
    return delay;
  });
}

function jitterDelay(baseDelay: number, ratio: number, random: () => number) {
  if (baseDelay === 0 || ratio === 0) {
    return baseDelay;
  }
  const normalizedRandom = Math.min(1, Math.max(0, random()));
  return Math.max(
    0,
    Math.round(baseDelay * (1 + (normalizedRandom * 2 - 1) * ratio)),
  );
}

function validatePositiveDuration(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function validatePositiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function validateRatio(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}
