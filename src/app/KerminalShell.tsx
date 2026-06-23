import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { X } from "lucide-react";
import { AppTitleBar } from "./AppTitleBar";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";
import {
  keybindingMatchesEvent,
  shortcutPlatform,
} from "../features/settings/keybindingUtils";
import { resolveThemeMode } from "../features/settings/settingsModel";
import { writeBroadcastCommand } from "../features/terminal/terminalSessionRegistry";
import { useWorkspaceStore } from "../features/workspace/workspaceStore";
import { cn } from "../lib/cn";
import { listDockerContainers } from "../lib/dockerApi";
import {
  listenNativeMenuActions,
  type NativeMenuAction,
} from "../lib/nativeMenuApi";
import { listProfiles } from "../lib/profileApi";
import {
  createRemoteHostGroup,
  updateRemoteHost,
  type RemoteHost,
} from "../lib/remoteHostApi";
import { useDocumentTheme } from "../lib/useDocumentTheme";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import { isToolId, type ToolId } from "../features/workspace/types";
import {
  DeleteConfirmationDialog,
  DialogLazyFallback,
  ShellResizeSeparator,
  clampPanelWidth,
  htmlLanguage,
  initialPanelWidth,
  isRealRemoteGroup,
  resolveShellLayout,
  useSystemThemePreference,
  useViewportWidth,
  workspaceBackgroundImage,
  workspaceBackgroundColor,
} from "./KerminalShell.helpers";
import { useKerminalShellRemoteActions } from "./useKerminalShellRemoteActions";
import { useKerminalShellSettings } from "./useKerminalShellSettings";
import {
  DEFAULT_REMOTE_GROUP_NAME,
  DEFAULT_SETTINGS_SECTION_ID,
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

function isSftpCapableRemoteHost(host: RemoteHost) {
  return !host.tags.some((tag) =>
    ["rdp", "telnet", "serial"].includes(tag.trim().toLowerCase()),
  );
}

function formatCssAlpha(value: number) {
  return String(Number(value.toFixed(4)));
}

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
  const openLocalTerminal = useWorkspaceStore((state) => state.openLocalTerminal);
  const openContainerTerminal = useWorkspaceStore(
    (state) => state.openContainerTerminal,
  );
  const openSshTerminal = useWorkspaceStore((state) => state.openSshTerminal);
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
  const renameMachineGroup = useWorkspaceStore((state) => state.renameMachineGroup);
  const selectMachine = useWorkspaceStore((state) => state.selectMachine);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const setMachineSearch = useWorkspaceStore((state) => state.setMachineSearch);
  const setProfiles = useWorkspaceStore((state) => state.setProfiles);
  const setRemoteHostTree = useWorkspaceStore(
    (state) => state.setRemoteHostTree,
  );
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const updateLocalMachine = useWorkspaceStore((state) => state.updateLocalMachine);
  const moveSidebarMachine = useWorkspaceStore((state) => state.moveSidebarMachine);
  const pinMachineGroup = useWorkspaceStore((state) => state.pinMachineGroup);
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);
  const profiles = useWorkspaceStore((state) => state.profiles);
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const settings = useWorkspaceStore((state) => state.settings);
  const setSettings = useWorkspaceStore((state) => state.setSettings);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    initialPanelWidth(0.22, {
      max: 320,
      min: 240,
    }),
  );
  const [toolPanelWidth, setToolPanelWidth] = useState(() =>
    initialPanelWidth(0.36, {
      max: 600,
      min: 460,
    }),
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const viewportWidth = useViewportWidth();
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsInitialSectionId, setSettingsInitialSectionId] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ID);
  const [shellNoticeVisible, setShellNoticeVisible] = useState(false);
  const [pendingSftpHostTarget, setPendingSftpHostTarget] =
    useState<SftpTransferCreateHostRequest | null>(null);
  const [createdSftpHostTarget, setCreatedSftpHostTarget] =
    useState<SftpTransferCreatedHostTarget>();
  const workspaceFrameRef = useRef<HTMLDivElement>(null);
  const createdSftpHostSequenceRef = useRef(0);
  const {
    handleSettingsChange,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
  } = useKerminalShellSettings({ setSettings });
  const systemPrefersDark = useSystemThemePreference();
  const resolvedTheme = resolveThemeMode(settings.themeMode, systemPrefersDark);
  const windowControlPlatform = shortcutPlatform();
  const reserveRightTitleBarControls = windowControlPlatform !== "mac";
  useDocumentTheme({
    density: settings.interfaceDensity,
    language: settings.appearance.interfaceLanguage,
    lang: htmlLanguage(settings.appearance.interfaceLanguage),
    theme: resolvedTheme,
  });
  const workspaceBackgroundStyle = useMemo<CSSProperties>(
    () => {
      const windowOpacity =
        Math.min(Math.max(settings.appearance.windowOpacity, 35), 100) / 100;
      return {
        "--app-window-opacity": formatCssAlpha(windowOpacity),
        "--app-nav-surface-opacity": formatCssAlpha(
          windowOpacity * (resolvedTheme === "dark" ? 0.78 : 0.68),
        ),
        "--app-terminal-surface-opacity": formatCssAlpha(windowOpacity * 0.78),
        backgroundColor: workspaceBackgroundColor(
          settings.appearance.windowOpacity,
          resolvedTheme,
        ),
        backgroundImage: workspaceBackgroundImage(
          settings.appearance.backgroundEnabled,
          settings.appearance.backgroundImagePath,
          settings.appearance.backgroundOpacity,
          resolvedTheme,
        ),
        backgroundPosition: "center",
        backgroundRepeat:
          settings.appearance.backgroundFit === "tile" ? "repeat" : "no-repeat",
        backgroundSize:
          settings.appearance.backgroundFit === "tile"
            ? "auto"
            : settings.appearance.backgroundFit,
      };
    },
    [
      resolvedTheme,
      settings.appearance.backgroundEnabled,
      settings.appearance.backgroundFit,
      settings.appearance.backgroundImagePath,
      settings.appearance.backgroundOpacity,
      settings.appearance.windowOpacity,
    ],
  ) as CSSProperties;
  const defaultRemoteGroupId =
    machineGroups.find(
      (group) =>
        isRealRemoteGroup(group) &&
        group.title.trim() === DEFAULT_REMOTE_GROUP_NAME,
    )?.id ?? machineGroups.find(isRealRemoteGroup)?.id;
  const defaultRemoteHostId = machineGroups
    .find((group) => group.id !== "local")
    ?.machines.find((machine) => machine.kind === "ssh")?.id;
  const {
    compactShell,
    effectiveLeftPanelCollapsed,
    effectiveRightPanelOpen,
    gridTemplateColumns,
    leftPanelColumnWidth,
    rightPanelColumnWidth,
    rightWorkspaceInset,
  } = resolveShellLayout({
    activeToolOpen: activeTool !== null,
    leftPanelCollapsed,
    leftPanelWidth,
    toolPanelWidth,
    viewportWidth,
  });
  const handleBroadcastCommand = useCallback(writeBroadcastCommand, []);
  const openLogsTool = useCallback(
    () => setActiveTool("logs"),
    [setActiveTool],
  );
  const openSettingsTool = useCallback(
    (sectionId: SettingsSectionId = DEFAULT_SETTINGS_SECTION_ID) => {
      setSettingsInitialSectionId(sectionId);
      setSettingsDialogOpen(true);
    },
    [],
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
  const activateTool = useCallback(
    (toolId: ToolId) => {
      if (toolId === "settings") {
        openSettingsTool();
        return;
      }
      setActiveTool(activeTool === toolId ? null : toolId);
    },
    [activeTool, openSettingsTool, setActiveTool],
  );
  const selectRelativeTerminalTab = useCallback(
    (offset: number) => {
      if (terminalTabs.length === 0) {
        return false;
      }

      const currentIndex = Math.max(
        terminalTabs.findIndex((tab) => tab.id === activeTabId),
        0,
      );
      const nextIndex =
        (currentIndex + offset + terminalTabs.length) % terminalTabs.length;
      selectTab(terminalTabs[nextIndex].id);
      return true;
    },
    [activeTabId, selectTab, terminalTabs],
  );
  const focusTerminalWorkspace = useCallback(() => {
    setActiveTool(null);
    if (!activeTabId) {
      addTerminalTab();
      return true;
    }

    selectTab(activeTabId);
    if (focusedPaneId) {
      focusPane(focusedPaneId);
    }
    return true;
  }, [
    activeTabId,
    addTerminalTab,
    focusPane,
    focusedPaneId,
    selectTab,
    setActiveTool,
  ]);
  const runKeybindingAction = useCallback(
    (action: string) => {
      if (action.startsWith("tool.")) {
        const toolId = action.slice("tool.".length);
        if (isToolId(toolId)) {
          activateTool(toolId);
          return true;
        }
      }

      if (action === "settings.open") {
        openSettingsTool();
        return true;
      }
      if (action === "settings.keybindings") {
        openSettingsTool("settings-keybindings");
        return true;
      }
      if (action === "terminal.focus") {
        return focusTerminalWorkspace();
      }
      if (action === "terminal.newTab") {
        addTerminalTab();
        return true;
      }
      if (action === "terminal.closeTab") {
        if (activeTabId) {
          closeTerminalTab(activeTabId);
        }
        return true;
      }
      if (action === "terminal.closePane") {
        closePane(focusedPaneId);
        return true;
      }
      if (action === "terminal.splitHorizontal") {
        splitFocusedPane("horizontal");
        return true;
      }
      if (action === "terminal.splitVertical") {
        splitFocusedPane("vertical");
        return true;
      }
      if (action === "terminal.previousTab") {
        return selectRelativeTerminalTab(-1);
      }
      if (action === "terminal.nextTab") {
        return selectRelativeTerminalTab(1);
      }

      return false;
    },
    [
      activateTool,
      activeTabId,
      addTerminalTab,
      closePane,
      closeTerminalTab,
      focusTerminalWorkspace,
      focusedPaneId,
      openSettingsTool,
      selectRelativeTerminalTab,
      splitFocusedPane,
    ],
  );
  const handleNativeMenuAction = useCallback(
    (action: NativeMenuAction) => {
      if (action === "newTerminal") {
        addTerminalTab();
      } else if (action === "closeTab") {
        closeTerminalTab(activeTabId);
      } else if (action === "closePane") {
        closePane(focusedPaneId);
      } else if (action === "openSettings") {
        openSettingsTool();
      } else if (action === "splitHorizontal") {
        splitFocusedPane("horizontal");
      } else if (action === "splitVertical") {
        splitFocusedPane("vertical");
      } else if (action === "openLogs") {
        setActiveTool("logs");
      } else if (action === "openAi") {
        setActiveTool("ai");
      } else if (action === "openSystem") {
        setActiveTool("system");
      } else if (action === "openSftp") {
        setActiveTool("sftp");
      } else if (action === "openPorts") {
        setActiveTool("ports");
      } else if (action === "openSnippets") {
        setActiveTool("snippets");
      }
    },
    [
      activeTabId,
      addTerminalTab,
      closePane,
      closeTerminalTab,
      focusedPaneId,
      openSettingsTool,
      setActiveTool,
      splitFocusedPane,
    ],
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
  useWorkspaceSessionPersistence();

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
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenNativeMenuActions(handleNativeMenuAction)
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // 原生菜单只在 Tauri 桌面端可用，监听失败不影响浏览器预览。
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleNativeMenuAction]);

  useEffect(() => {
    const platform = shortcutPlatform();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const matchedKeybinding = settings.keybindings.find((keybinding) =>
        keybindingMatchesEvent(keybinding, event, platform),
      );
      if (!matchedKeybinding) {
        return;
      }

      if (runKeybindingAction(matchedKeybinding.action)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [runKeybindingAction, settings.keybindings]);

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

  const beginPanelResize = useCallback(
    (panel: "left" | "tools", event: React.PointerEvent<HTMLDivElement>) => {
      if (
        (panel === "left" && effectiveLeftPanelCollapsed) ||
        (panel === "tools" && !effectiveRightPanelOpen)
      ) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startLeftWidth = leftPanelWidth;
      const startToolWidth = toolPanelWidth;
      const frameWidth =
        workspaceFrameRef.current?.getBoundingClientRect().width ??
        window.innerWidth;
      const terminalMinWidth = 360;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (panel === "left") {
          const maxLeftWidth =
            frameWidth - rightPanelColumnWidth - terminalMinWidth;
          setLeftPanelWidth(
            clampPanelWidth(startLeftWidth + moveEvent.clientX - startX, {
              max: Math.min(520, maxLeftWidth),
              min: 220,
            }),
          );
          return;
        }

        const maxToolWidth =
          frameWidth - leftPanelColumnWidth - terminalMinWidth;
        setToolPanelWidth(
          clampPanelWidth(startToolWidth - (moveEvent.clientX - startX), {
            max: Math.min(620, maxToolWidth),
            min: 300,
          }),
        );
      };
      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
    },
    [
      effectiveLeftPanelCollapsed,
      effectiveRightPanelOpen,
      leftPanelColumnWidth,
      leftPanelWidth,
      rightPanelColumnWidth,
      toolPanelWidth,
    ],
  );
  const resizeWithKeyboard = useCallback(
    (panel: "left" | "tools", event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      if (
        (panel === "left" && effectiveLeftPanelCollapsed) ||
        (panel === "tools" && !effectiveRightPanelOpen)
      ) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 40 : 16;
      if (panel === "left") {
        setLeftPanelWidth((current) =>
          clampPanelWidth(
            current + (event.key === "ArrowRight" ? step : -step),
            {
              max: 520,
              min: 220,
            },
          ),
        );
        return;
      }

      setToolPanelWidth((current) =>
        clampPanelWidth(current + (event.key === "ArrowLeft" ? step : -step), {
          max: 620,
          min: 300,
        }),
      );
    },
    [effectiveLeftPanelCollapsed, effectiveRightPanelOpen],
  );

  return (
    <div
      ref={workspaceFrameRef}
      className={cn(
        "relative grid h-screen overflow-hidden transition-[grid-template-columns] duration-200 ease-out",
        resolvedTheme === "dark"
          ? "dark text-zinc-100"
          : "text-zinc-950",
      )}
      data-density={settings.interfaceDensity}
      data-language={settings.appearance.interfaceLanguage}
      data-theme={resolvedTheme}
      lang={htmlLanguage(settings.appearance.interfaceLanguage)}
      style={{
        ...workspaceBackgroundStyle,
        gridTemplateColumns,
        gridTemplateRows: "44px minmax(0, 1fr)",
      }}
    >
      <div
        className="kerminal-material-nav col-[1/2] row-[1/2] border-b"
        data-tauri-drag-region
      />
      <div className="kerminal-material-nav col-[2/6] row-[1/2] border-b" />
      <AppTitleBar
        className="pointer-events-none col-[1/-1] row-[1/2] z-50 border-b-0 bg-transparent"
        leftPanelCollapsed={leftPanelCollapsed}
        onLeftPanelCollapsedChange={setLeftPanelCollapsed}
        resolvedTheme={resolvedTheme}
        surface={false}
        windowControlPlatform={windowControlPlatform}
      />
      <div className="col-[1/2] row-[2/3] h-full overflow-hidden">
        <MachineSidebarStoreBridge
          collapsed={effectiveLeftPanelCollapsed}
          groups={machineGroups}
          onAddConnection={openConnectionDialog}
          onAddGroup={() => openRemoteGroupDialog()}
          onAddMachine={(groupId) =>
            openConnectionDialog({ groupId, mode: "ssh" })
          }
          onDeleteGroup={requestDeleteGroup}
          onDeleteMachine={requestDeleteMachine}
          onDuplicateMachine={(machineId) => void handleDuplicateMachine(machineId)}
          onEditGroup={openRemoteGroupDialog}
          onEditMachine={(hostId) => openConnectionDialog({ hostId })}
          onMoveMachine={(machineId, groupId) =>
            void handleMoveMachineToGroup(machineId, groupId)
          }
          onOpenSettings={() => openSettingsTool()}
          onOpenLocalTerminal={openLocalTerminal}
          onOpenContainerTerminal={openContainerTerminal}
          onOpenRdpConnection={(machineId) => void openSavedRdpMachine(machineId)}
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
      <ShellResizeSeparator
        className="kerminal-terminal-surface col-[2/3] row-[2/3]"
        hidden={effectiveLeftPanelCollapsed}
        label="调整主机侧边栏宽度"
        onKeyDown={(event) => resizeWithKeyboard("left", event)}
        onPointerDown={(event) => beginPanelResize("left", event)}
      />
      <div className="col-[3/6] row-[1/3] h-full min-w-0 flex-1 overflow-hidden">
        <WorkspaceTerminalSurface
          contentRightInset={rightWorkspaceInset}
          createdSftpHostTarget={createdSftpHostTarget}
          interfaceDensity={settings.interfaceDensity}
          machineGroups={machineGroups}
          onBroadcastCommand={handleBroadcastCommand}
          onCreateSftpHost={openSftpTransferHostCreateDialog}
          onOpenAiTool={() => setActiveTool("ai")}
          onOpenConnection={() => openConnectionDialog({ mode: "ssh" })}
          onOpenLogs={openLogsTool}
          reserveRightTitleBarControls={reserveRightTitleBarControls}
          resolvedTheme={resolvedTheme}
          terminalAppearance={settings.terminal}
        />
      </div>
      <ShellResizeSeparator
        className="col-[4/5] row-[2/3]"
        hidden={!effectiveRightPanelOpen}
        label="调整工具面板宽度"
        onKeyDown={(event) => resizeWithKeyboard("tools", event)}
        onPointerDown={(event) => beginPanelResize("tools", event)}
      />
      <div className="col-[5/6] row-[2/3] h-full overflow-hidden">
        <ToolPanelStoreBridge
          activeTool={compactShell ? null : activeTool}
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
          settings={settings}
        />
      </div>
      {settingsDialogOpen ? (
        <Suspense fallback={<DialogLazyFallback />}>
          <LazySettingsDialog
            initialSectionId={settingsInitialSectionId}
            onClose={() => setSettingsDialogOpen(false)}
            onSettingsChange={handleSettingsChange}
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
            groups={machineGroups}
            onAddDockerContainer={async (request) => {
              const groupId = await resolveTargetGroupId(request.groupId);
              addDockerContainer(request.container, {
                groupId,
                shell: request.shell,
                user: request.user,
                workdir: request.workdir,
              });
            }}
            onClose={handleConnectionDialogClose}
            onCreateGroup={createRemoteHostGroup}
            onCreateLocal={handleCreateLocalProfile}
            onCreateHost={handleCreateRemoteHost}
            onListDockerContainers={listDockerContainers}
            onUpdateHost={updateRemoteHost}
            onUpdateLocal={handleUpdateLocalProfile}
            onCreated={handleConnectionDialogCreated}
            onGroupCreated={handleRemoteGroupSaved}
            open={remoteHostDialogOpen}
          />
        </Suspense>
      ) : null}
      {remoteGroupDialogOpen ? (
        <Suspense fallback={<DialogLazyFallback />}>
          <LazyRemoteHostGroupCreateDialog
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
      {shellNoticeMessage && shellNoticeVisible ? (
        <div
          className="absolute bottom-3 left-1/2 z-20 flex max-w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-50/95 px-3 py-2 text-sm text-amber-900 shadow-lg shadow-black/20 dark:border-amber-300/20 dark:bg-amber-950/85 dark:text-amber-100"
          role="alert"
        >
          <span className="min-w-0 flex-1">{shellNoticeMessage}</span>
          <button
            aria-label="关闭提示"
            className="rounded-md p-1 text-amber-700 transition hover:bg-amber-500/10 hover:text-amber-950 dark:text-amber-200 dark:hover:bg-amber-300/10 dark:hover:text-white"
            onClick={() => setShellNoticeVisible(false)}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

