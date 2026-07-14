import type { DockerContainerSummary } from "../../lib/dockerApi";
import type { TerminalProfile } from "../../lib/profileApi";
import { localTarget } from "../../lib/targetModel";
import { isExternalSshMachineId } from "../external-launch";
import type { AddDockerContainerOptions, AddTerminalTabOptions } from "./workspaceStoreContract";
import type { Machine, MachineGroup, TerminalPane, TerminalTab } from "./types";
import {
  addDockerContainerMachineToGroup,
  addMachineToGroup,
  containerToMachine,
  findMachine,
  localRuntimeDescription,
  nextPinnedSortOrder,
  nextUnpinnedSortOrder,
  profileToLocalMachine,
  removeMachineFromGroups,
  sortMachineGroups,
} from "./workspaceMachineModel";
import { syncContainerTerminalOpenState } from "./workspaceTerminalOpenState";

interface WorkspaceMachineState {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

type WorkspaceMachineStatePatch = Partial<WorkspaceMachineState>;

/** 将容器加入侧栏，并同步已打开的同容器终端状态。 */
export function addDockerContainerState(
  state: WorkspaceMachineState,
  container: DockerContainerSummary,
  options?: AddDockerContainerOptions,
): WorkspaceMachineStatePatch {
  const hostMachine = findMachine(state.machineGroups, container.hostId);
  if (!hostMachine || hostMachine.kind !== "ssh") return {};
  const machine = containerToMachine(container, hostMachine, options);
  const openState = syncContainerTerminalOpenState(state, machine);
  return {
    machineGroups: addDockerContainerMachineToGroup(
      state.machineGroups,
      machine,
      options?.groupId ?? hostMachine.remoteGroupId,
    ),
    removedSidebarMachineIds: withoutRemovedMachineId(
      state.removedSidebarMachineIds,
      machine.id,
    ),
    selectedMachineId: machine.id,
    terminalPanes: openState.terminalPanes,
    terminalTabs: openState.terminalTabs,
  };
}

/** 将 profile 显式登记为侧栏本地机器。 */
export function addLocalProfileMachineState(
  state: WorkspaceMachineState,
  profile: TerminalProfile,
  groupId?: string,
): WorkspaceMachineStatePatch {
  const machine = { ...profileToLocalMachine(profile), remoteGroupId: groupId };
  return {
    machineGroups: addMachineToGroup(state.machineGroups, machine, groupId),
    removedSidebarMachineIds: withoutRemovedMachineId(
      state.removedSidebarMachineIds,
      machine.id,
    ),
    selectedMachineId: machine.id,
  };
}

export function moveSidebarMachineState(
  state: WorkspaceMachineState,
  machineId: string,
  groupId: string,
): WorkspaceMachineStatePatch {
  const machine = findMachine(state.machineGroups, machineId);
  if (!machine) return {};
  const machineGroups = addMachineToGroup(
    removeMachineFromGroups(state.machineGroups, machineId),
    { ...machine, remoteGroupId: groupId },
    groupId,
  );
  return {
    machineGroups,
    selectedMachineId: findMachine(machineGroups, state.selectedMachineId)
      ? state.selectedMachineId
      : machineId,
  };
}

export function pinMachineGroupState(
  state: WorkspaceMachineState,
  groupId: string,
  pinned: boolean,
): WorkspaceMachineStatePatch {
  const targetGroup = state.machineGroups.find((group) => group.id === groupId);
  if (!targetGroup) return {};
  const sortOrder = pinned
    ? nextPinnedSortOrder(state.machineGroups)
    : nextUnpinnedSortOrder(state.machineGroups, groupId);
  return {
    machineGroups: sortMachineGroups(
      state.machineGroups.map((group) =>
        group.id === groupId ? { ...targetGroup, pinned, sortOrder } : group,
      ),
    ),
  };
}

export function removeSidebarMachineState(
  state: WorkspaceMachineState,
  machineId: string,
): WorkspaceMachineStatePatch {
  const machine = findMachine(state.machineGroups, machineId);
  if (!machine) return {};
  const persistent = machine.kind === "local" || machine.kind === "dockerContainer";
  const temporaryExternal = machine.kind === "ssh" && isExternalSshMachineId(machine.id);
  if (!persistent && !temporaryExternal) return {};
  const machineGroups = removeMachineFromGroups(state.machineGroups, machineId);
  return {
    machineGroups,
    removedSidebarMachineIds: persistent
      ? withRemovedMachineId(state.removedSidebarMachineIds, machineId)
      : state.removedSidebarMachineIds,
    selectedMachineId: findMachine(machineGroups, state.selectedMachineId)
      ? state.selectedMachineId
      : (machineGroups[0]?.machines[0]?.id ?? ""),
  };
}

export function renameMachineGroupState(
  state: WorkspaceMachineState,
  groupId: string,
  title: string,
): WorkspaceMachineStatePatch {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return {};
  return {
    machineGroups: state.machineGroups.map((group) =>
      group.id === groupId ? { ...group, title: trimmedTitle } : group,
    ),
  };
}

export function updateLocalMachineState(
  state: WorkspaceMachineState,
  machineId: string,
  options: AddTerminalTabOptions,
): WorkspaceMachineStatePatch {
  const machine = findMachine(state.machineGroups, machineId);
  if (!machine || machine.kind !== "local") return {};
  const nextMachine: Machine = {
    ...machine,
    args: options.args,
    cwd: options.cwd,
    description: localRuntimeDescription(options),
    env: options.env,
    name: options.title?.trim() || machine.name,
    remoteGroupId: options.groupId ?? machine.remoteGroupId,
    shell: options.shell,
    target: localTarget(machine.profileId),
  };
  const machineGroups = addMachineToGroup(
    removeMachineFromGroups(state.machineGroups, machineId),
    nextMachine,
    nextMachine.remoteGroupId,
  );
  return {
    machineGroups,
    selectedMachineId: findMachine(machineGroups, state.selectedMachineId)
      ? state.selectedMachineId
      : nextMachine.id,
    terminalPanes: state.terminalPanes.map((pane) =>
      pane.machineId === machineId
        ? {
            ...pane,
            args: nextMachine.args,
            cwd: nextMachine.cwd,
            env: nextMachine.env,
            profileId: nextMachine.profileId,
            shell: nextMachine.shell,
            target: localTarget(nextMachine.profileId),
            title: nextMachine.name,
          }
        : pane,
    ),
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.machineId === machineId ? { ...tab, title: nextMachine.name } : tab,
    ),
  };
}

function withoutRemovedMachineId(machineIds: string[], machineId: string) {
  return machineIds.filter((candidate) => candidate !== machineId);
}

function withRemovedMachineId(machineIds: string[], machineId: string) {
  return machineIds.includes(machineId) ? machineIds : [...machineIds, machineId];
}
