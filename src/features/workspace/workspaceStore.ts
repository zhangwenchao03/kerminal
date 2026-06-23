import { create } from "zustand";
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
} from "../settings/settingsModel";
import {
  browserPreviewProfiles,
  type TerminalProfile,
} from "../../lib/profileApi";
import type { DockerContainerSummary } from "../../lib/dockerApi";
import { localTarget } from "../../lib/targetModel";
import type { RemoteHostGroupWithHosts } from "../../lib/remoteHostApi";
import { machineGroups, terminalPanes, terminalTabs, tools } from "./workspaceData";
import {
  maxGeneratedTerminalCounters,
  normalizeWorkspaceSessionSnapshot,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";
import type {
  Machine,
  MachineGroup,
  SftpTransferWorkspaceTab,
  TerminalPane,
  TerminalSplitDirection,
  TerminalTab,
  TerminalTabGroupPreference,
  TerminalTabGroupPreferences,
  ToolId,
} from "./types";
import { isSftpTransferWorkspaceTab, isToolId } from "./types";
import {
  addDockerContainerMachineToGroup,
  addMachineToGroup,
  addPersistentSidebarMachines,
  buildMachineGroups,
  collectPersistentSidebarMachines,
  containerToMachine,
  dockerContainerMachinesFromSession,
  findMachine,
  isPersistedLocalProfile,
  localMachineIdForProfile,
  localMachinesFromSession,
  localRuntimeDescription,
  mergeSidebarMachines,
  nextPinnedSortOrder,
  nextUnpinnedSortOrder,
  profileToLocalMachine,
  removeMachineFromGroups,
  sortMachineGroups,
  syncLocalSidebarMachines,
  syncTerminalPaneProductionFlags,
  ungroupedGroupTitle,
  withUngroupedGroupTitle,
} from "./workspaceMachineModel";
import {
  closeTerminalPaneState,
  closeTerminalTabState,
  focusTerminalPaneState,
  resolveFocusedPaneSplitTarget,
  selectTerminalTabState,
  splitFocusedPaneState,
  updatePaneCurrentCwdState,
  updatePaneOutputHistoryState,
} from "./workspaceTerminalState";
import {
  createContainerTerminalOpenState,
  createLocalTerminalOpenState,
  createSerialTerminalOpenState,
  createSshTerminalOpenState,
  createTelnetTerminalOpenState,
  focusExistingMachineTabState,
  syncContainerTerminalOpenState,
} from "./workspaceTerminalOpenState";

export interface AddTerminalTabOptions {
  title?: string;
  profileId?: string;
  groupId?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface AddDockerContainerOptions {
  groupId?: string;
  shell?: string;
  user?: string;
  workdir?: string;
}

export interface OpenSftpTransferTabOptions {
  leftHostId?: string;
  lockedLeftHostId?: string;
  rightHostId?: string;
}

export interface WorkspaceState {
  profiles: TerminalProfile[];
  activeProfileId: string;
  machineGroups: MachineGroup[];
  terminalTabs: TerminalTab[];
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalPanes: TerminalPane[];
  activeTabId: string;
  selectedMachineId: string;
  focusedPaneId: string;
  removedSidebarMachineIds: string[];
  activeTool: ToolId | null;
  machineSearch: string;
  broadcastDraft: string;
  settings: AppSettings;
  setProfiles: (profiles: TerminalProfile[]) => void;
  setSettings: (settings: AppSettings) => void;
  selectProfile: (profileId: string) => void;
  setRemoteHostTree: (remoteGroups: RemoteHostGroupWithHosts[]) => void;
  addDockerContainer: (
    container: DockerContainerSummary,
    options?: AddDockerContainerOptions,
  ) => void;
  addLocalProfileMachine: (profile: TerminalProfile, groupId?: string) => void;
  moveSidebarMachine: (machineId: string, groupId: string) => void;
  pinMachineGroup: (groupId: string, pinned?: boolean) => void;
  removeSidebarMachine: (machineId: string) => void;
  renameMachineGroup: (groupId: string, title: string) => void;
  updateLocalMachine: (machineId: string, options: AddTerminalTabOptions) => void;
  selectMachine: (machineId: string) => void;
  selectTab: (tabId: string) => void;
  addTerminalTab: (options?: AddTerminalTabOptions) => void;
  openSftpTransferTab: (options?: OpenSftpTransferTabOptions) => void;
  openLocalTerminal: (machineId: string) => void;
  openSshTerminal: (hostId: string) => void;
  openTelnetTerminal: (hostId: string) => void;
  openSerialTerminal: (hostId: string) => void;
  openContainerTerminal: (machineId: string) => void;
  closeTerminalTab: (tabId: string) => void;
  renameTerminalTab: (tabId: string, title: string) => void;
  updateTerminalTabGroupPreference: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
  splitFocusedPane: (direction: TerminalSplitDirection) => void;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  updatePaneCurrentCwd: (paneId: string, currentCwd: string) => void;
  updatePaneOutputHistory: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  restoreWorkspaceSession: (session: WorkspaceSessionSnapshot) => void;
  setActiveTool: (toolId: ToolId | null) => void;
  setMachineSearch: (query: string) => void;
  setBroadcastDraft: (draft: string) => void;
}

export {
  findMachine,
  localMachineIdForProfile,
  sidebarMachinesForWorkspaceSession,
} from "./workspaceMachineModel";

const initialState = {
  profiles: browserPreviewProfiles,
  activeProfileId: browserPreviewProfiles[0].id,
  machineGroups,
  terminalTabs,
  terminalTabGroupPreferences: {},
  terminalPanes,
  activeTabId: "",
  selectedMachineId: "",
  focusedPaneId: "",
  removedSidebarMachineIds: [],
  activeTool: null,
  machineSearch: "",
  broadcastDraft: "",
  settings: defaultAppSettings,
};

let generatedPaneCount = terminalPanes.length;
let generatedTabCount = terminalTabs.length;
let generatedSplitCount = 0;

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  ...initialState,
  setProfiles: (profiles) =>
    set((state) => {
      const nextProfiles = profiles.length > 0 ? profiles : browserPreviewProfiles;
      const activeProfile =
        nextProfiles.find((profile) => profile.id === state.activeProfileId) ??
        nextProfiles.find((profile) => profile.isDefault) ??
        nextProfiles[0];
      const syncedMachineGroups = syncLocalSidebarMachines(
        state.machineGroups,
        nextProfiles,
      );
      const machineGroups = syncedMachineGroups;

      return {
        activeProfileId: activeProfile.id,
        machineGroups,
        profiles: nextProfiles,
        selectedMachineId: selectedMachineIdForUpdatedGroups({
          activeTabId: state.activeTabId,
          allowPendingActiveTabSelection: true,
          fallbackSelectedMachineId: state.selectedMachineId,
          machineGroups,
          terminalTabs: state.terminalTabs,
        }),
      };
    }),
  setSettings: (settings) => set({ settings: normalizeAppSettings(settings) }),
  selectProfile: (activeProfileId) => set({ activeProfileId }),
  setRemoteHostTree: (remoteGroups) =>
    set((state) => {
      const sidebarMachines = collectPersistentSidebarMachines(state.machineGroups);
      const machineGroups = withUngroupedGroupTitle(
        addPersistentSidebarMachines(
          buildMachineGroups(remoteGroups),
          sidebarMachines,
        ),
        ungroupedGroupTitle(state.machineGroups),
      );

      return {
        machineGroups,
        selectedMachineId: selectedMachineIdForUpdatedGroups({
          activeTabId: state.activeTabId,
          allowPendingActiveTabSelection: false,
          fallbackSelectedMachineId: state.selectedMachineId,
          machineGroups,
          terminalTabs: state.terminalTabs,
        }),
        terminalPanes: syncTerminalPaneProductionFlags(
          state.terminalPanes,
          machineGroups,
        ),
      };
    }),
  addDockerContainer: (container, options) =>
    set((state) => {
      const hostMachine = findMachine(state.machineGroups, container.hostId);
      if (!hostMachine || hostMachine.kind !== "ssh") {
        return {};
      }

      const machine = containerToMachine(container, hostMachine, options);

      const openState = syncContainerTerminalOpenState(state, machine);

      return {
        machineGroups: addDockerContainerMachineToGroup(
          state.machineGroups,
          machine,
          options?.groupId ?? hostMachine.remoteGroupId,
        ),
        removedSidebarMachineIds: removeRemovedSidebarMachineId(
          state.removedSidebarMachineIds,
          machine.id,
        ),
        selectedMachineId: machine.id,
        terminalPanes: openState.terminalPanes,
        terminalTabs: openState.terminalTabs,
      };
    }),
  addLocalProfileMachine: (profile, groupId) =>
    set((state) => {
      const machine = {
        ...profileToLocalMachine(profile),
        remoteGroupId: groupId,
      };

      return {
        machineGroups: addMachineToGroup(
          state.machineGroups,
          machine,
          groupId,
        ),
        removedSidebarMachineIds: removeRemovedSidebarMachineId(
          state.removedSidebarMachineIds,
          machine.id,
        ),
        selectedMachineId: machine.id,
      };
    }),
  moveSidebarMachine: (machineId, groupId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, machineId);
      if (!machine) {
        return {};
      }
      const nextGroups = addMachineToGroup(
        removeMachineFromGroups(state.machineGroups, machineId),
        {
          ...machine,
          remoteGroupId: groupId,
        },
        groupId,
      );

      return {
        machineGroups: nextGroups,
        selectedMachineId: findMachine(nextGroups, state.selectedMachineId)
          ? state.selectedMachineId
          : machineId,
      };
    }),
  pinMachineGroup: (groupId, pinned = true) =>
    set((state) => {
      const targetGroup = state.machineGroups.find((group) => group.id === groupId);
      if (!targetGroup) {
        return {};
      }
      const nextSortOrder = pinned
        ? nextPinnedSortOrder(state.machineGroups)
        : nextUnpinnedSortOrder(state.machineGroups, groupId);
      const pinnedGroup = {
        ...targetGroup,
        pinned,
        sortOrder: nextSortOrder,
      };

      return {
        machineGroups: sortMachineGroups(
          state.machineGroups.map((group) =>
            group.id === groupId ? pinnedGroup : group,
          ),
        ),
      };
    }),
  removeSidebarMachine: (machineId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, machineId);
      if (
        !machine ||
        (machine.kind !== "local" && machine.kind !== "dockerContainer")
      ) {
        return {};
      }

      const machineGroups = removeMachineFromGroups(state.machineGroups, machineId);
      const selectedMachineExists = Boolean(
        findMachine(machineGroups, state.selectedMachineId),
      );
      return {
        machineGroups,
        removedSidebarMachineIds: addRemovedSidebarMachineId(
          state.removedSidebarMachineIds,
          machineId,
        ),
        selectedMachineId: selectedMachineExists
          ? state.selectedMachineId
          : machineGroups[0]?.machines[0]?.id ?? "",
      };
    }),
  renameMachineGroup: (groupId, title) =>
    set((state) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return {};
      }

      return {
        machineGroups: state.machineGroups.map((group) =>
          group.id === groupId ? { ...group, title: trimmedTitle } : group,
        ),
      };
    }),
  updateLocalMachine: (machineId, options) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, machineId);
      if (!machine || machine.kind !== "local") {
        return {};
      }

      const nextMachine: Machine = {
        ...machine,
        args: options.args,
        cwd: options.cwd,
        description: localRuntimeDescription({
          args: options.args,
          cwd: options.cwd,
          shell: options.shell,
        }),
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
    }),
  selectMachine: (selectedMachineId) => set({ selectedMachineId }),
  selectTab: (activeTabId) =>
    set((state) => {
      const tabPatch = selectTerminalTabState(state, activeTabId);
      if (!("activeTabId" in tabPatch)) {
        return tabPatch;
      }
      return {
        ...tabPatch,
        selectedMachineId: selectedMachineIdFromWorkspaceTab(
          state.terminalTabs.find((tab) => tab.id === activeTabId),
          state.machineGroups,
        ),
      };
    }),
  addTerminalTab: (options) =>
    set((state) => {
      generatedTabCount += 1;
      generatedPaneCount += 1;
      const usesDirectRuntimeConfig = Boolean(
        options?.shell || options?.args || options?.cwd || options?.env,
      );
      const requestedProfile = options?.profileId
        ? state.profiles.find((profile) => profile.id === options.profileId)
        : undefined;
      const profile =
        requestedProfile ?? (usesDirectRuntimeConfig ? undefined : activeProfile(state));
      const persistedProfile =
        profile && isPersistedLocalProfile(profile) ? profile : undefined;
      const tabId = `tab-local-${generatedTabCount}`;
      const paneId = `pane-local-${generatedPaneCount}`;
      const title = options?.title ?? profile?.name ?? `本地终端 ${generatedTabCount}`;
      const machineId =
        persistedProfile
          ? localMachineIdForProfile(persistedProfile.id)
          : `machine-local-${generatedTabCount}`;
      const nextState = createLocalTerminalOpenState(state, {
        args: options?.args ?? profile?.args,
        cwd: options?.cwd ?? profile?.cwd,
        env: options?.env ?? profile?.env,
        groupId: options?.groupId,
        machineId,
        machineProfileId: persistedProfile?.id,
        paneId,
        profile,
        shell: options?.shell ?? profile?.shell,
        tabId,
        title,
      });
      return {
        ...nextState,
        removedSidebarMachineIds: removeRemovedSidebarMachineId(
          state.removedSidebarMachineIds,
          machineId,
        ),
      };
    }),
  openSftpTransferTab: (options) =>
    set((state) => {
      generatedTabCount += 1;
      const leftHost = options?.leftHostId
        ? findMachine(state.machineGroups, options.leftHostId)
        : undefined;
      const lockedLeftHost = options?.lockedLeftHostId
        ? findMachine(state.machineGroups, options.lockedLeftHostId)
        : undefined;
      const rightHost = options?.rightHostId
        ? findMachine(state.machineGroups, options.rightHostId)
        : undefined;
      const leftHostId = leftHost?.kind === "ssh" ? leftHost.id : undefined;
      const lockedLeftHostId =
        lockedLeftHost?.kind === "ssh" ? lockedLeftHost.id : undefined;
      const rightHostId = rightHost?.kind === "ssh" ? rightHost.id : undefined;
      const tabId = `tab-sftp-transfer-${generatedTabCount}`;
      const primaryHostId = rightHostId ?? lockedLeftHostId ?? leftHostId;
      const primaryHost = primaryHostId
        ? findMachine(state.machineGroups, primaryHostId)
        : undefined;
      const title = primaryHost ? `${primaryHost.name} 传输` : "SFTP 传输";
      const tab: SftpTransferWorkspaceTab = {
        id: tabId,
        kind: "sftpTransfer",
        leftHostId: lockedLeftHostId ?? leftHostId,
        lockedLeftHostId,
        machineId: primaryHostId ?? "sftp-transfer",
        rightHostId,
        title,
      };

      return {
        activeTabId: tabId,
        focusedPaneId: "",
        selectedMachineId:
          primaryHostId ?? state.selectedMachineId,
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  openLocalTerminal: (machineId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, machineId);
      if (!machine || machine.kind !== "local") {
        return {};
      }

      const existingTabState = focusExistingMachineTabState(state, machine.id);
      if (existingTabState) {
        return existingTabState;
      }

      const profile = machine.profileId
        ? state.profiles.find((candidate) => candidate.id === machine.profileId)
        : undefined;
      generatedTabCount += 1;
      generatedPaneCount += 1;
      return createLocalTerminalOpenState(state, {
        args: machine.args,
        cwd: machine.cwd,
        env: machine.env,
        groupId: machine.remoteGroupId,
        machineId: machine.id,
        paneId: `pane-local-${generatedPaneCount}`,
        profile,
        shell: machine.shell,
        tabId: `tab-local-${generatedTabCount}`,
        title: machine.name,
      });
    }),
  openSshTerminal: (hostId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, hostId);
      if (!machine || machine.kind !== "ssh") {
        return {};
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      return createSshTerminalOpenState(state, machine, {
        paneId: `pane-ssh-${generatedPaneCount}`,
        tabId: `tab-ssh-${generatedTabCount}`,
      });
    }),
  openTelnetTerminal: (hostId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, hostId);
      if (!machine || machine.kind !== "telnet") {
        return {};
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      return createTelnetTerminalOpenState(state, machine, {
        paneId: `pane-telnet-${generatedPaneCount}`,
        tabId: `tab-telnet-${generatedTabCount}`,
      });
    }),
  openSerialTerminal: (hostId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, hostId);
      if (!machine || machine.kind !== "serial") {
        return {};
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      return createSerialTerminalOpenState(state, machine, {
        paneId: `pane-serial-${generatedPaneCount}`,
        tabId: `tab-serial-${generatedTabCount}`,
      });
    }),
  openContainerTerminal: (machineId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, machineId);
      if (!machine || machine.kind !== "dockerContainer" || !machine.target) {
        return {};
      }

      const existingTabState = focusExistingMachineTabState(state, machine.id);
      if (existingTabState) {
        return existingTabState;
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      return createContainerTerminalOpenState(state, machine, {
        paneId: `pane-container-${generatedPaneCount}`,
        tabId: `tab-container-${generatedTabCount}`,
      });
    }),
  closeTerminalTab: (tabId) =>
    set((state) => closeTerminalTabState(state, tabId)),
  renameTerminalTab: (tabId, title) =>
    set((state) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return {};
      }

      return {
        terminalTabs: state.terminalTabs.map((tab) =>
          tab.id === tabId ? { ...tab, title: trimmedTitle } : tab,
        ),
      };
    }),
  updateTerminalTabGroupPreference: (groupId, preference) =>
    set((state) => {
      const trimmedGroupId = groupId.trim();
      if (!trimmedGroupId) {
        return {};
      }

      const trimmedTitle = preference.title?.trim();
      const nextPreference: TerminalTabGroupPreference = {
        ...(preference.color ? { color: preference.color } : {}),
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      };
      const nextPreferences = { ...state.terminalTabGroupPreferences };
      if (Object.keys(nextPreference).length === 0) {
        delete nextPreferences[trimmedGroupId];
      } else {
        nextPreferences[trimmedGroupId] = nextPreference;
      }

      return { terminalTabGroupPreferences: nextPreferences };
    }),
  splitFocusedPane: (direction) =>
    set((state) => {
      const splitTarget = resolveFocusedPaneSplitTarget(state);
      if (!splitTarget) {
        return {};
      }

      generatedPaneCount += 1;
      generatedSplitCount += 1;
      return splitFocusedPaneState(state, {
        direction,
        paneId: `${splitTarget.paneIdPrefix}-${generatedPaneCount}`,
        splitId: `split-${generatedSplitCount}`,
      });
    }),
  closePane: (paneId) =>
    set((state) => closeTerminalPaneState(state, paneId)),
  focusPane: (focusedPaneId) =>
    set((state) => focusTerminalPaneState(state, focusedPaneId)),
  updatePaneCurrentCwd: (paneId, currentCwd) =>
    set((state) => updatePaneCurrentCwdState(state, paneId, currentCwd)),
  updatePaneOutputHistory: (paneId, outputHistory) =>
    set((state) => updatePaneOutputHistoryState(state, paneId, outputHistory)),
  restoreWorkspaceSession: (session) =>
    set((state) => {
      const normalized = normalizeWorkspaceSessionSnapshot(session);
      updateGeneratedCounters(normalized);
      const removedSidebarMachineIds = normalized.removedSidebarMachineIds ?? [];
      const removedMachineIds = new Set(removedSidebarMachineIds);
      const machineGroups = addPersistentSidebarMachines(
        state.machineGroups,
        mergeSidebarMachines(
          localMachinesFromSession(normalized),
          dockerContainerMachinesFromSession(normalized),
          normalized.sidebarMachines,
        ).filter((machine) => !removedMachineIds.has(machine.id)),
      );

      const terminalTabs = sanitizeRestoredSftpTransferTabs(
        normalized.terminalTabs,
        machineGroups,
      );

      return {
        activeTabId: normalized.activeTabId,
        focusedPaneId: normalized.focusedPaneId,
        machineGroups,
        removedSidebarMachineIds,
        terminalPanes: syncTerminalPaneProductionFlags(
          normalized.terminalPanes,
          machineGroups,
        ),
        terminalTabGroupPreferences:
          normalized.terminalTabGroupPreferences ?? {},
        terminalTabs,
        selectedMachineId: restoredSelectedMachineId({
          activeTabId: normalized.activeTabId,
          fallbackSelectedMachineId: state.selectedMachineId,
          machineGroups,
          selectedMachineId: normalized.selectedMachineId,
          terminalTabs,
        }),
      };
    }),
  setActiveTool: (activeTool) =>
    set(() => {
      if (activeTool === null) {
        return { activeTool };
      }
      return isToolId(activeTool) ? { activeTool } : {};
    }),
  setMachineSearch: (machineSearch) => set({ machineSearch }),
  setBroadcastDraft: (broadcastDraft) => set({ broadcastDraft }),
}));

export function resetWorkspaceStore() {
  generatedPaneCount = 0;
  generatedTabCount = 0;
  generatedSplitCount = 0;
  useWorkspaceStore.setState(initialState);
}

export { machineGroups, terminalPanes, terminalTabs, tools };

function activeProfile(state: WorkspaceState) {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles.find((profile) => profile.isDefault) ??
    state.profiles[0]
  );
}

function addRemovedSidebarMachineId(machineIds: string[], machineId: string) {
  return machineIds.includes(machineId) ? machineIds : [...machineIds, machineId];
}

function removeRemovedSidebarMachineId(machineIds: string[], machineId: string) {
  return machineIds.includes(machineId)
    ? machineIds.filter((candidate) => candidate !== machineId)
    : machineIds;
}

function sanitizeRestoredSftpTransferTabs(
  tabs: TerminalTab[],
  machineGroups: MachineGroup[],
) {
  return tabs.map((tab) => {
    if (!isSftpTransferWorkspaceTab(tab)) {
      return tab;
    }

    const lockedLeftHostId = validSshHostId(machineGroups, tab.lockedLeftHostId);
    const leftHostId =
      lockedLeftHostId ?? validSshHostId(machineGroups, tab.leftHostId);
    const rightHostId = validSshHostId(machineGroups, tab.rightHostId);
    const machineHostId = validSshHostId(machineGroups, tab.machineId);
    const primaryHostId =
      rightHostId ?? lockedLeftHostId ?? leftHostId ?? machineHostId;

    return {
      ...tab,
      leftHostId: leftHostId ?? machineHostId,
      lockedLeftHostId,
      machineId: primaryHostId ?? "sftp-transfer",
      rightHostId,
    };
  });
}

function restoredSelectedMachineId({
  activeTabId,
  fallbackSelectedMachineId,
  machineGroups,
  selectedMachineId,
  terminalTabs,
}: {
  activeTabId: string;
  fallbackSelectedMachineId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalTabs: TerminalTab[];
}) {
  const activeTabCandidate = selectedMachineIdCandidateFromTab(
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0],
  );

  return (
    validMachineId(machineGroups, activeTabCandidate) ||
    activeTabCandidate ||
    validMachineId(machineGroups, selectedMachineId) ||
    pendingRemoteSelectionId(selectedMachineId) ||
    validMachineId(machineGroups, fallbackSelectedMachineId) ||
    ""
  );
}

function selectedMachineIdForUpdatedGroups({
  activeTabId,
  allowPendingActiveTabSelection,
  fallbackSelectedMachineId,
  machineGroups,
  terminalTabs,
}: {
  activeTabId: string;
  allowPendingActiveTabSelection: boolean;
  fallbackSelectedMachineId: string;
  machineGroups: MachineGroup[];
  terminalTabs: TerminalTab[];
}) {
  const activeTabCandidate = selectedMachineIdCandidateFromTab(
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0],
  );

  return (
    validMachineId(machineGroups, fallbackSelectedMachineId) ||
    validMachineId(machineGroups, activeTabCandidate) ||
    (allowPendingActiveTabSelection
      ? pendingRemoteSelectionId(fallbackSelectedMachineId) ||
        activeTabCandidate
      : "") ||
    ""
  );
}

function pendingRemoteSelectionId(machineId: string | undefined) {
  return machineId && machineId !== "sftp-transfer" ? machineId : "";
}

function selectedMachineIdFromWorkspaceTab(
  tab: TerminalTab | undefined,
  machineGroups: MachineGroup[],
) {
  return validMachineId(machineGroups, selectedMachineIdCandidateFromTab(tab));
}

function selectedMachineIdCandidateFromTab(tab: TerminalTab | undefined) {
  if (!tab) {
    return "";
  }
  if (isSftpTransferWorkspaceTab(tab)) {
    return (
      tab.rightHostId ||
      tab.lockedLeftHostId ||
      tab.leftHostId ||
      (tab.machineId === "sftp-transfer" ? "" : tab.machineId)
    );
  }
  return tab.machineId;
}

function validSshHostId(
  machineGroups: MachineGroup[],
  machineId: string | undefined,
) {
  const machine = machineId ? findMachine(machineGroups, machineId) : undefined;
  return machine?.kind === "ssh" ? machine.id : undefined;
}

function validMachineId(
  machineGroups: MachineGroup[],
  machineId: string | undefined,
) {
  if (!machineId || machineId === "sftp-transfer") {
    return "";
  }
  return findMachine(machineGroups, machineId)?.id ?? "";
}

function updateGeneratedCounters(session: WorkspaceSessionSnapshot) {
  const counters = maxGeneratedTerminalCounters(session);
  generatedPaneCount = Math.max(generatedPaneCount, counters.paneCount);
  generatedSplitCount = Math.max(generatedSplitCount, counters.splitCount);
  generatedTabCount = Math.max(generatedTabCount, counters.tabCount);
}
