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
    const session = scopedSessions.find(
      (candidate) => candidate.target?.paneId === request.paneId,
    );
    if (!session) {
      setActionError({
        recoveryAction:
          "请继续当前目标的历史对话，或新建一个绑定当前目标的 Agent 对话；完成后会自动打开发送预览。",
        severity: "warning",
        title: "已选择终端内容，等待 Agent 对话",
      });
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
    request,
    sessions,
    setActionError,
    targetPane,
  ]);
}
