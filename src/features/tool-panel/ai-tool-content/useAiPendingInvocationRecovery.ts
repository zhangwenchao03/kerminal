import { useEffect, type Dispatch, type SetStateAction } from "react";
import { listAiToolPendingInvocations } from "../../../lib/aiToolInvocationApi";
import {
  persistPendingInvocationQueue,
  reconcilePendingInvocations,
  type AiPendingInvocationQueueItem,
} from "./aiPendingInvocationQueue";

interface UseAiPendingInvocationRecoveryOptions {
  conversationPersistenceEnabled: boolean;
  pendingInvocations: AiPendingInvocationQueueItem[];
  setPendingInvocations: Dispatch<SetStateAction<AiPendingInvocationQueueItem[]>>;
  setToolInvocationError: Dispatch<SetStateAction<string | null>>;
}

export function useAiPendingInvocationRecovery({
  conversationPersistenceEnabled,
  pendingInvocations,
  setPendingInvocations,
  setToolInvocationError,
}: UseAiPendingInvocationRecoveryOptions) {
  useEffect(() => {
    persistPendingInvocationQueue(pendingInvocations);
  }, [pendingInvocations]);

  useEffect(() => {
    if (!conversationPersistenceEnabled) {
      return;
    }
    let cancelled = false;
    listAiToolPendingInvocations()
      .then((backendInvocations) => {
        if (cancelled) {
          return;
        }
        setPendingInvocations((current) =>
          reconcilePendingInvocations(current, backendInvocations),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setToolInvocationError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationPersistenceEnabled, setPendingInvocations, setToolInvocationError]);
}
