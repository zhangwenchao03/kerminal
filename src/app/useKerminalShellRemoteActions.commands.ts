import type { ConnectionOpenOptions } from "../features/machine-sidebar/MachineSidebar";
import type { useWorkspaceStore } from "../features/workspace/workspaceStore";
import type { MachineGroup } from "../features/workspace/types";
import type { TerminalProfile } from "../lib/profileApi";

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

export type ConnectionDialogOptions = ConnectionOpenOptions & {
  hostId?: string;
};

export type UseKerminalShellRemoteActionsParams = {
  activeProfileId: string | null;
  addLocalProfileMachine: WorkspaceState["addLocalProfileMachine"];
  addTerminalTab: WorkspaceState["addTerminalTab"];
  defaultRemoteGroupId: string | undefined;
  machineGroups: MachineGroup[];
  moveSidebarMachine: WorkspaceState["moveSidebarMachine"];
  pinMachineGroup: WorkspaceState["pinMachineGroup"];
  profiles: TerminalProfile[];
  removeSidebarMachine: WorkspaceState["removeSidebarMachine"];
  renameMachineGroup: WorkspaceState["renameMachineGroup"];
  selectMachine: WorkspaceState["selectMachine"];
  setProfiles: WorkspaceState["setProfiles"];
  setRemoteHostTree: WorkspaceState["setRemoteHostTree"];
  updateLocalMachine: WorkspaceState["updateLocalMachine"];
};
