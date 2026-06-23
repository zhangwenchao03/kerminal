import type {
  AiConversationCreateRequest,
  AiConversationRouteMode,
  AiConversationScopeKind,
} from "../../../lib/aiConversationApi";
import type { AiApplicationContextRequest } from "../../../lib/aiAgentApi";
import {
  buildAiTerminalContextRequest,
  type AiTerminalContextRequest,
} from "../../../lib/aiContextApi";
import type { AppSettings } from "../../settings/settingsModel";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";

export interface AiConversationSlotDescriptor {
  createRequest: AiConversationCreateRequest;
  routeMode: AiConversationRouteMode;
  slotKey: string;
  targetRefJson: string;
}

export interface AiTargetResolutionInput {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  sessionId?: string;
  settings?: AppSettings;
}

export interface AiResolvedWorkspaceTarget {
  activeTab?: TerminalTab;
  applicationContext: AiApplicationContextRequest;
  conversationSlot: AiConversationSlotDescriptor;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  terminalContext?: AiTerminalContextRequest;
  terminalSessionId?: string;
  terminalSessionReady: boolean;
  terminalSnapshotRequest: AiTerminalContextRequest;
}

export const AI_TERMINAL_SESSION_NOT_READY_ERROR =
  "终端会话未就绪，暂时不可读取终端上下文。";

export function isAiTerminalContextReadinessBlocked(target: {
  focusedPane?: unknown;
  terminalSessionReady: boolean;
}) {
  return Boolean(target.focusedPane && !target.terminalSessionReady);
}

export function resolveAiWorkspaceTarget({
  activeTab,
  focusedPane,
  selectedMachine,
  sessionId,
  settings,
}: AiTargetResolutionInput): AiResolvedWorkspaceTarget {
  const terminalSessionId =
    focusedPane && sessionId?.trim() ? sessionId : undefined;
  const terminalSnapshotRequest = buildAiTerminalContextRequest({
    activeTab,
    focusedPane,
    selectedMachine,
    sessionId: terminalSessionId,
    settings,
  });

  return {
    activeTab,
    applicationContext: buildAiApplicationContext({
      activeTab,
      focusedPane,
      selectedMachine,
      sessionId: terminalSessionId,
    }),
    conversationSlot: buildAiConversationSlotDescriptorForTarget({
      activeTab,
      focusedPane,
      selectedMachine,
    }),
    focusedPane,
    selectedMachine,
    terminalContext: terminalSessionId ? terminalSnapshotRequest : undefined,
    terminalSessionId,
    terminalSessionReady: Boolean(terminalSessionId),
    terminalSnapshotRequest,
  };
}

export function buildAiConversationSlotDescriptorForTarget(input: {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
}): AiConversationSlotDescriptor {
  const { activeTab, focusedPane, selectedMachine } = input;
  if (focusedPane) {
    const targetRef = {
      kind: "pane",
      machineId:
        focusedPane.machineId ?? activeTab?.machineId ?? selectedMachine?.id,
      machineKind: selectedMachine?.kind,
      machineName: selectedMachine?.name,
      paneId: focusedPane.id,
      paneTitle: focusedPane.title,
      tabId: activeTab?.id,
      tabTitle: activeTab?.title,
    };
    return buildSlotDescriptor({
      activeTab,
      focusedPane,
      scopeKind: "lockedPane",
      selectedMachine,
      slotKey: `pane:${focusedPane.id}`,
      targetKey: `pane:${focusedPane.id}`,
      targetRef,
      title: focusedPane.title,
    });
  }

  if (activeTab) {
    const targetRef = {
      kind: "tab",
      machineId: activeTab.machineId ?? selectedMachine?.id,
      machineKind: selectedMachine?.kind,
      machineName: selectedMachine?.name,
      tabId: activeTab.id,
      tabTitle: activeTab.title,
    };
    return buildSlotDescriptor({
      activeTab,
      scopeKind: selectedMachine ? "lockedHost" : "followFocus",
      selectedMachine,
      slotKey: `tab:${activeTab.id}`,
      targetKey: `tab:${activeTab.id}`,
      targetRef,
      title: activeTab.title,
    });
  }

  if (selectedMachine) {
    const targetRef = {
      kind: "host",
      machineId: selectedMachine.id,
      machineKind: selectedMachine.kind,
      machineName: selectedMachine.name,
    };
    return buildSlotDescriptor({
      scopeKind: "lockedHost",
      selectedMachine,
      slotKey: `host:${selectedMachine.id}`,
      targetKey: `host:${selectedMachine.id}`,
      targetRef,
      title: selectedMachine.name,
    });
  }

  return buildSlotDescriptor({
    scopeKind: "noContext",
    slotKey: "no-context",
    targetRef: { kind: "none" },
    title: "普通 AI 会话",
  });
}

function buildAiApplicationContext({
  activeTab,
  focusedPane,
  selectedMachine,
  sessionId,
}: {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  sessionId?: string;
}): AiApplicationContextRequest {
  return {
    activeToolId: "ai",
    activeTab: activeTab
      ? {
          id: activeTab.id,
          machineId: activeTab.machineId,
          title: activeTab.title,
        }
      : undefined,
    focusedPane: focusedPane
      ? {
          id: focusedPane.id,
          machineId: focusedPane.machineId,
          mode: focusedPane.mode,
          sessionId,
          status: focusedPane.status,
          title: focusedPane.title,
        }
      : undefined,
    selectedMachine: selectedMachine
      ? {
          id: selectedMachine.id,
          kind: selectedMachine.kind,
          name: selectedMachine.name,
          production:
            selectedMachine.kind === "ssh"
              ? selectedMachine.production
              : undefined,
          status: selectedMachine.status,
        }
      : undefined,
  };
}

function buildSlotDescriptor(input: {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  scopeKind: AiConversationScopeKind;
  selectedMachine?: Machine;
  slotKey: string;
  targetKey?: string;
  targetRef: Record<string, unknown>;
  title: string;
}): AiConversationSlotDescriptor {
  const routeMode: AiConversationRouteMode =
    input.scopeKind === "noContext" ? "noContextChat" : "followWorkspaceTarget";
  return {
    createRequest: {
      hostId: input.selectedMachine?.id,
      paneId: input.focusedPane?.id,
      scopeKind: input.scopeKind,
      scopeRefJson: JSON.stringify(input.targetRef),
      tabId: input.activeTab?.id,
      targetKey: input.targetKey,
      title: input.title,
    },
    routeMode,
    slotKey: input.slotKey,
    targetRefJson: JSON.stringify(input.targetRef),
  };
}
