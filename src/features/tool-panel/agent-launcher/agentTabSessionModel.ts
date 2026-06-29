import {
  agentSessionRecordId,
  agentSessionRecordStatus,
  agentSessionRecordTarget,
  type AgentSessionRecord,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
  type ExternalAgentSessionStatus,
} from "../../../lib/agentLauncherApi";
import type { AgentLaunchPermissionMode } from "./agentLauncherModel";

export interface AgentSidebarTabSession {
  agentId: ExternalAgentId;
  agentSessionId: string;
  customCommand?: string;
  permissionMode: AgentLaunchPermissionMode;
  status: ExternalAgentSessionStatus;
  tabId: string;
  target?: AgentSessionTargetRequest;
}

export interface AgentSidebarSessionState {
  activeSessionIdByTabId: Record<string, string | undefined>;
  sessionsById: Record<string, AgentSidebarTabSession>;
  viewByTabId: Record<string, "launcher" | "terminal">;
}

export interface TabRemovedCleanupPlan {
  removedTabIds: string[];
  agentSessionIds: string[];
}

export function agentSessionTabId(
  session: Pick<AgentSidebarTabSession, "tabId" | "target">,
): string | undefined {
  return normalizedText(session.target?.tabId) ?? normalizedText(session.tabId);
}

export function visibleAgentSessionForTab(
  state: AgentSidebarSessionState,
  tabId: string | undefined,
): AgentSidebarTabSession | undefined {
  const normalizedTabId = normalizedText(tabId);
  if (!normalizedTabId) {
    return undefined;
  }
  const sessionId = state.activeSessionIdByTabId[normalizedTabId];
  if (!sessionId) {
    return undefined;
  }
  const session = state.sessionsById[sessionId];
  if (!session) {
    return undefined;
  }
  return agentSessionTabId(session) === normalizedTabId ? session : undefined;
}

export function findRunningSessionForTabAgent(
  state: AgentSidebarSessionState,
  tabId: string | undefined,
  agentId: ExternalAgentId,
  permissionMode: AgentLaunchPermissionMode,
  customCommand?: string,
): AgentSidebarTabSession | undefined {
  const normalizedTabId = normalizedText(tabId);
  if (!normalizedTabId) {
    return undefined;
  }
  const normalizedCommand = normalizeCustomCommand(customCommand);
  return Object.values(state.sessionsById).find((session) => {
    if (agentSessionTabId(session) !== normalizedTabId) {
      return false;
    }
    if (session.agentId !== agentId || session.permissionMode !== permissionMode) {
      return false;
    }
    if (!isRunningSidebarSessionStatus(session.status)) {
      return false;
    }
    return normalizeCustomCommand(session.customCommand) === normalizedCommand;
  });
}

export function tabRemovedCleanupPlan(
  previousTabIds: readonly string[],
  nextTabIds: readonly string[],
  state: AgentSidebarSessionState,
): TabRemovedCleanupPlan {
  const nextIds = new Set(nextTabIds.map(normalizedText).filter(Boolean));
  const removedTabIds = previousTabIds
    .map(normalizedText)
    .filter((tabId): tabId is string => Boolean(tabId) && !nextIds.has(tabId));
  const removedSet = new Set(removedTabIds);
  const agentSessionIds = Object.values(state.sessionsById)
    .filter((session) => {
      const tabId = agentSessionTabId(session);
      return Boolean(tabId && removedSet.has(tabId));
    })
    .map((session) => session.agentSessionId);
  return {
    agentSessionIds: [...new Set(agentSessionIds)],
    removedTabIds,
  };
}

export function restorableSessionsForTab(
  records: readonly AgentSessionRecord[],
  tabId: string | undefined,
): AgentSessionRecord[] {
  const normalizedTabId = normalizedText(tabId);
  if (!normalizedTabId) {
    return [];
  }
  return records.filter((record) => {
    if (agentSessionRecordStatus(record) !== "active") {
      return false;
    }
    return agentSessionRecordTarget(record)?.tabId === normalizedTabId;
  });
}

export function agentSessionRecordTabId(
  record: AgentSessionRecord,
): string | undefined {
  return normalizedText(agentSessionRecordTarget(record)?.tabId);
}

export function agentSessionRecordIds(
  records: readonly AgentSessionRecord[],
): string[] {
  return records.map((record) => agentSessionRecordId(record));
}

function isRunningSidebarSessionStatus(
  status: ExternalAgentSessionStatus,
): boolean {
  return status === "starting" || status === "running";
}

function normalizeCustomCommand(command: string | undefined): string {
  return command?.trim() ?? "";
}

function normalizedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
