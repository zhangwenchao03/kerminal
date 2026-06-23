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
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  terminalTabs: TerminalTab[];
}

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
    terminalTabs: state.terminalTabs,
  });
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
      : focusedPane?.remoteHostId ??
        focusedPane?.machineId ??
        activeTab?.machineId ??
        state.selectedMachineId;
  const selectedMachine =
    findMachine(machineGroups, state.selectedMachineId) ??
    findMachine(machineGroups, activeTerminalMachineId);

  return {
    activeTab,
    focusedPane,
    selectedMachine,
    terminalTabs: state.terminalTabs,
  };
}

function terminalPaneWithoutHighFrequencyOutput(pane: TerminalPane) {
  const { lines: _lines, outputHistory: _outputHistory, ...stablePane } = pane;
  return stablePane;
}
