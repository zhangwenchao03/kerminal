import { writeTerminal } from "../../lib/terminalApi";
import {
  recordCommandHistory,
  type CommandHistoryTarget,
  type CommandHistorySource,
} from "../../lib/commandHistoryApi";

interface PaneSessionRecord {
  sessionId: string;
  target: CommandHistoryTarget;
  cwd?: string;
  profileId?: string;
  remoteHostId?: string;
  shell?: string;
}

const paneSessions = new Map<string, PaneSessionRecord>();

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
  paneSessions.set(paneId, {
    sessionId,
    target: metadata.target ?? "local",
    cwd: metadata.cwd,
    profileId: metadata.profileId,
    remoteHostId: metadata.remoteHostId,
    shell: metadata.shell,
  });
}

export function unregisterTerminalPaneSession(
  paneId: string,
  sessionId?: string,
) {
  const currentSession = paneSessions.get(paneId);
  if (sessionId && currentSession?.sessionId !== sessionId) {
    return;
  }
  paneSessions.delete(paneId);
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
}

export function resetTerminalPaneSessionsForTests() {
  paneSessions.clear();
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
