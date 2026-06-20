import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AppTitleBar } from "./AppTitleBar";
import { MachineSidebar } from "../features/machine-sidebar/MachineSidebar";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";
import {
  keybindingMatchesEvent,
  shortcutPlatform,
} from "../features/settings/keybindingUtils";
import {
  resolveThemeMode,
  type AppSettings,
} from "../features/settings/settingsModel";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";
import { writeBroadcastCommand } from "../features/terminal/terminalSessionRegistry";
import { ToolPanel } from "../features/tool-panel/ToolPanel";
import { SftpTransferWorkbench } from "../features/sftp/SftpTransferWorkbench";
import {
  findMachine,
  sidebarMachinesForWorkspaceSession,
  tools,
  useWorkspaceStore,
} from "../features/workspace/workspaceStore";
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "../features/workspace/workspaceSessionStorage";
import { cn } from "../lib/cn";
import { listDockerContainers } from "../lib/dockerApi";
import {
  listenNativeMenuActions,
  type NativeMenuAction,
} from "../lib/nativeMenuApi";
import {
  listProfiles,
} from "../lib/profileApi";
import {
  createRemoteHostGroup,
  updateRemoteHost,
} from "../lib/remoteHostApi";
import { getSettings, updateSettings } from "../lib/settingsApi";
import { useDocumentTheme } from "../lib/useDocumentTheme";
import {
  isToolId,
  isSftpTransferWorkspaceTab,
  type ToolId,
} from "../features/workspace/types";
import {
  DeleteConfirmationDialog,
  DialogLazyFallback,
  ShellResizeSeparator,
  clampPanelWidth,
  htmlLanguage,
  initialPanelWidth,
  isRealRemoteGroup,
  useSystemThemePreference,
  workspaceBackgroundImage,
} from "./KerminalShell.helpers";
import { useKerminalShellRemoteActions } from "./useKerminalShellRemoteActions";
import {
  DEFAULT_REMOTE_GROUP_NAME,
  DEFAULT_SETTINGS_SECTION_ID,
  LEFT_RAIL_WIDTH,
  LazyRemoteHostCreateDialog,
  LazyRemoteHostGroupCreateDialog,
  LazySettingsDialog,
  TOOL_RAIL_WIDTH,
  WORKSPACE_SESSION_SAVE_DELAY_MS,
} from "./KerminalShell.static";

type WorkspaceSessionSnapshot = Parameters<typeof saveWorkspaceSession>[0];

export function KerminalShell() {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const broadcastDraft = useWorkspaceStore((state) => state.broadcastDraft);
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
  const renameTerminalTab = useWorkspaceStore((state) => state.renameTerminalTab);
  const restoreWorkspaceSession = useWorkspaceStore(
    (state) => state.restoreWorkspaceSession,
  );
  const selectMachine = useWorkspaceStore((state) => state.selectMachine);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const setBroadcastDraft = useWorkspaceStore(
    (state) => state.setBroadcastDraft,
  );
  const setMachineSearch = useWorkspaceStore((state) => state.setMachineSearch);
  const setProfiles = useWorkspaceStore((state) => state.setProfiles);
  const setRemoteHostTree = useWorkspaceStore(
    (state) => state.setRemoteHostTree,
  );
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const updatePaneCurrentCwd = useWorkspaceStore(
    (state) => state.updatePaneCurrentCwd,
  );
  const updatePaneOutputHistory = useWorkspaceStore(
    (state) => state.updatePaneOutputHistory,
  );
  const updateLocalMachine = useWorkspaceStore((state) => state.updateLocalMachine);
  const moveSidebarMachine = useWorkspaceStore((state) => state.moveSidebarMachine);
  const pinMachineGroup = useWorkspaceStore((state) => state.pinMachineGroup);
  const terminalPanes = useWorkspaceStore((state) => state.terminalPanes);
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);
  const profiles = useWorkspaceStore((state) => state.profiles);
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const activeTab = terminalTabs.find((tab) => tab.id === activeTabId);
  const focusedPane = terminalPanes.find((pane) => pane.id === focusedPaneId);
  const activeTerminalMachineId =
    focusedPane?.mode === "container"
      ? focusedPane.machineId
      : focusedPane?.remoteHostId ??
    focusedPane?.machineId ??
    activeTab?.machineId ??
    selectedMachineId;
  const activeTerminalMachine = findMachine(
    machineGroups,
    activeTerminalMachineId,
  );
  const openMachineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of terminalTabs) {
      ids.add(tab.machineId);
    }
    for (const pane of terminalPanes) {
      ids.add(pane.machineId);
      if (pane.remoteHostId) {
        ids.add(pane.remoteHostId);
      }
    }
    return [...ids];
  }, [terminalPanes, terminalTabs]);
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
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(
    null,
  );
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(
    null,
  );
  const [settingsSaveState, setSettingsSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [workspaceSessionRestored, setWorkspaceSessionRestored] =
    useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsInitialSectionId, setSettingsInitialSectionId] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ID);
  const workspaceFrameRef = useRef<HTMLDivElement>(null);
  const workspaceSessionSaveTimerRef = useRef<number | null>(null);
  const latestWorkspaceSessionRef = useRef<WorkspaceSessionSnapshot | null>(null);
  const settingsSaveRequestRef = useRef(0);
  const systemPrefersDark = useSystemThemePreference();
  const resolvedTheme = resolveThemeMode(settings.themeMode, systemPrefersDark);
  useDocumentTheme({
    density: settings.interfaceDensity,
    language: settings.appearance.interfaceLanguage,
    lang: htmlLanguage(settings.appearance.interfaceLanguage),
    theme: resolvedTheme,
  });
  const workspaceBackgroundStyle = useMemo<CSSProperties>(
    () => ({
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
    }),
    [
      resolvedTheme,
      settings.appearance.backgroundEnabled,
      settings.appearance.backgroundFit,
      settings.appearance.backgroundImagePath,
      settings.appearance.backgroundOpacity,
    ],
  );
  const defaultRemoteGroupId =
    machineGroups.find(
      (group) =>
        isRealRemoteGroup(group) &&
        group.title.trim() === DEFAULT_REMOTE_GROUP_NAME,
    )?.id ?? machineGroups.find(isRealRemoteGroup)?.id;
  const defaultRemoteHostId = machineGroups
    .find((group) => group.id !== "local")
    ?.machines.find((machine) => machine.kind === "ssh")?.id;
  const rightPanelOpen = activeTool !== null;
  const leftPanelColumnWidth = leftPanelCollapsed
    ? LEFT_RAIL_WIDTH
    : leftPanelWidth;
  const rightPanelColumnWidth = rightPanelOpen
    ? toolPanelWidth
    : TOOL_RAIL_WIDTH;
  const gridTemplateColumns = `${leftPanelColumnWidth}px ${
    leftPanelCollapsed ? 0 : 8
  }px minmax(0, 1fr) ${rightPanelOpen ? 8 : 0}px ${rightPanelColumnWidth}px`;
  const rightWorkspaceInset =
    rightPanelColumnWidth + (rightPanelOpen ? 8 : 0);
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
  const flushWorkspaceSession = useCallback(() => {
    const session = latestWorkspaceSessionRef.current;
    if (!session) {
      return;
    }

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }

    saveWorkspaceSession(session);
  }, []);

  useEffect(() => {
    const session = loadWorkspaceSession();
    if (session) {
      restoreWorkspaceSession(session);
    }
    setWorkspaceSessionRestored(true);
  }, [restoreWorkspaceSession]);

  useEffect(() => {
    if (!workspaceSessionRestored) {
      return;
    }

    latestWorkspaceSessionRef.current = {
      activeTabId,
      focusedPaneId,
      selectedMachineId,
      sidebarMachines: sidebarMachinesForWorkspaceSession(machineGroups),
      terminalPanes,
      terminalTabs,
    };

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
    }
    workspaceSessionSaveTimerRef.current = window.setTimeout(() => {
      workspaceSessionSaveTimerRef.current = null;
      const session = latestWorkspaceSessionRef.current;
      if (session) {
        saveWorkspaceSession(session);
      }
    }, WORKSPACE_SESSION_SAVE_DELAY_MS);

    return () => {
      if (workspaceSessionSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSessionSaveTimerRef.current);
        workspaceSessionSaveTimerRef.current = null;
      }
    };
  }, [
    activeTabId,
    focusedPaneId,
    machineGroups,
    selectedMachineId,
    terminalPanes,
    terminalTabs,
    workspaceSessionRestored,
  ]);

  useEffect(() => {
    window.addEventListener("pagehide", flushWorkspaceSession);
    return () => {
      window.removeEventListener("pagehide", flushWorkspaceSession);
      flushWorkspaceSession();
    };
  }, [flushWorkspaceSession]);

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

  useEffect(() => {
    let cancelled = false;

    getSettings()
      .then((storedSettings) => {
        if (cancelled) {
          return;
        }
        setSettings(storedSettings);
        setSettingsLoadError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSettingsLoadError("设置加载失败，已使用默认本地设置。");
      });

    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      settingsSaveRequestRef.current += 1;
      const requestId = settingsSaveRequestRef.current;
      setSettings(nextSettings);
      setSettingsSaveState("saving");
      setSettingsSaveError(null);

      updateSettings(nextSettings)
        .then((storedSettings) => {
          if (requestId !== settingsSaveRequestRef.current) {
            return;
          }
          setSettings(storedSettings);
          setSettingsSaveState("saved");
        })
        .catch((error: unknown) => {
          if (requestId !== settingsSaveRequestRef.current) {
            return;
          }
          setSettingsSaveState("error");
          setSettingsSaveError(
            error instanceof Error ? error.message : String(error),
          );
        });
    },
    [setSettings],
  );
  const beginPanelResize = useCallback(
    (panel: "left" | "tools", event: React.PointerEvent<HTMLDivElement>) => {
      if (
        (panel === "left" && leftPanelCollapsed) ||
        (panel === "tools" && !rightPanelOpen)
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
      leftPanelCollapsed,
      leftPanelColumnWidth,
      leftPanelWidth,
      rightPanelColumnWidth,
      rightPanelOpen,
      toolPanelWidth,
    ],
  );
  const resizeWithKeyboard = useCallback(
    (panel: "left" | "tools", event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      if (
        (panel === "left" && leftPanelCollapsed) ||
        (panel === "tools" && !rightPanelOpen)
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
    [leftPanelCollapsed, rightPanelOpen],
  );

  return (
    <div
      ref={workspaceFrameRef}
      className={cn(
        "relative grid h-screen overflow-hidden transition-[grid-template-columns] duration-200 ease-out",
        resolvedTheme === "dark"
          ? "dark bg-[#101012] text-zinc-100"
          : "bg-[#f5f5f7] text-zinc-950",
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
        className="col-[1/2] row-[1/2] border-b border-r border-black/8 bg-white/78 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/78"
        data-tauri-drag-region
      />
      <div className="col-[2/6] row-[1/2] border-b border-black/8 bg-white/72 backdrop-blur-xl dark:border-white/8 dark:bg-[#111113]/92" />
      <AppTitleBar
        className="pointer-events-none col-[1/-1] row-[1/2] z-10 border-b-0 bg-transparent"
        leftPanelCollapsed={leftPanelCollapsed}
        onLeftPanelCollapsedChange={setLeftPanelCollapsed}
        resolvedTheme={resolvedTheme}
      />
      <div className="col-[1/2] row-[2/3] h-full overflow-hidden">
        <MachineSidebar
          collapsed={leftPanelCollapsed}
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
          openMachineIds={openMachineIds}
          onSearchChange={setMachineSearch}
          onSelectMachine={selectMachine}
          search={machineSearch}
          selectedMachineId={selectedMachineId}
          settingsSelected={settingsDialogOpen}
        />
      </div>
      <ShellResizeSeparator
        className="col-[2/3] row-[2/3]"
        hidden={leftPanelCollapsed}
        label="调整主机侧边栏宽度"
        onKeyDown={(event) => resizeWithKeyboard("left", event)}
        onPointerDown={(event) => beginPanelResize("left", event)}
      />
      <div className="col-[3/6] row-[1/3] h-full min-w-0 flex-1 overflow-hidden">
        <TerminalWorkspace
          activeTabId={activeTabId}
          broadcastDraft={broadcastDraft}
          contentRightInset={rightWorkspaceInset}
          focusedPaneId={focusedPaneId}
          interfaceDensity={settings.interfaceDensity}
          onBroadcastCommand={handleBroadcastCommand}
          onBroadcastDraftChange={setBroadcastDraft}
          onClosePane={closePane}
          onCloseTab={closeTerminalTab}
          onFocusPane={focusPane}
          onPaneCurrentCwdChange={updatePaneCurrentCwd}
          onPaneOutputHistoryChange={updatePaneOutputHistory}
          onOpenLogs={openLogsTool}
          onRenameTab={renameTerminalTab}
          renderCustomTab={(tab, active) =>
            isSftpTransferWorkspaceTab(tab) ? (
              <SftpTransferWorkbench
                active={active}
                groups={machineGroups}
                initialLeftHostId={tab.leftHostId}
                initialRightHostId={tab.rightHostId}
                lockedLeftHostId={tab.lockedLeftHostId}
              />
            ) : null
          }
          onSelectTab={selectTab}
          onSplitPane={splitFocusedPane}
          panes={terminalPanes}
          resolvedTheme={resolvedTheme}
          tabs={terminalTabs}
          terminalAppearance={settings.terminal}
        />
      </div>
      <ShellResizeSeparator
        className="col-[4/5] row-[2/3]"
        hidden={!rightPanelOpen}
        label="调整工具面板宽度"
        onKeyDown={(event) => resizeWithKeyboard("tools", event)}
        onPointerDown={(event) => beginPanelResize("tools", event)}
      />
      <div className="col-[5/6] row-[2/3] h-full overflow-hidden">
        <ToolPanel
          activeTool={activeTool}
          activeTab={activeTab}
          defaultRemoteGroupId={defaultRemoteGroupId}
          defaultRemoteHostId={defaultRemoteHostId}
          focusedPane={focusedPane}
          onActiveToolChange={activateTool}
          onCreateTerminal={addTerminalTab}
          onFocusTab={selectTab}
          onOpenSettingsSection={openSettingsTool}
          onOpenSshTerminal={openSshTerminal}
          onRemoteHostCreated={refreshRemoteHostTree}
          onSettingsChange={handleSettingsChange}
          onSplitPane={splitFocusedPane}
          selectedMachine={activeTerminalMachine}
          settings={settings}
          terminalTabs={terminalTabs}
          tools={tools}
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
            onClose={closeConnectionDialog}
            onCreateLocal={handleCreateLocalProfile}
            onCreateHost={handleCreateRemoteHost}
            onListDockerContainers={listDockerContainers}
            onUpdateHost={updateRemoteHost}
            onUpdateLocal={handleUpdateLocalProfile}
            onCreated={handleRemoteHostCreated}
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
      {profileLoadError || remoteHostLoadError || settingsLoadError ? (
        <div
          className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-amber-300/20 bg-amber-950/80 px-3 py-2 text-sm text-amber-100 shadow-lg shadow-black/30"
          role="alert"
        >
          {profileLoadError ?? remoteHostLoadError ?? settingsLoadError}
        </div>
      ) : null}
    </div>
  );
}

