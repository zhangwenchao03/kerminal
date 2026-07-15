import { create } from "zustand";
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
} from "../settings/contracts/index";
import {
  browserPreviewProfiles,
  type TerminalProfile,
} from "../../lib/profileApi";
import type { DockerContainerSummary } from "../../lib/dockerApi";
import type { RemoteHostGroupWithHosts } from "../../lib/remoteHostApi";
import {
  machineGroups,
  terminalPanes,
  terminalTabs,
  tools,
} from "./workspaceData";
import type { TerminalPaneMovePlacement } from "./workspaceLayout";
import type { TerminalPaneMoveScope } from "../terminal/runtime/index";
import {
  maxGeneratedTerminalCounters,
  normalizeWorkspaceSessionSnapshot,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";
import type {
  MachineStatus,
  MachineGroup,
  SftpTransferWorkspaceTab,
  TerminalPane,
  TerminalSplitDirection,
  TerminalSplitLayoutSizes,
  TerminalTab,
  TerminalTabGroupPreferences,
  WorkspaceFileDirtyState,
  WorkspaceFileRevealRequest,
  WorkspaceFileTab,
} from "./types";
import { isWorkspaceFileTab } from "./types";
import {
  containerToMachine,
  findMachine,
  isPersistedLocalProfile,
  localMachineIdForProfile,
} from "./workspaceMachineModel";
import {
  addDockerContainerState,
  addLocalProfileMachineState,
  moveSidebarMachineState,
  pinMachineGroupState,
  removeSidebarMachineState,
  renameMachineGroupState,
  updateLocalMachineState,
} from "./workspaceMachineState";
import {
  closeTerminalPaneState,
  focusTerminalPaneState,
  moveTerminalPaneState,
  paneIdPrefixForSplitMachine,
  resolveFocusedPaneSplitTarget,
  selectTerminalTabState,
  splitFocusedPaneState,
  splitTargetPaneForMachine,
  updatePaneCurrentCwdState,
  updateTerminalSplitLayoutSizesState,
  updatePaneOutputHistoryState,
  updatePaneStatusState,
} from "./workspaceTerminalState";
import {
  createContainerTerminalOpenState,
  createLocalTerminalOpenState,
  focusExistingMachineTabState,
} from "./workspaceTerminalOpenState";
import { selectedMachineIdFromWorkspaceTab } from "./workspaceSelectionModel";
import {
  updateRemoteHostTreeState,
  updateWorkspaceProfilesState,
} from "./workspaceSidebarState";
import {
  buildWorkspaceFileTabKey,
  normalizeWorkspaceFilePath,
  titleForWorkspaceFilePath,
  workspaceFileMachineId,
  workspaceFileTargetHostId,
} from "./workspaceFileTabModel";
import {
  revealWorkspaceFileInSftpState,
  setWorkspaceFileTabDirtyState,
} from "./workspaceFileTabState";
import { restoreWorkspaceSessionState } from "./workspaceRestoreState";
import type {
  AddDockerContainerOptions,
  AddTerminalTabOptions,
  OpenSftpTransferTabOptions,
  OpenWorkspaceFileTabOptions,
  SplitFocusedPaneOptions,
  WorkspaceShellInteractionSlice,
} from "./workspaceStoreContract";
import {
  createWorkspaceShellInteractionSlice,
  initialWorkspaceShellInteractionState,
} from "./workspaceShellInteractionSlice";
import {
  createWorkspaceTerminalOpenActions,
  type WorkspaceTerminalOpenActions,
  type WorkspaceTerminalOpenCounterPort,
} from "./workspaceTerminalOpenActions";
import {
  createWorkspaceTerminalTabActions,
  type WorkspaceTerminalTabActions,
} from "./workspaceTerminalTabActions";

export type {
  AddDockerContainerOptions,
  AddTerminalTabOptions,
  OpenSftpTransferTabOptions,
  OpenSshCommandTerminalOptions,
  OpenWorkspaceFileTabOptions,
  SplitFocusedPaneOptions,
  TmuxAttachPlacement,
} from "./workspaceStoreContract";

export interface WorkspaceState
  extends WorkspaceShellInteractionSlice,
    WorkspaceTerminalOpenActions,
    WorkspaceTerminalTabActions {
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
  settings: AppSettings;
  workspaceFileDirtyState: WorkspaceFileDirtyState;
  workspaceFileRevealRequest: WorkspaceFileRevealRequest | null;
  setProfiles: (profiles: TerminalProfile[]) => void;
  setSettings: (settings: AppSettings) => void;
  selectProfile: (profileId: string) => void;
  setRemoteHostTree: (remoteGroups: RemoteHostGroupWithHosts[]) => void;
  addDockerContainer: (
    container: DockerContainerSummary,
    options?: AddDockerContainerOptions,
  ) => void;
  openDockerContainerTerminal: (
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
  openWorkspaceFileTab: (options: OpenWorkspaceFileTabOptions) => void;
  revealWorkspaceFileInSftp: (tabId: string) => void;
  setWorkspaceFileTabDirty: (tabId: string, dirty: boolean) => void;
  splitFocusedPane: (
    direction: TerminalSplitDirection,
    options?: SplitFocusedPaneOptions,
  ) => void;
  moveTerminalPane: (
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMovePlacement,
    scope?: TerminalPaneMoveScope,
  ) => void;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  updatePaneCurrentCwd: (paneId: string, currentCwd: string) => void;
  updateTerminalSplitLayoutSizes: (
    splitId: string,
    sizes: TerminalSplitLayoutSizes,
  ) => void;
  updatePaneOutputHistory: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  updatePaneStatus: (paneId: string, status: MachineStatus) => void;
  restoreWorkspaceSession: (session: WorkspaceSessionSnapshot) => void;
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
  ...initialWorkspaceShellInteractionState,
  settings: defaultAppSettings,
  workspaceFileDirtyState: {},
  workspaceFileRevealRequest: null,
};

let generatedPaneCount = terminalPanes.length;
let generatedTabCount = terminalTabs.length;
let generatedSplitCount = 0;

const terminalOpenCounterPort: WorkspaceTerminalOpenCounterPort = {
  commitTmuxConsumption: ({ pane, split, tab }) => {
    generatedPaneCount += pane ? 1 : 0;
    generatedSplitCount += split ? 1 : 0;
    generatedTabCount += tab ? 1 : 0;
  },
  nextPaneId: (prefix) => `${prefix}-${(generatedPaneCount += 1)}`,
  nextTabId: (prefix) => `${prefix}-${(generatedTabCount += 1)}`,
  previewTmuxIds: () => ({
    localMachineId: `machine-tmux-local-${generatedTabCount + 1}`,
    paneId: `pane-tmux-${generatedPaneCount + 1}`,
    splitId: `split-${generatedSplitCount + 1}`,
    tabId: `tab-tmux-${generatedTabCount + 1}`,
  }),
};

export const useWorkspaceStore = create<WorkspaceState>()((set, get, store) => ({
  ...initialState,
  ...createWorkspaceShellInteractionSlice(set, get, store),
  ...createWorkspaceTerminalOpenActions(terminalOpenCounterPort)(set, get, store),
  ...createWorkspaceTerminalTabActions(set, get, store),
  setProfiles: (profiles) =>
    set((state) => updateWorkspaceProfilesState(state, profiles)),
  setSettings: (settings) => set({ settings: normalizeAppSettings(settings) }),
  selectProfile: (activeProfileId) => set({ activeProfileId }),
  setRemoteHostTree: (remoteGroups) =>
    set((state) => updateRemoteHostTreeState(state, remoteGroups)),
  addDockerContainer: (container, options) =>
    set((state) => addDockerContainerState(state, container, options)),
  openDockerContainerTerminal: (container, options) =>
    set((state) => {
      if (container.status !== "running") {
        return {};
      }

      const hostMachine = findMachine(state.machineGroups, container.hostId);
      if (!hostMachine || hostMachine.kind !== "ssh") {
        return {};
      }

      const machine = containerToMachine(container, hostMachine, options);
      const focusState = focusExistingMachineTabState(state, machine.id);
      if (focusState) {
        return focusState;
      }

      generatedPaneCount += 1;
      generatedTabCount += 1;

      return createContainerTerminalOpenState(state, machine, {
        paneId: `pane-container-${generatedPaneCount}`,
        tabId: `tab-container-${generatedTabCount}`,
      });
    }),
  addLocalProfileMachine: (profile, groupId) =>
    set((state) => addLocalProfileMachineState(state, profile, groupId)),
  moveSidebarMachine: (machineId, groupId) =>
    set((state) => moveSidebarMachineState(state, machineId, groupId)),
  pinMachineGroup: (groupId, pinned = true) =>
    set((state) => pinMachineGroupState(state, groupId, pinned)),
  removeSidebarMachine: (machineId) =>
    set((state) => removeSidebarMachineState(state, machineId)),
  renameMachineGroup: (groupId, title) =>
    set((state) => renameMachineGroupState(state, groupId, title)),
  updateLocalMachine: (machineId, options) =>
    set((state) => updateLocalMachineState(state, machineId, options)),
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
        requestedProfile ??
        (usesDirectRuntimeConfig ? undefined : activeProfile(state));
      const persistedProfile =
        profile && isPersistedLocalProfile(profile) ? profile : undefined;
      const tabId = `tab-local-${generatedTabCount}`;
      const paneId = `pane-local-${generatedPaneCount}`;
      const title =
        options?.title ?? profile?.name ?? `本地终端 ${generatedTabCount}`;
      const machineId = persistedProfile
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
        tmuxBinding: options?.tmuxBinding,
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
        selectedMachineId: primaryHostId ?? state.selectedMachineId,
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  openWorkspaceFileTab: (options) =>
    set((state) => {
      const path = normalizeWorkspaceFilePath(options.path);
      const rootPath = options.rootPath
        ? normalizeWorkspaceFilePath(options.rootPath)
        : undefined;
      const tabKey = buildWorkspaceFileTabKey({
        access: options.access,
        path,
        source: options.source,
        target: options.target,
      });
      const existingTab = state.terminalTabs.find(
        (tab) =>
          isWorkspaceFileTab(tab) &&
          buildWorkspaceFileTabKey({
            access: tab.access,
            path: tab.path,
            source: tab.source,
            target: tab.target,
          }) === tabKey,
      );
      const selectedMachineId =
        workspaceFileTargetHostId(options.target) ??
        workspaceFileMachineId(options.target);

      if (existingTab) {
        return {
          activeTabId: existingTab.id,
          focusedPaneId: "",
          selectedMachineId,
        };
      }

      generatedTabCount += 1;
      const tabId = `tab-workspace-file-${generatedTabCount}`;
      const title = options.title?.trim() || titleForWorkspaceFilePath(path);
      const tab: WorkspaceFileTab = {
        access: options.access,
        id: tabId,
        kind: "workspaceFile",
        machineId: workspaceFileMachineId(options.target),
        path,
        ...(rootPath ? { rootPath } : {}),
        source: options.source,
        target: options.target,
        title,
      };

      return {
        activeTabId: tabId,
        focusedPaneId: "",
        selectedMachineId,
        terminalTabs: [...state.terminalTabs, tab],
      };
    }),
  setWorkspaceFileTabDirty: (tabId, dirty) =>
    set((state) => setWorkspaceFileTabDirtyState(state, tabId, dirty)),
  revealWorkspaceFileInSftp: (tabId) =>
    set((state) =>
      revealWorkspaceFileInSftpState(state.terminalTabs, tabId, Date.now()),
    ),
  splitFocusedPane: (direction, options) =>
    set((state) => {
      const splitTarget = resolveFocusedPaneSplitTarget(
        state,
        options?.sourcePaneId,
      );
      if (!splitTarget) {
        return {};
      }
      const targetMachine = options?.targetMachineId
        ? findMachine(state.machineGroups, options.targetMachineId)
        : undefined;
      if (options?.targetMachineId && !targetMachine) {
        return {};
      }
      const targetPaneIdPrefix = targetMachine
        ? paneIdPrefixForSplitMachine(targetMachine)
        : undefined;
      if (targetMachine && !targetPaneIdPrefix) {
        return {};
      }

      generatedPaneCount += 1;
      generatedSplitCount += 1;
      const paneId = `${
        targetPaneIdPrefix ?? splitTarget.paneIdPrefix
      }-${generatedPaneCount}`;
      const targetPane = targetMachine
        ? splitTargetPaneForMachine(targetMachine, paneId)
        : undefined;
      if (targetMachine && !targetPane) {
        return {};
      }
      const splitPatch = splitFocusedPaneState(state, {
        direction,
        paneId,
        placement: options?.placement,
        sourcePaneId: splitTarget.sourcePaneId,
        splitId: `split-${generatedSplitCount}`,
        ...(targetPane ? { targetPane } : {}),
      });
      if (targetPane && "focusedPaneId" in splitPatch) {
        return { ...splitPatch, selectedMachineId: targetPane.machineId };
      }
      return splitPatch;
    }),
  moveTerminalPane: (sourcePaneId, targetPaneId, placement, scope) =>
    set((state) => {
      if (sourcePaneId === targetPaneId) {
        return {};
      }

      generatedSplitCount += 1;
      return moveTerminalPaneState(state, {
        placement,
        scope,
        sourcePaneId,
        splitId: `split-${generatedSplitCount}`,
        targetPaneId,
      });
    }),
  closePane: (paneId) => set((state) => closeTerminalPaneState(state, paneId)),
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
  restoreWorkspaceSession: (session) =>
    set((state) => {
      const normalized = normalizeWorkspaceSessionSnapshot(session);
      updateGeneratedCounters(normalized);
      return restoreWorkspaceSessionState(state, normalized);
    }),
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

function removeRemovedSidebarMachineId(
  machineIds: string[],
  machineId: string,
) {
  return machineIds.includes(machineId)
    ? machineIds.filter((candidate) => candidate !== machineId)
    : machineIds;
}

function updateGeneratedCounters(session: WorkspaceSessionSnapshot) {
  const counters = maxGeneratedTerminalCounters(session);
  generatedPaneCount = Math.max(generatedPaneCount, counters.paneCount);
  generatedSplitCount = Math.max(generatedSplitCount, counters.splitCount);
  generatedTabCount = Math.max(generatedTabCount, counters.tabCount);
}
