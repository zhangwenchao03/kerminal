import { useCallback, useEffect, useRef } from "react";
import {
  sidebarMachinesForWorkspaceSession,
  useWorkspaceStore,
  type WorkspaceState,
} from "../features/workspace/workspaceStore";
import type {
  WorkspaceShellLayout,
  WorkspaceSessionSnapshot,
} from "../features/workspace/workspaceSession";
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "../features/workspace/workspaceSessionStorage";
import { flushPendingTerminalOutputHistoryBuffers } from "../features/terminal/terminalOutputHistoryBuffer";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalTabGroupPreferences,
} from "../features/workspace/types";
import { WORKSPACE_SESSION_SAVE_DELAY_MS } from "./KerminalShell.static";

interface WorkspaceSessionSnapshotInput {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
  shellLayout?: WorkspaceShellLayout;
  terminalPanes: TerminalPane[];
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalTabs: TerminalTab[];
}

interface WorkspaceSessionPersistenceOptions {
  onShellLayoutRestored?: (shellLayout: WorkspaceShellLayout) => void;
  shellLayout?: WorkspaceShellLayout;
}

export function buildWorkspaceSessionSnapshot({
  activeTabId,
  focusedPaneId,
  machineGroups,
  removedSidebarMachineIds,
  selectedMachineId,
  shellLayout,
  terminalPanes,
  terminalTabGroupPreferences,
  terminalTabs,
}: WorkspaceSessionSnapshotInput): WorkspaceSessionSnapshot {
  return {
    activeTabId,
    focusedPaneId,
    selectedMachineId,
    removedSidebarMachineIds,
    shellLayout,
    sidebarMachines: sidebarMachinesForWorkspaceSession(machineGroups),
    terminalTabGroupPreferences,
    terminalPanes,
    terminalTabs,
  };
}

export function buildWorkspaceSessionStableKey({
  activeTabId,
  focusedPaneId,
  machineGroups,
  removedSidebarMachineIds,
  selectedMachineId,
  shellLayout,
  terminalPanes,
  terminalTabGroupPreferences,
  terminalTabs,
}: WorkspaceSessionSnapshotInput): string {
  return JSON.stringify({
    activeTabId,
    focusedPaneId,
    removedSidebarMachineIds,
    selectedMachineId,
    shellLayout,
    sidebarMachines: sidebarMachinesForWorkspaceSession(machineGroups),
    terminalPanes: terminalPanes.map(terminalPaneWithoutVolatileSessionFields),
    terminalTabGroupPreferences,
    terminalTabs,
  });
}

export function useWorkspaceSessionPersistence({
  onShellLayoutRestored,
  shellLayout,
}: WorkspaceSessionPersistenceOptions = {}) {
  const workspaceSessionRestoredRef = useRef(false);
  const workspaceSessionSaveTimerRef = useRef<number | null>(null);
  const latestWorkspaceSessionRef = useRef<WorkspaceSessionSnapshot | null>(
    null,
  );
  const latestWorkspaceStateRef = useRef<WorkspaceState | null>(null);
  const latestWorkspaceSessionStableKeyRef = useRef<string | null>(null);
  const queuedWorkspaceSessionSaveRef =
    useRef<WorkspaceSessionSnapshot | null>(null);
  const workspaceSessionSaveInFlightRef = useRef<Promise<void> | null>(null);
  const volatileWorkspaceSessionDirtyRef = useRef(false);
  const canSaveEmptyWorkspaceSessionRef = useRef(false);
  const latestShellLayoutRef = useRef<WorkspaceShellLayout | undefined>(
    shellLayout,
  );
  const onShellLayoutRestoredRef = useRef(onShellLayoutRestored);

  useEffect(() => {
    onShellLayoutRestoredRef.current = onShellLayoutRestored;
  }, [onShellLayoutRestored]);

  const enqueueWorkspaceSessionSave = useCallback(
    (session: WorkspaceSessionSnapshot) => {
      if (hasWorkspaceSessionTerminalSurface(session)) {
        canSaveEmptyWorkspaceSessionRef.current = true;
      } else if (!canSaveEmptyWorkspaceSessionRef.current) {
        return;
      }

      queuedWorkspaceSessionSaveRef.current = session;
      if (workspaceSessionSaveInFlightRef.current) {
        return;
      }

      const saveInFlight = (async () => {
        while (queuedWorkspaceSessionSaveRef.current) {
          const nextSession = queuedWorkspaceSessionSaveRef.current;
          queuedWorkspaceSessionSaveRef.current = null;
          await saveWorkspaceSession(nextSession);
        }
      })().finally(() => {
        if (workspaceSessionSaveInFlightRef.current === saveInFlight) {
          workspaceSessionSaveInFlightRef.current = null;
        }
        if (queuedWorkspaceSessionSaveRef.current) {
          enqueueWorkspaceSessionSave(queuedWorkspaceSessionSaveRef.current);
        }
      });

      workspaceSessionSaveInFlightRef.current = saveInFlight;
    },
    [],
  );

  const flushWorkspaceSession = useCallback(() => {
    flushPendingTerminalOutputHistoryBuffers();
    const latestState = useWorkspaceStore.getState();
    if (latestState) {
      latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshotFromState(
        latestState,
        latestShellLayoutRef.current,
      );
      latestWorkspaceSessionStableKeyRef.current =
        buildWorkspaceSessionStableKeyFromState(
          latestState,
          latestShellLayoutRef.current,
        );
      volatileWorkspaceSessionDirtyRef.current = false;
    }
    const session = latestWorkspaceSessionRef.current;
    if (!session) {
      return;
    }

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }

    enqueueWorkspaceSessionSave(session);
  }, [enqueueWorkspaceSessionSave]);

  const captureWorkspaceSession = useCallback((state: WorkspaceState) => {
    if (!workspaceSessionRestoredRef.current) {
      return;
    }

    latestWorkspaceStateRef.current = state;
    const stableKey = buildWorkspaceSessionStableKeyFromState(
      state,
      latestShellLayoutRef.current,
    );
    const stableSessionChanged =
      latestWorkspaceSessionStableKeyRef.current !== stableKey;

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }

    if (stableSessionChanged || !latestWorkspaceSessionRef.current) {
      latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshotFromState(
        state,
        latestShellLayoutRef.current,
      );
      latestWorkspaceSessionStableKeyRef.current = stableKey;
      volatileWorkspaceSessionDirtyRef.current = false;
      enqueueWorkspaceSessionSave(latestWorkspaceSessionRef.current);
      return;
    }

    volatileWorkspaceSessionDirtyRef.current = true;
    workspaceSessionSaveTimerRef.current = window.setTimeout(() => {
      workspaceSessionSaveTimerRef.current = null;
      const latestState = latestWorkspaceStateRef.current;
      if (latestState && volatileWorkspaceSessionDirtyRef.current) {
        latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshotFromState(
          latestState,
          latestShellLayoutRef.current,
        );
        latestWorkspaceSessionStableKeyRef.current =
          buildWorkspaceSessionStableKeyFromState(
            latestState,
            latestShellLayoutRef.current,
          );
        volatileWorkspaceSessionDirtyRef.current = false;
      }
      const session = latestWorkspaceSessionRef.current;
      if (session) {
        enqueueWorkspaceSessionSave(session);
      }
    }, WORKSPACE_SESSION_SAVE_DELAY_MS);
  }, [enqueueWorkspaceSessionSave]);

  useEffect(() => {
    latestShellLayoutRef.current = shellLayout;
    if (workspaceSessionRestoredRef.current) {
      captureWorkspaceSession(useWorkspaceStore.getState());
    }
  }, [captureWorkspaceSession, shellLayout]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      captureWorkspaceSession(state);
    });

    void loadWorkspaceSession()
      .catch(() => null)
      .then((session) => {
        if (disposed) {
          return;
        }

        if (session) {
          if (!hasWorkspaceSessionTerminalSurface(session)) {
            canSaveEmptyWorkspaceSessionRef.current = true;
          }
          useWorkspaceStore.getState().restoreWorkspaceSession(session);
          if (session.shellLayout) {
            latestShellLayoutRef.current = session.shellLayout;
            onShellLayoutRestoredRef.current?.(session.shellLayout);
          }
        }
        workspaceSessionRestoredRef.current = true;
        captureWorkspaceSession(useWorkspaceStore.getState());
      });

    return () => {
      disposed = true;
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

function buildWorkspaceSessionSnapshotFromState(
  state: WorkspaceState,
  shellLayout?: WorkspaceShellLayout,
): WorkspaceSessionSnapshot {
  return buildWorkspaceSessionSnapshot({
    activeTabId: state.activeTabId,
    focusedPaneId: state.focusedPaneId,
    machineGroups: state.machineGroups,
    removedSidebarMachineIds: state.removedSidebarMachineIds,
    selectedMachineId: state.selectedMachineId,
    shellLayout,
    terminalPanes: state.terminalPanes,
    terminalTabGroupPreferences: state.terminalTabGroupPreferences,
    terminalTabs: state.terminalTabs,
  });
}

function buildWorkspaceSessionStableKeyFromState(
  state: WorkspaceState,
  shellLayout?: WorkspaceShellLayout,
): string {
  return buildWorkspaceSessionStableKey({
    activeTabId: state.activeTabId,
    focusedPaneId: state.focusedPaneId,
    machineGroups: state.machineGroups,
    removedSidebarMachineIds: state.removedSidebarMachineIds,
    selectedMachineId: state.selectedMachineId,
    shellLayout,
    terminalPanes: state.terminalPanes,
    terminalTabGroupPreferences: state.terminalTabGroupPreferences,
    terminalTabs: state.terminalTabs,
  });
}

function terminalPaneWithoutVolatileSessionFields(pane: TerminalPane) {
  const {
    currentCwd: _currentCwd,
    latencyMs: _latencyMs,
    lines: _lines,
    outputHistory: _outputHistory,
    status: _status,
    ...stablePane
  } = pane;
  return stablePane;
}

function hasWorkspaceSessionTerminalSurface(session: WorkspaceSessionSnapshot) {
  return session.terminalTabs.length > 0 || session.terminalPanes.length > 0;
}
