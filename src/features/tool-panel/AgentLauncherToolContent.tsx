import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Link2,
  Loader2,
  ShieldOff,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  currentDesktopNotificationVisibility,
  sendDesktopNotification,
} from "../../lib/desktopNotificationApi";
import type { DesktopNotificationSettings } from "../../lib/desktopNotificationPolicy";
import {
  agentSessionRecordId,
  agentSessionRecordAgentId,
  agentSessionRecordTarget,
  createAgentSession,
  getExternalAgentWorkspaceStatus,
  listAgentSessions,
  prepareExternalAgentWorkspace,
  rebindAgentSessionTarget,
  type AgentSessionRecord,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
  type ExternalAgentLaunchSpec,
  type ExternalAgentSessionStatus,
  type ExternalAgentWorkspaceStatus,
} from "../../lib/agentLauncherApi";
import { targetStableId } from "../../lib/targetModel";
import {
  defaultTerminalAppearance,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settings/settingsModel";
import {
  getTerminalPaneSessionRecord,
  listTerminalPaneSessionRecords,
  type PaneSessionListRecord,
  type PaneSessionRecord,
} from "../terminal/terminalSessionRegistry";
import { XtermPane } from "../terminal/XtermPane";
import type { TerminalPane, TerminalTab } from "../workspace/types";
import {
  agentLauncherErrorMessage,
  agentLaunchDisplayCommand,
  agentPermissionSkipFlag,
  agentSupportsPermissionSkip,
  applyAgentLaunchPermissionMode,
  buildAgentLauncherViewModel,
  type AgentLaunchPermissionMode,
  type AgentActionViewModel,
} from "./agent-launcher/agentLauncherModel";

interface AgentLauncherToolContentProps {
  activeTab?: TerminalTab;
  desktopNotifications?: DesktopNotificationSettings;
  focusedPane?: TerminalPane;
  resolvedTheme?: ResolvedTheme;
  terminalAppearance?: TerminalAppearance;
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

interface AgentTerminalSession {
  agentSessionId: string;
  agentId: ExternalAgentId;
  title: string;
  commandLabel: string;
  shell: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  status: ExternalAgentSessionStatus;
  customCommand?: string;
  permissionMode: AgentLaunchPermissionMode;
  target?: AgentSessionTargetRequest;
}

interface AgentSessionSelection {
  agentSessionId: string;
  target?: AgentSessionTargetRequest;
}

interface AgentRestoreChoice {
  agentId: ExternalAgentId;
  permissionMode: AgentLaunchPermissionMode;
  session: AgentSessionSelection;
}

const agentIcons = {
  claude: Sparkles,
  codex: Terminal,
  custom: Wrench,
};
const agentLaunchContextMenuClassName =
  "kerminal-context-menu kerminal-agent-launch-menu kerminal-floating-enter absolute z-[1000] w-[136px]";
const AGENT_LAUNCH_CONTEXT_MENU_WIDTH = 136;
const AGENT_LAUNCH_CONTEXT_MENU_HEIGHT = 38;
const AGENT_LAUNCH_CONTEXT_MENU_INSET = 8;

const initialAgentActions: AgentActionViewModel[] = [
  {
    actionLabel: "Open Codex",
    agentId: "codex",
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
}: AgentLauncherToolContentProps) {
  const [status, setStatus] = useState<ExternalAgentWorkspaceStatus | null>(
    null,
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [customCommandOpen, setCustomCommandOpen] = useState(false);
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
  const launcherMenuRootRef = useRef<HTMLDivElement | null>(null);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<
    string | null
  >(null);
  const [view, setView] = useState<AgentLauncherView>("launcher");
  const loadStatus = useCallback(async (state: LoadState = "loading") => {
    setLoadState(state);
    setLoadError(null);
    try {
      setStatus(await getExternalAgentWorkspaceStatus());
      setLoadState("idle");
    } catch (error) {
      setLoadError(agentLauncherErrorMessage(error));
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

  const runAction = async (
    nextAction: ExternalAgentId,
    action: () => Promise<void>,
  ) => {
    setActionState(nextAction);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(agentLauncherErrorMessage(error));
    } finally {
      setActionState(null);
    }
  };

  const agentSessionList = useMemo(
    () => Object.values(agentSessions),
    [agentSessions],
  );

  const findAgentSessionId = (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode,
  ) =>
    agentSessionList.find(
      (session) =>
        session.agentId === agentId && session.permissionMode === permissionMode,
    )?.agentSessionId ?? null;

  const findPersistedAgentSession = (
    agentId: ExternalAgentId,
    records: AgentSessionRecord[],
  ) => {
    for (const record of records) {
      if (agentSessionRecordAgentId(record) !== agentId) {
        continue;
      }
      try {
        return {
          agentSessionId: agentSessionRecordId(record),
          target: agentSessionRecordTarget(record),
        } satisfies AgentSessionSelection;
      } catch {
        continue;
      }
    }
    return null;
  };

  const resolvePersistedAgentSession = async (agentId: ExternalAgentId) => {
    const current = findPersistedAgentSession(agentId, persistedAgentSessions);
    if (current) {
      return current;
    }
    try {
      const list = await listAgentSessions();
      setPersistedAgentSessions(list.sessions ?? []);
      return findPersistedAgentSession(agentId, list.sessions ?? []);
    } catch {
      return null;
    }
  };

  const launchPreparedSpec = (
    spec: ExternalAgentLaunchSpec,
    options: {
      customCommand?: string;
      permissionMode?: AgentLaunchPermissionMode;
      target?: AgentSessionTargetRequest;
    } = {},
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
      target: options.target,
    };
    setAgentSessions((current) => ({
      ...current,
      [nextSession.agentSessionId]: nextSession,
    }));
    setRestoreChoice(null);
    setActiveAgentSessionId(nextSession.agentSessionId);
    setView("terminal");
  };

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
      target: agentSession.target,
    });
    await loadPersistedAgentSessions();
    await loadStatus("refreshing");
  };

  const startNewProviderAgentSession = async (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
  ) => {
    const agentSession = await createSessionForLaunch(agentId, {
      activeTab,
      focusedPane,
    });
    await prepareAndLaunchAgent(agentId, agentSession, {
      permissionMode,
      resumeProviderSession: false,
    });
  };

  const launchAgent = (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
  ) => {
    if (agentId === "custom") {
      setRestoreChoice(null);
      setCustomCommandOpen(true);
      setActionError(null);
      return;
    }

    const existingSessionId = findAgentSessionId(agentId, permissionMode);
    if (existingSessionId) {
      setRestoreChoice(null);
      setActiveAgentSessionId(existingSessionId);
      setView("terminal");
      return;
    }

    void runAction(agentId, async () => {
      const persistedSession = await resolvePersistedAgentSession(agentId);
      if (persistedSession) {
        setRestoreChoice({ agentId, permissionMode, session: persistedSession });
        return;
      }
      await startNewProviderAgentSession(agentId, permissionMode);
    });
  };

  const launchCustomAgent = () => {
    const trimmedCommand = customCommand.trim();
    if (!trimmedCommand) {
      return;
    }

    const existingSession = agentSessionList.find(
      (session) =>
        session.agentId === "custom" &&
        session.customCommand === trimmedCommand,
    );
    if (existingSession) {
      setActiveAgentSessionId(existingSession.agentSessionId);
      setView("terminal");
      return;
    }

    void runAction("custom", async () => {
      setRestoreChoice(null);
      const agentSession = await createSessionForLaunch("custom", {
        activeTab,
        focusedPane,
      });
      const launchSpec = await prepareExternalAgentWorkspace({
        agentId: "custom",
        agentSessionId: agentSession.agentSessionId,
        customCommand: trimmedCommand,
      });
      launchPreparedSpec(launchSpec, {
        customCommand: trimmedCommand,
        permissionMode: "default",
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

  const rebindAgentTarget = async (
    session: AgentTerminalSession,
    target: AgentSessionTargetRequest,
  ) => {
    setActionState(session.agentId);
    setActionError(null);
    try {
      const record = await rebindAgentSessionTarget(session.agentSessionId, target);
      const nextTarget = agentSessionRecordTarget(record) ?? target;
      setAgentSessions((current) => {
        const existing = current[session.agentSessionId] ?? session;
        return {
          ...current,
          [session.agentSessionId]: {
            ...existing,
            target: nextTarget,
          },
        };
      });
      await loadPersistedAgentSessions();
      return true;
    } catch (error) {
      setActionError(agentLauncherErrorMessage(error));
      return false;
    } finally {
      setActionState(null);
    }
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

            {agentContextMenu ? (
              <AgentLaunchContextMenu
                agent={agentContextMenu.agent}
                onLaunch={(permissionMode) => {
                  setAgentContextMenu(null);
                  launchAgent(agentContextMenu.agent.agentId, permissionMode);
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
          <InlineError message={loadError ?? "Agent workspace unavailable."}>
            <Button onClick={() => void loadStatus("loading")} size="sm">
              Retry
            </Button>
          </InlineError>
        ) : null}
        {actionError ? <InlineError message={actionError} /> : null}
      </div>
      {agentSessionList.map((session) => {
        const active = session.agentSessionId === activeAgentSessionId;
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
            onBack={() => setView("launcher")}
            onRebindTarget={rebindAgentTarget}
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
  }: {
    activeTab?: TerminalTab;
    focusedPane?: TerminalPane;
  },
): Promise<AgentSessionSelection> {
  const record = await createAgentSession({
    agentId,
    title: agentTitle(agentId),
    target: buildAgentSessionTarget(focusedPane, activeTab),
  });
  return {
    agentSessionId: agentSessionRecordId(record),
    target: agentSessionRecordTarget(record),
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

function buildAgentSessionTarget(
  focusedPane?: TerminalPane,
  activeTab?: TerminalTab,
): AgentSessionTargetRequest | undefined {
  if (!focusedPane) {
    return undefined;
  }
  const paneSession = getTerminalPaneSessionRecord(focusedPane.id);
  if (!paneSession?.sessionId) {
    return undefined;
  }
  return {
    cwd: paneSession.cwd ?? focusedPane.currentCwd ?? focusedPane.cwd,
    liveStatus: "ready",
    paneId: focusedPane.id,
    shell: paneSession.shell ?? focusedPane.shell,
    tabId: paneSession.tabId ?? activeTab?.id,
    targetKind: paneSession.target ?? paneTargetKind(focusedPane),
    targetRef: buildAgentTargetRef(focusedPane, activeTab, paneSession),
    targetTerminalSessionId: paneSession.sessionId,
  };
}

function buildAgentSessionTargetFromPaneRecord(
  record: PaneSessionListRecord,
): AgentSessionTargetRequest {
  return {
    cwd: record.cwd,
    liveStatus: "ready",
    paneId: record.paneId,
    shell: record.shell,
    tabId: record.tabId,
    targetKind: record.target,
    targetRef: buildPaneRecordTargetRef(record),
    targetTerminalSessionId: record.sessionId,
  };
}

function buildAgentTargetRef(
  focusedPane: TerminalPane,
  activeTab: TerminalTab | undefined,
  paneSession: PaneSessionRecord,
): string {
  if (paneSession.targetRef?.trim()) {
    return paneSession.targetRef.trim();
  }
  if (focusedPane.target) {
    return targetStableId(focusedPane.target);
  }
  const tabPart = activeTab?.id ? `tab:${activeTab.id}` : undefined;
  const panePart = `pane:${focusedPane.id}`;
  if (paneSession.target === "dockerContainer") {
    return joinTargetRefParts([
      "dockerContainer",
      paneSession.remoteHostId ? `host:${paneSession.remoteHostId}` : undefined,
      paneSession.containerRuntime
        ? `runtime:${paneSession.containerRuntime}`
        : undefined,
      paneSession.containerId ? `container:${paneSession.containerId}` : undefined,
      tabPart,
      panePart,
    ]);
  }
  if (paneSession.target === "local") {
    return joinTargetRefParts([
      "local",
      paneSession.profileId ? `profile:${paneSession.profileId}` : "profile:default",
      tabPart,
      panePart,
    ]);
  }
  return joinTargetRefParts([
    paneSession.target,
    paneSession.remoteHostId ? `host:${paneSession.remoteHostId}` : undefined,
    tabPart,
    panePart,
  ]);
}

function buildPaneRecordTargetRef(record: PaneSessionListRecord): string {
  if (record.targetRef?.trim()) {
    return record.targetRef.trim();
  }
  const tabPart = record.tabId ? `tab:${record.tabId}` : undefined;
  const panePart = `pane:${record.paneId}`;
  if (record.target === "dockerContainer") {
    return joinTargetRefParts([
      "dockerContainer",
      record.remoteHostId ? `host:${record.remoteHostId}` : undefined,
      record.containerRuntime ? `runtime:${record.containerRuntime}` : undefined,
      record.containerId ? `container:${record.containerId}` : undefined,
      tabPart,
      panePart,
    ]);
  }
  if (record.target === "local") {
    return joinTargetRefParts([
      "local",
      record.profileId ? `profile:${record.profileId}` : "profile:default",
      tabPart,
      panePart,
    ]);
  }
  return joinTargetRefParts([
    record.target,
    record.remoteHostId ? `host:${record.remoteHostId}` : undefined,
    tabPart,
    panePart,
  ]);
}

function joinTargetRefParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(":");
}

function formatTargetChipLabel(target?: AgentSessionTargetRequest): string {
  if (!target?.targetTerminalSessionId) {
    return "未绑定";
  }
  if (target.liveStatus === "closed") {
    return "已关闭";
  }
  if (target.liveStatus === "stale") {
    return "已失效";
  }
  const name = compactTargetName(target.targetRef ?? target.paneId);
  const path = compactTargetPath(target.cwd);
  return path ? `${name} · ${path}` : name;
}

function formatPaneRecordTitle(record: PaneSessionListRecord): string {
  return compactTargetName(buildPaneRecordTargetRef(record));
}

function compactTargetName(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "当前终端";
  }
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function compactTargetPath(path?: string): string {
  const normalized = path?.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "cwd 未知";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }
  return `.../${segments.slice(-2).join("/")}`;
}

function paneTargetKind(pane: TerminalPane): string | undefined {
  if (pane.mode === "container") {
    return "dockerContainer";
  }
  return pane.mode === "preview" ? undefined : pane.mode;
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

function AgentIconButton({
  actionState,
  agent,
  onLaunch,
  onOpenMenu,
}: {
  actionState: ActionState;
  agent: AgentActionViewModel;
  onLaunch: (
    agentId: ExternalAgentId,
    permissionMode?: AgentLaunchPermissionMode,
  ) => void;
  onOpenMenu: (agent: AgentActionViewModel, event: ReactMouseEvent) => void;
}) {
  const Icon = agentIcons[agent.agentId];
  const busy = actionState === agent.agentId;
  const disabled = actionState !== null || agent.disabled;
  const label = agent.agentId === "custom" ? "自定义" : agent.title;

  return (
    <button
      aria-label={agent.agentId === "custom" ? "Open Custom Agent" : `Open ${agent.title}`}
      className={cn(
        "kerminal-pressable kerminal-focus-ring flex h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent bg-transparent text-zinc-700 transition hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] active:scale-[0.98] dark:text-zinc-200",
        disabled && "cursor-not-allowed opacity-45",
      )}
      disabled={disabled}
      onClick={() => onLaunch(agent.agentId)}
      onContextMenu={(event) => {
        if (disabled || !agentSupportsPermissionSkip(agent.agentId)) {
          return;
        }
        onOpenMenu(agent, event);
      }}
      title={agent.disabledReason ?? agent.statusDetail}
      type="button"
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      )}
      <span className="max-w-full truncate text-[11px] font-medium">{label}</span>
    </button>
  );
}

function AgentLaunchContextMenu({
  agent,
  onLaunch,
  position,
}: {
  agent: AgentActionViewModel;
  onLaunch: (permissionMode: AgentLaunchPermissionMode) => void;
  position: {
    x: number;
    y: number;
  };
}) {
  const skipFlag = agentPermissionSkipFlag(agent.agentId);
  if (!skipFlag) {
    return null;
  }

  return (
    <div
      aria-label={`${agent.title} launch options`}
      className={agentLaunchContextMenuClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="kerminal-context-menu-group">
        <button
          aria-label={`Launch ${agent.title} with skipped permissions`}
          className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
          onClick={() => onLaunch("skipPermissions")}
          role="menuitem"
          title={skipFlag}
          type="button"
        >
          <span className="kerminal-context-menu-icon">
            <ShieldOff />
          </span>
          <span className="kerminal-context-menu-label">跳过权限打开</span>
        </button>
      </div>
    </div>
  );
}

function AgentTerminalView({
  desktopNotifications,
  focused,
  onBack,
  onRebindTarget,
  resolvedTheme,
  session,
  terminalAppearance,
}: {
  desktopNotifications?: DesktopNotificationSettings;
  focused: boolean;
  onBack: () => void;
  onRebindTarget: (
    session: AgentTerminalSession,
    target: AgentSessionTargetRequest,
  ) => Promise<boolean>;
  resolvedTheme: ResolvedTheme;
  session: AgentTerminalSession;
  terminalAppearance: TerminalAppearance;
}) {
  const [rebindOpen, setRebindOpen] = useState(false);
  const [availableTargets, setAvailableTargets] = useState<
    PaneSessionListRecord[]
  >([]);
  const [rebindBusyTarget, setRebindBusyTarget] = useState<string | null>(null);
  const paneId = `agent-terminal-${session.agentSessionId}`;
  const Icon = agentIcons[session.agentId];
  const workspacePath = compactWorkspacePath(session.cwd);
  const title = session.title === "Custom" ? "自定义" : session.title;
  const targetLabel = formatTargetChipLabel(session.target);
  const notificationLastSentAtRef = useRef<Record<string, number | undefined>>(
    {},
  );
  const notifiedSessionIdsRef = useRef<Set<string>>(new Set());
  const notifyAgentSessionFinished = useCallback(
    (event: { durationMs: number; sessionId: string }) => {
      if (!desktopNotifications?.enabled) {
        return;
      }
      if (notifiedSessionIdsRef.current.has(event.sessionId)) {
        return;
      }
      notifiedSessionIdsRef.current.add(event.sessionId);
      void sendDesktopNotification({
        event: {
          agentName: title,
          durationMs: event.durationMs,
          exitCode: null,
          kind: "agent.process.finished",
          notificationKey: `agent.process.finished:${session.agentSessionId}`,
        },
        lastSentAtByKey: notificationLastSentAtRef.current,
        permissionPrompt: "important-event",
        settings: desktopNotifications,
        visibility: currentDesktopNotificationVisibility(),
      });
    },
    [desktopNotifications, session.agentSessionId, title],
  );
  const openRebindTargets = () => {
    setAvailableTargets(
      listTerminalPaneSessionRecords().filter(
        (record) => !record.paneId.startsWith("agent-terminal-"),
      ),
    );
    setRebindOpen((open) => !open);
  };
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-terminal)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-solid)] px-2.5">
        <Button
          aria-label="Back to agent launcher"
          className="h-8 w-8 rounded-xl"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-[var(--surface-hover)] text-zinc-700 ring-1 ring-inset ring-[var(--border-subtle)] dark:text-zinc-200">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </div>
          <div
            className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400"
            data-testid="agent-terminal-command"
            title={`${session.commandLabel} · ${session.cwd}`}
          >
            {session.commandLabel} · {workspacePath}
          </div>
        </div>
        <div className="relative shrink-0">
          <button
            aria-label="Rebind agent target"
            className={cn(
              "kerminal-pressable kerminal-focus-ring flex h-7 max-w-[132px] items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition",
              session.target?.liveStatus === "stale" ||
                session.target?.liveStatus === "closed"
                ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200"
                : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-zinc-600 dark:text-zinc-300",
            )}
            onClick={openRebindTargets}
            title={targetLabel}
            type="button"
          >
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" data-testid="agent-target-chip">
              {targetLabel}
            </span>
          </button>
          {rebindOpen ? (
            <div className="absolute right-0 top-8 z-20 w-64 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-1.5 shadow-xl shadow-black/15 dark:shadow-black/40">
              {availableTargets.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {availableTargets.map((record) => {
                    const target = buildAgentSessionTargetFromPaneRecord(record);
                    const targetKey = `${record.paneId}:${record.sessionId}`;
                    return (
                      <button
                        aria-label={`Bind agent target to ${formatPaneRecordTitle(record)}`}
                        className="kerminal-pressable kerminal-focus-ring flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--surface-hover)]"
                        disabled={rebindBusyTarget !== null}
                        key={targetKey}
                        onClick={async () => {
                          setRebindBusyTarget(targetKey);
                          const ok = await onRebindTarget(session, target);
                          setRebindBusyTarget(null);
                          if (ok) {
                            setRebindOpen(false);
                          }
                        }}
                        type="button"
                      >
                        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                            {formatPaneRecordTitle(record)}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                            {compactTargetPath(record.cwd)}
                          </span>
                        </span>
                        {rebindBusyTarget === targetKey ? (
                          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  没有可绑定的终端
                </div>
              )}
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 p-2">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-terminal)] shadow-sm shadow-black/5 dark:shadow-black/25">
          <XtermPane
            args={session.args}
            cwd={session.cwd}
            env={session.env}
            focused={focused}
            key={session.agentSessionId}
            paneId={paneId}
            resolvedTheme={resolvedTheme}
            shell={session.shell}
            shellAssistEnabled={false}
            startupMessage={`加载 ${title}...\r\n`}
            terminalAppearance={terminalAppearance}
            title={session.title}
            transientStartupMessage
            onSessionFinished={notifyAgentSessionFinished}
          />
        </div>
      </div>
    </section>
  );
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

function compactWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").endsWith("/.kerminal") ? "~/.kerminal" : path;
}

function InlineError({
  children,
  message,
}: {
  children?: ReactNode;
  message: string;
}) {
  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-100"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {children}
    </div>
  );
}
