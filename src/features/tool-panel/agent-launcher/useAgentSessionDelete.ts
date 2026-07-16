import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AgentWorkflowController,
  AgentWorkflowSendPreview,
} from "../../agent-workflow";
import {
  agentSessionRecordId,
  archiveAgentSession,
  type AgentSessionRecord,
} from "../../../lib/agentLauncherApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../../lib/userFacingMessage";
import type { AgentTerminalSession } from "./AgentTerminalView";

interface UseAgentSessionDeleteOptions {
  activeSessionIdByTabId: Record<string, string | undefined>;
  cancelPreview: (previewId: string) => void;
  controller: AgentWorkflowController;
  onDeleted?: (agentSessionId: string) => void;
  preview: AgentWorkflowSendPreview | null;
  setActionError: Dispatch<SetStateAction<UserFacingMessage | null>>;
  setActiveSessionIdByTabId: Dispatch<
    SetStateAction<Record<string, string | undefined>>
  >;
  setPersistedSessions: Dispatch<SetStateAction<AgentSessionRecord[]>>;
  setRuntimeSessions: Dispatch<
    SetStateAction<Record<string, AgentTerminalSession>>
  >;
  setViewByTabId: Dispatch<
    SetStateAction<Record<string, "launcher" | "terminal" | undefined>>
  >;
}

/** 将会话从 Kerminal 活跃历史中归档，并清理对应的本地运行态映射。 */
export function useAgentSessionDelete({
  activeSessionIdByTabId,
  cancelPreview,
  controller,
  onDeleted,
  preview,
  setActionError,
  setActiveSessionIdByTabId,
  setPersistedSessions,
  setRuntimeSessions,
  setViewByTabId,
}: UseAgentSessionDeleteOptions) {
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );

  const deleteSession = useCallback(
    async (agentSessionId: string) => {
      setDeletingSessionId(agentSessionId);
      setActionError(null);
      try {
        await archiveAgentSession(agentSessionId);
        if (preview?.sessionId === agentSessionId) {
          cancelPreview(preview.id);
        }

        const affectedScopes = new Set(
          Object.entries(activeSessionIdByTabId)
            .filter(([, sessionId]) => sessionId === agentSessionId)
            .map(([scopeId]) => scopeId),
        );
        setRuntimeSessions((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([sessionId]) => sessionId !== agentSessionId,
            ),
          ),
        );
        setPersistedSessions((current) =>
          current.filter((record) => {
            try {
              return agentSessionRecordId(record) !== agentSessionId;
            } catch {
              return true;
            }
          }),
        );
        setActiveSessionIdByTabId((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([, sessionId]) => sessionId !== agentSessionId,
            ),
          ),
        );
        setViewByTabId((current) =>
          Object.fromEntries(
            Object.entries(current).map(([scopeId, view]) => [
              scopeId,
              affectedScopes.has(scopeId) ? "launcher" : view,
            ]),
          ),
        );
        onDeleted?.(agentSessionId);
        await controller.refresh();
        return true;
      } catch (error) {
        setActionError(
          buildUserFacingError(error, {
            recoveryAction: "请保留当前会话记录并稍后重试。",
            title: "无法删除会话记录",
          }),
        );
        return false;
      } finally {
        setDeletingSessionId(null);
      }
    },
    [
      activeSessionIdByTabId,
      cancelPreview,
      controller,
      onDeleted,
      preview,
      setActionError,
      setActiveSessionIdByTabId,
      setPersistedSessions,
      setRuntimeSessions,
      setViewByTabId,
    ],
  );

  return { deleteSession, deletingSessionId };
}
