import { useEffect, useState } from "react";
import type { AgentWorkflowController } from "../AgentWorkflowController";

/** 订阅 controller 的只读派生快照；hook 不拥有 session 或 prompt 状态。 */
export function useAgentWorkflowController(
  controller: AgentWorkflowController,
) {
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());

  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      unsubscribe();
    };
  }, [controller]);

  return snapshot;
}
