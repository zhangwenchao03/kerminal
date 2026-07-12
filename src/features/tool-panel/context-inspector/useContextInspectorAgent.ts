import { useEffect, useState } from "react";
import { listAgentSessions } from "../../../lib/agentLauncherApi";
import {
  resolveWorkspaceContextAgent,
  type WorkspaceContextAgent,
  type WorkspaceContextProjection,
} from "../../workspace/context";

const AGENT_REFRESH_INTERVAL_MS = 5_000;

/**
 * Context 与 Agent 面板会被 ToolPanel 保持挂载，因此定时刷新当前目标会话，
 * 让用户从 Agent 返回 Context 时无需重新打开面板即可看到最新关联状态。
 */
export function useContextInspectorAgent(
  context: WorkspaceContextProjection,
  active = true,
): WorkspaceContextAgent {
  const [agent, setAgent] = useState<WorkspaceContextAgent>(context.agent);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await listAgentSessions();
        if (!cancelled) {
          setAgent(
            resolveWorkspaceContextAgent(
              {
                activeTabId: context.activeTabId,
                focusedPaneId: context.focusedPaneId,
                targetId: context.target?.id ?? null,
              },
              result.sessions ?? [],
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setAgent((current) =>
            current.sessionId
              ? current
              : { sessionId: null, status: "unavailable" },
          );
        }
      }
    };

    setAgent(
      context.agent.sessionId
        ? context.agent
        : { sessionId: null, status: "loading" },
    );
    void refresh();
    const timer = window.setInterval(refresh, AGENT_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [
    active,
    context.activeTabId,
    context.agent.sessionId,
    context.agent.status,
    context.agent.title,
    context.focusedPaneId,
    context.target?.id,
  ]);

  return agent;
}
