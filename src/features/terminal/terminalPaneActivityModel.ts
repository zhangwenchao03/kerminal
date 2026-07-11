/** 终端 pane 当前使用的 xterm buffer 类型。 */
export type TerminalPaneBufferType = "normal" | "alternate";

/** 终端连接事实；connecting/reconnecting 只作为低干扰状态展示。 */
export type TerminalPaneConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "warning"
  | "closed"
  | "error";

/** Tab chrome 可聚合的最高优先级 attention。 */
export type TerminalPaneAttention =
  | "error"
  | "disconnected"
  | "warning"
  | "bell"
  | "followPaused"
  | "unread"
  | "none";

/** Pane activity 的完整瞬时状态，不包含 output 文本或持久化数据。 */
export interface TerminalPaneActivityState {
  applicationActive: boolean;
  atBottom: boolean;
  bell: boolean;
  bufferType: TerminalPaneBufferType;
  connectionState: TerminalPaneConnectionState;
  followPaused: boolean;
  unread: boolean;
  visible: boolean;
}

/** reducer 接受的事实事件与用户 acknowledge 事件。 */
export type TerminalPaneActivityEvent =
  | { type: "output" }
  | { type: "bell" }
  | { type: "bufferChanged"; bufferType: TerminalPaneBufferType }
  | { type: "bottomChanged"; atBottom: boolean }
  | { type: "visibilityChanged"; visible: boolean }
  | { type: "applicationActivityChanged"; applicationActive: boolean }
  | {
      type: "connectionChanged";
      connectionState: TerminalPaneConnectionState;
    }
  | { type: "userInput" }
  | { type: "userScrolled"; atBottom: boolean }
  | { type: "jumpToBottom" }
  | { type: "acknowledgeBell" };

export const DEFAULT_TERMINAL_PANE_ACTIVITY_STATE: Readonly<TerminalPaneActivityState> =
  Object.freeze({
    applicationActive: true,
    atBottom: true,
    bell: false,
    bufferType: "normal",
    connectionState: "connected",
    followPaused: false,
    unread: false,
    visible: true,
  });

/** 创建 pane activity 初始状态，并统一应用普通 activity 的清理规则。 */
export function createTerminalPaneActivityState(
  overrides: Partial<TerminalPaneActivityState> = {},
): TerminalPaneActivityState {
  return normalizeOrdinaryActivity({
    ...DEFAULT_TERMINAL_PANE_ACTIVITY_STATE,
    ...overrides,
  });
}

/**
 * 纯状态机：高频 output/Bell 在语义状态未变化时返回原对象，
 * 让上层 external store 可以用引用相等直接抑制通知。
 */
export function reduceTerminalPaneActivity(
  state: TerminalPaneActivityState,
  event: TerminalPaneActivityEvent,
): TerminalPaneActivityState {
  switch (event.type) {
    case "output":
      return reduceOutput(state);
    case "bell":
      return state.bell ? state : { ...state, bell: true };
    case "bufferChanged":
      return reduceBufferChanged(state, event.bufferType);
    case "bottomChanged":
      return updateFacts(state, { atBottom: event.atBottom });
    case "visibilityChanged":
      return updateFacts(state, { visible: event.visible });
    case "applicationActivityChanged":
      return updateFacts(state, {
        applicationActive: event.applicationActive,
      });
    case "connectionChanged":
      return state.connectionState === event.connectionState
        ? state
        : { ...state, connectionState: event.connectionState };
    case "userInput":
    case "acknowledgeBell":
      return state.bell ? { ...state, bell: false } : state;
    case "userScrolled":
      return updateFacts(state, {
        atBottom: event.atBottom,
        bell: false,
      });
    case "jumpToBottom":
      return updateFacts(state, {
        atBottom: true,
        bell: false,
        followPaused: false,
        unread: false,
      });
  }
}

/** 按错误、警告、Bell、跟随暂停、未读的固定顺序派生 attention。 */
export function resolveTerminalPaneAttention(
  state: TerminalPaneActivityState,
): TerminalPaneAttention {
  if (state.connectionState === "error") {
    return "error";
  }
  if (state.connectionState === "closed") {
    return "disconnected";
  }
  if (state.connectionState === "warning") {
    return "warning";
  }
  if (state.bell) {
    return "bell";
  }
  if (state.followPaused) {
    return "followPaused";
  }
  if (state.unread) {
    return "unread";
  }
  return "none";
}

function reduceOutput(
  state: TerminalPaneActivityState,
): TerminalPaneActivityState {
  if (state.bufferType === "alternate") {
    return state;
  }
  if (!state.visible || !state.applicationActive) {
    return state.unread ? state : { ...state, unread: true };
  }
  if (!state.atBottom) {
    return state.followPaused ? state : { ...state, followPaused: true };
  }
  return clearOrdinaryActivity(state);
}

function reduceBufferChanged(
  state: TerminalPaneActivityState,
  bufferType: TerminalPaneBufferType,
): TerminalPaneActivityState {
  if (state.bufferType === bufferType) {
    return state;
  }
  // buffer 切换只更新事实，不创建或清除既有 attention。
  return { ...state, bufferType };
}

function updateFacts(
  state: TerminalPaneActivityState,
  changes: Partial<TerminalPaneActivityState>,
): TerminalPaneActivityState {
  let changed = false;
  for (const key of Object.keys(changes) as Array<
    keyof TerminalPaneActivityState
  >) {
    if (changes[key] !== undefined && state[key] !== changes[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    return state;
  }
  return normalizeOrdinaryActivity({ ...state, ...changes });
}

function normalizeOrdinaryActivity(
  state: TerminalPaneActivityState,
): TerminalPaneActivityState {
  if (
    state.visible &&
    state.applicationActive &&
    state.atBottom &&
    (state.unread || state.followPaused)
  ) {
    return { ...state, followPaused: false, unread: false };
  }
  return state;
}

function clearOrdinaryActivity(
  state: TerminalPaneActivityState,
): TerminalPaneActivityState {
  return state.unread || state.followPaused
    ? { ...state, followPaused: false, unread: false }
    : state;
}
