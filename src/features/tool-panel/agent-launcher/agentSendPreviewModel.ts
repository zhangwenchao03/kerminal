import type {
  AgentWorkflowPreviewKind,
  AgentWorkflowSendPreview,
} from "../../agent-workflow";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import {
  readXtermPanePromptSource,
  type XtermPanePromptSourceSnapshot,
} from "../../terminal/xterm/index";
import {
  buildAgentTerminalCommandBlockPrompt,
  buildAgentTerminalContextPrompt,
  buildAgentTerminalSelectionPrompt,
  type AgentTerminalContextSession,
} from "./agentTerminalContextModel";

export type AgentSendPreviewSource = "commandBlock" | "context" | "selection";

export interface AgentSendPreviewBuildInput {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  session: AgentTerminalContextSession;
  source: AgentSendPreviewSource;
}

export interface AgentSendPreviewBuildResult {
  kind: AgentWorkflowPreviewKind;
  text: string;
}

/** 按用户点击时刻读取目标 pane 正文，并复用既有 prompt builder 进行绑定校验。 */
export function buildAgentSendPreviewInput({
  activeTab,
  focusedPane,
  session,
  source,
}: AgentSendPreviewBuildInput): AgentSendPreviewBuildResult | null {
  const paneId = session.target?.paneId ?? focusedPane?.id;
  if (
    !paneId ||
    (session.target?.tabId && session.target.tabId !== activeTab?.id)
  ) {
    return null;
  }
  if (focusedPane?.id !== paneId) {
    return null;
  }

  if (source === "context") {
    const text = buildAgentTerminalContextPrompt({
      activeTab,
      focusedPane,
      session,
    });
    return text ? { kind: "diagnostic", text } : null;
  }

  const runtimeContext = readRuntimeContext(paneId);
  if (!runtimeContext) {
    return null;
  }
  const text =
    source === "selection"
      ? buildAgentTerminalSelectionPrompt({
          activeTab,
          focusedPane,
          runtimeContext,
          session,
        })
      : buildAgentTerminalCommandBlockPrompt({
          activeTab,
          focusedPane,
          runtimeContext,
          session,
        });
  return text ? { kind: source, text } : null;
}

function readRuntimeContext(
  paneId: string,
): XtermPanePromptSourceSnapshot | null {
  return readXtermPanePromptSource(paneId);
}

/** 会话切换时只保留同一 session 的瞬时预览。 */
export function retainPreviewForSession(
  preview: AgentWorkflowSendPreview | null,
  sessionId?: string,
): AgentWorkflowSendPreview | null {
  return preview?.sessionId === sessionId ? preview : null;
}
