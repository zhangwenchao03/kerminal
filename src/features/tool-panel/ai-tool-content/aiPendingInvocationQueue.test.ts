import { beforeEach, describe, expect, it } from "vitest";
import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import {
  appendPendingInvocations,
  loadPendingInvocationQueue,
  persistPendingInvocationQueue,
  reconcilePendingInvocations,
  removePendingInvocation,
  selectActivePendingInvocation,
} from "./aiPendingInvocationQueue";

const paneSlot: AiConversationSlotDescriptor = {
  createRequest: {
    paneId: "pane-a",
    scopeKind: "lockedPane",
    scopeRefJson: JSON.stringify({ kind: "pane", paneId: "pane-a" }),
    targetKey: "pane:pane-a",
    title: "Pane A",
  },
  routeMode: "followWorkspaceTarget",
  slotKey: "pane:pane-a",
  targetRefJson: JSON.stringify({ kind: "pane", paneId: "pane-a" }),
};

const hostSlot: AiConversationSlotDescriptor = {
  createRequest: {
    hostId: "host-b",
    scopeKind: "lockedHost",
    scopeRefJson: JSON.stringify({ kind: "host", machineId: "host-b" }),
    targetKey: "host:host-b",
    title: "Host B",
  },
  routeMode: "followWorkspaceTarget",
  slotKey: "host:host-b",
  targetRefJson: JSON.stringify({ kind: "host", machineId: "host-b" }),
};

function pendingInvocation(
  id: string,
  toolTitle = "写入终端",
): AiToolPendingInvocation {
  return {
    argumentsSummary: "sessionId=session-1",
    audit: "summary",
    confirmation: "contextual",
    createdAt: "1",
    id,
    reason: "AI 请求执行工具。",
    requestedBy: "kerminal-agent",
    requiresConfirmation: true,
    risk: "write",
    status: "pending",
    toolId: "terminal.write",
    toolTitle,
  };
}

describe("aiPendingInvocationQueue", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("selects pending invocations by active conversation", () => {
    const first = pendingInvocation("tool-call-a");
    const second = pendingInvocation("tool-call-b");
    const queue = appendPendingInvocations([], {
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocations: [first],
    });
    const nextQueue = appendPendingInvocations(queue, {
      conversationId: "conv-b",
      conversationSlot: hostSlot,
      invocations: [second],
    });

    expect(selectActivePendingInvocation(nextQueue, "conv-a", paneSlot)).toMatchObject({
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocation: first,
    });
    expect(selectActivePendingInvocation(nextQueue, "conv-b", hostSlot)).toMatchObject({
      conversationId: "conv-b",
      conversationSlot: hostSlot,
      invocation: second,
    });
    expect(selectActivePendingInvocation(nextQueue, "conv-missing", paneSlot)).toBeNull();
  });

  it("does not select same-conversation pending invocations for a different slot", () => {
    const invocation = pendingInvocation("tool-call-a");
    const queue = appendPendingInvocations([], {
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocations: [invocation],
    });

    expect(selectActivePendingInvocation(queue, "conv-a", hostSlot)).toBeNull();
    expect(selectActivePendingInvocation(queue, "conv-a", paneSlot)).toMatchObject({
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocation,
    });
  });

  it("deduplicates invocations by id when the model retries", () => {
    const initial = appendPendingInvocations([], {
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocations: [pendingInvocation("tool-call-a", "旧标题")],
    });

    const retried = appendPendingInvocations(initial, {
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocations: [pendingInvocation("tool-call-a", "新标题")],
    });

    expect(retried).toHaveLength(1);
    expect(retried[0].invocation.toolTitle).toBe("新标题");
  });

  it("removes a resolved invocation without touching other conversations", () => {
    const queue = appendPendingInvocations(
      appendPendingInvocations([], {
        conversationId: "conv-a",
        conversationSlot: paneSlot,
        invocations: [pendingInvocation("tool-call-a")],
      }),
      {
        conversationId: "conv-b",
        conversationSlot: hostSlot,
        invocations: [pendingInvocation("tool-call-b")],
      },
    );

    const nextQueue = removePendingInvocation(queue, "tool-call-a");

    expect(selectActivePendingInvocation(nextQueue, "conv-a", paneSlot)).toBeNull();
    expect(selectActivePendingInvocation(nextQueue, "conv-b", hostSlot)).toMatchObject({
      invocation: expect.objectContaining({ id: "tool-call-b" }),
    });
  });

  it("persists queue metadata and reconciles with backend pending records", () => {
    const initial = appendPendingInvocations([], {
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocations: [pendingInvocation("tool-call-a", "旧标题")],
    });
    persistPendingInvocationQueue(initial);

    const loaded = loadPendingInvocationQueue();
    const reconciled = reconcilePendingInvocations(loaded, [
      pendingInvocation("tool-call-a", "恢复后的标题"),
    ]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocation: expect.objectContaining({
        id: "tool-call-a",
        toolTitle: "恢复后的标题",
      }),
    });
  });

  it("rebuilds queue items from backend-owned conversation slot metadata", () => {
    const backendPending = {
      ...pendingInvocation("tool-call-backend", "后端恢复标题"),
      conversationId: "conv-backend",
      conversationSlotJson: JSON.stringify(hostSlot),
    };

    const reconciled = reconcilePendingInvocations([], [backendPending]);

    expect(reconciled).toEqual([
      {
        conversationId: "conv-backend",
        conversationSlot: hostSlot,
        invocation: backendPending,
      },
    ]);
  });

  it("ignores backend-only pending records without usable slot metadata", () => {
    expect(
      reconcilePendingInvocations([], [
        {
          ...pendingInvocation("tool-call-missing-slot"),
          conversationId: "conv-backend",
        },
        {
          ...pendingInvocation("tool-call-invalid-slot"),
          conversationId: "conv-backend",
          conversationSlotJson: "{not json",
        },
      ]),
    ).toEqual([]);
  });

  it("drops locally remembered items that no longer exist on the backend", () => {
    const queue = appendPendingInvocations([], {
      conversationId: "conv-a",
      conversationSlot: paneSlot,
      invocations: [pendingInvocation("tool-call-a")],
    });

    expect(reconcilePendingInvocations(queue, [])).toEqual([]);
  });
});
