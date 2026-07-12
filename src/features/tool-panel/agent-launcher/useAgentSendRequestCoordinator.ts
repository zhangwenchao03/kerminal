import { useEffect } from "react";
import {
  consumeAgentSendRequest,
  type AgentSendRequest,
} from "../../agent-workflow/agentSendRequestStore";
import type { TerminalPane, TerminalTab } from "../../workspace/types";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import type { AgentTerminalSession } from "./AgentTerminalView";
import type { AgentSendPreviewSource } from "./agentSendPreviewModel";

interface UseAgentSendRequestCoordinatorInput {
  activeTab?: TerminalTab;
  agentScopeId: string;
  createPreview: (
    source: AgentSendPreviewSource,
    override?: {
      activeTab?: TerminalTab;
      focusedPane?: TerminalPane;
      session?: AgentTerminalSession;
    },
  ) => boolean;
  onActivateSession: (tabId: string, agentSessionId: string) => void;
  preferredSessionId?: string;
  request: AgentSendRequest | null;
  sessions: readonly AgentTerminalSession[];
  setActionError: (message: UserFacingMessage | null) => void;
  targetPane?: TerminalPane;
}

/** 将终端对象动作交给绑定该 pane 的 Agent 会话；无运行会话时短暂等待用户继续或新建。 */
export function useAgentSendRequestCoordinator({
  activeTab,
  agentScopeId,
  createPreview,
  onActivateSession,
  preferredSessionId,
  request,
  sessions,
  setActionError,
  targetPane,
}: UseAgentSendRequestCoordinatorInput) {
  useEffect(() => {
    if (!request) {
      return undefined;
    }
    const clearDelay = Math.max(0, request.expiresAt - Date.now());
    const clearTimer = window.setTimeout(
      () => consumeAgentSendRequest(request.id),
      clearDelay,
    );
    if (!targetPane || targetPane.id !== request.paneId) {
      consumeAgentSendRequest(request.id);
      setActionError({
        recoveryAction: "请回到原终端重新选择要发送的内容。",
        severity: "warning",
        title: "目标终端已经不可用",
      });
      return () => window.clearTimeout(clearTimer);
    }
    if (request.tabId && activeTab?.id !== request.tabId) {
      consumeAgentSendRequest(request.id);
      setActionError({
        recoveryAction: "请回到原终端标签，重新选择需要发送的内容。",
        severity: "warning",
        title: "发送请求已取消",
      });
      return () => window.clearTimeout(clearTimer);
    }

    const scopedSessions = sessions.filter(
      (session) => session.tabId === agentScopeId,
    );
    const matchingSessions = scopedSessions.filter(
      (candidate) => candidate.target?.paneId === request.paneId,
    );
    const session =
      matchingSessions.find(
        (candidate) => candidate.agentSessionId === preferredSessionId,
      ) ?? (matchingSessions.length === 1 ? matchingSessions[0] : undefined);
    if (!session) {
      setActionError(null);
      return () => window.clearTimeout(clearTimer);
    }

    const created = createPreview(request.source, {
      activeTab,
      focusedPane: targetPane,
      session,
    });
    consumeAgentSendRequest(request.id);
    if (!created) {
      return () => window.clearTimeout(clearTimer);
    }
    onActivateSession(session.tabId, session.agentSessionId);
    setActionError(null);
    return () => window.clearTimeout(clearTimer);
  }, [
    activeTab,
    agentScopeId,
    createPreview,
    onActivateSession,
    preferredSessionId,
    request,
    sessions,
    setActionError,
    targetPane,
  ]);
}
