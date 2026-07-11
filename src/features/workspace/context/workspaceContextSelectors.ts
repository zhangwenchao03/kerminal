import { buildWorkspaceContextProjection } from "./workspaceContextModel";
import type {
  WorkspaceContextProjection,
  WorkspaceContextProjectionInput,
} from "./workspaceContextTypes";

/**
 * 创建引用稳定的 projection selector。缓存仅属于 selector 实例，
 * 不可写、不订阅、不定时刷新，因此不会形成第二个业务 store。
 */
export function createWorkspaceContextProjectionSelector(): (
  input: WorkspaceContextProjectionInput,
) => WorkspaceContextProjection {
  let previousInput: WorkspaceContextProjectionInput | undefined;
  let previousProjection: WorkspaceContextProjection | undefined;

  return (input) => {
    if (previousInput && previousProjection && sameProjectionInput(previousInput, input)) {
      return previousProjection;
    }
    previousInput = input;
    previousProjection = buildWorkspaceContextProjection(input);
    return previousProjection;
  };
}

function sameProjectionInput(
  previous: WorkspaceContextProjectionInput,
  next: WorkspaceContextProjectionInput,
): boolean {
  return previous.revision === next.revision
    && previous.generatedAt === next.generatedAt
    && previous.activeTabId === next.activeTabId
    && previous.focusedPaneId === next.focusedPaneId
    && previous.selectedMachineId === next.selectedMachineId
    && previous.machineGroups === next.machineGroups
    && previous.terminalTabs === next.terminalTabs
    && previous.terminalPanes === next.terminalPanes
    && previous.workspaceFileDirtyState === next.workspaceFileDirtyState
    && previous.workspaceFileRevealRequest === next.workspaceFileRevealRequest
    && previous.sources === next.sources;
}
