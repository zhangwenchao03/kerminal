import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppTitleBar } from "./AppTitleBar";
import type { MachineSidebarMachineDragEvent } from "../features/machine-sidebar/MachineSidebar.shared";
import type {
  SettingsSaveState,
  SettingsSectionId,
} from "../features/settings/SettingsToolContent";
import { shortcutPlatform } from "../features/settings/keybindingUtils";
import {
  resolveThemeMode,
  type AppSettings,
} from "../features/settings/settingsModel";
import type { TerminalSplitDropIndicator } from "../features/terminal/TerminalSplitDropOverlay";
import {
  resolveTerminalSplitDropZone,
  terminalSplitDropZoneToDirection,
  terminalSplitDropZoneToPlacement,
  type TerminalSplitDropZone,
} from "../features/terminal/terminalSplitDropZones";
import { isTerminalSplitMachineKind } from "../features/terminal/terminalSplitTargets";
import { writeBroadcastCommand } from "../features/terminal/terminalSessionRegistry";
import { useWorkspaceStore } from "../features/workspace/workspaceStore";
import { cn } from "../lib/cn";
import {
  fetchDockerContainerStats,
  inspectDockerContainer,
  listDockerContainers,
  removeDockerContainer,
  restartDockerContainer,
  startDockerContainer,
  stopDockerContainer,
  type DockerContainerLifecycleAction,
  type DockerContainerSummary,
} from "../lib/dockerApi";
import {
  createRemoteHostGroup,
  updateRemoteHost,
  type RemoteHost,
} from "../lib/remoteHostApi";
import { listProfiles } from "../lib/profileApi";
import { reapOrphanTerminalSessions } from "../lib/terminalApi";
import { useDocumentTheme } from "../lib/useDocumentTheme";
import { useTauriWindowFrameState } from "../lib/useTauriWindowFrameState";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import {
  isTerminalSessionTab,
} from "../features/workspace/types";
import {
  DeleteConfirmationDialog,
  DialogLazyFallback,
  ShellResizeSeparator,
  htmlLanguage,
  isRealRemoteGroup,
  useSystemThemePreference,
  useViewportWidth,
} from "./KerminalShell.helpers";
import {
  KerminalShellNotices,
  ShellToolRail,
} from "./KerminalShell.view";
import { useKerminalShellRemoteActions } from "./useKerminalShellRemoteActions";
import { useKerminalShellBackgroundStyle } from "./useKerminalShellBackgroundStyle";
import { useKerminalShellCommands } from "./useKerminalShellCommands";
import { useKerminalShellConfigRefresh } from "./useKerminalShellConfigRefresh";
import { useKerminalShellPanelResize } from "./useKerminalShellPanelResize";
import { useKerminalShellSettings } from "./useKerminalShellSettings";
import {
  DEFAULT_REMOTE_GROUP_NAME,
  DEFAULT_SETTINGS_SECTION_ID,
  LazyHostContainersDialog,
  LazyRemoteHostCreateDialog,
  LazyRemoteHostGroupCreateDialog,
  LazySettingsDialog,
} from "./KerminalShell.static";
import { useWorkspaceSessionPersistence } from "./useWorkspaceSessionPersistence";
import {
  MachineSidebarStoreBridge,
  ToolPanelStoreBridge,
  WorkspaceTerminalSurface,
} from "./KerminalShell.workspaceBridge";
import {
  resolveConnectionEditConflict,
  resolveRemoteGroupEditConflict,
} from "./configDirtyGuardModel";
import { useKerminalConfigEvents } from "./useKerminalConfigEvents";

function isSftpCapableRemoteHost(host: RemoteHost) {
  return !host.tags.some((tag) =>
    ["rdp", "telnet", "serial"].includes(tag.trim().toLowerCase()),
  );
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const terminalSplitDropZoneLabels: Record<TerminalSplitDropZone, string> = {
  bottom: "下方",
  left: "左侧",
  right: "右侧",
  top: "上方",
};

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
  const [hostContainersHostId, setHostContainersHostId] = useState<
    string | null
  >(null);
  const [
    hostContainersInitialContainerId,
    setHostContainersInitialContainerId,
  ] = useState<string>();
  const [terminalSplitDropIndicator, setTerminalSplitDropIndicator] =
    useState<TerminalSplitDropIndicator | null>(null);
  const workspaceFrameRef = useRef<HTMLDivElement>(null);
  const terminalSplitDropZoneRef = useRef<TerminalSplitDropZone | null>(null);
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
  const windowControlPlatform = shortcutPlatform();
  const windowFrameState = useTauriWindowFrameState();
  const reserveRightTitleBarControls = windowControlPlatform !== "mac";
  useDocumentTheme({
    density: settings.interfaceDensity,
    language: settings.appearance.interfaceLanguage,
    lang: htmlLanguage(settings.appearance.interfaceLanguage),
    theme: resolvedTheme,
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
  const hostContainersHost = useMemo(
    () =>
      hostContainersHostId
        ? machineGroups
            .flatMap((group) => group.machines)
            .find(
              (machine) =>
                machine.id === hostContainersHostId && machine.kind === "ssh",
            )
        : undefined,
    [hostContainersHostId, machineGroups],
  );
  const leftTitleBarInset = effectiveLeftPanelCollapsed
    ? windowControlPlatform === "mac"
      ? 112
      : 48
    : 0;
  const handleBroadcastCommand = useCallback(writeBroadcastCommand, []);
  const resolveTerminalDropZone = useCallback(
    (event: MachineSidebarMachineDragEvent) => {
      const activeTab =
        terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
      if (
        !activeTab ||
        !isTerminalSessionTab(activeTab) ||
        !focusedPaneId ||
        !isTerminalSplitMachineKind(event.machine.kind) ||
        typeof document === "undefined"
      ) {
        return null;
      }
      const terminalContent = document.querySelector<HTMLElement>(
        "[data-terminal-workspace-content]",
      );
      if (!terminalContent) {
        return null;
      }
      return resolveTerminalSplitDropZone(
        terminalContent.getBoundingClientRect(),
        event,
      );
    },
    [activeTabId, focusedPaneId, terminalTabs],
  );
  const handleExternalMachineDrag = useCallback(
    (event: MachineSidebarMachineDragEvent) => {
      const zone = resolveTerminalDropZone(event);
      terminalSplitDropZoneRef.current = zone;
      if (!zone) {
        setTerminalSplitDropIndicator(null);
        return undefined;
      }
      setTerminalSplitDropIndicator((current) =>
        current?.machineName === event.machine.name && current.zone === zone
          ? current
          : { machineName: event.machine.name, zone },
      );
      return {
        hint: `松开分屏到${terminalSplitDropZoneLabels[zone]}`,
      };
    },
    [resolveTerminalDropZone],
  );
  const handleExternalMachineDragEnd = useCallback(() => {
    terminalSplitDropZoneRef.current = null;
    setTerminalSplitDropIndicator(null);
  }, []);
  const handleExternalMachineDrop = useCallback(
    (event: MachineSidebarMachineDragEvent) => {
      const zone = resolveTerminalDropZone(event);
      handleExternalMachineDragEnd();
      if (!zone) {
        return false;
      }
      splitFocusedPane(terminalSplitDropZoneToDirection(zone), {
        placement: terminalSplitDropZoneToPlacement(zone),
        targetMachineId: event.machine.id,
      });
      return true;
    },
    [handleExternalMachineDragEnd, resolveTerminalDropZone, splitFocusedPane],
  );
  const openSettingsTool = useCallback(
    (sectionId: SettingsSectionId = DEFAULT_SETTINGS_SECTION_ID) => {
      settingsDialogDirtyRef.current = false;
      settingsDialogOpenRef.current = true;
      setSettingsInitialSectionId(sectionId);
      setSettingsDialogOpen(true);
    },
    [],
  );
  const { activateTool, openLogsTool } = useKerminalShellCommands({
    activeTabId,
    activeTool,
    addTerminalTab,
    closePane,
    closeTerminalTab,
    focusPane,
    focusedPaneId,
    keybindings: settings.keybindings,
    openSettingsTool,
    selectTab,
    setActiveTool,
    splitFocusedPane,
    terminalTabs,
  });
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
  const openHostContainersDialog = useCallback(
    (machineId: string, initialContainerId?: string) => {
      selectMachine(machineId);
      setHostContainersHostId(machineId);
      setHostContainersInitialContainerId(initialContainerId);
    },
    [selectMachine],
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

      selectMachine(machine.id);
      setHostContainersHostId(machine.parentMachineId);
      setHostContainersInitialContainerId(machine.containerId);
    },
    [machineGroups, selectMachine],
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
  const pinHostContainer = useCallback(
    async (container: DockerContainerSummary) => {
      const groupId = await resolveTargetGroupId(
        hostContainersHost?.remoteGroupId ?? defaultRemoteGroupId,
      );
      addDockerContainer(container, { groupId });
    },
    [
      addDockerContainer,
      defaultRemoteGroupId,
      hostContainersHost?.remoteGroupId,
      resolveTargetGroupId,
    ],
  );
  const runHostContainerLifecycleAction = useCallback(
    async (
      action: DockerContainerLifecycleAction,
      container: DockerContainerSummary,
      options?: { force?: boolean },
    ) => {
      const request = {
        containerId: container.id,
        force: options?.force,
        hostId: container.hostId,
        runtime: container.runtime,
      };
      if (action === "start") {
        await startDockerContainer(request);
        return;
      }
      if (action === "stop") {
        await stopDockerContainer(request);
        return;
      }
      if (action === "restart") {
        await restartDockerContainer(request);
        return;
      }
      await removeDockerContainer(request);
    },
    [],
  );
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
  const reapLocalOrphanTerminalSessions = useCallback(async () => {
    try {
      const diagnostics = await reapOrphanTerminalSessions();
      if (diagnostics.reapedCount > 0) {
        console.info("Kerminal local PTY orphan reaper completed", diagnostics);
      }
    } catch (error) {
      console.warn("Kerminal local PTY orphan reaper failed", error);
    }
  }, []);
  useWorkspaceSessionPersistence({
    beforeRestore: reapLocalOrphanTerminalSessions,
    onShellLayoutRestored: handleWorkspaceShellLayoutRestored,
    shellLayout: workspaceShellLayout,
  });
  useKerminalConfigEvents({ coordinator: configRefreshCoordinator });

  useEffect(() => {
    if (settingsSaveState === "saved") {
      settingsDialogDirtyRef.current = false;
    }
  }, [settingsSaveState]);

  useEffect(() => {
    if (!shellNoticeMessage) {
      setShellNoticeVisible(false);
      return undefined;
    }

    setShellNoticeVisible(true);
    const timer = window.setTimeout(() => {
      setShellNoticeVisible(false);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [shellNoticeMessage]);

  useEffect(() => {
    let cancelled = false;

    listProfiles()
      .then((nextProfiles) => {
        if (cancelled) {
          return;
        }
        setProfiles(nextProfiles);
        setProfileLoadError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setProfileLoadError("终端配置加载失败，已使用默认本地配置。");
      });

    return () => {
      cancelled = true;
    };
  }, [setProfiles]);

  useEffect(() => {
    void refreshRemoteHostTree();
  }, [refreshRemoteHostTree]);

  return (
    <div
      ref={workspaceFrameRef}
      className={cn(
        "relative grid h-screen overflow-hidden",
        resolvedTheme === "dark" ? "dark text-zinc-100" : "text-zinc-950",
      )}
      data-density={settings.interfaceDensity}
      data-language={settings.appearance.interfaceLanguage}
      data-theme={resolvedTheme}
      data-window-controls-platform={windowControlPlatform}
      data-window-frame={windowFrameState}
      lang={htmlLanguage(settings.appearance.interfaceLanguage)}
      style={{
        ...workspaceBackgroundStyle,
        gridTemplateColumns,
        gridTemplateRows: "36px minmax(0, 1fr)",
      }}
    >
      <div
        className="kerminal-material-nav col-[1/2] row-[1/2]"
        data-tauri-drag-region
      />
      <div
        className="kerminal-material-nav col-[2/6] row-[1/2] border-b"
        data-tauri-drag-region
      />
      <AppTitleBar
        className="pointer-events-none col-[1/-1] row-[1/2] z-50 border-b-0 bg-transparent"
        leftPanelCollapsed={leftPanelCollapsed}
        onLeftPanelCollapsedChange={setLeftPanelCollapsed}
        resolvedTheme={resolvedTheme}
        surface={false}
        windowControlPlatform={windowControlPlatform}
      />
      {effectiveLeftPanelCollapsed ? null : (
        <div className="col-[1/2] row-[2/3] h-full overflow-hidden">
          <MachineSidebarStoreBridge
            collapsed={false}
            collapsedGroupIds={collapsedMachineGroupIds}
            groups={machineGroups}
            onAddConnection={openConnectionDialog}
            onAddGroup={() => openRemoteGroupDialog()}
            onAddMachine={(groupId) =>
              openConnectionDialog({ groupId, mode: "ssh" })
            }
            onDeleteGroup={requestDeleteGroup}
            onDeleteMachine={requestDeleteMachine}
            onCollapsedGroupIdsChange={handleCollapsedMachineGroupIdsChange}
            onDuplicateMachine={(machineId) =>
              void handleDuplicateMachine(machineId)
            }
            onEditGroup={openRemoteGroupDialog}
            onEditMachine={(hostId) => openConnectionDialog({ hostId })}
            onExternalMachineDrag={handleExternalMachineDrag}
            onExternalMachineDragEnd={handleExternalMachineDragEnd}
            onExternalMachineDrop={handleExternalMachineDrop}
            onMoveMachine={(machineId, groupId) =>
              void handleMoveMachineToGroup(machineId, groupId)
            }
            onOpenSettings={() => openSettingsTool()}
            onOpenLocalTerminal={openLocalTerminal}
            onOpenContainerTerminal={openContainerTerminal}
            onOpenContainerDetails={openContainerDetails}
            onOpenHostContainers={openHostContainersDialog}
            onOpenRdpConnection={(machineId) =>
              void openSavedRdpMachine(machineId)
            }
            onOpenSftp={openSftpForMachine}
            onOpenSshTerminal={openSshTerminal}
            onOpenSftpTransferWorkbench={openSftpTransferWorkbench}
            onOpenTransferWorkbench={() => openSftpTransferWorkbench()}
            onOpenTelnetTerminal={openTelnetTerminal}
            onOpenSerialTerminal={openSerialTerminal}
            onPinGroup={(groupId, pinned) =>
              void handlePinMachineGroup(groupId, pinned)
            }
            onSearchChange={setMachineSearch}
            onSelectMachine={selectMachine}
            search={machineSearch}
            selectedMachineId={selectedMachineId}
            settingsSelected={settingsDialogOpen}
          />
        </div>
      )}
      <ShellResizeSeparator
        className="kerminal-shell-separator col-[2/3] row-[2/3]"
        hidden={effectiveLeftPanelCollapsed}
        label="调整主机侧边栏宽度"
        onKeyDown={(event) => resizeWithKeyboard("left", event)}
        onPointerDown={(event) => beginPanelResize("left", event)}
      />
      <div
        className="relative z-0 h-full min-w-0 flex-1 overflow-hidden"
        style={{ gridColumn: "3 / 6", gridRow: "1 / 3" }}
      >
        <WorkspaceTerminalSurface
          contentRightInset={rightWorkspaceInset}
          createdSftpHostTarget={createdSftpHostTarget}
          desktopNotifications={settings.desktopNotifications}
          interfaceDensity={settings.interfaceDensity}
          machineGroups={machineGroups}
          onBroadcastCommand={handleBroadcastCommand}
          onCreateSftpHost={openSftpTransferHostCreateDialog}
          onOpenAgentTool={() => setActiveTool("agentLauncher")}
          onOpenConnection={() => openConnectionDialog({ mode: "ssh" })}
          onOpenLogs={openLogsTool}
          leftTitleBarInset={leftTitleBarInset}
          reserveRightTitleBarControls={reserveRightTitleBarControls}
          resolvedTheme={resolvedTheme}
          splitDropIndicator={terminalSplitDropIndicator}
          terminalAppearance={settings.terminal}
        />
      </div>
      <ShellResizeSeparator
        className="relative z-20"
        hidden={!effectiveRightPanelOpen}
        label="调整工具面板宽度"
        onKeyDown={(event) => resizeWithKeyboard("tools", event)}
        onPointerDown={(event) => beginPanelResize("tools", event)}
        style={{ gridColumn: "4 / 5", gridRow: "2 / 3" }}
      />
      <div
        className="relative z-20 h-full overflow-hidden"
        style={{ gridColumn: "5 / 6", gridRow: "2 / 3" }}
      >
        {activeTool === null || compactShell ? (
          <ShellToolRail onActiveToolChange={activateTool} />
        ) : (
          <ToolPanelStoreBridge
            activeTool={activeTool}
            defaultRemoteGroupId={defaultRemoteGroupId}
            defaultRemoteHostId={defaultRemoteHostId}
            machineGroups={machineGroups}
            onActiveToolChange={activateTool}
            onCreateTerminal={addTerminalTab}
            onFocusTab={selectTab}
            onOpenSettingsSection={openSettingsTool}
            onOpenSshTerminal={openSshTerminal}
            onRemoteHostCreated={refreshRemoteHostTree}
            onSettingsChange={handleSettingsChange}
            onSplitPane={splitFocusedPane}
            resolvedTheme={resolvedTheme}
            settings={settings}
            snippetConfigRevision={configCatalogRevisions.snippets}
            terminalAppearance={settings.terminal}
            workflowConfigRevision={configCatalogRevisions.workflows}
          />
        )}
      </div>
      {settingsDialogOpen ? (
        <Suspense fallback={<DialogLazyFallback />}>
          <LazySettingsDialog
            initialSectionId={settingsInitialSectionId}
            onClose={handleSettingsDialogClose}
            onSettingsChange={handleSettingsDialogChange}
            open={settingsDialogOpen}
            saveError={settingsSaveError}
            saveState={settingsSaveState}
            settings={settings}
          />
        </Suspense>
      ) : null}
      {remoteHostDialogOpen ? (
        <Suspense fallback={<DialogLazyFallback />}>
          <LazyRemoteHostCreateDialog
            defaultGroupId={remoteHostDefaultGroupId ?? defaultRemoteGroupId}
            defaultMode={remoteHostDefaultMode}
            editingHost={editingRemoteHost}
            editingLocalMachine={editingLocalMachine}
            externalConfigConflict={connectionConfigConflict?.message}
            groups={machineGroups}
            onClose={handleConnectionDialogClose}
            onCreateGroup={createRemoteHostGroup}
            onCreateLocal={handleCreateLocalProfile}
            onCreateHost={handleCreateRemoteHost}
            onUpdateHost={updateRemoteHost}
            onUpdateLocal={handleUpdateLocalProfile}
            onCreated={handleConnectionDialogCreated}
            onGroupCreated={handleRemoteGroupSaved}
            open={remoteHostDialogOpen}
          />
        </Suspense>
      ) : null}
      {hostContainersHost ? (
        <Suspense fallback={<DialogLazyFallback />}>
          <LazyHostContainersDialog
            host={hostContainersHost}
            initialContainerId={hostContainersInitialContainerId}
            onClose={() => {
              setHostContainersHostId(null);
              setHostContainersInitialContainerId(undefined);
            }}
            onEnterContainer={enterHostContainer}
            onFetchContainerStats={fetchDockerContainerStats}
            onInspectContainer={inspectDockerContainer}
            onLifecycleContainer={runHostContainerLifecycleAction}
            onListDockerContainers={listDockerContainers}
            onOpenContainerLogs={openHostContainerLogs}
            onPinContainer={pinHostContainer}
            open={Boolean(hostContainersHost)}
          />
        </Suspense>
      ) : null}
      {remoteGroupDialogOpen ? (
        <Suspense fallback={<DialogLazyFallback />}>
          <LazyRemoteHostGroupCreateDialog
            externalConfigConflict={remoteGroupConfigConflict?.message}
            group={editingRemoteGroup}
            onClose={closeRemoteGroupDialog}
            onCreateGroup={createRemoteHostGroup}
            onUpdateGroup={handleRemoteGroupUpdate}
            onCreated={handleRemoteGroupSaved}
            open={remoteGroupDialogOpen}
          />
        </Suspense>
      ) : null}
      <DeleteConfirmationDialog
        deleteError={deleteError}
        deleting={deleteSaving}
        onClose={() => {
          if (!deleteSaving) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void confirmDelete()}
        pendingDelete={pendingDelete}
      />
      <KerminalShellNotices
        configNotice={configNotice}
        onConfigNoticeDismiss={() => setConfigNotice(null)}
        onShellNoticeDismiss={() => setShellNoticeVisible(false)}
        shellNoticeMessage={shellNoticeMessage}
        shellNoticeVisible={shellNoticeVisible}
      />
    </div>
  );
}
