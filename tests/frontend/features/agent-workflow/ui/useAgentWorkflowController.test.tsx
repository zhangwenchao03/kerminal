import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentWorkflowController } from "../../../../../src/features/agent-workflow";
import { useAgentWorkflowController } from "../../../../../src/features/agent-workflow/ui";
import type { AgentWorkflowSnapshot } from "../../../../../src/features/agent-workflow";

function SnapshotProbe({
  controller,
}: {
  controller: AgentWorkflowController;
}) {
  const snapshot = useAgentWorkflowController(controller);
  return (
    <>
      <output aria-label="revision">{snapshot.revision}</output>
      <output aria-label="history count">
        {snapshot.historyMetadata.length}
      </output>
    </>
  );
}

describe("useAgentWorkflowController", () => {
  it("订阅 controller 快照并在卸载时清理", () => {
    let listener: ((snapshot: AgentWorkflowSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    const controller = {
      getSnapshot: () =>
        ({
          disposed: false,
          historyMetadata: [],
          loading: false,
          queueMetadata: [],
          revision: 1,
          sessions: [],
          stale: false,
        }) satisfies AgentWorkflowSnapshot,
      subscribe: vi.fn((nextListener: typeof listener) => {
        listener = nextListener;
        return unsubscribe;
      }),
    } as unknown as AgentWorkflowController;

    const view = render(<SnapshotProbe controller={controller} />);
    expect(screen.getByLabelText("revision")).toHaveTextContent("1");

    act(() => {
      listener?.({
        disposed: false,
        historyMetadata: [],
        loading: false,
        queueMetadata: [],
        revision: 2,
        sessions: [],
        stale: false,
      });
    });
    expect(screen.getByLabelText("revision")).toHaveTextContent("2");
    expect(screen.getByLabelText("history count")).toHaveTextContent("0");

    act(() => {
      listener?.({
        disposed: false,
        historyMetadata: [
          {
            action: "selection",
            createdAt: "2026-07-11T00:00:00.000Z",
            id: "history-1",
            outcome: "sent",
            sessionId: "session-1",
            submit: true,
            textBytes: 12,
          },
        ],
        loading: false,
        queueMetadata: [],
        revision: 3,
        sessions: [],
        stale: false,
      });
    });
    expect(screen.getByLabelText("history count")).toHaveTextContent("1");

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
