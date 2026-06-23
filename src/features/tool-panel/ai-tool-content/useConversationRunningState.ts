import { useCallback, useRef, useState } from "react";

export function useConversationRunningState(activeConversationId?: string) {
  const [runningConversationIds, setRunningConversationIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const runningConversationIdsRef =
    useRef<ReadonlySet<string>>(runningConversationIds);

  const isConversationRunning = useCallback((conversationId?: string | null) => {
    return Boolean(
      conversationId && runningConversationIdsRef.current.has(conversationId),
    );
  }, []);

  const startConversationRun = useCallback((conversationId: string) => {
    if (runningConversationIdsRef.current.has(conversationId)) {
      return false;
    }
    const next = new Set(runningConversationIdsRef.current);
    next.add(conversationId);
    runningConversationIdsRef.current = next;
    setRunningConversationIds(next);
    return true;
  }, []);

  const finishConversationRun = useCallback((conversationId: string) => {
    if (!runningConversationIdsRef.current.has(conversationId)) {
      return;
    }
    const next = new Set(runningConversationIdsRef.current);
    next.delete(conversationId);
    runningConversationIdsRef.current = next;
    setRunningConversationIds(next);
  }, []);

  return {
    activeConversationRunning: isConversationRunning(activeConversationId),
    finishConversationRun,
    isConversationRunning,
    startConversationRun,
  };
}
