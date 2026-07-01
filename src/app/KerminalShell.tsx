import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Bot,
  Cpu,
  FileText,
  FolderOpen,
  History,
  Network,
  PanelsTopLeft,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { AppTitleBar } from "./AppTitleBar";
import type { MachineSidebarMachineDragEvent } from "../features/machine-sidebar/MachineSidebar.shared";
import type {
  SettingsSaveState,
  SettingsSectionId,
} from "../features/settings/SettingsToolContent";
import {
  keybindingMatchesEvent,
  shortcutPlatform,
} from "../features/settings/keybindingUtils";
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
import type { WorkspaceShellLayout } from "../features/workspace/workspaceSession";
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
  listenNativeMenuActions,
  type NativeMenuAction,
} from "../lib/nativeMenuApi";
import { listProfiles } from "../lib/profileApi";
import {
  createRemoteHostGroup,
  updateRemoteHost,
  type RemoteHost,
} from "../lib/remoteHostApi";
import { getSettings } from "../lib/settingsApi";
import { listSnippets } from "../lib/snippetApi";
import { reapOrphanTerminalSessions } from "../lib/terminalApi";
import { useDocumentTheme } from "../lib/useDocumentTheme";
import { useTauriWindowFrameState } from "../lib/useTauriWindowFrameState";
import { listWorkflows } from "../lib/workflowApi";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import {
  isTerminalSessionTab,
  isToolId,
  type MachineGroup,
  type ToolId,
} from "../features/workspace/types";
import { tools } from "../features/workspace/workspaceData";
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
  createConfigRefreshCoordinator,
  type ConfigChangeNotice,
} from "./configRefreshCoordinator";
import {
  configChangeNoticeSnapshot,
  type ConfigChangeNoticeSnapshot,
  type ConfigChangePublicItem,
} from "./configChangeNoticeModel";
import {
  resolveConnectionEditConflict,
  resolveRemoteGroupEditConflict,
  shouldKeepSettingsEditorDraft,
} from "./configDirtyGuardModel";
import { useKerminalConfigEvents } from "./useKerminalConfigEvents";

function isSftpCapableRemoteHost(host: RemoteHost) {
  return !host.tags.some((tag) =>
    ["rdp", "telnet", "serial"].includes(tag.trim().toLowerCase()),
  );
}

function formatCssAlpha(value: number) {
  return String(Number(value.toFixed(4)));
}

function clampCssAlpha(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCollapsedMachineGroupIds(groupIds: readonly string[] = []) {
  return [...new Set(groupIds.filter(Boolean))].sort();
}

function configHostNoticeItems(groups: MachineGroup[]): ConfigChangePublicItem[] {
  return groups.flatMap((group) =>
    group.machines
      .filter((machine) =>
        ["ssh", "rdp", "telnet", "serial"].includes(machine.kind),
      )
      .map((machine) => ({
        id: machine.id,
        label: machine.name,
        revision: [
          machine.updatedAt ?? "",
          machine.remoteGroupId ?? group.id,
          machine.host ?? "",
          machine.port ?? "",
          machine.production ? "prod" : "dev",
          machine.tags.join(","),
        ].join("|"),
      })),
  );
}

function configProfileNoticeItems(
  profiles: Awaited<ReturnType<typeof listProfiles>>,
): ConfigChangePublicItem[] {
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    revision: [
      profile.updatedAt,
      profile.sidebarGroupId ?? "",
      profile.shell,
      profile.args.join(" "),
      profile.cwd ?? "",
    ].join("|"),
  }));
}

function configSettingsRevision(settings: AppSettings) {
  return JSON.stringify(settings);
}

function shellNoticeClassName(level: ConfigChangeNotice["level"] | "warning") {
  return cn(
    "absolute bottom-3 left-1/2 z-20 flex max-w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-start gap-2 rounded-xl border px-3 py-2 font-mono text-xs shadow-lg shadow-black/20",
    level === "info" &&
      "border-emerald-300/25 bg-emerald-50/95 text-emerald-900 dark:border-emerald-300/20 dark:bg-emerald-950/85 dark:text-emerald-100",
    level === "warning" &&
      "border-amber-300/30 bg-amber-50/95 text-amber-900 dark:border-amber-300/20 dark:bg-amber-950/85 dark:text-amber-100",
    level === "error" &&
      "border-rose-300/30 bg-rose-50/95 text-rose-900 dark:border-rose-300/20 dark:bg-rose-950/85 dark:text-rose-100",
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

const TOOL_PANEL_INITIAL_MAX_WIDTH = 444;
const TOOL_PANEL_INITIAL_MIN_WIDTH = 340;
const TOOL_PANEL_MIN_WIDTH = 300;
const TOOL_PANEL_RESIZE_MAX_WIDTH = 720;

const shellToolRailIcons: Partial<Record<ToolId, typeof Bot>> = {
  agentLauncher: Bot,
  logs: History,
  ports: Network,
  sftp: FolderOpen,
  snippets: FileText,
  system: Cpu,
  tmux: PanelsTopLeft,
};

function ShellToolRail({
  onActiveToolChange,
}: {
  onActiveToolChange: (toolId: ToolId) => void;
}) {
  return (
    <aside
      aria-expanded={false}
      aria-label="工具面板"
      className="kerminal-material-nav flex h-full w-full min-w-0 justify-center border-l"
    >
      <nav
        aria-label="工具栏"
        className="flex w-11 shrink-0 flex-col items-center gap-1.5 py-2.5"
      >
        {tools
          .filter((tool) => tool.id !== "settings")
          .map((tool) => {
            const Icon = shellToolRailIcons[tool.id];
            if (!Icon) {
              return null;
            }
            return (
              <Button
                aria-label={`打开 ${tool.title}`}
                className="h-8 w-8 rounded-xl"
                key={tool.id}
                onClick={() => onActiveToolChange(tool.id)}
                size="icon"
                title={tool.title}
                variant="ghost"
              >
                <Icon className="h-4 w-4" />
              </Button>
            );
          })}
      </nav>
    </aside>
  );
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
  const [configNotice, setConfigNotice] = useState<ConfigChangeNotice | null>(
    null,
  );
  const [configCatalogRevisions, setConfigCatalogRevisions] = useState({
    snippets: 0,
    workflows: 0,
  });
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    initialPanelWidth(0.22, {
      max: 320,
      min: 240,
    }),
  );
  const [toolPanelWidth, setToolPanelWidth] = useState(() =>
    initialPanelWidth(0.24, {
      max: TOOL_PANEL_INITIAL_MAX_WIDTH,
      min: TOOL_PANEL_INITIAL_MIN_WIDTH,
    }),
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [collapsedMachineGroupIds, setCollapsedMachineGroupIds] = useState<
    string[]
  >([]);
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
  const machineGroupsRef = useRef(machineGroups);
  const profilesRef = useRef(profiles);
  const settingsDialogDirtyRef = useRef(false);
  const settingsDialogOpenRef = useRef(settingsDialogOpen);
  const settingsSaveStateRef = useRef<SettingsSaveState>("idle");
  const settingsRef = useRef(settings);
  const snippetNoticeItemsRef = useRef<ConfigChangePublicItem[]>([]);
  const workflowNoticeItemsRef = useRef<ConfigChangePublicItem[]>([]);
  machineGroupsRef.current = machineGroups;
  profilesRef.current = profiles;
  settingsRef.current = settings;
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
  const handleCollapsedMachineGroupIdsChange = useCallback(
    (groupIds: string[]) => {
      setCollapsedMachineGroupIds(normalizeCollapsedMachineGroupIds(groupIds));
    },
    [],
  );
  const handleWorkspaceShellLayoutRestored = useCallback(
    (layout: WorkspaceShellLayout) => {
      if (typeof layout.leftPanelWidth === "number") {
        setLeftPanelWidth(
          clampPanelWidth(layout.leftPanelWidth, { max: 520, min: 220 }),
        );
      }
      if (typeof layout.toolPanelWidth === "number") {
        setToolPanelWidth(
          clampPanelWidth(layout.toolPanelWidth, {
            max: TOOL_PANEL_RESIZE_MAX_WIDTH,
            min: TOOL_PANEL_MIN_WIDTH,
          }),
        );
      }
      if (typeof layout.leftPanelCollapsed === "boolean") {
        setLeftPanelCollapsed(layout.leftPanelCollapsed);
      }
      setCollapsedMachineGroupIds(
        normalizeCollapsedMachineGroupIds(layout.collapsedMachineGroupIds),
      );
    },
    [],
  );
  const workspaceShellLayout = useMemo<WorkspaceShellLayout>(
    () => ({
      collapsedMachineGroupIds,
      leftPanelCollapsed,
      leftPanelWidth,
      toolPanelWidth,
    }),
    [
      collapsedMachineGroupIds,
      leftPanelCollapsed,
      leftPanelWidth,
      toolPanelWidth,
    ],
  );
  const workspaceBackgroundStyle = useMemo<CSSProperties>(() => {
    const windowOpacity =
      Math.min(Math.max(settings.appearance.windowOpacity, 35), 100) / 100;
    const backgroundImageVisible =
      settings.appearance.backgroundEnabled &&
      settings.appearance.backgroundImagePath.trim()
        ? Math.min(Math.max(settings.appearance.backgroundOpacity, 0), 100) /
          100
        : 0;
    const transparencyDepth = 1 - windowOpacity;
    const chromeSurfaceOpacity = clampCssAlpha(
      (resolvedTheme === "dark" ? 0.78 : 0.8) -
        transparencyDepth * 0.1 -
        backgroundImageVisible * 0.06,
      resolvedTheme === "dark" ? 0.62 : 0.66,
      0.82,
    );
    const terminalSurfaceOpacity = clampCssAlpha(
      (resolvedTheme === "dark" ? 0.76 : 0.78) -
        transparencyDepth * 0.12 -
        backgroundImageVisible * 0.08,
      resolvedTheme === "dark" ? 0.62 : 0.64,
      0.84,
    );
    const terminalHeaderOpacity = clampCssAlpha(
      terminalSurfaceOpacity + 0.05,
      resolvedTheme === "dark" ? 0.68 : 0.7,
      0.88,
    );
    const backgroundVeilOpacity =
      backgroundImageVisible > 0
        ? clampCssAlpha(
            (resolvedTheme === "dark" ? 0.32 : 0.46) +
              (1 - backgroundImageVisible) * 0.2,
            resolvedTheme === "dark" ? 0.3 : 0.44,
            resolvedTheme === "dark" ? 0.58 : 0.72,
          )
        : 0;
    return {
      "--app-background-veil-opacity": formatCssAlpha(backgroundVeilOpacity),
      "--app-window-opacity": formatCssAlpha(windowOpacity),
      "--app-nav-surface-opacity": formatCssAlpha(chromeSurfaceOpacity),
      "--app-workspace-surface-opacity": formatCssAlpha(chromeSurfaceOpacity),
      "--app-terminal-header-opacity": formatCssAlpha(terminalHeaderOpacity),
      "--app-terminal-surface-opacity": formatCssAlpha(terminalSurfaceOpacity),
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
  }, [
    resolvedTheme,
    settings.appearance.backgroundEnabled,
    settings.appearance.backgroundFit,
    settings.appearance.backgroundImagePath,
    settings.appearance.backgroundOpacity,
    settings.appearance.windowOpacity,
  ]) as CSSProperties;
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
  const openLogsTool = useCallback(
    () => setActiveTool("logs"),
    [setActiveTool],
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
      } else if (action === "openAgentLauncher") {
        setActiveTool("agentLauncher");
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
  const refreshSettingsFromConfig = useCallback(async () => {
    if (
      shouldKeepSettingsEditorDraft({
        dialogOpen: settingsDialogOpenRef.current,
        dirty: settingsDialogDirtyRef.current,
        saveState: settingsSaveStateRef.current,
      })
    ) {
      setConfigNotice({
        batchId: "settings-editor-draft",
        domains: ["settings"],
        id: `settings-editor-draft:${Date.now()}`,
        level: "warning",
        text: "cfg: settings changed externally; editor draft kept",
        ttlMs: 3500,
      });
      return;
    }
    setSettings(await getSettings());
  }, [setSettings]);
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
  const refreshSnippetNoticeSnapshot = useCallback(async () => {
    const snippets = await listSnippets();
    snippetNoticeItemsRef.current = snippets.map((snippet) => ({
      id: snippet.id,
      label: snippet.title,
      revision: [
        snippet.updatedAt,
        snippet.scope,
        snippet.tags.join(","),
        snippet.command,
      ].join("|"),
    }));
    setConfigCatalogRevisions((current) => ({
      ...current,
      snippets: current.snippets + 1,
    }));
  }, []);
  const refreshWorkflowNoticeSnapshot = useCallback(async () => {
    const workflows = await listWorkflows();
    workflowNoticeItemsRef.current = workflows.map((workflow) => ({
      id: workflow.id,
      label: workflow.title,
      revision: [
        workflow.updatedAt,
        workflow.scope,
        workflow.tags.join(","),
        workflow.steps.map((step) => `${step.id}:${step.updatedAt}`).join(","),
      ].join("|"),
    }));
    setConfigCatalogRevisions((current) => ({
      ...current,
      workflows: current.workflows + 1,
    }));
  }, []);
  const getConfigNoticeSnapshot = useCallback(
    (): ConfigChangeNoticeSnapshot =>
      configChangeNoticeSnapshot({
        hosts: configHostNoticeItems(machineGroupsRef.current),
        profiles: configProfileNoticeItems(profilesRef.current),
        settingsRevision: configSettingsRevision(settingsRef.current),
        snippets: snippetNoticeItemsRef.current,
        workflows: workflowNoticeItemsRef.current,
      }),
    [],
  );
  const configRefreshCoordinator = useMemo(
    () =>
      createConfigRefreshCoordinator({
        getSnapshot: getConfigNoticeSnapshot,
        onNotice: setConfigNotice,
        refreshers: {
          hosts: refreshRemoteHostTree,
          profiles: async () => {
            await refreshProfiles();
          },
          settings: refreshSettingsFromConfig,
          snippets: refreshSnippetNoticeSnapshot,
          workflows: refreshWorkflowNoticeSnapshot,
        },
      }),
    [
      getConfigNoticeSnapshot,
      refreshProfiles,
      refreshRemoteHostTree,
      refreshSettingsFromConfig,
      refreshSnippetNoticeSnapshot,
      refreshWorkflowNoticeSnapshot,
    ],
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
    let cancelled = false;

    Promise.allSettled([listSnippets(), listWorkflows()]).then((results) => {
      if (cancelled) {
        return;
      }
      const [snippetsResult, workflowsResult] = results;
      if (snippetsResult.status === "fulfilled") {
        snippetNoticeItemsRef.current = snippetsResult.value.map((snippet) => ({
          id: snippet.id,
          label: snippet.title,
          revision: [
            snippet.updatedAt,
            snippet.scope,
            snippet.tags.join(","),
            snippet.command,
          ].join("|"),
        }));
      }
      if (workflowsResult.status === "fulfilled") {
        workflowNoticeItemsRef.current = workflowsResult.value.map((workflow) => ({
          id: workflow.id,
          label: workflow.title,
          revision: [
            workflow.updatedAt,
            workflow.scope,
            workflow.tags.join(","),
            workflow.steps.map((step) => `${step.id}:${step.updatedAt}`).join(","),
          ].join("|"),
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!configNotice) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setConfigNotice((current) =>
        current?.id === configNotice.id ? null : current,
      );
    }, configNotice.ttlMs);
    return () => window.clearTimeout(timer);
  }, [configNotice]);

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
            max: Math.min(TOOL_PANEL_RESIZE_MAX_WIDTH, maxToolWidth),
            min: TOOL_PANEL_MIN_WIDTH,
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
          max: TOOL_PANEL_RESIZE_MAX_WIDTH,
          min: TOOL_PANEL_MIN_WIDTH,
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
      {configNotice ? (
        <div
          aria-live="polite"
          className={shellNoticeClassName(configNotice.level)}
          role={configNotice.level === "error" ? "alert" : "status"}
        >
          <span className="min-w-0 flex-1 truncate">{configNotice.text}</span>
          <button
            aria-label="关闭提示"
            className="rounded-md p-1 opacity-75 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            onClick={() => setConfigNotice(null)}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : shellNoticeMessage && shellNoticeVisible ? (
        <div className={shellNoticeClassName("warning")} role="alert">
          <span className="min-w-0 flex-1">{shellNoticeMessage}</span>
          <button
            aria-label="关闭提示"
            className="rounded-md p-1 opacity-75 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
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
