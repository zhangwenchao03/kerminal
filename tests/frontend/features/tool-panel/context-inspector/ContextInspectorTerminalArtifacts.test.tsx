import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  publishXtermPaneArtifactSnapshot,
  removeXtermPaneArtifactSnapshot,
} from "../../../../../src/features/terminal/XtermPane.artifactsRegistry";
import type { TerminalArtifactIndexSnapshot } from "../../../../../src/features/terminal/artifacts/public";
import { ContextInspectorTerminalArtifacts } from "../../../../../src/features/tool-panel/context-inspector";

function snapshot(
  paneId: string,
  label: string,
): TerminalArtifactIndexSnapshot {
  return {
    artifacts: [
      {
        actions: [{ enabled: true, id: "copy", requiresConfirmation: false }],
        createdAt: 1,
        dedupeKey: label,
        id: `${paneId}-artifact`,
        kind: "url",
        label,
        paneId,
        pathStyle: "uri",
        revision: 1,
        sensitivity: "normal",
        source: "osc8",
        target: { id: "local", kind: "local" },
        value: "https://example.test",
      },
    ],
    degraded: false,
    disposed: false,
    evictions: 0,
    paneId,
    rejected: 0,
    revision: 1,
  };
}

describe("ContextInspectorTerminalArtifacts", () => {
  it("订阅 pane 快照并在无 handler 时保持只读", () => {
    const paneId = "pane-readonly";
    const { unmount } = render(
      <ContextInspectorTerminalArtifacts paneId={paneId} />,
    );

    act(() => {
      publishXtermPaneArtifactSnapshot(snapshot(paneId, "部署日志"));
    });

    expect(screen.getByText("部署日志")).toBeVisible();
    expect(screen.queryByRole("button", { name: "复制" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("listitem"), { key: "Enter" });
    expect(screen.queryByRole("button")).toBeNull();

    unmount();
    removeXtermPaneArtifactSnapshot(paneId);
  });

  it("提供 handler 时只转发 artifact 动作请求", () => {
    const paneId = "pane-actions";
    const onActionRequest = vi.fn();
    publishXtermPaneArtifactSnapshot(snapshot(paneId, "构建报告"));

    const { unmount } = render(
      <ContextInspectorTerminalArtifacts
        onActionRequest={onActionRequest}
        paneId={paneId}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(onActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "copy",
        artifact: expect.objectContaining({ paneId }),
        route: "execute",
      }),
    );

    unmount();
    removeXtermPaneArtifactSnapshot(paneId);
  });
});
