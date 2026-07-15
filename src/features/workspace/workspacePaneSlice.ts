import type { StateCreator } from "zustand";
import type { TerminalPaneMoveScope } from "../terminal/runtime/move/index";
import { findMachine } from "./workspaceMachineModel";
import type { WorkspaceState } from "./workspaceStore";
import type { SplitFocusedPaneOptions } from "./workspaceStoreContract";
import type { WorkspaceStoreCounterRuntime } from "./workspaceStoreCounterRuntime";
import {
  closeTerminalPaneState,
  focusTerminalPaneState,
  moveTerminalPaneState,
  paneIdPrefixForSplitMachine,
  resolveFocusedPaneSplitTarget,
  splitFocusedPaneState,
  splitTargetPaneForMachine,
  updatePaneCurrentCwdState,
  updatePaneOutputHistoryState,
  updatePaneStatusState,
  updateTerminalSplitLayoutSizesState,
} from "./workspaceTerminalState";
import type {
  MachineStatus,
  TerminalSplitDirection,
  TerminalSplitLayoutSizes,
} from "./types";
import type { TerminalPaneMovePlacement } from "./workspaceLayout";

export interface WorkspacePaneSlice {
  splitFocusedPane(
    direction: TerminalSplitDirection,
    options?: SplitFocusedPaneOptions,
  ): void;
  moveTerminalPane(
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMovePlacement,
    scope?: TerminalPaneMoveScope,
  ): void;
  closePane(paneId: string): void;
  focusPane(paneId: string): void;
  updatePaneCurrentCwd(paneId: string, currentCwd: string): void;
  updateTerminalSplitLayoutSizes(
    splitId: string,
    sizes: TerminalSplitLayoutSizes,
  ): void;
  updatePaneOutputHistory(paneId: string, outputHistory: string | undefined): void;
  updatePaneStatus(paneId: string, status: MachineStatus): void;
}

/** 组合 pane layout 与运行状态动作，保持 reducer 的原子 patch 语义。 */
export function createWorkspacePaneSlice(
  counters: WorkspaceStoreCounterRuntime,
): StateCreator<WorkspaceState, [], [], WorkspacePaneSlice> {
  return (set) => ({
    splitFocusedPane: (direction, options) =>
      set((state) => {
        const splitTarget = resolveFocusedPaneSplitTarget(
          state,
          options?.sourcePaneId,
        );
        if (!splitTarget) return {};
        const targetMachine = options?.targetMachineId
          ? findMachine(state.machineGroups, options.targetMachineId)
          : undefined;
        if (options?.targetMachineId && !targetMachine) return {};
        const targetPaneIdPrefix = targetMachine
          ? paneIdPrefixForSplitMachine(targetMachine)
          : undefined;
        if (targetMachine && !targetPaneIdPrefix) return {};
        const paneId = counters.nextPaneId(
          targetPaneIdPrefix ?? splitTarget.paneIdPrefix,
        );
        const splitId = counters.nextSplitId();
        const targetPane = targetMachine
          ? splitTargetPaneForMachine(targetMachine, paneId)
          : undefined;
        if (targetMachine && !targetPane) return {};
        const splitPatch = splitFocusedPaneState(state, {
          direction,
          paneId,
          placement: options?.placement,
          sourcePaneId: splitTarget.sourcePaneId,
          splitId,
          ...(targetPane ? { targetPane } : {}),
        });
        return targetPane && "focusedPaneId" in splitPatch
          ? { ...splitPatch, selectedMachineId: targetPane.machineId }
          : splitPatch;
      }),
    moveTerminalPane: (sourcePaneId, targetPaneId, placement, scope) =>
      set((state) => {
        if (sourcePaneId === targetPaneId) return {};
        return moveTerminalPaneState(state, {
          placement,
          scope,
          sourcePaneId,
          splitId: counters.nextSplitId(),
          targetPaneId,
        });
      }),
    closePane: (paneId) =>
      set((state) => closeTerminalPaneState(state, paneId)),
    focusPane: (focusedPaneId) =>
      set((state) => focusTerminalPaneState(state, focusedPaneId)),
    updatePaneCurrentCwd: (paneId, currentCwd) =>
      set((state) => updatePaneCurrentCwdState(state, paneId, currentCwd)),
    updateTerminalSplitLayoutSizes: (splitId, sizes) =>
      set((state) => updateTerminalSplitLayoutSizesState(state, splitId, sizes)),
    updatePaneOutputHistory: (paneId, outputHistory) =>
      set((state) => updatePaneOutputHistoryState(state, paneId, outputHistory)),
    updatePaneStatus: (paneId, status) =>
      set((state) => updatePaneStatusState(state, paneId, status)),
  });
}
