import { useEffect, useRef, useState } from "react";
import type {
  AgentWorkflowController,
  AgentWorkflowPreviewResolution,
  AgentWorkflowSendPreview,
} from "../../agent-workflow";
import type { TerminalPane, TerminalTab } from "../../workspace/types";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import type { AgentTerminalSession } from "./AgentTerminalView";
import {
  buildAgentSendPreviewInput,
  retainPreviewForSession,
  type AgentSendPreviewSource,
} from "./agentSendPreviewModel";

interface UseAgentSendPreviewInput {
  activeTab?: TerminalTab;
  controller: AgentWorkflowController;
  focusedPane?: TerminalPane;
  session?: AgentTerminalSession;
  setActionError(message: UserFacingMessage | null): void;
}

/** 管理预览的瞬时正文生命周期；切会话、取消、确认和 TTL 到期都会立即释放正文。 */
export function useAgentSendPreview({
  activeTab,
  controller,
  focusedPane,
  session,
  setActionError,
}: UseAgentSendPreviewInput) {
  const [preview, setPreview] = useState<AgentWorkflowSendPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<AgentWorkflowSendPreview | null>(null);
  const previousSessionIdRef = useRef(session?.agentSessionId);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = session?.agentSessionId;
    if (previewRef.current && previousSessionId !== session?.agentSessionId) {
      controller.cancelSendPreview(previewRef.current.id);
    }
    setPreview((current) =>
      retainPreviewForSession(current, session?.agentSessionId),
    );
  }, [controller, session?.agentSessionId]);

  useEffect(
    () => () => {
      const current = previewRef.current;
      if (current) {
        controller.cancelSendPreview(current.id);
      }
    },
    [controller],
  );

  useEffect(() => {
    if (!preview) {
      return undefined;
    }
    const delay = Math.max(
      0,
      new Date(preview.expiresAt).getTime() - Date.now(),
    );
    const timer = window.setTimeout(() => {
      controller.cancelSendPreview(preview.id);
      setPreview((current) => (current?.id === preview.id ? null : current));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [controller, preview]);

  const create = (source: AgentSendPreviewSource) => {
    if (!session) {
      return;
    }
    const prompt = buildAgentSendPreviewInput({
      activeTab,
      focusedPane,
      session,
      source,
    });
    if (!prompt) {
      setActionError({
        recoveryAction: "请切回会话绑定的目标终端，并确认存在可发送的内容。",
        severity: "warning",
        title: "无法读取目标终端内容",
      });
      return;
    }
    setActionError(null);
    setPreview(
      controller.createSendPreview({
        kind: prompt.kind,
        sessionId: session.agentSessionId,
        text: prompt.text,
      }),
    );
  };

  const cancel = (previewId: string): AgentWorkflowPreviewResolution => {
    const resolution = controller.cancelSendPreview(previewId);
    setPreview((current) => (current?.id === previewId ? null : current));
    return resolution;
  };

  const confirm = async (
    previewId: string,
    submit: boolean,
  ): Promise<AgentWorkflowPreviewResolution> => {
    setBusy(true);
    try {
      const resolution = await controller.confirmSendPreview(previewId, submit);
      setPreview((current) => (current?.id === previewId ? null : current));
      if (resolution.outcome === "failed") {
        setActionError({
          recoveryAction: "请确认对应 Agent 终端仍然打开后重试。",
          severity: "warning",
          title: "Agent 终端未接受发送内容",
        });
      }
      return resolution;
    } finally {
      setBusy(false);
    }
  };

  return { busy, cancel, confirm, create, preview };
}
