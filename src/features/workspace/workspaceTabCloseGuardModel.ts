import type { TerminalTab, WorkspaceFileDirtyState } from "./types";
import { isTerminalSessionTab, isWorkspaceFileTab } from "./types";

export type WorkspaceTabCloseDecision =
  | {
      kind: "close";
      tabIds: string[];
    }
  | {
      dirtyFileTabIds: string[];
      kind: "confirmDirtyFiles";
      tabIds: string[];
    }
  | {
      kind: "confirmTerminalTabs";
      tabIds: string[];
    };

export function resolveWorkspaceTabCloseDecision({
  confirmTerminalClose,
  confirmedDirtyFiles = false,
  tabIds,
  tabs,
  workspaceFileDirtyState,
}: {
  confirmTerminalClose: boolean;
  confirmedDirtyFiles?: boolean;
  tabIds: string[];
  tabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}): WorkspaceTabCloseDecision {
  const requestedIds = tabIds.filter(
    (tabId, index) => tabIds.indexOf(tabId) === index,
  );
  if (requestedIds.length === 0) {
    return { kind: "close", tabIds: [] };
  }

  const requestedTabs = requestedIds
    .map((tabId) => tabs.find((tab) => tab.id === tabId))
    .filter((tab): tab is TerminalTab => Boolean(tab));
  const dirtyFileTabIds = requestedTabs
    .filter((tab) => isWorkspaceFileTab(tab) && workspaceFileDirtyState[tab.id])
    .map((tab) => tab.id);
  if (!confirmedDirtyFiles && dirtyFileTabIds.length > 0) {
    return {
      dirtyFileTabIds,
      kind: "confirmDirtyFiles",
      tabIds: requestedIds,
    };
  }

  if (confirmTerminalClose && requestedTabs.some(isTerminalSessionTab)) {
    return { kind: "confirmTerminalTabs", tabIds: requestedIds };
  }

  return { kind: "close", tabIds: requestedIds };
}
