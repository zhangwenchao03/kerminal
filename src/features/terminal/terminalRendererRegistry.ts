import type { TerminalRendererType } from "../settings/settingsModel";
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
  clearTextureAtlas?(): void;
  dispose(): void;
  getState(): TerminalRendererControllerState;
  updateMode(mode: TerminalRendererType): void;
}

export interface RegisterTerminalRendererPaneOptions {
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

export interface TerminalRendererPaneSnapshot {
  backend: TerminalRendererBackend;
  canvasCount: number;
  failureCount: number;
  fallbackReason?: string;
  focused: boolean;
  lastAttachAt?: number;
  lastContextLossAt?: number;
  lastRecoveryAt?: number;
  paneId: string;
  recoveryCount: number;
  visible: boolean;
}

export interface TerminalRendererRegistry {
  clearTextureAtlas(paneId?: string): void;
  dispose(): void;
  getSnapshot(): TerminalRendererRegistrySnapshot;
  recordPaneFailure(paneId: string, reason: TerminalRendererFallbackReason): void;
  registerPane(options: RegisterTerminalRendererPaneOptions): () => void;
  reconcile(): void;
  subscribe(listener: () => void): () => void;
  updateMode(mode: TerminalRendererType): void;
  updatePaneFocus(paneId: string, focused: boolean): void;
  updatePaneState(
    paneId: string,
    state: TerminalRendererControllerState,
  ): void;
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

  const syncPaneState = (pane: RegisteredRendererPane) => {
    const state = pane.controller.getState();
    pane.currentBackend = state.backend;
    if (state.fallbackReason !== undefined || state.backend === "gpu") {
      pane.fallbackReason = state.fallbackReason;
    }
    if (state.backend === "gpu") {
      pane.lastAttachAt = now();
      pane.retryCount = 0;
    }
  };

  const applyDecision = (
    pane: RegisteredRendererPane,
    decision: TerminalRendererPanePolicyDecision,
  ) => {
    if (decision.targetBackend === "cpu") {
      pane.controller.updateMode("cpu");
      if (decision.shouldReapWebgl) {
        cancelReaper(pane);
      }
      syncPaneState(pane);
      return;
    }

    if (pane.visible) {
      pane.controller.updateMode(requestedMode === "cpu" ? "cpu" : requestedMode);
      if (decision.shouldAttemptImport || pane.currentBackend !== "gpu") {
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
      panes: [...panes.values()].map((pane) => ({
        currentBackend: pane.currentBackend,
        failureCount: pane.failureCount,
        focused: pane.focused,
        hiddenSince: pane.hiddenSince,
        lastFailureAt: pane.lastFailureAt,
        lastFailureReason: pane.lastFailureReason,
        lastUsedAt: pane.lastUsedAt,
        paneId: pane.paneId,
        retryCount: pane.retryCount,
        visible: pane.visible,
      })),
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
    pane.currentBackend = state.backend;
    if (state.fallbackReason !== undefined || state.backend === "gpu") {
      pane.fallbackReason = state.fallbackReason;
    }
    if (state.backend === "gpu") {
      pane.lastAttachAt = now();
      pane.retryCount = 0;
    }
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
    if (reason === "context-lost") {
      pane.lastContextLossAt = at;
      pane.retryCount += 1;
    }
  };

  const clearTextureAtlas = (paneId?: string) => {
    const requestedTargets =
      typeof paneId === "string"
        ? [...panes.values()].filter((pane) => pane.paneId === paneId)
        : [...panes.values()].filter((pane) => pane.currentBackend === "gpu");
    const relatedGpuPanes =
      typeof paneId === "string"
        ? [...panes.values()].filter((pane) => pane.currentBackend === "gpu")
        : requestedTargets;
    const targets = new Map<string, RegisteredRendererPane>();
    for (const pane of [...requestedTargets, ...relatedGpuPanes]) {
      targets.set(pane.paneId, pane);
    }
    if (targets.size === 0) {
      return;
    }
    const recoveredAt = now();
    let clearedCount = 0;
    let firstError: unknown;
    for (const pane of targets.values()) {
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
      return {
        backend: state.backend,
        canvasCount: state.canvasCount ?? 0,
        failureCount: pane.failureCount,
        fallbackReason: pane.fallbackReason ?? state.fallbackReason,
        focused: pane.focused,
        lastAttachAt: pane.lastAttachAt,
        lastContextLossAt: pane.lastContextLossAt,
        lastRecoveryAt: pane.lastRecoveryAt,
        paneId: pane.paneId,
        recoveryCount: pane.recoveryCount,
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
    subscribe,
    updateMode,
    updatePaneFocus,
    updatePaneState,
    updatePaneVisibility,
  };
}

export const terminalRendererRegistry = createTerminalRendererRegistry({
  rendererType: "auto",
});
