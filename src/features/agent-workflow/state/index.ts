// Agent 发送请求状态的最小公开入口；测试 reset 保持特性私有。
export {
  claimAgentSendRequestAutoOpen,
  consumeAgentSendRequest,
  requestAgentSend,
  useAgentSendRequestSnapshot,
  type AgentSendRequest,
} from "../agentSendRequestStore";
