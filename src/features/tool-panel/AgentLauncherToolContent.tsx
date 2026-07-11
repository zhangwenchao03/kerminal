import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Info, Loader2, Terminal } from "lucide-react";
import { Button } from "../../components/ui/button";
import { IconAction } from "../../components/ui/icon-action";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import type { DesktopNotificationSettings } from "../../lib/desktopNotificationPolicy";
import {
  agentSessionRecordId,
  agentSessionRecordAgentId,
  agentSessionRecordTarget,
  archiveAgentSession,
  createAgentSession,
  getExternalAgentWorkspaceStatus,
  listAgentSessions,
  prepareExternalAgentWorkspace,
  type AgentSessionRecord,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
  type ExternalAgentLaunchSpec,
  type ExternalAgentWorkspaceStatus,
} from "../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../lib/terminalApi";
import {
  buildUserFacingError,
  redactSensitiveTechnicalDetail,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import {
  defaultTerminalAppearance,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settings/settingsModel";
import {
  isTerminalSessionTab,
  type TerminalPane,
  type TerminalTab,
} from "../workspace/types";
import {
  agentLaunchDisplayCommand,
  applyAgentLaunchPermissionMode,
  buildAgentLauncherViewModel,
  type AgentLaunchPermissionMode,
  type AgentActionViewModel,
} from "./agent-launcher/agentLauncherModel";
import {
  agentSessionScopeId,
  findRunningSessionForTabAgent,
  restorableSessionsForTab,
  tabRemovedCleanupPlan,
  visibleAgentSessionForTab,
  type AgentSidebarSessionState,
} from "./agent-launcher/agentTabSessionModel";
import {
  buildAgentSessionTarget,
  formatCurrentAgentTargetLabel,
  formatTargetChipLabel,
} from "./agent-launcher/agentSessionTargetModel";
import {
  AgentTerminalView,
  type AgentTerminalSession,
} from "./agent-launcher/AgentTerminalView";
import {
  AgentIconButton,
  AgentLaunchContextMenu,
  type AgentLaunchTargetMode,
} from "./agent-launcher/AgentLaunchControls";

interface AgentLauncherToolContentProps {
  activeTab?: TerminalTab;
  desktopNotifications?: DesktopNotificationSettings;
  focusedPane?: TerminalPane;
  resolvedTheme?: ResolvedTheme;
  terminalAppearance?: TerminalAppearance;
  terminalTabs?: TerminalTab[];
}

type LoadState = "idle" | "loading" | "refreshing" | "error";
type ActionState = ExternalAgentId | null;
type AgentLauncherView = "launcher" | "terminal";

interface AgentLauncherContextMenuState {
  agent: AgentActionViewModel;
  position: {
    x: number;
    y: number;
  };
}

interface AgentSessionSelection {
  agentSessionId: string;
  tabId: string;
  target?: AgentSessionTargetRequest;
}

interface AgentRestoreChoice {
  agentId: ExternalAgentId;
  permissionMode: AgentLaunchPermissionMode;
  session: AgentSessionSelection;
}

const AGENT_LAUNCH_CONTEXT_MENU_WIDTH = 164;
const AGENT_LAUNCH_CONTEXT_MENU_HEIGHT = 72;
const AGENT_LAUNCH_CONTEXT_MENU_INSET = 8;

const initialAgentActions: AgentActionViewModel[] = [
  {
    actionLabel: "Open Codex",
    agentId: "codex",
    availabilityDetail: "正在检查 Codex 状态。",
    availabilityLabel: "需设置",
    cliCommand: "codex",
    configLabel: "Workspace",
    configPath: "~/.kerminal/.codex/config.toml",
    disabled: false,
    installLabel: "Launch",
    statusDetail: "Open Codex in the Kerminal workspace.",
    title: "Codex",
    tone: "muted",
  },
  {
    actionLabel: "Open Claude",
    agentId: "claude",
    availabilityDetail: "正在检查 Claude 状态。",
    availabilityLabel: "需设置",
    cliCommand: "claude",
    configLabel: "Workspace",
    configPath: "~/.kerminal/.mcp.json",
    disabled: false,
    installLabel: "Launch",
    statusDetail: "Open Claude in the Kerminal workspace.",
    title: "Claude",
    tone: "muted",
  },
  {
    actionLabel: "Open Custom Agent",
    agentId: "custom",
    availabilityDetail: "输入自定义命令后打开。",
    availabilityLabel: "需设置",
    cliCommand: "User supplied CLI",
    configLabel: "Explicit command",
    configPath: "~/.kerminal",
    disabled: false,
    installLabel: "Launch",
    statusDetail: "Enter a custom CLI command to run in the Kerminal workspace.",
    title: "Custom",
    tone: "muted",
  },
];

export function AgentLauncherToolContent({
  activeTab,
  desktopNotifications,
  focusedPane,
  resolvedTheme = "dark",
  terminalAppearance = defaultTerminalAppearance,
  terminalTabs,
}: AgentLauncherToolContentProps) {
  const [status, setStatus] = useState<ExternalAgentWorkspaceStatus | null>(
    null,
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<UserFacingMessage | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [actionError, setActionError] = useState<UserFacingMessage | null>(null);
  const [customCommandOpen, setCustomCommandOpen] = useState(false);
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [customCommand, setCustomCommand] = useState("");
  const [agentSessions, setAgentSessions] = useState<
    Record<string, AgentTerminalSession>
  >({});
  const [persistedAgentSessions, setPersistedAgentSessions] = useState<
    AgentSessionRecord[]
  >([]);
  const [restoreChoice, setRestoreChoice] = useState<AgentRestoreChoice | null>(
    null,
  );
  const [agentContextMenu, setAgentContextMenu] =
    useState<AgentLauncherContextMenuState | null>(null);
  const [customLaunchTargetMode, setCustomLaunchTargetMode] =
    useState<AgentLaunchTargetMode>("current");
  const launcherMenuRootRef = useRef<HTMLDivElement | null>(null);
  const [activeSessionIdByTabId, setActiveSessionIdByTabId] = useState<
    Record<string, string | undefined>
  >({});
  const [viewByTabId, setViewByTabId] = useState<
    Record<string, AgentLauncherView | undefined>
  >({});
  const previousTerminalTabIdsRef = useRef<string[] | null>(null);
  const activeAgentTabId = isTerminalSessionTab(activeTab)
    ? activeTab.id
    : undefined;
  const activeAgentScopeId = agentSessionScopeId(activeAgentTabId);
  const view = viewByTabId[activeAgentScopeId] ?? "launcher";
  const loadStatus = useCallback(async (state: LoadState = "loading") => {
    setLoadState(state);
    setLoadError(null);
    try {
      setStatus(await getExternalAgentWorkspaceStatus());
      setLoadState("idle");
    } catch (error) {
      setLoadError(
        buildUserFacingError(error, {
          recoveryAction: "请确认 Kerminal 服务可用后重试。",
          title: "无法读取 Agent 状态",
        }),
      );
      setLoadState("error");
    }
  }, []);

  const loadPersistedAgentSessions = useCallback(async () => {
    try {
      const list = await listAgentSessions();
      setPersistedAgentSessions(list.sessions ?? []);
    } catch {
      setPersistedAgentSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadStatus("loading");
    void loadPersistedAgentSessions();
  }, [loadPersistedAgentSessions, loadStatus]);

  useEffect(() => {
    if (!agentContextMenu) {
      return undefined;
    }

    const closeMenu = () => setAgentContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [agentContextMenu]);

  const agentActions = useMemo(
    () => (status ? buildAgentLauncherViewModel(status, true) : initialAgentActions),
    [status],
  );
  const agentTechnicalDetail = useMemo(
    () =>
      redactSensitiveTechnicalDetail(
        [
          `MCP: ${status?.mcpServerRunning ? "running" : "stopped"}`,
          `Endpoint: ${status?.mcpEndpoint || "unavailable"}`,
          ...agentActions.flatMap((agent) => [
            "",
            `${agent.title}: ${agent.availabilityLabel}`,
            `  command: ${agent.cliCommand}`,
            `  config: ${agent.configPath}`,
            `  status: ${agent.statusDetail}`,
          ]),
        ].join("\n"),
      ),
    [agentActions, status],
  );
  const currentAgentTargetLabel = formatCurrentAgentTargetLabel(
    focusedPane,
    activeTab,
  );

  const runAction = async (
    nextAction: ExternalAgentId,
    action: () => Promise<void>,
  ) => {
    setActionState(nextAction);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(
        buildUserFacingError(error, {
          recoveryAction: "请检查目标终端和 Agent 配置后重试。",
          title: "Agent 操作未完成",
        }),
      );
    } finally {
      setActionState(null);
    }
  };

  const agentSessionList = useMemo(
    () => Object.values(agentSessions),
    [agentSessions],
  );

  const agentSidebarState: AgentSidebarSessionState = useMemo(
    () => ({
      activeSessionIdByTabId,
      sessionsById: agentSessions,
      viewByTabId: viewByTabId as Record<string, AgentLauncherView>,
    }),
    [activeSessionIdByTabId, agentSessions, viewByTabId],
  );

  const activeAgentSession = useMemo(
    () => visibleAgentSessionForTab(agentSidebarState, activeAgentScopeId),
    [activeAgentScopeId, agentSidebarState],
  );
  const terminalTabIds = useMemo(
    () =>
      terminalTabs
        ?.filter((tab) => isTerminalSessionTab(tab))
        .map((tab) => tab.id) ?? [],
    [terminalTabs],
  );
  const terminalTabIdsKey = terminalTabIds.join("\u0000");

  useEffect(() => {
    if (!terminalTabs) {
      return;
    }
    const previousTabIds = previousTerminalTabIdsRef.current;
    previousTerminalTabIdsRef.current = terminalTabIds;
    if (!previousTabIds) {
      return;
    }
    const cleanupPlan = tabRemovedCleanupPlan(
      previousTabIds,
      terminalTabIds,
      agentSidebarState,
    );
    if (cleanupPlan.agentSessionIds.length === 0) {
      return;
    }
    const removedSessionIds = new Set(cleanupPlan.agentSessionIds);
    const removedTabIds = new Set(cleanupPlan.removedTabIds);
    setAgentSessions((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([agentSessionId]) => !removedSessionIds.has(agentSessionId),
        ),
      ),
    );
    setActiveSessionIdByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)),
      ),
    );
    setViewByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)),
      ),
    );
    void Promise.all(
      cleanupPlan.agentSessionIds.map(async (agentSessionId) => {
        try {
          await archiveAgentSession(agentSessionId);
        } catch (error) {
          setActionError(
            buildUserFacingError(error, {
              recoveryAction: "请稍后重新整理会话。",
              title: "无法归档 Agent 会话",
            }),
          );
        }
      }),
    );
  }, [agentSidebarState, terminalTabIds, terminalTabIdsKey, terminalTabs]);

  const findAgentSessionId = (
    tabId: string | undefined,
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode,
  ) =>
    findRunningSessionForTabAgent(
      agentSidebarState,
      tabId,
      agentId,
      permissionMode,
    )?.agentSessionId ?? null;

  const setTabView = (tabId: string, nextView: AgentLauncherView) => {
    setViewByTabId((current) => ({
      ...current,
      [tabId]: nextView,
    }));
  };

  const activateAgentSessionForTab = (
    tabId: string,
    agentSessionId: string,
  ) => {
    setActiveSessionIdByTabId((current) => ({
      ...current,
      [tabId]: agentSessionId,
    }));
    setTabView(tabId, "terminal");
  };

  const findPersistedAgentSession = (
    tabId: string,
    agentId: ExternalAgentId,
    records: AgentSessionRecord[],
  ) => {
    for (const record of restorableSessionsForTab(records, tabId)) {
      if (agentSessionRecordAgentId(record) !== agentId) {
        continue;
      }
      try {
        return {
          agentSessionId: agentSessionRecordId(record),
          tabId,
          target: agentSessionRecordTarget(record),
        } satisfies AgentSessionSelection;
      } catch {
        continue;
      }
    }
    return null;
  };

  const resolvePersistedAgentSession = async (
    tabId: string,
    agentId: ExternalAgentId,
  ) => {
    const current = findPersistedAgentSession(
      tabId,
      agentId,
      persistedAgentSessions,
    );
    if (current) {
      return current;
    }
    try {
      const list = await listAgentSessions();
      setPersistedAgentSessions(list.sessions ?? []);
      return findPersistedAgentSession(tabId, agentId, list.sessions ?? []);
    } catch {
      return null;
    }
  };

  const launchPreparedSpec = (
    spec: ExternalAgentLaunchSpec,
    options: {
      customCommand?: string;
      permissionMode?: AgentLaunchPermissionMode;
      tabId: string;
      target?: AgentSessionTargetRequest;
    },
  ) => {
    const permissionMode = options.permissionMode ?? "default";
    const launchSpec = applyAgentLaunchPermissionMode(spec, permissionMode);
    const agentSessionId = launchSpec.agentSessionId?.trim();
    if (!agentSessionId) {
      throw new Error("Agent session launch spec is missing agentSessionId.");
    }
    const nextSession: AgentTerminalSession = {
      agentSessionId,
      agentId: launchSpec.agentId,
      args: launchSpec.args ?? [],
      commandLabel: formatLaunchCommand(launchSpec),
      cwd: launchSpec.cwd,
      env: launchSpec.env,
      permissionMode,
      shell: launchSpec.shell,
      status: launchSpec.status ?? "running",
      title: launchSpec.agentId === "custom" ? "Custom" : launchSpec.title,
      customCommand: options.customCommand,
      tabId: options.tabId,
      target: options.target,
    };
    setAgentSessions((current) => ({
      ...current,
      [nextSession.agentSessionId]: nextSession,
    }));
    setRestoreChoice(null);
    activateAgentSessionForTab(options.tabId, nextSession.agentSessionId);
  };

  const handleAgentSignal = useCallback((signal: TerminalAgentSignal) => {
    const agentSessionId = signal.agentSessionId?.trim();
    if (!agentSessionId) {
      return;
    }
    setAgentSessions((current) => {
      const session = current[agentSessionId];
      if (!session) {
        return current;
      }
      if (
        session.agentId !== "custom" &&
        session.agentId !== signal.agent
      ) {
        return current;
      }
      if (
        session.agentSignal?.terminalSessionId === signal.terminalSessionId &&
        session.agentSignal?.agent === signal.agent &&
        session.agentSignal?.status === signal.status
      ) {
        return current;
      }
      return {
        ...current,
        [agentSessionId]: {
          ...session,
          agentSignal: signal,
        },
      };
    });
  }, []);

  const prepareAndLaunchAgent = async (
    agentId: ExternalAgentId,
    agentSession: AgentSessionSelection,
    options: {
      customCommand?: string;
      permissionMode?: AgentLaunchPermissionMode;
      resumeProviderSession?: boolean;
    } = {},
  ) => {
    const launchSpec = await prepareExternalAgentWorkspace({
      agentId,
      agentSessionId: agentSession.agentSessionId,
      ...(options.customCommand !== undefined
        ? { customCommand: options.customCommand }
        : {}),
      ...(options.resumeProviderSession !== undefined
        ? { resumeProviderSession: options.resumeProviderSession }
        : {}),
    });
    launchPreparedSpec(launchSpec, {
      customCommand: options.customCommand,
      permissionMode: options.permissionMode,
      tabId: agentSession.tabId,
      target: agentSession.target,
    });
    await loadPersistedAgentSessions();
    await loadStatus("refreshing");
  };

  const startNewProviderAgentSession = async (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
    targetMode: AgentLaunchTargetMode = "current",
  ) => {
    const agentSession = await createSessionForLaunch(agentId, {
      activeTab,
      focusedPane,
      tabId: activeAgentScopeId,
      targetMode,
    });
    await prepareAndLaunchAgent(agentId, agentSession, {
      permissionMode,
      resumeProviderSession: false,
    });
  };

  const launchAgent = (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
    targetMode: AgentLaunchTargetMode = "current",
  ) => {
    if (agentId === "custom") {
      setCustomLaunchTargetMode(targetMode);
      setRestoreChoice(null);
      setCustomCommandOpen(true);
      setActionError(null);
      return;
    }

    const existingSessionId = findAgentSessionId(
      activeAgentScopeId,
      agentId,
      permissionMode,
    );
    if (existingSessionId) {
      setRestoreChoice(null);
      activateAgentSessionForTab(activeAgentScopeId, existingSessionId);
      return;
    }

    void runAction(agentId, async () => {
      const persistedSession = await resolvePersistedAgentSession(
        activeAgentScopeId,
        agentId,
      );
      if (persistedSession) {
        setRestoreChoice({ agentId, permissionMode, session: persistedSession });
        return;
      }
      await startNewProviderAgentSession(agentId, permissionMode, targetMode);
    });
  };

  const launchCustomAgent = () => {
    const trimmedCommand = customCommand.trim();
    if (!trimmedCommand) {
      return;
    }
    const tabId = activeAgentScopeId;

    const existingSession = agentSessionList.find(
      (session) =>
        session.tabId === tabId &&
        session.agentId === "custom" &&
        session.customCommand === trimmedCommand,
    );
    if (existingSession) {
      activateAgentSessionForTab(tabId, existingSession.agentSessionId);
      return;
    }

    void runAction("custom", async () => {
      setRestoreChoice(null);
      const agentSession = await createSessionForLaunch("custom", {
        activeTab,
        focusedPane,
        tabId,
        targetMode: customLaunchTargetMode,
      });
      const launchSpec = await prepareExternalAgentWorkspace({
        agentId: "custom",
        agentSessionId: agentSession.agentSessionId,
        customCommand: trimmedCommand,
      });
      launchPreparedSpec(launchSpec, {
        customCommand: trimmedCommand,
        permissionMode: "default",
        tabId: agentSession.tabId,
        target: agentSession.target,
      });
      await loadPersistedAgentSessions();
      await loadStatus("refreshing");
    });
  };

  const continuePersistedAgentSession = (choice: AgentRestoreChoice) => {
    void runAction(choice.agentId, async () => {
      await prepareAndLaunchAgent(choice.agentId, choice.session, {
        permissionMode: choice.permissionMode,
        resumeProviderSession: true,
      });
    });
  };

  const createFreshAgentSession = (choice: AgentRestoreChoice) => {
    void runAction(choice.agentId, async () => {
      await startNewProviderAgentSession(
        choice.agentId,
        choice.permissionMode,
      );
    });
  };

  const openAgentContextMenu = (
    agent: AgentActionViewModel,
    event: ReactMouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = launcherMenuRootRef.current?.getBoundingClientRect();
    setAgentContextMenu({
      agent,
      position: clampAgentLaunchContextMenuPosition(
        bounds ? event.clientX - bounds.left : event.clientX,
        bounds ? event.clientY - bounds.top : event.clientY,
        bounds,
      ),
    });
  };

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-[var(--surface-terminal)]">
      <div
        aria-hidden={view !== "launcher"}
        className={cn(
          "absolute inset-0 flex min-h-0 flex-col px-3 py-4 transition-opacity duration-150",
          view === "launcher"
            ? "opacity-100"
            : "pointer-events-none select-none opacity-0",
        )}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="relative w-full max-w-[260px]" ref={launcherMenuRootRef}>
            <div className="mb-2 flex min-w-0 items-center gap-1 px-1">
              <div
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-[11px]"
                data-testid="agent-current-target"
                title={currentAgentTargetLabel}
              >
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                  当前目标
                </span>
                <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-200">
                  {currentAgentTargetLabel}
                </span>
              </div>
              <IconAction
                aria-controls="agent-launcher-technical-details"
                aria-expanded={technicalDetailsOpen}
                className="h-7 w-7 rounded-lg"
                icon={Info}
                label="查看 Agent 技术详情"
                onClick={() => setTechnicalDetailsOpen((current) => !current)}
                tooltip="技术详情"
                variant="ghost"
              />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {agentActions.map((agent) => (
                <AgentIconButton
                  actionState={actionState}
                  agent={agent}
                  key={agent.agentId}
                  onLaunch={launchAgent}
                  onOpenMenu={openAgentContextMenu}
                />
              ))}
            </div>
            {technicalDetailsOpen ? (
              <div
                aria-label="Agent 技术详情"
                className="kerminal-muted-surface mt-2 rounded-xl border p-2.5"
                id="agent-launcher-technical-details"
                role="region"
              >
                <pre className="scrollbar-none max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-zinc-600 dark:text-zinc-300">
                  {agentTechnicalDetail}
                </pre>
              </div>
            ) : null}

            {agentContextMenu ? (
              <AgentLaunchContextMenu
                agent={agentContextMenu.agent}
                onLaunch={(permissionMode, targetMode = "current") => {
                  setAgentContextMenu(null);
                  launchAgent(
                    agentContextMenu.agent.agentId,
                    permissionMode,
                    targetMode,
                  );
                }}
                position={agentContextMenu.position}
              />
            ) : null}

            {customCommandOpen ? (
              <form
                className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-1.5 shadow-sm shadow-black/5 dark:shadow-black/20"
                onSubmit={(event) => {
                  event.preventDefault();
                  launchCustomAgent();
                }}
              >
                <label className="sr-only">
                  Custom CLI command
                </label>
                <input
                  aria-label="Custom agent command"
                  autoFocus
                  className="h-8 min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 font-mono text-xs text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-sky-400/50 focus:bg-white/70 focus:ring-4 focus:ring-sky-400/15 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:bg-white/10"
                  onChange={(event) => setCustomCommand(event.target.value)}
                  placeholder="kimi or qwen --model ..."
                  value={customCommand}
                />
                <Button
                  aria-label="Open custom agent command"
                  disabled={actionState !== null || !customCommand.trim()}
                  size="icon"
                  type="submit"
                  variant="primary"
                >
                  {actionState === "custom" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Terminal className="h-4 w-4" />
                  )}
                </Button>
              </form>
            ) : null}

            {restoreChoice ? (
              <AgentRestoreChoicePanel
                actionState={actionState}
                choice={restoreChoice}
                onCancel={() => setRestoreChoice(null)}
                onContinue={continuePersistedAgentSession}
                onNewSession={createFreshAgentSession}
              />
            ) : null}
          </div>
        </div>

        {loadState === "error" && !status ? (
          <UserFacingNotice
            className="mt-3"
            compact
            message={
              loadError ?? {
                recoveryAction: "请稍后重试。",
                severity: "error",
                title: "无法读取 Agent 状态",
              }
            }
          >
            <Button onClick={() => void loadStatus("loading")} size="sm">
              重试
            </Button>
          </UserFacingNotice>
        ) : null}
        {actionError ? (
          <UserFacingNotice className="mt-3" compact message={actionError} />
        ) : null}
      </div>
      {agentSessionList.map((session) => {
        const active = session.agentSessionId === activeAgentSession?.agentSessionId;
        return (
        <div
          aria-hidden={view !== "terminal" || !active}
          className={cn(
            "absolute inset-0 transition-opacity duration-150",
            view === "terminal" && active
              ? "opacity-100"
              : "pointer-events-none select-none opacity-0",
          )}
          key={session.agentSessionId}
        >
          <AgentTerminalView
            focused={view === "terminal" && active}
            session={session}
            desktopNotifications={desktopNotifications}
            onBack={() => {
              setTabView(activeAgentScopeId, "launcher");
            }}
            onAgentSignal={handleAgentSignal}
            resolvedTheme={resolvedTheme}
            terminalAppearance={terminalAppearance}
          />
        </div>
        );
      })}
    </section>
  );
}

async function createSessionForLaunch(
  agentId: ExternalAgentId,
  {
    activeTab,
    focusedPane,
    tabId,
    targetMode = "current",
  }: {
    activeTab?: TerminalTab;
    focusedPane?: TerminalPane;
    tabId: string;
    targetMode?: AgentLaunchTargetMode;
  },
): Promise<AgentSessionSelection> {
  const target =
    targetMode === "unbound"
      ? unboundAgentSessionTarget()
      : buildAgentSessionTarget(focusedPane, activeTab) ??
        unboundAgentSessionTarget();
  const record = await createAgentSession({
    agentId,
    title: agentTitle(agentId),
    target,
  });
  return {
    agentSessionId: agentSessionRecordId(record),
    tabId,
    target: agentSessionRecordTarget(record),
  };
}
function unboundAgentSessionTarget(): AgentSessionTargetRequest {
  return {
    liveStatus: "unbound",
  };
}
function AgentRestoreChoicePanel({
  actionState,
  choice,
  onCancel,
  onContinue,
  onNewSession,
}: {
  actionState: ActionState;
  choice: AgentRestoreChoice;
  onCancel: () => void;
  onContinue: (choice: AgentRestoreChoice) => void;
  onNewSession: (choice: AgentRestoreChoice) => void;
}) {
  const busy = actionState === choice.agentId;
  const disabled = actionState !== null;
  return (
    <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-2 shadow-lg shadow-black/10 dark:shadow-black/35">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {agentTitle(choice.agentId)}
        </span>
        <span
          className={cn(
            "max-w-[116px] truncate rounded-full border px-2 py-0.5 text-[10px] font-medium",
            choice.session.target?.liveStatus === "stale" ||
              choice.session.target?.liveStatus === "closed"
              ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200"
              : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-zinc-600 dark:text-zinc-300",
          )}
          data-testid="agent-restore-target-chip"
          title={formatTargetChipLabel(choice.session.target)}
        >
          {formatTargetChipLabel(choice.session.target)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <button
          className="kerminal-pressable kerminal-focus-ring h-8 rounded-xl bg-zinc-900 px-2 text-[11px] font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          disabled={disabled}
          onClick={() => onContinue(choice)}
          type="button"
        >
          {busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : "继续上次"}
        </button>
        <button
          className="kerminal-pressable kerminal-focus-ring h-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 text-[11px] font-semibold text-zinc-700 transition hover:bg-[var(--surface-field)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-200"
          disabled={disabled}
          onClick={() => onNewSession(choice)}
          type="button"
        >
          新会话
        </button>
        <button
          className="kerminal-pressable kerminal-focus-ring h-8 rounded-xl px-2 text-[11px] font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-400"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}
function agentTitle(agentId: ExternalAgentId): string {
  if (agentId === "claude") {
    return "Claude";
  }
  if (agentId === "custom") {
    return "Custom";
  }
  return "Codex";
}
function clampAgentLaunchContextMenuPosition(
  x: number,
  y: number,
  bounds?: DOMRect,
) {
  const width = bounds?.width ?? window.innerWidth;
  const height = bounds?.height ?? window.innerHeight;
  const maxX = Math.max(
    AGENT_LAUNCH_CONTEXT_MENU_INSET,
    width - AGENT_LAUNCH_CONTEXT_MENU_WIDTH - AGENT_LAUNCH_CONTEXT_MENU_INSET,
  );
  const maxY = Math.max(
    AGENT_LAUNCH_CONTEXT_MENU_INSET,
    height - AGENT_LAUNCH_CONTEXT_MENU_HEIGHT - AGENT_LAUNCH_CONTEXT_MENU_INSET,
  );

  return {
    x: Math.max(
      AGENT_LAUNCH_CONTEXT_MENU_INSET,
      Math.min(x, maxX),
    ),
    y: Math.max(
      AGENT_LAUNCH_CONTEXT_MENU_INSET,
      Math.min(y, maxY),
    ),
  };
}
function formatLaunchCommand(spec: ExternalAgentLaunchSpec): string {
  return agentLaunchDisplayCommand(spec) || spec.title;
}
