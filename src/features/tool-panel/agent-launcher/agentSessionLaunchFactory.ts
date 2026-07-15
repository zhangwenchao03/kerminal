import {
  agentSessionRecordId,
  agentSessionRecordTarget,
  createAgentSession,
  type ExternalAgentId,
} from "../../../lib/agentLauncherApi";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import type { AgentLaunchTargetMode } from "./AgentLaunchControls";
import { buildAgentSessionTitle } from "./agentLauncherModel";
import {
  buildAgentSessionTarget,
  formatCurrentAgentTargetLabel,
} from "./agentSessionTargetModel";

interface CreateAgentSessionForLaunchInput {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  tabId: string;
  targetMode?: AgentLaunchTargetMode;
}

/** 创建可供启动器继续编排的持久化会话，并统一生成默认标题与目标绑定。 */
export async function createAgentSessionForLaunch(
  agentId: ExternalAgentId,
  {
    activeTab,
    focusedPane,
    tabId,
    targetMode = "current",
  }: CreateAgentSessionForLaunchInput,
) {
  const target =
    targetMode === "unbound"
      ? { liveStatus: "unbound" as const }
      : (buildAgentSessionTarget(focusedPane, activeTab) ?? {
          liveStatus: "unbound" as const,
        });
  const record = await createAgentSession({
    agentId,
    title: buildAgentSessionTitle(
      agentId,
      targetMode === "unbound"
        ? "未绑定"
        : formatCurrentAgentTargetLabel(focusedPane, activeTab),
    ),
    target,
  });
  return {
    agentSessionId: agentSessionRecordId(record),
    tabId,
    target: agentSessionRecordTarget(record),
  };
}
