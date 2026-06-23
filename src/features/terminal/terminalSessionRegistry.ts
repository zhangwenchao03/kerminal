import { writeTerminal } from "../../lib/terminalApi";
import {
  recordCommandHistory,
  type CommandHistoryTarget,
  type CommandHistorySource,
} from "../../lib/commandHistoryApi";
import {
  closeTerminalSessionBinding,
  markTerminalSessionBindingDisconnected,
  markTerminalSessionBindingReady,
  type PaneSessionBindingTraceRequest,
  registerTerminalSessionBinding,
} from "../../lib/paneSessionTraceApi";
import {
  getHostNetworkAssistAutoInjection,
  resetHostNetworkAssistAutoInjectionForTests,
} from "./terminalProxyAutoInjection";

interface PaneSessionRecord {
  sessionId: string;
  containerId?: string;
  containerRuntime?: string;
  targetRef?: string;
  targetToken?: string;
  tabId?: string;
  target: CommandHistoryTarget;
  cwd?: string;
  profileId?: string;
  remoteHostId?: string;
  shell?: string;
}

const paneSessions = new Map<string, PaneSessionRecord>();
const hostNetworkAssistInjectionTasks = new Map<string, Promise<void>>();

export interface BroadcastWriteRequest {
  command?: string;
  data: string;
  targetPaneIds: string[];
}

export interface BroadcastWriteResult {
  missingPaneIds: string[];
  sentPaneIds: string[];
}

export interface SnippetWriteRequest {
  command: string;
  paneId: string;
  tabId?: string;
}

export interface PaneCommandWriteRequest {
  command: string;
  paneId: string;
  source: Extract<CommandHistorySource, "snippet" | "workflow" | "tool">;
  tabId?: string;
}

export interface PaneCommandWriteResult {
  paneId: string;
  reason?: "empty-command" | "missing-session";
  sent: boolean;
  sessionId?: string;
  target?: CommandHistoryTarget;
}

export type SnippetWriteResult = PaneCommandWriteResult;
export type WorkflowWriteResult = PaneCommandWriteResult;

export function registerTerminalPaneSession(
  paneId: string,
  sessionId: string,
  metadata: Partial<Omit<PaneSessionRecord, "sessionId">> = {},
) {
  const record = {
    containerId: metadata.containerId,
    containerRuntime: metadata.containerRuntime,
    sessionId,
    targetRef: metadata.targetRef,
    targetToken: metadata.targetToken,
    target: metadata.target ?? "local",
    cwd: metadata.cwd,
    profileId: metadata.profileId,
    remoteHostId: metadata.remoteHostId,
    shell: metadata.shell,
    tabId: metadata.tabId,
  };
  paneSessions.set(paneId, record);
  reportTerminalSessionRegistered(paneId, record);
  void injectHostNetworkAssistIfEnabled(paneId, record)?.catch(() => undefined);
}

export function unregisterTerminalPaneSession(
  paneId: string,
  sessionId?: string,
) {
  const currentSession = paneSessions.get(paneId);
  if (sessionId && currentSession?.sessionId !== sessionId) {
    return;
  }
  clearInjectedHostNetworkAssistSessions(paneId, currentSession?.sessionId);
  paneSessions.delete(paneId);
  if (currentSession) {
    reportTerminalSessionClosed(paneId, currentSession.sessionId);
  }
}

export function getTerminalPaneSession(paneId: string) {
  return paneSessions.get(paneId)?.sessionId;
}

export function updateTerminalPaneSessionCwd(paneId: string, cwd: string) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession) {
    return;
  }
  paneSessions.set(paneId, {
    ...currentSession,
    cwd,
  });
  reportTerminalSessionMetadataUpdated(paneId, {
    ...currentSession,
    cwd,
  });
}

export function markTerminalPaneSessionDisconnected(
  paneId: string,
  sessionId?: string,
) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession || (sessionId && currentSession.sessionId !== sessionId)) {
    return;
  }
  void markTerminalSessionBindingDisconnected(
    buildTraceRequest(paneId, currentSession),
  ).catch(() => undefined);
}

export function markTerminalPaneSessionReconnected(
  paneId: string,
  sessionId?: string,
) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession || (sessionId && currentSession.sessionId !== sessionId)) {
    return;
  }
  reportTerminalSessionRegistered(paneId, currentSession);
}

export function resetTerminalPaneSessionsForTests() {
  paneSessions.clear();
  hostNetworkAssistInjectionTasks.clear();
  resetHostNetworkAssistAutoInjectionForTests();
}

function reportTerminalSessionRegistered(
  paneId: string,
  session: PaneSessionRecord,
) {
  const request = buildTraceRequest(paneId, session);
  void registerTerminalSessionBinding(request).catch(
    () => undefined,
  );
  void markTerminalSessionBindingReady(request).catch(
    () => undefined,
  );
}

function reportTerminalSessionMetadataUpdated(
  paneId: string,
  session: PaneSessionRecord,
) {
  reportTerminalSessionRegistered(paneId, session);
}

function reportTerminalSessionClosed(paneId: string, sessionId: string) {
  void closeTerminalSessionBinding({ paneId, sessionId }).catch(() => undefined);
}

function buildTraceRequest(
  paneId: string,
  session: PaneSessionRecord,
): PaneSessionBindingTraceRequest {
  return {
    metadata: {
      cwd: session.cwd,
      profileId: session.profileId,
      remoteHostId: session.remoteHostId,
      shell: session.shell,
      tabId: session.tabId,
      targetRef: buildTargetRef(paneId, session),
      targetKind: session.target,
    },
    paneId,
    sessionId: session.sessionId,
    targetToken: session.targetToken,
  };
}

function buildTargetRef(paneId: string, session: PaneSessionRecord): string {
  const backendTargetRef = session.targetRef?.trim();
  if (backendTargetRef) {
    return backendTargetRef;
  }
  const scopeParts = [
    session.tabId ? `tab:${session.tabId}` : undefined,
    `pane:${paneId}`,
  ];
  if (session.target === "local") {
    return joinTargetRefParts([
      "local",
      session.profileId ? `profile:${session.profileId}` : "profile:default",
      ...scopeParts,
    ]);
  }
  if (session.target === "dockerContainer") {
    return joinTargetRefParts([
      "dockerContainer",
      session.remoteHostId ? `host:${session.remoteHostId}` : undefined,
      session.containerRuntime ? `runtime:${session.containerRuntime}` : undefined,
      session.containerId ? `container:${session.containerId}` : undefined,
      ...scopeParts,
    ]);
  }
  return joinTargetRefParts([
    session.target,
    session.remoteHostId ? `host:${session.remoteHostId}` : undefined,
    ...scopeParts,
  ]);
}

function joinTargetRefParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(":");
}

function injectHostNetworkAssistIfEnabled(
  paneId: string,
  session: PaneSessionRecord,
): Promise<void> | undefined {
  if (session.target !== "ssh" || !session.remoteHostId) {
    return undefined;
  }

  const injection = getHostNetworkAssistAutoInjection(session.remoteHostId);
  if (!injection) {
    return undefined;
  }
  const { command: injectionCommand, sessionId: injectionSessionId } = injection;
  const command = injectionCommand.trim();
  if (!command) {
    return undefined;
  }

  const injectionKey = [paneId, session.sessionId, injectionSessionId].join(
    "\u0000",
  );
  const existingTask = hostNetworkAssistInjectionTasks.get(injectionKey);
  if (existingTask) {
    return existingTask;
  }

  const task = Promise.resolve(writeTerminal(session.sessionId, `${command}\r`))
    .then(() =>
      recordCommandHistory({
        command,
        cwd: session.cwd,
        paneId,
        profileId: session.profileId,
        remoteHostId: session.remoteHostId,
        sessionId: session.sessionId,
        shell: session.shell,
        source: "tool",
        target: session.target,
      }),
    )
    .then(() => undefined)
    .catch(() => {
      hostNetworkAssistInjectionTasks.delete(injectionKey);
    });
  hostNetworkAssistInjectionTasks.set(injectionKey, task);
  return task;
}

function clearInjectedHostNetworkAssistSessions(
  paneId: string,
  sessionId?: string,
) {
  const prefix = sessionId
    ? `${paneId}\u0000${sessionId}\u0000`
    : `${paneId}\u0000`;
  for (const key of hostNetworkAssistInjectionTasks.keys()) {
    if (key.startsWith(prefix)) {
      hostNetworkAssistInjectionTasks.delete(key);
    }
  }
}

export async function writeBroadcastCommand({
  command,
  data,
  targetPaneIds,
}: BroadcastWriteRequest): Promise<BroadcastWriteResult> {
  const sentPaneIds: string[] = [];
  const missingPaneIds: string[] = [];

  for (const paneId of targetPaneIds) {
    const session = paneSessions.get(paneId);
    if (!session) {
      missingPaneIds.push(paneId);
      continue;
    }
    await writeTerminal(session.sessionId, data);
    if (command?.trim()) {
      void recordCommandHistory({
        command,
        cwd: session.cwd,
        paneId,
        profileId: session.profileId,
        remoteHostId: session.remoteHostId,
        sessionId: session.sessionId,
        shell: session.shell,
        source: "broadcast",
        target: session.target,
      });
    }
    sentPaneIds.push(paneId);
  }

  return { missingPaneIds, sentPaneIds };
}

export async function writePaneCommand({
  command,
  paneId,
  source,
  tabId,
}: PaneCommandWriteRequest): Promise<PaneCommandWriteResult> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return { paneId, reason: "empty-command", sent: false };
  }

  const session = paneSessions.get(paneId);
  if (!session) {
    return { paneId, reason: "missing-session", sent: false };
  }

  const autoInjectionCommand = session.remoteHostId
    ? getHostNetworkAssistAutoInjection(session.remoteHostId)?.command.trim()
    : undefined;
  if (autoInjectionCommand && autoInjectionCommand !== normalizedCommand) {
    await injectHostNetworkAssistIfEnabled(paneId, session);
  }

  await writeTerminal(session.sessionId, `${normalizedCommand}\r`);
  void recordCommandHistory({
    command: normalizedCommand,
    cwd: session.cwd,
    paneId,
    profileId: session.profileId,
    remoteHostId: session.remoteHostId,
    sessionId: session.sessionId,
    shell: session.shell,
    source,
    tabId,
    target: session.target,
  });

  return {
    paneId,
    sent: true,
    sessionId: session.sessionId,
    target: session.target,
  };
}

export async function writeSnippetCommand(
  request: SnippetWriteRequest,
): Promise<SnippetWriteResult> {
  return writePaneCommand({ ...request, source: "snippet" });
}

export async function writeWorkflowCommand(
  request: SnippetWriteRequest,
): Promise<WorkflowWriteResult> {
  return writePaneCommand({ ...request, source: "workflow" });
}
