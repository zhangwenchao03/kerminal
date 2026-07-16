import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { AgentWorkflowController } from "../../agent-workflow";
import {
  agentSessionRecordId,
  updateAgentSession,
  type AgentSessionRecord,
} from "../../../lib/agentLauncherApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../../lib/userFacingMessage";
import type { AgentTerminalSession } from "./AgentTerminalView";

interface UseAgentSessionTitleRenameOptions {
  controller: AgentWorkflowController;
  setActionError: Dispatch<SetStateAction<UserFacingMessage | null>>;
  setPersistedSessions: Dispatch<SetStateAction<AgentSessionRecord[]>>;
  setRuntimeSessions: Dispatch<
    SetStateAction<Record<string, AgentTerminalSession>>
  >;
}

/** 持久化会话标题，并同步当前已挂载的 repository 与 terminal 派生状态。 */
export function useAgentSessionTitleRename({
  controller,
  setActionError,
  setPersistedSessions,
  setRuntimeSessions,
}: UseAgentSessionTitleRenameOptions) {
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const renameSession = useCallback(
    async (agentSessionId: string, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title) {
        return false;
      }
      setRenamingSessionId(agentSessionId);
      setActionError(null);
      try {
        await updateAgentSession(agentSessionId, { title });
        setPersistedSessions((current) =>
          current.map((record) => {
            try {
              return agentSessionRecordId(record) === agentSessionId
                ? {
                    ...record,
                    session: {
                      ...record.session,
                      title,
                    },
                  }
                : record;
            } catch {
              return record;
            }
          }),
        );
        setRuntimeSessions((current) => {
          const session = current[agentSessionId];
          return session
            ? {
                ...current,
                [agentSessionId]: {
                  ...session,
                  title,
                },
              }
            : current;
        });
        await controller.refresh();
        return true;
      } catch (error) {
        setActionError(
          buildUserFacingError(error, {
            recoveryAction: "请保留当前标题并稍后重试。",
            title: "无法更新会话标题",
          }),
        );
        return false;
      } finally {
        setRenamingSessionId(null);
      }
    },
    [
      controller,
      setActionError,
      setPersistedSessions,
      setRuntimeSessions,
    ],
  );

  return { renameSession, renamingSessionId };
}
