import {
  collectPaneIds,
  findFirstPaneId,
  removePaneFromLayout,
  splitPaneInLayout,
} from "./workspaceLayout";
import {
  isTerminalSessionTab,
  type TerminalPane,
  type TerminalSplitDirection,
  type TerminalTab,
} from "./types";

export interface TerminalWorkspaceStateSlice {
  activeTabId: string;
  focusedPaneId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

type TerminalWorkspaceStatePatch = Partial<TerminalWorkspaceStateSlice>;

export interface FocusedPaneSplitTarget {
  paneIdPrefix: string;
  sourcePaneId: string;
}

export interface SplitFocusedPaneCommand {
  direction: TerminalSplitDirection;
  paneId: string;
  splitId: string;
}

export function selectTerminalTabState(
  state: TerminalWorkspaceStateSlice,
  activeTabId: string,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return {};
  }

  const focusedPaneId = isTerminalSessionTab(activeTab)
    ? resolveFocusForTerminalTab(state, activeTab)
    : "";
  return { activeTabId, focusedPaneId };
}

export function closeTerminalTabState(
  state: TerminalWorkspaceStateSlice,
  tabId: string,
): TerminalWorkspaceStatePatch {
  const tab = state.terminalTabs.find((item) => item.id === tabId);
  if (!tab) {
    return {};
  }

  const paneIds = isTerminalSessionTab(tab) ? collectPaneIds(tab.layout) : [];
  const terminalTabs = state.terminalTabs.filter((item) => item.id !== tabId);
  const terminalPanes = state.terminalPanes.filter(
    (pane) => !paneIds.includes(pane.id),
  );
  const nextActiveTab =
    state.activeTabId === tabId
      ? terminalTabs[0]
      : terminalTabs.find((item) => item.id === state.activeTabId);
  const focusedPaneId =
    nextActiveTab && isTerminalSessionTab(nextActiveTab)
      ? resolveFocusForTerminalTab(
          { ...state, terminalPanes, terminalTabs },
          nextActiveTab,
        )
      : "";

  return {
    activeTabId: nextActiveTab?.id ?? "",
    focusedPaneId,
    terminalPanes,
    terminalTabs,
  };
}

export function closeTerminalPaneState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    return {};
  }

  const activePaneIds = collectPaneIds(activeTab.layout);
  if (activePaneIds.length <= 1 || !activePaneIds.includes(paneId)) {
    return {};
  }

  const nextLayout = removePaneFromLayout(activeTab.layout, paneId);
  if (!nextLayout) {
    return {};
  }

  const terminalTabs = state.terminalTabs.map((tab) =>
    tab.id === activeTab.id && isTerminalSessionTab(tab)
      ? { ...tab, layout: nextLayout }
      : tab,
  );
  const terminalPanes = state.terminalPanes.filter(
    (pane) => pane.id !== paneId,
  );
  const focusedPaneId =
    paneId === state.focusedPaneId
      ? (findFirstPaneId(nextLayout) ?? state.focusedPaneId)
      : state.focusedPaneId;

  return { focusedPaneId, terminalPanes, terminalTabs };
}

export function focusTerminalPaneState(
  state: TerminalWorkspaceStateSlice,
  focusedPaneId: string,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  if (state.focusedPaneId === focusedPaneId) {
    return state;
  }

  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    return state;
  }

  const livePaneIds = new Set(state.terminalPanes.map((pane) => pane.id));
  const activePaneIds = collectPaneIds(activeTab.layout);
  if (
    !activePaneIds.includes(focusedPaneId) ||
    !livePaneIds.has(focusedPaneId)
  ) {
    return state;
  }

  return { focusedPaneId };
}

export function resolveFocusedPaneSplitTarget(
  state: TerminalWorkspaceStateSlice,
): FocusedPaneSplitTarget | undefined {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  const sourcePane = state.terminalPanes.find(
    (pane) => pane.id === state.focusedPaneId,
  );
  if (
    !activeTab ||
    !isTerminalSessionTab(activeTab) ||
    !sourcePane ||
    !collectPaneIds(activeTab.layout).includes(sourcePane.id)
  ) {
    return undefined;
  }

  return {
    paneIdPrefix: paneIdPrefixForSplitMode(sourcePane.mode),
    sourcePaneId: sourcePane.id,
  };
}

export function splitFocusedPaneState(
  state: TerminalWorkspaceStateSlice,
  command: SplitFocusedPaneCommand,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  const sourcePane = state.terminalPanes.find(
    (pane) => pane.id === state.focusedPaneId,
  );
  if (
    !activeTab ||
    !isTerminalSessionTab(activeTab) ||
    !sourcePane ||
    !collectPaneIds(activeTab.layout).includes(sourcePane.id)
  ) {
    return {};
  }

  const newPane: TerminalPane = {
    ...sourcePane,
    cwd: sourcePane.currentCwd ?? sourcePane.cwd,
    currentCwd: sourcePane.currentCwd ?? sourcePane.cwd,
    id: command.paneId,
    lines: [],
    machineId: sourcePane.machineId,
    mode: sourcePane.mode,
    title: command.direction === "horizontal" ? "右侧分屏" : "下方分屏",
  };
  const terminalTabs = state.terminalTabs.map((tab) =>
    tab.id === activeTab.id && isTerminalSessionTab(tab)
      ? {
          ...tab,
          layout: splitPaneInLayout(
            activeTab.layout,
            sourcePane.id,
            command.paneId,
            command.direction,
            command.splitId,
          ),
        }
      : tab,
  );

  return {
    focusedPaneId: command.paneId,
    terminalPanes: [...state.terminalPanes, newPane],
    terminalTabs,
  };
}

export function updatePaneCurrentCwdState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
  currentCwd: string,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  const targetPane = state.terminalPanes.find((pane) => pane.id === paneId);
  if (!targetPane || targetPane.currentCwd === currentCwd) {
    return state;
  }

  return {
    terminalPanes: state.terminalPanes.map((pane) =>
      pane.id === paneId ? { ...pane, currentCwd } : pane,
    ),
  };
}

export function updatePaneOutputHistoryState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
  outputHistory: string | undefined,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  const targetPane = state.terminalPanes.find((pane) => pane.id === paneId);
  if (!targetPane || targetPane.outputHistory === outputHistory) {
    return state;
  }

  return {
    terminalPanes: state.terminalPanes.map((pane) =>
      pane.id === paneId ? { ...pane, outputHistory } : pane,
    ),
  };
}

function paneIdPrefixForSplitMode(mode: TerminalPane["mode"]): string {
  switch (mode) {
    case "ssh":
      return "pane-ssh";
    case "telnet":
      return "pane-telnet";
    case "serial":
      return "pane-serial";
    case "preview":
      return "pane-preview";
    default:
      return "pane-local";
  }
}

function resolveFocusForTerminalTab(
  state: TerminalWorkspaceStateSlice,
  tab: TerminalTab,
): string {
  if (!isTerminalSessionTab(tab)) {
    return "";
  }

  const livePaneIds = new Set(state.terminalPanes.map((pane) => pane.id));
  const layoutPaneIds = collectPaneIds(tab.layout).filter((paneId) =>
    livePaneIds.has(paneId),
  );
  if (layoutPaneIds.includes(state.focusedPaneId)) {
    return state.focusedPaneId;
  }

  return layoutPaneIds[0] ?? "";
}
