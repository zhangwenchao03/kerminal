import type { TerminalRendererType } from "../settings/contracts/index";
import type { TerminalRendererDiagnostics } from "./terminalRenderer";
import {
  TERMINAL_RENDERER_DEFAULT_POLICY,
  resolveTerminalRendererPolicy,
  type TerminalRendererBackend,
  type TerminalRendererFailureEvent,
  type TerminalRendererFallbackReason,
  type TerminalRendererPanePolicyDecision,
  type TerminalRendererPolicyConfig,
} from "./terminalRendererPolicy";

export interface TerminalRendererControllerState {
  backend: TerminalRendererBackend;
  canvasCount?: number;
  fallbackReason?: TerminalRendererFallbackReason | string;
  mode: TerminalRendererType;
}

export interface TerminalRendererRegistryController {
  attach(): void;
  canAttemptGpu?(): boolean;
  clearTextureAtlas?(): void;
  dispose(): void;
  getDiagnostics?(): TerminalRendererDiagnostics;
  getState(): TerminalRendererControllerState;
  retryGpu?(): void;
  /** 从 CPU 切换到 auto/gpu 时负责启动一次 attach。 */
  updateMode(mode: TerminalRendererType): void;
}

interface RegisterTerminalRendererPaneOptions {
  controller: TerminalRendererRegistryController;
  focused?: boolean;
  paneId: string;
  visible?: boolean;
}

export interface TerminalRendererRegistrySnapshot {
  activeControllers: number;
  atlasEpoch: number;
  effectiveGpuPanes: number;
  hiddenControllers: number;
  lastRecoveryAt?: number;
  panes: TerminalRendererPaneSnapshot[];
  recoveryCount: number;
  requestedMode: TerminalRendererType;
  suggestedFallback?: "cpu";
  webglCanvasCount: number;
}

interface TerminalRendererPaneSnapshot {
  backend: TerminalRendererBackend;
  canvasCount: number;
  circuitOpen?: boolean;
  contextLossCount?: number;
  failureCount: number;
  fallbackReason?: string;
  focused: boolean;
  /** attach 尚未提交时为 true，用于诊断重复 attach 风险。 */
  gpuAttachPending?: boolean;
  gpuPlatformClass?: TerminalRendererDiagnostics["gpuPlatformClass"];
  /** 当前 GPU lease 的授予时间；CPU 非 owner 不携带该值。 */
  gpuOwnerSince?: number;
  lastAttachAt?: number;
  lastContextLossAt?: number;
  lastRecoveryAt?: number;
  lifecycleGeneration?: number;
  lifecycleState?: string;
  paneId: string;
  recoveryCount: number;
  rendererActiveTimerCount?: number;
  rendererRetryCount?: number;
  staleCommitRejectedCount?: number;
  visible: boolean;
}

export interface TerminalRendererRegistry {
  clearTextureAtlas(paneId?: string): void;
  dispose(): void;
  getSnapshot(): TerminalRendererRegistrySnapshot;
  recordPaneFailure(
    paneId: string,
    reason: TerminalRendererFallbackReason,
  ): void;
  registerPane(options: RegisterTerminalRendererPaneOptions): () => void;
  reconcile(): void;
  retryGpu(paneId?: string): void;
  subscribe(listener: () => void): () => void;
  updateMode(mode: TerminalRendererType): void;
  updatePaneFocus(paneId: string, focused: boolean): void;
  updatePaneState(paneId: string, state: TerminalRendererControllerState): void;
  updatePaneVisibility(paneId: string, visible: boolean): void;
}

export interface CreateTerminalRendererRegistryOptions {
  cancelTimer?: (handle: TimerHandle) => void;
  config?: Partial<TerminalRendererPolicyConfig>;
  now?: () => number;
  rendererType: TerminalRendererType;
  scheduleTimer?: (callback: () => void, delayMs: number) => TimerHandle;
}

type TimerHandle = ReturnType<typeof setTimeout>;

interface RegisteredRendererPane {
  controller: TerminalRendererRegistryController;
  currentBackend: TerminalRendererBackend;
  failureCount: number;
  fallbackReason?: string;
  focused: boolean;
  gpuAttachPending: boolean;
  gpuOwnerSince?: number;
  hiddenSince?: number;
  lastAttachAt?: number;
  lastContextLossAt?: number;
  lastFailureAt?: number;
  lastFailureReason?: TerminalRendererFallbackReason;
  lastRecoveryAt?: number;
  lastUsedAt: number;
  paneId: string;
  recoveryCount: number;
  reaperTimer?: TimerHandle;
  retryCount: number;
  visible: boolean;
}

export function createTerminalRendererRegistry({
  cancelTimer = clearTimeout,
  config = {},
  now = () => Date.now(),
  rendererType,
  scheduleTimer = setTimeout,
}: CreateTerminalRendererRegistryOptions): TerminalRendererRegistry {
  const resolvedConfig = { ...TERMINAL_RENDERER_DEFAULT_POLICY, ...config };
  const panes = new Map<string, RegisteredRendererPane>();
  const failureEvents: TerminalRendererFailureEvent[] = [];
  const listeners = new Set<() => void>();
  let atlasEpoch = 0;
  let cachedSnapshot: TerminalRendererRegistrySnapshot | null = null;
  let lastRecoveryAt: number | undefined;
  let recoveryCount = 0;
  let requestedMode = rendererType;
  let suggestedFallback: "cpu" | undefined;
  let disposed = false;

  const emitChange = () => {
    cachedSnapshot = null;
    for (const listener of listeners) {
      listener();
    }
  };

  const cancelReaper = (pane: RegisteredRendererPane) => {
    if (!pane.reaperTimer) {
      return;
    }
    cancelTimer(pane.reaperTimer);
    pane.reaperTimer = undefined;
  };

  /** 释放 pane 的 GPU lease；失败、CPU 决策和隐藏回收可越过驻留稳定性。 */
  const releaseGpuOwner = (pane: RegisteredRendererPane) => {
    pane.gpuAttachPending = false;
    pane.gpuOwnerSince = undefined;
  };

  const scheduleHiddenReaper = (pane: RegisteredRendererPane) => {
    cancelReaper(pane);
    if (pane.visible || pane.currentBackend !== "gpu") {
      return;
    }
    const hiddenSince = pane.hiddenSince ?? now();
    const delayMs = Math.max(
      0,
      hiddenSince + resolvedConfig.webglReapGraceMs - now(),
    );
    pane.reaperTimer = scheduleTimer(() => {
      pane.reaperTimer = undefined;
      reconcile();
    }, delayMs);
  };

  const syncPaneState = (
    pane: RegisteredRendererPane,
    state = pane.controller.getState(),
  ) => {
    const previousBackend = pane.currentBackend;
    pane.currentBackend = state.backend;
    if (state.fallbackReason !== undefined || state.backend === "gpu") {
      pane.fallbackReason = state.fallbackReason;
    }
    if (state.backend === "gpu") {
      const attachedAt = now();
      pane.gpuAttachPending = false;
      pane.gpuOwnerSince ??= attachedAt;
      if (previousBackend !== "gpu") {
        pane.lastAttachAt = attachedAt;
      }
      pane.retryCount = 0;
    } else if (state.mode === "cpu" || state.fallbackReason !== undefined) {
      releaseGpuOwner(pane);
    }
  };

  const applyDecision = (
    pane: RegisteredRendererPane,
    decision: TerminalRendererPanePolicyDecision,
  ) => {
    if (decision.targetBackend === "cpu") {
      releaseGpuOwner(pane);
      pane.controller.updateMode("cpu");
      if (decision.shouldReapWebgl) {
        cancelReaper(pane);
      }
      syncPaneState(pane);
      return;
    }

    if (pane.visible) {
      const targetMode = requestedMode === "cpu" ? "cpu" : requestedMode;
      const controllerState = pane.controller.getState();
      const modeChanged = controllerState.mode !== targetMode;
      const shouldStartAttach =
        pane.currentBackend !== "gpu" &&
        !pane.gpuAttachPending &&
        (decision.shouldAttemptImport || modeChanged);
      pane.gpuOwnerSince ??= now();
      if (shouldStartAttach) {
        // 先占用 lease，再启动异步 attach；同步状态回调也不会重复发起。
        pane.gpuAttachPending = true;
      }
      if (modeChanged) {
        // capability 依赖 controller 的当前模式；先提交显式 GPU 模式，
        // 避免软件平台仍按旧 Auto 状态拒绝用户主动尝试。
        pane.controller.updateMode(targetMode);
      }
      if (pane.controller.canAttemptGpu?.() === false) {
        releaseGpuOwner(pane);
        pane.gpuAttachPending = false;
        syncPaneState(pane);
        return;
      }
      if (!modeChanged && shouldStartAttach) {
        pane.controller.attach();
      }
      syncPaneState(pane);
      scheduleHiddenReaper(pane);
    }
  };

  const reconcile = () => {
    if (disposed) {
      return;
    }
    const policy = resolveTerminalRendererPolicy({
      config: resolvedConfig,
      failureEvents,
      now: now(),
      panes: [...panes.values()].map((pane) => {
        const diagnostics = pane.controller.getDiagnostics?.();
        return {
          currentBackend: pane.currentBackend,
          failureCount: pane.failureCount,
          focused: pane.focused,
          gpuAttachPending: pane.gpuAttachPending,
          gpuPlatformClass: diagnostics?.gpuPlatformClass,
          gpuOwnerSince: pane.gpuOwnerSince,
          hiddenSince: pane.hiddenSince,
          lastFailureAt: pane.lastFailureAt,
          lastFailureReason: pane.lastFailureReason,
          lastUsedAt: pane.lastUsedAt,
          paneId: pane.paneId,
          retryCount: pane.retryCount,
          visible: pane.visible,
        };
      }),
      requestedMode,
      suggestedFallback,
    });
    suggestedFallback = policy.suggestedFallback;
    for (const decision of policy.decisions) {
      const pane = panes.get(decision.paneId);
      if (!pane) {
        continue;
      }
      applyDecision(pane, decision);
    }
    emitChange();
  };

  const registerPane = ({
    controller,
    focused = false,
    paneId,
    visible = true,
  }: RegisterTerminalRendererPaneOptions) => {
    if (disposed) {
      controller.dispose();
      return () => undefined;
    }
    const registeredAt = now();
    const state = controller.getState();
    const pane: RegisteredRendererPane = {
      controller,
      currentBackend: state.backend,
      failureCount: 0,
      fallbackReason: state.fallbackReason,
      focused,
      gpuAttachPending: false,
      gpuOwnerSince: state.backend === "gpu" ? registeredAt : undefined,
      hiddenSince: visible ? undefined : registeredAt,
      lastUsedAt: focused || visible ? registeredAt : 0,
      paneId,
      recoveryCount: 0,
      retryCount: 0,
      visible,
    };
    panes.set(paneId, pane);
    scheduleHiddenReaper(pane);
    reconcile();

    return () => {
      const current = panes.get(paneId);
      if (!current || current.controller !== controller) {
        return;
      }
      cancelReaper(current);
      panes.delete(paneId);
      controller.dispose();
      reconcile();
    };
  };

  const updateMode = (mode: TerminalRendererType) => {
    if (requestedMode === mode) {
      return;
    }
    requestedMode = mode;
    suggestedFallback = undefined;
    failureEvents.length = 0;
    for (const pane of panes.values()) {
      pane.failureCount = 0;
      pane.fallbackReason = undefined;
      pane.lastFailureAt = undefined;
      pane.lastFailureReason = undefined;
      pane.retryCount = 0;
    }
    reconcile();
  };

  const updatePaneState = (
    paneId: string,
    state: TerminalRendererControllerState,
  ) => {
    const pane = panes.get(paneId);
    if (!pane) {
      return;
    }
    syncPaneState(pane, state);
    emitChange();
  };

  const updatePaneVisibility = (paneId: string, visible: boolean) => {
    const pane = panes.get(paneId);
    if (!pane || pane.visible === visible) {
      return;
    }
    pane.visible = visible;
    if (visible) {
      pane.hiddenSince = undefined;
      pane.lastUsedAt = now();
      cancelReaper(pane);
    } else {
      pane.hiddenSince = now();
      scheduleHiddenReaper(pane);
    }
    reconcile();
  };

  const updatePaneFocus = (paneId: string, focused: boolean) => {
    const pane = panes.get(paneId);
    if (!pane || pane.focused === focused) {
      return;
    }
    pane.focused = focused;
    if (focused) {
      pane.lastUsedAt = now();
    }
    reconcile();
  };

  const recordPaneFailure = (
    paneId: string,
    reason: TerminalRendererFallbackReason,
  ) => {
    const pane = panes.get(paneId);
    if (!pane) {
      return;
    }
    const event: TerminalRendererFailureEvent = { at: now(), reason };
    failureEvents.push(event);
    pane.failureCount += 1;
    pane.fallbackReason = reason;
    pane.lastFailureAt = event.at;
    pane.lastFailureReason = reason;
    releaseGpuOwner(pane);
    if (reason === "context-lost") {
      pane.lastContextLossAt = event.at;
      pane.retryCount += 1;
    }
    reconcile();
  };

  const recordPaneFailureEvent = (
    pane: RegisteredRendererPane,
    reason: TerminalRendererFallbackReason,
    at: number,
  ) => {
    failureEvents.push({ at, reason });
    pane.failureCount += 1;
    pane.fallbackReason = reason;
    pane.lastFailureAt = at;
    pane.lastFailureReason = reason;
    releaseGpuOwner(pane);
    if (reason === "context-lost") {
      pane.lastContextLossAt = at;
      pane.retryCount += 1;
    }
  };

  const retryGpu = (paneId?: string) => {
    if (requestedMode === "cpu") {
      return;
    }
    const targets =
      typeof paneId === "string"
        ? [...panes.values()].filter((pane) => pane.paneId === paneId)
        : [...panes.values()];
    if (targets.length === 0) {
      return;
    }
    // 人工恢复明确覆盖自动 cooldown/global fallback，但只重置目标 pane 的局部故障账本。
    suggestedFallback = undefined;
    failureEvents.length = 0;
    for (const pane of targets) {
      if (pane.controller.canAttemptGpu?.() === false) {
        continue;
      }
      pane.failureCount = 0;
      pane.fallbackReason = undefined;
      pane.gpuAttachPending = true;
      pane.lastFailureAt = undefined;
      pane.lastFailureReason = undefined;
      pane.retryCount = 0;
      const state = pane.controller.getState();
      if (state.mode !== requestedMode) {
        pane.controller.updateMode(requestedMode);
      } else if (pane.controller.retryGpu) {
        pane.controller.retryGpu();
      } else {
        // 兼容尚未实现专用 retry API 的 controller，避免留下永久 pending lease。
        pane.controller.attach();
      }
      syncPaneState(pane);
    }
    reconcile();
  };

  const clearTextureAtlas = (paneId?: string) => {
    const targets =
      typeof paneId === "string"
        ? [...panes.values()].filter(
            (pane) => pane.paneId === paneId && pane.currentBackend === "gpu",
          )
        : [...panes.values()].filter((pane) => pane.currentBackend === "gpu");
    if (targets.length === 0) {
      return;
    }
    const recoveredAt = now();
    let clearedCount = 0;
    let firstError: unknown;
    for (const pane of targets) {
      try {
        pane.controller.clearTextureAtlas?.();
      } catch (error) {
        firstError ??= error;
        recordPaneFailureEvent(pane, "atlas-clear-failed", recoveredAt);
        continue;
      }
      pane.lastRecoveryAt = recoveredAt;
      pane.recoveryCount += 1;
      clearedCount += 1;
    }
    if (clearedCount > 0) {
      atlasEpoch += 1;
      lastRecoveryAt = recoveredAt;
      recoveryCount += 1;
    }
    if (firstError) {
      reconcile();
      throw firstError;
    }
    emitChange();
  };

  const getSnapshot = (): TerminalRendererRegistrySnapshot => {
    if (cachedSnapshot) {
      return cachedSnapshot;
    }
    const paneSnapshots = [...panes.values()].map((pane) => {
      const state = pane.controller.getState();
      const diagnostics = pane.controller.getDiagnostics?.();
      return {
        backend: state.backend,
        canvasCount: state.canvasCount ?? 0,
        circuitOpen: diagnostics?.circuitOpen,
        contextLossCount: diagnostics?.contextLossCount,
        failureCount: pane.failureCount,
        fallbackReason: pane.fallbackReason ?? state.fallbackReason,
        focused: pane.focused,
        gpuAttachPending: pane.gpuAttachPending,
        gpuPlatformClass: diagnostics?.gpuPlatformClass,
        gpuOwnerSince: pane.gpuOwnerSince,
        lastAttachAt: pane.lastAttachAt,
        lastContextLossAt: pane.lastContextLossAt,
        lastRecoveryAt: pane.lastRecoveryAt,
        lifecycleGeneration: diagnostics?.lifecycle.generation,
        lifecycleState: diagnostics?.lifecycle.state,
        paneId: pane.paneId,
        recoveryCount: pane.recoveryCount,
        rendererActiveTimerCount: diagnostics?.activeTimerCount,
        rendererRetryCount: diagnostics?.retryCount,
        staleCommitRejectedCount:
          diagnostics?.telemetry.counters.staleCommitRejectedCount,
        visible: pane.visible,
      };
    });
    cachedSnapshot = {
      activeControllers: panes.size,
      atlasEpoch,
      effectiveGpuPanes: paneSnapshots.filter((pane) => pane.backend === "gpu")
        .length,
      hiddenControllers: paneSnapshots.filter((pane) => !pane.visible).length,
      lastRecoveryAt,
      panes: paneSnapshots,
      recoveryCount,
      requestedMode,
      suggestedFallback,
      webglCanvasCount: paneSnapshots.reduce(
        (sum, pane) => sum + pane.canvasCount,
        0,
      ),
    };
    return cachedSnapshot;
  };

  const dispose = () => {
    disposed = true;
    for (const pane of panes.values()) {
      cancelReaper(pane);
      pane.controller.dispose();
    }
    panes.clear();
    emitChange();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    clearTextureAtlas,
    dispose,
    getSnapshot,
    recordPaneFailure,
    registerPane,
    reconcile,
    retryGpu,
    subscribe,
    updateMode,
    updatePaneFocus,
    updatePaneState,
    updatePaneVisibility,
  };
}

export const terminalRendererRegistry = createTerminalRendererRegistry({
  rendererType: "cpu",
});
