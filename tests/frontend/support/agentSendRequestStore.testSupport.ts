import {
  consumeAgentSendRequest,
  getAgentSendRequestSnapshot,
} from "../../../src/features/agent-workflow/agentSendRequestStore";

/** 通过公开消费语义清理默认实例，不向生产模块泄漏测试 reset。 */
export function consumePendingAgentSendRequest() {
  const request = getAgentSendRequestSnapshot().request;
  if (request) {
    consumeAgentSendRequest(request.id);
  }
}
