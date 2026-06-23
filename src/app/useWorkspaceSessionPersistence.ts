import { useCallback, useEffect, useRef } from "react";
import {
  sidebarMachinesForWorkspaceSession,
  useWorkspaceStore,
  type WorkspaceState,
} from "../features/workspace/workspaceStore";
import type { WorkspaceSessionSnapshot } from "../features/workspace/workspaceSession";
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "../features/workspace/workspaceSessionStorage";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../features/workspace/types";
import { WORKSPACE_SESSION_SAVE_DELAY_MS } from "./KerminalShell.static";

interface WorkspaceSessionSnapshotInput {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export function buildWorkspaceSessionSnapshot({
  activeTabId,
  focusedPaneId,
  machineGroups,
  removedSidebarMachineIds,
  selectedMachineId,
  terminalPanes,
  terminalTabs,
}: WorkspaceSessionSnapshotInput): WorkspaceSessionSnapshot {
  return {
    activeTabId,
    focusedPaneId,
    selectedMachineId,
    removedSidebarMachineIds,
    sidebarMachines: sidebarMachinesForWorkspaceSession(machineGroups),
    terminalPanes,
    terminalTabs,
  };
}

export function useWorkspaceSessionPersistence() {
  const workspaceSessionRestoredRef = useRef(false);
  const workspaceSessionSaveTimerRef = useRef<number | null>(null);
  const latestWorkspaceSessionRef = useRef<WorkspaceSessionSnapshot | null>(
    null,
  );

  const flushWorkspaceSession = useCallback(() => {
    const session = latestWorkspaceSessionRef.current;
    if (!session) {
      return;
    }

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }

    saveWorkspaceSession(session);
  }, []);

  const captureWorkspaceSession = useCallback((state: WorkspaceState) => {
    if (!workspaceSessionRestoredRef.current) {
      return;
    }

      latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshot({
        activeTabId: state.activeTabId,
        focusedPaneId: state.focusedPaneId,
        machineGroups: state.machineGroups,
        removedSidebarMachineIds: state.removedSidebarMachineIds,
        selectedMachineId: state.selectedMachineId,
        terminalPanes: state.terminalPanes,
        terminalTabs: state.terminalTabs,
    });

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
    }
    workspaceSessionSaveTimerRef.current = window.setTimeout(() => {
      workspaceSessionSaveTimerRef.current = null;
      const session = latestWorkspaceSessionRef.current;
      if (session) {
        saveWorkspaceSession(session);
      }
    }, WORKSPACE_SESSION_SAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      captureWorkspaceSession(state);
    });

    const session = loadWorkspaceSession();
    if (session) {
      useWorkspaceStore.getState().restoreWorkspaceSession(session);
    }
    workspaceSessionRestoredRef.current = true;
    captureWorkspaceSession(useWorkspaceStore.getState());

    return () => {
      unsubscribe();
      if (workspaceSessionSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSessionSaveTimerRef.current);
        workspaceSessionSaveTimerRef.current = null;
      }
    };
  }, [captureWorkspaceSession]);

  useEffect(() => {
    window.addEventListener("pagehide", flushWorkspaceSession);
    return () => {
      window.removeEventListener("pagehide", flushWorkspaceSession);
      flushWorkspaceSession();
    };
  }, [flushWorkspaceSession]);
}
