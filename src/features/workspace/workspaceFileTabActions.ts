// @author kongweiguang

export type WorkspaceFileTabCommand = "reload";

export interface WorkspaceFileTabCommandEventDetail {
  command: WorkspaceFileTabCommand;
  tabId: string;
}

export const WORKSPACE_FILE_TAB_COMMAND_EVENT =
  "kerminal:workspace-file-tab-command";

export function dispatchWorkspaceFileTabCommand(
  detail: WorkspaceFileTabCommandEventDetail,
) {
  window.dispatchEvent(
    new CustomEvent<WorkspaceFileTabCommandEventDetail>(
      WORKSPACE_FILE_TAB_COMMAND_EVENT,
      { detail },
    ),
  );
}
