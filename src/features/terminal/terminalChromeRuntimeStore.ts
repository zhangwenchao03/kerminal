import {
  createTerminalPaneActivityState,
  reduceTerminalPaneActivity,
  type TerminalPaneActivityEvent,
  type TerminalPaneActivityState,
} from "./terminalPaneActivityModel";

/** Tab chrome 订阅的 pane snapshot；paneId 只用于运行态定位。 */
export interface TerminalPaneChromeSnapshot
  extends TerminalPaneActivityState {
  paneId: string;
}

/** 低频 pane chrome external store 的窄接口。 */
export interface TerminalChromeRuntimeStore {
  diagnosticsSnapshot(): TerminalChromeActivityDiagnosticsSnapshot;
  getSnapshot(paneId: string): TerminalPaneChromeSnapshot;
  getSnapshots(): readonly TerminalPaneChromeSnapshot[];
  register(
    paneId: string,
    initialState?: Partial<TerminalPaneActivityState>,
  ): () => void;
  remove(paneId: string): void;
  reset(): void;
  subscribe(paneId: string, listener: () => void): () => void;
  subscribeAll(listener: () => void): () => void;
  update(
    paneId: string,
    event: TerminalPaneActivityEvent,
  ): TerminalPaneChromeSnapshot;
}

/** Chrome activity 转换诊断，只保留计数，不包含终端文本或用户输入。 */
interface TerminalChromeActivityDiagnosticsSnapshot {
  publishedTransitions: number;
  registeredPanes: number;
  suppressedTransitions: number;
}

interface TerminalChromeRuntimeRecord {
  snapshot: TerminalPaneChromeSnapshot;
}

export const EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT: Readonly<TerminalPaneChromeSnapshot> =
  Object.freeze({
    ...createTerminalPaneActivityState(),
    paneId: "",
  });

/**
 * 创建兼容 useSyncExternalStore 的 pane store。
 * 未注册 pane 始终返回同一个空 snapshot；只有 reducer 产生新引用才通知。
 */
export function createTerminalChromeRuntimeStore(): TerminalChromeRuntimeStore {
  const records = new Map<string, TerminalChromeRuntimeRecord>();
  const listeners = new Map<string, Set<() => void>>();
  const allListeners = new Set<() => void>();
  let allSnapshots: readonly TerminalPaneChromeSnapshot[] = [];
  let publishedTransitions = 0;
  let suppressedTransitions = 0;

  const emit = (paneId: string) => {
    for (const listener of listeners.get(paneId) ?? []) {
      listener();
    }
    for (const listener of allListeners) {
      listener();
    }
  };

  const refreshAllSnapshots = () => {
    allSnapshots = [...records.values()].map((record) => record.snapshot);
  };

  const getSnapshot = (paneId: string): TerminalPaneChromeSnapshot =>
    records.get(paneId)?.snapshot ?? EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT;

  const register = (
    paneId: string,
    initialState: Partial<TerminalPaneActivityState> = {},
  ) => {
    const snapshot = {
      ...createTerminalPaneActivityState(initialState),
      paneId,
    };
    const previous = records.get(paneId);
    if (previous && snapshotsEqual(previous.snapshot, snapshot)) {
      const record = { snapshot: previous.snapshot };
      records.set(paneId, record);
      return createRegistrationDisposer(paneId, record);
    }
    const record = { snapshot };
    records.set(paneId, record);
    refreshAllSnapshots();
    emit(paneId);
    return createRegistrationDisposer(paneId, record);
  };

  const createRegistrationDisposer = (
    paneId: string,
    record: TerminalChromeRuntimeRecord,
  ) => () => {
    if (records.get(paneId) !== record) {
      return;
    }
    records.delete(paneId);
    refreshAllSnapshots();
    emit(paneId);
  };

  const update = (
    paneId: string,
    event: TerminalPaneActivityEvent,
  ): TerminalPaneChromeSnapshot => {
    const record = records.get(paneId);
    if (!record) {
      suppressedTransitions += 1;
      return EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT;
    }
    const nextState = reduceTerminalPaneActivity(record.snapshot, event);
    if (nextState === record.snapshot) {
      suppressedTransitions += 1;
      return record.snapshot;
    }
    publishedTransitions += 1;
    record.snapshot = { ...nextState, paneId };
    refreshAllSnapshots();
    emit(paneId);
    return record.snapshot;
  };

  const remove = (paneId: string) => {
    if (!records.delete(paneId)) {
      return;
    }
    refreshAllSnapshots();
    emit(paneId);
  };

  const reset = () => {
    const registeredPaneIds = [...records.keys()];
    records.clear();
    publishedTransitions = 0;
    suppressedTransitions = 0;
    refreshAllSnapshots();
    for (const paneId of registeredPaneIds) {
      emit(paneId);
    }
  };

  const subscribe = (paneId: string, listener: () => void) => {
    let paneListeners = listeners.get(paneId);
    if (!paneListeners) {
      paneListeners = new Set();
      listeners.set(paneId, paneListeners);
    }
    paneListeners.add(listener);
    return () => {
      const current = listeners.get(paneId);
      current?.delete(listener);
      if (current?.size === 0) {
        listeners.delete(paneId);
      }
    };
  };

  const subscribeAll = (listener: () => void) => {
    allListeners.add(listener);
    return () => {
      allListeners.delete(listener);
    };
  };

  return {
    diagnosticsSnapshot: () => ({
      publishedTransitions,
      registeredPanes: records.size,
      suppressedTransitions,
    }),
    getSnapshot,
    getSnapshots: () => allSnapshots,
    register,
    remove,
    reset,
    subscribe,
    subscribeAll,
    update,
  };
}

function snapshotsEqual(
  left: TerminalPaneChromeSnapshot,
  right: TerminalPaneChromeSnapshot,
) {
  return (
    left.paneId === right.paneId &&
    left.applicationActive === right.applicationActive &&
    left.atBottom === right.atBottom &&
    left.bell === right.bell &&
    left.bufferType === right.bufferType &&
    left.connectionState === right.connectionState &&
    left.followPaused === right.followPaused &&
    left.unread === right.unread &&
    left.visible === right.visible
  );
}

export const terminalChromeRuntimeStore =
  createTerminalChromeRuntimeStore();
