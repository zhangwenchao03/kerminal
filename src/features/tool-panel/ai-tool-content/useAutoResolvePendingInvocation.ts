import { useEffect, type MutableRefObject } from "react";

import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";

export function useAutoResolvePendingInvocation({
  autoResolvedInvocationIdsRef,
  pendingInvocation,
  resolvePendingInvocation,
  toolInvocationState,
}: {
  autoResolvedInvocationIdsRef: MutableRefObject<Set<string>>;
  pendingInvocation: AiToolPendingInvocation | null;
  resolvePendingInvocation: (approved: boolean) => Promise<void>;
  toolInvocationState: "idle" | "preparing" | "confirming";
}) {
  useEffect(() => {
    if (
      !pendingInvocation ||
      pendingInvocation.requiresConfirmation ||
      toolInvocationState !== "idle" ||
      autoResolvedInvocationIdsRef.current.has(pendingInvocation.id)
    ) {
      return;
    }
    autoResolvedInvocationIdsRef.current.add(pendingInvocation.id);
    void resolvePendingInvocation(true);
  }, [
    autoResolvedInvocationIdsRef,
    pendingInvocation,
    resolvePendingInvocation,
    toolInvocationState,
  ]);
}
