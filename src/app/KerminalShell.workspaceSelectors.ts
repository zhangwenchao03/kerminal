import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../features/workspace/types";
import { isTerminalSessionTab } from "../features/workspace/types";
import type { WorkspaceState } from "../features/workspace/workspaceStore";
import { findMachine } from "../features/workspace/workspaceMachineModel";

interface OpenMachineState {
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export interface ToolPanelWorkspaceContext {
  activeMachine?: Machine;
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export interface TerminalWorkspaceSnapshot {
  activeTabId: string;
  broadcastDraft: string;
  focusedPaneId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
  terminalTabGroupPreferences: WorkspaceState["terminalTabGroupPreferences"];
}

interface ParsedTerminalWorkspaceSnapshotCache {
  panesSnapshot: string;
  preferencesSnapshot: string;
  snapshot: string;
  tabsSnapshot: string;
  value: TerminalWorkspaceSnapshot;
}

let parsedTerminalWorkspaceSnapshotCache:
  | ParsedTerminalWorkspaceSnapshotCache
  | undefined;

export function collectOpenMachineIds({
  terminalPanes,
  terminalTabs,
}: OpenMachineState): string[] {
  const ids = new Set<string>();
  for (const tab of terminalTabs) {
    if (isTerminalSessionTab(tab)) {
      ids.add(tab.machineId);
    }
  }
  for (const pane of terminalPanes) {
    ids.add(pane.machineId);
    if (pane.remoteHostId) {
      ids.add(pane.remoteHostId);
    }
  }
  return [...ids];
}

export function buildOpenMachineIdsSnapshot(state: OpenMachineState): string {
  return JSON.stringify(collectOpenMachineIds(state));
}

export function parseOpenMachineIdsSnapshot(snapshot: string): string[] {
  return JSON.parse(snapshot) as string[];
}

export function buildToolPanelWorkspaceSnapshot(state: WorkspaceState): string {
  const focusedPane = state.terminalPanes.find(
    (pane) => pane.id === state.focusedPaneId,
  );

  return JSON.stringify({
    activeTabId: state.activeTabId,
    focusedPane: focusedPane
      ? terminalPaneWithoutHighFrequencyOutput(focusedPane)
      : null,
    focusedPaneId: state.focusedPaneId,
    selectedMachineId: state.selectedMachineId,
    terminalPanes: state.terminalPanes.map(terminalPaneWithoutHighFrequencyOutput),
    terminalTabs: state.terminalTabs,
  });
}

export function buildTerminalWorkspaceSnapshot(state: WorkspaceState): string {
  return JSON.stringify({
    activeTabId: state.activeTabId,
    broadcastDraft: state.broadcastDraft,
    focusedPaneId: state.focusedPaneId,
    terminalPanes: state.terminalPanes.map(
      terminalPaneWithoutHighFrequencyOutput,
    ),
    terminalTabs: state.terminalTabs,
    terminalTabGroupPreferences: state.terminalTabGroupPreferences,
  } satisfies TerminalWorkspaceSnapshot);
}

export function parseTerminalWorkspaceSnapshot(
  snapshot: string,
): TerminalWorkspaceSnapshot {
  if (parsedTerminalWorkspaceSnapshotCache?.snapshot === snapshot) {
    return parsedTerminalWorkspaceSnapshotCache.value;
  }

  const next = JSON.parse(snapshot) as TerminalWorkspaceSnapshot;
  const panesSnapshot = JSON.stringify(next.terminalPanes);
  const tabsSnapshot = JSON.stringify(next.terminalTabs);
  const preferencesSnapshot = JSON.stringify(next.terminalTabGroupPreferences);
  const previous = parsedTerminalWorkspaceSnapshotCache;

  if (previous && previous.panesSnapshot === panesSnapshot) {
    next.terminalPanes = previous.value.terminalPanes;
  }
  if (previous && previous.tabsSnapshot === tabsSnapshot) {
    next.terminalTabs = previous.value.terminalTabs;
  }
  if (previous && previous.preferencesSnapshot === preferencesSnapshot) {
    next.terminalTabGroupPreferences =
      previous.value.terminalTabGroupPreferences;
  }

  parsedTerminalWorkspaceSnapshotCache = {
    panesSnapshot,
    preferencesSnapshot,
    snapshot,
    tabsSnapshot,
    value: next,
  };

  return next;
}

export function buildToolPanelWorkspaceContext(
  state: WorkspaceState,
  machineGroups: MachineGroup[],
): ToolPanelWorkspaceContext {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  const focusedPane = state.terminalPanes.find(
    (pane) => pane.id === state.focusedPaneId,
  );
  const activeTerminalMachineId =
    focusedPane?.mode === "container"
      ? focusedPane.machineId
      : (focusedPane?.remoteHostId ??
        focusedPane?.machineId ??
        activeTab?.machineId ??
        state.selectedMachineId);
  const selectedMachine =
    findMachine(machineGroups, state.selectedMachineId) ??
    findMachine(machineGroups, activeTerminalMachineId);
  const activeMachine = findMachine(machineGroups, activeTerminalMachineId);

  return {
    activeMachine,
    activeTab,
    focusedPane,
    selectedMachine,
    terminalPanes: state.terminalPanes.map(terminalPaneWithoutHighFrequencyOutput),
    terminalTabs: state.terminalTabs,
  };
}

function terminalPaneWithoutHighFrequencyOutput(pane: TerminalPane) {
  const { lines: _lines, outputHistory: _outputHistory, ...stablePane } = pane;
  return {
    ...stablePane,
    lines: [],
  };
}
