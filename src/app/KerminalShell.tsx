import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MachineSidebarViewMode } from "../features/machine-sidebar/MachineSidebar.shared";
import type {
  SettingsSaveState,
  SettingsSectionId,
} from "../features/settings/SettingsToolContent";
import {
  resolveThemeMode,
  type AppSettings,
} from "../features/settings/settingsModel";
import { writeBroadcastCommand } from "../features/terminal/terminalSessionRegistry";
import { useWorkspaceStore } from "../features/workspace/workspaceStore";
import type { DockerContainerSummary } from "../lib/dockerApi";
import { resolveDesktopPlatform } from "../lib/desktopPlatform";
import {
  createRemoteHostGroup,
  updateRemoteHost,
  type RemoteHost,
} from "../lib/remoteHostApi";
import { useDocumentTheme } from "../lib/useDocumentTheme";
import { useTauriWindowFrameState } from "../lib/useTauriWindowFrameState";
import { resolveWindowChromeModel } from "../lib/windowChromeModel";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import type { ToolId } from "../features/workspace/types";
import {
  htmlLanguage,
  isRealRemoteGroup,
  useSystemThemePreference,
  useViewportWidth,
} from "./KerminalShell.helpers";
import { useKerminalShellRemoteActions } from "./useKerminalShellRemoteActions";
import { useKerminalShellBackgroundStyle } from "./useKerminalShellBackgroundStyle";
import { useKerminalShellCommands } from "./useKerminalShellCommands";
import { useKerminalShellContainerActions } from "./useKerminalShellContainerActions";
import { useKerminalShellConfigRefresh } from "./useKerminalShellConfigRefresh";
import { useKerminalShellPanelResize } from "./useKerminalShellPanelResize";
import { useKerminalShellSettings } from "./useKerminalShellSettings";
import { useKerminalShellTabClose } from "./useKerminalShellTabClose";
import {
  DEFAULT_REMOTE_GROUP_NAME,
  DEFAULT_SETTINGS_SECTION_ID,
} from "./KerminalShell.static";
import {
  resolveConnectionEditConflict,
  resolveRemoteGroupEditConflict,
} from "./configDirtyGuardModel";
import { KerminalShellLayout } from "./KerminalShell.layout";
import { useKerminalShellStartupSync } from "./useKerminalShellStartupSync";
import { useKerminalShellTerminalDrop } from "./useKerminalShellTerminalDrop";
import {
  isSftpCapableRemoteHost,
  shellQuote,
} from "./KerminalShell.contextWorkspaceShellHelpers";
import {
  SNIPPET_PANEL_OPEN_EVENT,
  type SnippetPanelOpenRequest,
} from "../features/snippets/snippetPanelEvents";

export function KerminalShell() {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const focusedPaneId = useWorkspaceStore((state) => state.focusedPaneId);
  const machineGroups = useWorkspaceStore((state) => state.machineGroups);
  const machineSearch = useWorkspaceStore((state) => state.machineSearch);
  const selectedMachineId = useWorkspaceStore(
    (state) => state.selectedMachineId,
  );
  const addDockerContainer = useWorkspaceStore(
    (state) => state.addDockerContainer,
  );
  const addLocalProfileMachine = useWorkspaceStore(
    (state) => state.addLocalProfileMachine,
  );
  const focusPane = useWorkspaceStore((state) => state.focusPane);
  const addTerminalTab = useWorkspaceStore((state) => state.addTerminalTab);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const closeTerminalTab = useWorkspaceStore((state) => state.closeTerminalTab);
  const openLocalTerminal = useWorkspaceStore(
    (state) => state.openLocalTerminal,
  );
  const openContainerTerminal = useWorkspaceStore(
    (state) => state.openContainerTerminal,
  );
  const openDockerContainerTerminal = useWorkspaceStore(
    (state) => state.openDockerContainerTerminal,
  );
  const openSshTerminal = useWorkspaceStore((state) => state.openSshTerminal);
  const openSshCommandTerminal = useWorkspaceStore(
    (state) => state.openSshCommandTerminal,
  );
  const openTelnetTerminal = useWorkspaceStore(
    (state) => state.openTelnetTerminal,
  );
  const openSerialTerminal = useWorkspaceStore(
    (state) => state.openSerialTerminal,
  );
  const openSftpTransferTab = useWorkspaceStore(
    (state) => state.openSftpTransferTab,
  );
  const openWorkspaceFileTab = useWorkspaceStore(
    (state) => state.openWorkspaceFileTab,
  );
  const removeSidebarMachine = useWorkspaceStore(
    (state) => state.removeSidebarMachine,
  );
  const renameMachineGroup = useWorkspaceStore(
    (state) => state.renameMachineGroup,
  );
  const selectMachine = useWorkspaceStore((state) => state.selectMachine);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const setMachineSearch = useWorkspaceStore((state) => state.setMachineSearch);
  const setProfiles = useWorkspaceStore((state) => state.setProfiles);
  const setRemoteHostTree = useWorkspaceStore(
    (state) => state.setRemoteHostTree,
  );
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const updateLocalMachine = useWorkspaceStore(
    (state) => state.updateLocalMachine,
  );
  const moveSidebarMachine = useWorkspaceStore(
    (state) => state.moveSidebarMachine,
  );
  const pinMachineGroup = useWorkspaceStore((state) => state.pinMachineGroup);
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);
  const workspaceFileDirtyState = useWorkspaceStore(
    (state) => state.workspaceFileDirtyState,
  );
  const profiles = useWorkspaceStore((state) => state.profiles);
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const settings = useWorkspaceStore((state) => state.settings);
  const setSettings = useWorkspaceStore((state) => state.setSettings);
  const viewportWidth = useViewportWidth();
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsInitialSectionId, setSettingsInitialSectionId] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ID);
  const [shellNoticeVisible, setShellNoticeVisible] = useState(false);
  const [pendingSftpHostTarget, setPendingSftpHostTarget] =
    useState<SftpTransferCreateHostRequest | null>(null);
  const [createdSftpHostTarget, setCreatedSftpHostTarget] =
    useState<SftpTransferCreatedHostTarget>();
  const [machineSidebarView, setMachineSidebarView] =
    useState<MachineSidebarViewMode>("hosts");
  const [hostContainersHostId, setHostContainersHostId] = useState<
    string | null
  >(null);
  const [
    hostContainersInitialContainerId,
    setHostContainersInitialContainerId,
  ] = useState<string>();
  const workspaceFrameRef = useRef<HTMLDivElement>(null);
  const createdSftpHostSequenceRef = useRef(0);
  const settingsDialogDirtyRef = useRef(false);
  const settingsDialogOpenRef = useRef(settingsDialogOpen);
  const settingsSaveStateRef = useRef<SettingsSaveState>("idle");
  const {
    handleSettingsChange,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
  } = useKerminalShellSettings({ setSettings });
  settingsDialogOpenRef.current = settingsDialogOpen;
  settingsSaveStateRef.current = settingsSaveState;
  const systemPrefersDark = useSystemThemePreference();
  const resolvedTheme = resolveThemeMode(settings.themeMode, systemPrefersDark);
  const desktopPlatform = resolveDesktopPlatform();
  const windowFrameState = useTauriWindowFrameState();
  const windowChrome = resolveWindowChromeModel({
    frameState: windowFrameState,
    platform: desktopPlatform,
  });
  const reserveRightTitleBarControls = windowChrome.controlMode === "custom";
  useDocumentTheme({
    density: settings.interfaceDensity,
    desktopPlatform,
    language: settings.appearance.interfaceLanguage,
    lang: htmlLanguage(settings.appearance.interfaceLanguage),
    theme: resolvedTheme,
    windowFrame: windowFrameState,
  });
  const {
    beginPanelResize,
    collapsedMachineGroupIds,
    compactShell,
    effectiveLeftPanelCollapsed,
    effectiveRightPanelOpen,
    gridTemplateColumns,
    handleCollapsedMachineGroupIdsChange,
    handleWorkspaceShellLayoutRestored,
    leftPanelCollapsed,
    resizeWithKeyboard,
    rightWorkspaceInset,
    setLeftPanelCollapsed,
    workspaceShellLayout,
  } = useKerminalShellPanelResize({
    activeTool,
    viewportWidth,
    workspaceFrameRef,
  });
  const rightToolRailTitleBarFillWidth =
    activeTool === null || compactShell
      ? 44
      : settings.interfaceDensity === "spacious"
        ? 56
        : settings.interfaceDensity === "compact"
          ? 44
          : 48;
  const workspaceBackgroundStyle = useKerminalShellBackgroundStyle({
    resolvedTheme,
    settings,
  });
  const defaultRemoteGroupId =
    machineGroups.find(
      (group) =>
        isRealRemoteGroup(group) &&
        group.title.trim() === DEFAULT_REMOTE_GROUP_NAME,
    )?.id ?? machineGroups.find(isRealRemoteGroup)?.id;
  const defaultRemoteHostId = machineGroups
    .find((group) => group.id !== "local")
    ?.machines.find((machine) => machine.kind === "ssh")?.id;
  const leftTitleBarInset = effectiveLeftPanelCollapsed
    ? windowChrome.reserveTrafficLightInset
      ? 112
      : 48
    : 0;
  const handleBroadcastCommand = useCallback(writeBroadcastCommand, []);
  const {
    handleExternalMachineDrag,
    handleExternalMachineDragEnd,
    handleExternalMachineDrop,
    terminalSplitDropIndicator,
  } = useKerminalShellTerminalDrop({
    activeTabId,
    focusedPaneId,
    splitFocusedPane,
    terminalTabs,
  });
  const openSettingsTool = useCallback(
    (sectionId: SettingsSectionId = DEFAULT_SETTINGS_SECTION_ID) => {
      settingsDialogDirtyRef.current = false;
      settingsDialogOpenRef.current = true;
      setSettingsInitialSectionId(sectionId);
      setSettingsDialogOpen(true);
    },
    [],
  );
  const {
    cancelDirtyFileTabs,
    cancelTerminalTabs,
    confirmDirtyFileTabs,
    confirmTerminalTabs,
    dirtyFileTabCount,
    pendingDirtyFileTabCount,
    pendingTerminalTabCount,
    requestCloseTab,
  } = useKerminalShellTabClose({
    closeTerminalTab,
    confirmTerminalClose: settings.terminal.confirmCloseTab,
    terminalTabs,
    workspaceFileDirtyState,
  });
  const { activateTool, openLogsTool } = useKerminalShellCommands({
    activeTabId,
    activeTool,
    addTerminalTab,
    closePane,
    closeTerminalTab: requestCloseTab,
    focusPane,
    focusedPaneId,
    keybindings: settings.keybindings,
    openSettingsTool,
    selectTab,
    setActiveTool,
    splitFocusedPane,
    terminalTabs,
  });
  const activateShellTool = useCallback(
    (toolId: ToolId) => {
      activateTool(toolId);
    },
    [activateTool],
  );
  useEffect(() => {
    const handleSnippetPanelOpen = (event: Event) => {
      const request = (event as CustomEvent<SnippetPanelOpenRequest>).detail;
      if (!request?.snippetId) return;
      if (request.paneId) focusPane(request.paneId);
      activateShellTool("snippets");
    };
    window.addEventListener(SNIPPET_PANEL_OPEN_EVENT, handleSnippetPanelOpen);
    return () =>
      window.removeEventListener(SNIPPET_PANEL_OPEN_EVENT, handleSnippetPanelOpen);
  }, [activateShellTool, focusPane]);
  const selectHostContainersHost = useCallback(
    (machineId: string) => {
      selectMachine(machineId);
      setHostContainersHostId(machineId);
      setHostContainersInitialContainerId(undefined);
    },
    [selectMachine],
  );
  const openSftpForMachine = useCallback(
    (machineId: string) => {
      selectMachine(machineId);
      setActiveTool("sftp");
    },
    [selectMachine, setActiveTool],
  );
  const openSftpTransferWorkbench = useCallback(
    (machineId?: string) => {
      openSftpTransferTab(
        machineId
          ? {
              rightHostId: machineId,
            }
          : undefined,
      );
      setActiveTool(null);
    },
    [openSftpTransferTab, setActiveTool],
  );
  const openHostContainersSidebar = useCallback(
    (machineId: string, initialContainerId?: string) => {
      selectMachine(machineId);
      setHostContainersHostId(machineId);
      setHostContainersInitialContainerId(initialContainerId);
      setMachineSidebarView("containers");
      if (activeTool === "containers") {
        setActiveTool(null);
      }
    },
    [activeTool, selectMachine, setActiveTool],
  );
  const openContainerDetails = useCallback(
    (machineId: string) => {
      const machine = machineGroups
        .flatMap((group) => group.machines)
        .find((candidate) => candidate.id === machineId);
      if (
        !machine ||
        machine.kind !== "dockerContainer" ||
        !machine.parentMachineId ||
        !machine.containerId
      ) {
        return;
      }

      selectMachine(machine.parentMachineId);
      setHostContainersHostId(machine.parentMachineId);
      setHostContainersInitialContainerId(machine.containerId);
      setMachineSidebarView("containers");
      if (activeTool === "containers") {
        setActiveTool(null);
      }
    },
    [activeTool, machineGroups, selectMachine, setActiveTool],
  );
  const enterHostContainer = useCallback(
    (container: DockerContainerSummary) => {
      setActiveTool(null);
      openDockerContainerTerminal(container);
    },
    [openDockerContainerTerminal, setActiveTool],
  );
  const openHostContainerLogs = useCallback(
    (container: DockerContainerSummary) => {
      const runtimeBin = container.runtime === "podman" ? "podman" : "docker";
      openSshCommandTerminal(container.hostId, {
        remoteCommand: `${runtimeBin} logs -f --tail 200 ${shellQuote(container.id)}`,
        title: `${container.name} logs`,
      });
      setActiveTool(null);
      setHostContainersHostId(null);
      setHostContainersInitialContainerId(undefined);
    },
    [openSshCommandTerminal, setActiveTool],
  );
  const {
    closeConnectionDialog,
    closeRemoteGroupDialog,
    confirmDelete,
    deleteError,
    deleteSaving,
    editingLocalMachine,
    editingRemoteGroup,
    editingRemoteHost,
    handleCreateLocalProfile,
    handleCreateRemoteHost,
    handleDuplicateMachine,
    handleMoveMachineToGroup,
    handlePinMachineGroup,
    handleRemoteGroupSaved,
    handleRemoteGroupUpdate,
    handleRemoteHostCreated,
    handleUpdateLocalProfile,
    openConnectionDialog,
    openRemoteGroupDialog,
    openSavedRdpMachine,
    pendingDelete,
    profileLoadError,
    refreshProfiles,
    refreshRemoteHostTree,
    rdpOpeningMachineIds,
    remoteGroupDialogOpen,
    remoteHostDefaultGroupId,
    remoteHostDefaultMode,
    remoteHostDialogOpen,
    remoteHostLoadError,
    requestDeleteGroup,
    requestDeleteMachine,
    resolveTargetGroupId,
    setDeleteError,
    setPendingDelete,
    setProfileLoadError,
  } = useKerminalShellRemoteActions({
    activeProfileId,
    addLocalProfileMachine,
    addTerminalTab,
    defaultRemoteGroupId,
    machineGroups,
    moveSidebarMachine,
    pinMachineGroup,
    profiles,
    removeSidebarMachine,
    renameMachineGroup,
    selectMachine,
    setProfiles,
    setRemoteHostTree,
    updateLocalMachine,
  });
  const {
    configCatalogRevisions,
    configNotice,
    configRefreshCoordinator,
    setConfigNotice,
  } = useKerminalShellConfigRefresh({
    machineGroups,
    profiles,
    refreshProfiles,
    refreshRemoteHostTree,
    setSettings,
    settings,
    settingsDialogDirtyRef,
    settingsDialogOpenRef,
    settingsSaveStateRef,
  });
  const handleSettingsDialogChange = useCallback(
    (nextSettings: AppSettings) => {
      settingsDialogDirtyRef.current = true;
      handleSettingsChange(nextSettings);
    },
    [handleSettingsChange],
  );
  const handleSettingsDialogClose = useCallback(() => {
    settingsDialogDirtyRef.current = false;
    settingsDialogOpenRef.current = false;
    setSettingsDialogOpen(false);
  }, []);
  const connectionConfigConflict = useMemo(
    () =>
      resolveConnectionEditConflict({
        editingHost: editingRemoteHost,
        editingLocalMachine,
        groups: machineGroups,
      }),
    [editingLocalMachine, editingRemoteHost, machineGroups],
  );
  const remoteGroupConfigConflict = useMemo(
    () =>
      resolveRemoteGroupEditConflict({
        group: editingRemoteGroup,
        groups: machineGroups,
      }),
    [editingRemoteGroup, machineGroups],
  );
  const {
    fetchContainerStats,
    inspectContainer,
    listDockerContainers: loadDockerContainers,
    pinHostContainer,
    runHostContainerLifecycleAction,
  } = useKerminalShellContainerActions({
    addDockerContainer,
    defaultRemoteGroupId,
    machineGroups,
    resolveTargetGroupId,
  });
  const shellNoticeMessage =
    profileLoadError ?? remoteHostLoadError ?? settingsLoadError;
  const openSftpTransferHostCreateDialog = useCallback(
    (request: SftpTransferCreateHostRequest) => {
      if (!request.workspaceTabId) {
        return;
      }
      setPendingSftpHostTarget(request);
      openConnectionDialog({ mode: "ssh" });
    },
    [openConnectionDialog],
  );
  const handleConnectionDialogClose = useCallback(() => {
    setPendingSftpHostTarget(null);
    closeConnectionDialog();
  }, [closeConnectionDialog]);
  const handleConnectionDialogCreated = useCallback(
    async (host: RemoteHost) => {
      await handleRemoteHostCreated(host);
      if (pendingSftpHostTarget && isSftpCapableRemoteHost(host)) {
        createdSftpHostSequenceRef.current += 1;
        setCreatedSftpHostTarget({
          hostId: host.id,
          sequence: createdSftpHostSequenceRef.current,
          side: pendingSftpHostTarget.side,
          workspaceTabId: pendingSftpHostTarget.workspaceTabId,
        });
      }
      setPendingSftpHostTarget(null);
    },
    [handleRemoteHostCreated, pendingSftpHostTarget],
  );
  useKerminalShellStartupSync({
    configRefreshCoordinator, handleWorkspaceShellLayoutRestored,
    refreshRemoteHostTree, settingsDialogDirtyRef, settingsSaveState,
    setProfileLoadError, setProfiles, setShellNoticeVisible,
    shellNoticeMessage, workspaceShellLayout,
  });

  return (
    <KerminalShellLayout
      activeTool={activeTool}
      compactShell={compactShell}
      contextWorkspaceProps={{ onOpenSettings: openSettingsTool }}
      deleteDialogProps={{
        deleteError, deleting: deleteSaving, pendingDelete,
        onConfirm: () => void confirmDelete(),
        onClose: () => {
          if (!deleteSaving) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        },
      }}
      frame={{
        backgroundStyle: workspaceBackgroundStyle, density: settings.interfaceDensity,
        desktopPlatform, gridTemplateColumns,
        lang: htmlLanguage(settings.appearance.interfaceLanguage),
        language: settings.appearance.interfaceLanguage, resolvedTheme,
        windowFrameState, workspaceFrameRef,
      }}
      leftSeparatorProps={{
        className: "kerminal-shell-separator col-[2/3] row-[2/3]",
        hidden: effectiveLeftPanelCollapsed, label: "调整主机侧边栏宽度",
        onKeyDown: (event) => resizeWithKeyboard("left", event),
        onPointerDown: (event) => beginPanelResize("left", event),
      }}
      machineSidebarProps={effectiveLeftPanelCollapsed ? null : {
        activeView: machineSidebarView, collapsed: false, collapsedGroupIds: collapsedMachineGroupIds,
        containerHostId: hostContainersHostId, containerInitialContainerId: hostContainersInitialContainerId,
        groups: machineGroups, onActiveViewChange: setMachineSidebarView,
        onAddConnection: openConnectionDialog, onAddGroup: openRemoteGroupDialog,
        onAddMachine: (groupId) => openConnectionDialog({ groupId, mode: "ssh" }),
        onCollapsedGroupIdsChange: handleCollapsedMachineGroupIdsChange,
        onContainerHostChange: selectHostContainersHost, onDeleteGroup: requestDeleteGroup,
        onDeleteMachine: requestDeleteMachine,
        onDuplicateMachine: (machineId) => void handleDuplicateMachine(machineId),
        onEditGroup: openRemoteGroupDialog, onEditMachine: (hostId) => openConnectionDialog({ hostId }),
        onEnterContainer: enterHostContainer, onExternalMachineDrag: handleExternalMachineDrag,
        onExternalMachineDragEnd: handleExternalMachineDragEnd,
        onExternalMachineDrop: handleExternalMachineDrop,
        onFetchContainerStats: fetchContainerStats, onInspectContainer: inspectContainer,
        onLifecycleContainer: runHostContainerLifecycleAction, onListDockerContainers: loadDockerContainers,
        onMoveMachine: (machineId, groupId) => void handleMoveMachineToGroup(machineId, groupId),
        onOpenContainerDetails: openContainerDetails,
        onOpenContainerLogs: openHostContainerLogs, onOpenContainerTerminal: openContainerTerminal,
        onOpenHostContainers: openHostContainersSidebar, onOpenLocalTerminal: openLocalTerminal,
        onOpenRdpConnection: openSavedRdpMachine, onOpenSerialTerminal: openSerialTerminal,
        onOpenSettings: openSettingsTool, onOpenSftp: openSftpForMachine,
        onOpenSftpTransferWorkbench: openSftpTransferWorkbench,
        onOpenSshTerminal: openSshTerminal, onOpenTelnetTerminal: openTelnetTerminal,
        onOpenTransferWorkbench: openSftpTransferWorkbench,
        onOpenWorkspaceFileTab: openWorkspaceFileTab,
        onPinContainer: pinHostContainer,
        onPinGroup: (groupId, pinned) => void handlePinMachineGroup(groupId, pinned),
        onSearchChange: setMachineSearch, onSelectMachine: selectMachine,
        rdpOpeningMachineIds, search: machineSearch, selectedMachineId,
        settingsSelected: settingsDialogOpen,
      }}
      noticesProps={{
        configNotice, shellNoticeMessage, shellNoticeVisible,
        onConfigNoticeDismiss: () => setConfigNotice(null),
        onShellNoticeDismiss: () => setShellNoticeVisible(false),
      }}
      onActiveToolChange={activateShellTool}
      onCloseToolPanel={() => setActiveTool(null)}
      remoteGroupDialogProps={remoteGroupDialogOpen ? {
        externalConfigConflict: remoteGroupConfigConflict?.message, group: editingRemoteGroup,
        onClose: closeRemoteGroupDialog, onCreateGroup: createRemoteHostGroup,
        onCreated: handleRemoteGroupSaved, onUpdateGroup: handleRemoteGroupUpdate,
        open: remoteGroupDialogOpen,
      } : null}
      remoteHostDialogProps={remoteHostDialogOpen ? {
        defaultGroupId: remoteHostDefaultGroupId ?? defaultRemoteGroupId,
        defaultMode: remoteHostDefaultMode, editingHost: editingRemoteHost,
        editingLocalMachine, externalConfigConflict: connectionConfigConflict?.message,
        groups: machineGroups, onClose: handleConnectionDialogClose,
        onCreateGroup: createRemoteHostGroup, onCreateHost: handleCreateRemoteHost,
        onCreateLocal: handleCreateLocalProfile, onCreated: handleConnectionDialogCreated,
        onGroupCreated: handleRemoteGroupSaved, onUpdateHost: updateRemoteHost,
        onUpdateLocal: handleUpdateLocalProfile, open: remoteHostDialogOpen,
      } : null}
      rightSeparatorProps={{
        className: "kerminal-shell-separator relative z-20",
        hidden: !effectiveRightPanelOpen, label: "调整工具面板宽度",
        onKeyDown: (event) => resizeWithKeyboard("tools", event),
        onPointerDown: (event) => beginPanelResize("tools", event),
        style: { gridColumn: "4 / 5", gridRow: "2 / 3" },
      }}
      settingsDialogProps={settingsDialogOpen ? {
        initialSectionId: settingsInitialSectionId, onClose: handleSettingsDialogClose,
        onSettingsChange: handleSettingsDialogChange, open: settingsDialogOpen,
        saveError: settingsSaveError, saveState: settingsSaveState, settings,
      } : null}
      shellWindowChromeProps={{
        desktopPlatform, leftPanelCollapsed,
        onLeftPanelCollapsedChange: setLeftPanelCollapsed, resolvedTheme,
        rightToolRailTitleBarFillWidth, windowFrameState,
      }}
      tabsConfirmationProps={{
        onClose: cancelTerminalTabs,
        onConfirm: confirmTerminalTabs, tabCount: pendingTerminalTabCount,
      }}
      toolPanelProps={{
        activeTool, defaultRemoteGroupId, defaultRemoteHostId, machineGroups,
        onActiveToolChange: activateShellTool, onCreateTerminal: addTerminalTab,
        onFocusTab: selectTab, onOpenSettingsSection: openSettingsTool,
        onOpenSshTerminal: openSshTerminal, onRemoteHostCreated: refreshRemoteHostTree,
        onSettingsChange: handleSettingsChange, onSplitPane: splitFocusedPane,
        resolvedTheme, settings, snippetConfigRevision: configCatalogRevisions.snippets,
        terminalAppearance: settings.terminal,
        workflowConfigRevision: configCatalogRevisions.workflows,
      }}
      workspaceFileConfirmationProps={{
        dirtyTabCount: dirtyFileTabCount,
        onClose: cancelDirtyFileTabs,
        onConfirm: confirmDirtyFileTabs,
        tabCount: pendingDirtyFileTabCount,
      }}
      workspaceTerminalProps={{
        contentRightInset: rightWorkspaceInset, createdSftpHostTarget,
        desktopNotifications: settings.desktopNotifications,
        interfaceDensity: settings.interfaceDensity, leftTitleBarInset,
        machineGroups, onBroadcastCommand: handleBroadcastCommand,
        onCreateSftpHost: openSftpTransferHostCreateDialog,
        onOpenAgentTool: () => setActiveTool("agentLauncher"),
        onOpenConnection: () => openConnectionDialog({ mode: "ssh" }),
        onOpenLogs: openLogsTool, reserveRightTitleBarControls,
        resolvedTheme, splitDropIndicator: terminalSplitDropIndicator,
        terminalAppearance: settings.terminal,
      }}
    />
  );
}
