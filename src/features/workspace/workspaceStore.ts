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
import {
  localTarget,
  serialTarget,
  sshTarget,
  telnetTarget,
} from "../../lib/targetModel";
import type { RemoteHostGroupWithHosts } from "../../lib/remoteHostApi";
import { machineGroups, terminalPanes, terminalTabs, tools } from "./workspaceData";
import {
  collectPaneIds,
  findFirstPaneId,
  removePaneFromLayout,
  splitPaneInLayout,
} from "./workspaceLayout";
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
  ToolId,
} from "./types";
import { isTerminalSessionTab, isToolId } from "./types";
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
  serialPortName,
  sortMachineGroups,
  syncLocalSidebarMachines,
  syncTerminalPaneProductionFlags,
  ungroupedGroupTitle,
  withUngroupedGroupTitle,
} from "./workspaceMachineModel";

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
  terminalPanes: TerminalPane[];
  activeTabId: string;
  selectedMachineId: string;
  focusedPaneId: string;
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
  terminalPanes,
  activeTabId: "",
  selectedMachineId: "",
  focusedPaneId: "",
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
      const selectedMachineExists = Boolean(
        findMachine(machineGroups, state.selectedMachineId),
      );

      return {
        activeProfileId: activeProfile.id,
        machineGroups,
        profiles: nextProfiles,
        selectedMachineId: selectedMachineExists
          ? state.selectedMachineId
          : machineGroups[0]?.machines[0]?.id ?? "",
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
      const selectedMachineExists = Boolean(
        findMachine(machineGroups, state.selectedMachineId),
      );

      return {
        machineGroups,
        selectedMachineId: selectedMachineExists
          ? state.selectedMachineId
          : machineGroups[0]?.machines[0]?.id ?? "",
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

      return {
        machineGroups: addDockerContainerMachineToGroup(
          state.machineGroups,
          machine,
          options?.groupId ?? hostMachine.remoteGroupId,
        ),
        selectedMachineId: machine.id,
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
      const activeTab = state.terminalTabs.find((tab) => tab.id === activeTabId);
      if (!activeTab) {
        return {};
      }
      const focusedPaneId = isTerminalSessionTab(activeTab)
        ? findFirstPaneId(activeTab.layout) ?? state.focusedPaneId
        : "";
      return { activeTabId, focusedPaneId };
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
      const pane: TerminalPane = {
        args: options?.args ?? profile?.args,
        cwd: options?.cwd ?? profile?.cwd,
        env: options?.env ?? profile?.env,
        id: paneId,
        profileId: profile?.id,
        shell: options?.shell ?? profile?.shell,
        title,
        machineId,
        mode: "local",
        prompt: "PS>",
        status: "online",
        target: localTarget(profile?.id),
        lines: [],
      };
      const tab: TerminalTab = {
        id: tabId,
        title,
        machineId: pane.machineId,
        layout: { type: "pane", paneId },
      };
      const machine: Machine = {
        args: pane.args,
        cwd: pane.cwd,
        description: pane.shell ?? profile?.shell ?? "本地会话",
        env: pane.env,
        id: machineId,
        kind: "local",
        name: title,
        profileId: persistedProfile?.id,
        remoteGroupId: options?.groupId,
        shell: pane.shell,
        status: "online",
        target: localTarget(persistedProfile?.id),
        tags: ["local"],
      };

      return {
        activeTabId: tabId,
        focusedPaneId: paneId,
        machineGroups: addMachineToGroup(
          state.machineGroups,
          machine,
          options?.groupId,
        ),
        selectedMachineId: machine.id,
        terminalPanes: [...state.terminalPanes, pane],
        terminalTabs: [...state.terminalTabs, tab],
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
      const primaryHost = rightHost ?? lockedLeftHost ?? leftHost;
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

      const existingTab = findTabForMachine(state, machine.id);
      if (existingTab) {
        return {
          activeTabId: existingTab.id,
          focusedPaneId: isTerminalSessionTab(existingTab)
            ? findFirstPaneId(existingTab.layout) ?? state.focusedPaneId
            : "",
          selectedMachineId: machine.id,
        };
      }

      const profile = machine.profileId
        ? state.profiles.find((candidate) => candidate.id === machine.profileId)
        : undefined;
      return createLocalTerminalTabState(state, {
        args: machine.args,
        cwd: machine.cwd,
        env: machine.env,
        groupId: machine.remoteGroupId,
        machineId: machine.id,
        profile,
        shell: machine.shell,
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
      const tabId = `tab-ssh-${generatedTabCount}`;
      const paneId = `pane-ssh-${generatedPaneCount}`;
      const hostLabel = machine.host ?? machine.name;
      const userLabel = machine.username ?? "ssh";
      const pane: TerminalPane = {
        id: paneId,
        latencyMs: machine.latencyMs,
        lines: [],
        machineId: machine.id,
        mode: "ssh",
        prompt: `${userLabel}@${hostLabel}:~$`,
        remoteHostId: machine.id,
        remoteHostProduction: machine.production ?? false,
        status: machine.status,
        target: sshTarget(machine.id),
        title: machine.name,
      };
      const tab: TerminalTab = {
        id: tabId,
        layout: { type: "pane", paneId },
        machineId: machine.id,
        title: machine.name,
      };

      return {
        activeTabId: tabId,
        focusedPaneId: paneId,
        selectedMachineId: machine.id,
        terminalPanes: [...state.terminalPanes, pane],
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  openTelnetTerminal: (hostId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, hostId);
      if (!machine || machine.kind !== "telnet") {
        return {};
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      const tabId = `tab-telnet-${generatedTabCount}`;
      const paneId = `pane-telnet-${generatedPaneCount}`;
      const hostLabel = machine.host ?? machine.name;
      const pane: TerminalPane = {
        id: paneId,
        latencyMs: machine.latencyMs,
        lines: [],
        machineId: machine.id,
        mode: "telnet",
        prompt: `${hostLabel}:${machine.port ?? 23}>`,
        remoteHostProduction: machine.production ?? false,
        status: machine.status,
        target: telnetTarget(machine.id),
        title: machine.name,
      };
      const tab: TerminalTab = {
        id: tabId,
        layout: { type: "pane", paneId },
        machineId: machine.id,
        title: machine.name,
      };

      return {
        activeTabId: tabId,
        focusedPaneId: paneId,
        selectedMachineId: machine.id,
        terminalPanes: [...state.terminalPanes, pane],
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  openSerialTerminal: (hostId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, hostId);
      if (!machine || machine.kind !== "serial") {
        return {};
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      const tabId = `tab-serial-${generatedTabCount}`;
      const paneId = `pane-serial-${generatedPaneCount}`;
      const serialPort = serialPortName(machine.tags) ?? machine.host ?? machine.name;
      const pane: TerminalPane = {
        id: paneId,
        latencyMs: machine.latencyMs,
        lines: [],
        machineId: machine.id,
        mode: "serial",
        prompt: `${serialPort}>`,
        remoteHostProduction: machine.production ?? false,
        status: machine.status,
        target: serialTarget(machine.id),
        title: machine.name,
      };
      const tab: TerminalTab = {
        id: tabId,
        layout: { type: "pane", paneId },
        machineId: machine.id,
        title: machine.name,
      };

      return {
        activeTabId: tabId,
        focusedPaneId: paneId,
        selectedMachineId: machine.id,
        terminalPanes: [...state.terminalPanes, pane],
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  openContainerTerminal: (machineId) =>
    set((state) => {
      const machine = findMachine(state.machineGroups, machineId);
      if (!machine || machine.kind !== "dockerContainer" || !machine.target) {
        return {};
      }

      const existingTab = findTabForMachine(state, machine.id);
      if (existingTab) {
        return {
          activeTabId: existingTab.id,
          focusedPaneId: isTerminalSessionTab(existingTab)
            ? findFirstPaneId(existingTab.layout) ?? state.focusedPaneId
            : "",
          selectedMachineId: machine.id,
        };
      }

      generatedTabCount += 1;
      generatedPaneCount += 1;
      const tabId = `tab-container-${generatedTabCount}`;
      const paneId = `pane-container-${generatedPaneCount}`;
      const pane: TerminalPane = {
        containerId: machine.containerId,
        id: paneId,
        lines: [],
        machineId: machine.id,
        mode: "container",
        prompt: `${machine.name}:/$`,
        remoteHostId: machine.parentMachineId,
        remoteHostProduction: machine.production ?? false,
        shell: machine.shell,
        status: machine.status,
        target: machine.target,
        title: machine.name,
      };
      const tab: TerminalTab = {
        id: tabId,
        layout: { type: "pane", paneId },
        machineId: machine.id,
        title: machine.name,
      };

      return {
        activeTabId: tabId,
        focusedPaneId: paneId,
        selectedMachineId: machine.id,
        terminalPanes: [...state.terminalPanes, pane],
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  closeTerminalTab: (tabId) =>
    set((state) => {
      const tab = state.terminalTabs.find((item) => item.id === tabId);
      if (!tab) {
        return {};
      }

      const paneIds = isTerminalSessionTab(tab) ? collectPaneIds(tab.layout) : [];
      const terminalTabs = state.terminalTabs.filter((item) => item.id !== tabId);
      const terminalPanes = state.terminalPanes.filter(
        (pane) => !paneIds.includes(pane.id),
      );
      const nextActiveTab =
        state.activeTabId === tabId
          ? terminalTabs[0]
          : terminalTabs.find((item) => item.id === state.activeTabId);
      const focusedPaneId =
        nextActiveTab && isTerminalSessionTab(nextActiveTab)
          ? findFirstPaneId(nextActiveTab.layout) ?? terminalPanes[0]?.id ?? ""
          : "";

      return {
        activeTabId: nextActiveTab?.id ?? "",
        focusedPaneId,
        terminalPanes,
        terminalTabs,
      };
    }),
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
  splitFocusedPane: (direction) =>
    set((state) => {
      const activeTab = state.terminalTabs.find(
        (tab) => tab.id === state.activeTabId,
      );
      const sourcePane = state.terminalPanes.find(
        (pane) => pane.id === state.focusedPaneId,
      );
      if (!activeTab || !isTerminalSessionTab(activeTab) || !sourcePane) {
        return {};
      }

      generatedPaneCount += 1;
      generatedSplitCount += 1;
      const panePrefix =
        sourcePane.mode === "ssh"
          ? "pane-ssh"
          : sourcePane.mode === "telnet"
            ? "pane-telnet"
            : sourcePane.mode === "serial"
              ? "pane-serial"
          : sourcePane.mode === "preview"
            ? "pane-preview"
            : "pane-local";
      const paneId = `${panePrefix}-${generatedPaneCount}`;
      const newPane: TerminalPane = {
        ...sourcePane,
        id: paneId,
        title: direction === "horizontal" ? "右侧分屏" : "下方分屏",
        machineId: sourcePane.machineId,
        mode: sourcePane.mode,
        lines: [],
      };
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === activeTab.id && isTerminalSessionTab(tab)
          ? {
              ...tab,
              layout: splitPaneInLayout(
                activeTab.layout,
                state.focusedPaneId,
                paneId,
                direction,
                `split-${generatedSplitCount}`,
              ),
            }
          : tab,
      );

      return {
        focusedPaneId: paneId,
        terminalPanes: [...state.terminalPanes, newPane],
        terminalTabs,
      };
    }),
  closePane: (paneId) =>
    set((state) => {
      const activeTab = state.terminalTabs.find(
        (tab) => tab.id === state.activeTabId,
      );
      if (
        !activeTab ||
        !isTerminalSessionTab(activeTab) ||
        collectPaneIds(activeTab.layout).length <= 1
      ) {
        return {};
      }

      const nextLayout = removePaneFromLayout(activeTab.layout, paneId);
      if (!nextLayout) {
        return {};
      }

      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === activeTab.id && isTerminalSessionTab(tab)
          ? { ...tab, layout: nextLayout }
          : tab,
      );
      const terminalPanes = state.terminalPanes.filter(
        (pane) => pane.id !== paneId,
      );
      const focusedPaneId =
        paneId === state.focusedPaneId
          ? findFirstPaneId(nextLayout) ?? state.focusedPaneId
          : state.focusedPaneId;

      return { focusedPaneId, terminalPanes, terminalTabs };
    }),
  focusPane: (focusedPaneId) => set({ focusedPaneId }),
  updatePaneCurrentCwd: (paneId, currentCwd) =>
    set((state) => ({
      terminalPanes: state.terminalPanes.map((pane) =>
        pane.id === paneId ? { ...pane, currentCwd } : pane,
      ),
    })),
  updatePaneOutputHistory: (paneId, outputHistory) =>
    set((state) => ({
      terminalPanes: state.terminalPanes.map((pane) =>
        pane.id === paneId ? { ...pane, outputHistory } : pane,
      ),
    })),
  restoreWorkspaceSession: (session) =>
    set((state) => {
      const normalized = normalizeWorkspaceSessionSnapshot(session);
      updateGeneratedCounters(normalized);
      const machineGroups = addPersistentSidebarMachines(
        state.machineGroups,
        mergeSidebarMachines(
          localMachinesFromSession(normalized),
          dockerContainerMachinesFromSession(normalized),
          normalized.sidebarMachines,
        ),
      );

      return {
        activeTabId: normalized.activeTabId,
        focusedPaneId: normalized.focusedPaneId,
        machineGroups,
        terminalPanes: syncTerminalPaneProductionFlags(
          normalized.terminalPanes,
          machineGroups,
        ),
        terminalTabs: normalized.terminalTabs,
        selectedMachineId:
          normalized.selectedMachineId || state.selectedMachineId || "",
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

function findTabForMachine(
  state: WorkspaceState,
  machineId: string,
): TerminalTab | undefined {
  const panesById = new Map(state.terminalPanes.map((pane) => [pane.id, pane]));
  return state.terminalTabs.find((tab) => {
    if (tab.machineId === machineId) {
      return true;
    }
    if (!isTerminalSessionTab(tab)) {
      return false;
    }
    return collectPaneIds(tab.layout).some((paneId) => {
      const pane = panesById.get(paneId);
      return pane?.machineId === machineId || pane?.remoteHostId === machineId;
    });
  });
}

function createLocalTerminalTabState(
  state: WorkspaceState,
  options: {
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    groupId?: string;
    machineId: string;
    profile?: TerminalProfile;
    shell?: string;
    title: string;
  },
) {
  generatedTabCount += 1;
  generatedPaneCount += 1;
  const tabId = `tab-local-${generatedTabCount}`;
  const paneId = `pane-local-${generatedPaneCount}`;
  const pane: TerminalPane = {
    args: options.args ?? options.profile?.args,
    cwd: options.cwd ?? options.profile?.cwd,
    env: options.env ?? options.profile?.env,
    id: paneId,
    profileId: options.profile?.id,
    shell: options.shell ?? options.profile?.shell,
    title: options.title,
    machineId: options.machineId,
    mode: "local",
    prompt: "PS>",
    status: "online",
    target: localTarget(options.profile?.id),
    lines: [],
  };
  const tab: TerminalTab = {
    id: tabId,
    title: options.title,
    machineId: options.machineId,
    layout: { type: "pane", paneId },
  };
  const machine: Machine = {
    args: pane.args,
    cwd: pane.cwd,
    description: pane.shell ?? options.profile?.shell ?? "本地会话",
    env: pane.env,
    id: options.machineId,
    kind: "local",
    name: options.title,
    profileId: options.profile?.id,
    remoteGroupId: options.groupId,
    shell: pane.shell,
    status: "online",
    target: localTarget(options.profile?.id),
    tags: ["local"],
  };

  return {
    activeTabId: tabId,
    focusedPaneId: paneId,
    machineGroups: addMachineToGroup(
      state.machineGroups,
      machine,
      options.groupId,
    ),
    selectedMachineId: machine.id,
    terminalPanes: [...state.terminalPanes, pane],
    terminalTabs: [...state.terminalTabs, tab],
  };
}

function updateGeneratedCounters(session: WorkspaceSessionSnapshot) {
  const counters = maxGeneratedTerminalCounters(session);
  generatedPaneCount = Math.max(generatedPaneCount, counters.paneCount);
  generatedSplitCount = Math.max(generatedSplitCount, counters.splitCount);
  generatedTabCount = Math.max(generatedTabCount, counters.tabCount);
}
