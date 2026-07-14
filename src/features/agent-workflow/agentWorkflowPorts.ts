import type { AgentSessionRecord } from "../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../lib/terminalApi";
import type {
  AgentWorkflowPromptRequest,
  AgentWorkflowPromptResult,
} from "./agentWorkflowTypes";

/** 持久化会话只读端口；controller 不拥有 session CRUD。 */
export interface AgentWorkflowRepositoryPort {
  listSessions(): Promise<AgentSessionRecord[]>;
}

/** 终端 typed signal 订阅端口；返回函数必须释放底层监听。 */
export interface AgentWorkflowTerminalSignalPort {
  subscribe(listener: (signal: TerminalAgentSignal) => void): () => void;
}

/** Prompt 传输的可选生命周期上下文；旧 adapter 可继续只接收 request。 */
interface AgentWorkflowPromptTransportContext {
  signal?: AbortSignal;
}

/** Prompt 传输端口；实现方不得记录或持久化 request.text。 */
export interface AgentWorkflowPromptTransportPort {
  send(
    request: AgentWorkflowPromptRequest,
    context?: AgentWorkflowPromptTransportContext,
  ): Promise<AgentWorkflowPromptResult>;
}
