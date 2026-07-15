import { maxGeneratedTerminalCounters, type WorkspaceSessionSnapshot } from "./workspaceSession";
import type { WorkspaceTerminalOpenCounterPort } from "./workspaceTerminalOpenActions";

export interface WorkspaceStoreCounterRuntime extends WorkspaceTerminalOpenCounterPort {
  nextSplitId(): string;
  reset(): void;
  restore(session: WorkspaceSessionSnapshot): void;
}

/** 统一持有 workspace 生成 ID，保证各 slice 共享同一单调序列。 */
export function createWorkspaceStoreCounterRuntime({
  paneCount,
  tabCount,
}: {
  paneCount: number;
  tabCount: number;
}): WorkspaceStoreCounterRuntime {
  let generatedPaneCount = paneCount;
  let generatedTabCount = tabCount;
  let generatedSplitCount = 0;

  return {
    commitTmuxConsumption: ({ pane, split, tab }) => {
      generatedPaneCount += pane ? 1 : 0;
      generatedSplitCount += split ? 1 : 0;
      generatedTabCount += tab ? 1 : 0;
    },
    nextPaneId: (prefix) => `${prefix}-${(generatedPaneCount += 1)}`,
    nextSplitId: () => `split-${(generatedSplitCount += 1)}`,
    nextTabId: (prefix) => `${prefix}-${(generatedTabCount += 1)}`,
    previewTmuxIds: () => ({
      localMachineId: `machine-tmux-local-${generatedTabCount + 1}`,
      paneId: `pane-tmux-${generatedPaneCount + 1}`,
      splitId: `split-${generatedSplitCount + 1}`,
      tabId: `tab-tmux-${generatedTabCount + 1}`,
    }),
    reset() {
      generatedPaneCount = 0;
      generatedSplitCount = 0;
      generatedTabCount = 0;
    },
    restore(session) {
      const counters = maxGeneratedTerminalCounters(session);
      generatedPaneCount = Math.max(generatedPaneCount, counters.paneCount);
      generatedSplitCount = Math.max(generatedSplitCount, counters.splitCount);
      generatedTabCount = Math.max(generatedTabCount, counters.tabCount);
    },
  };
}
