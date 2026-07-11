import type {
  AgentWorkflowPromptRequest,
  AgentWorkflowPromptTransportPort,
} from "../../agent-workflow";
import type { XtermPaneInputRequest } from "../../terminal/XtermPane";

interface AgentPromptTerminalEndpoint {
  paneId: string;
  send(request: XtermPaneInputRequest): void;
}

const terminalEndpoints = new Map<string, AgentPromptTerminalEndpoint>();
let requestSequence = 0;

export function agentTerminalPaneId(agentSessionId: string): string {
  return `agent-terminal-${agentSessionId}`;
}

/** Agent terminal 挂载时注册瞬时输入端点；正文不进入 repository、日志或历史。 */
export function registerAgentPromptTerminal(
  agentSessionId: string,
  endpoint: AgentPromptTerminalEndpoint,
): () => void {
  terminalEndpoints.set(agentSessionId, endpoint);
  return () => {
    if (terminalEndpoints.get(agentSessionId) === endpoint) {
      terminalEndpoints.delete(agentSessionId);
    }
  };
}

/** 创建严格按 session 映射的 transport；映射不可靠时拒绝，禁止向当前可见终端猜测发送。 */
export function createAgentPromptTransport(): AgentWorkflowPromptTransportPort {
  return {
    send: async (
      request: AgentWorkflowPromptRequest,
      context?: { signal?: AbortSignal },
    ) => {
      if (context?.signal?.aborted) {
        return { accepted: false };
      }
      const endpoint = terminalEndpoints.get(request.sessionId);
      const expectedPaneId = agentTerminalPaneId(request.sessionId);
      if (!endpoint || endpoint.paneId !== expectedPaneId) {
        return { accepted: false };
      }
      const transportId = `agent-prompt-input-${++requestSequence}`;
      endpoint.send({
        id: transportId,
        submit: request.submit,
        text: request.text,
      });
      return { accepted: true, transportId };
    },
  };
}
