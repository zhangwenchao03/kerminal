import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TerminalArtifactList,
  type TerminalArtifact,
  type TerminalArtifactIndexSnapshot,
} from "../../../../../../src/features/terminal/artifacts/public";

function artifact(
  id: string,
  overrides: Partial<TerminalArtifact> = {},
): TerminalArtifact {
  return {
    actions: [
      { enabled: true, id: "copy", requiresConfirmation: false },
      { enabled: true, id: "open", requiresConfirmation: false },
    ],
    createdAt: 1,
    dedupeKey: id,
    id,
    kind: "url",
    label: `Artifact ${id}`,
    paneId: "pane-1",
    pathStyle: "uri",
    revision: 1,
    sensitivity: "normal",
    source: "osc8",
    target: { id: "local", kind: "local" },
    value: `https://example.com/${id}`,
    ...overrides,
  };
}

function snapshot(
  artifacts: readonly TerminalArtifact[],
  degraded = false,
): TerminalArtifactIndexSnapshot {
  return {
    artifacts,
    degraded,
    disposed: false,
    evictions: 0,
    paneId: "pane-1",
    rejected: 0,
    revision: 1,
  };
}

describe("TerminalArtifactList", () => {
  it("renders empty and degraded states without exposing artifact value", () => {
    const { rerender } = render(
      <TerminalArtifactList
        onActionRequest={vi.fn()}
        snapshot={snapshot([])}
      />,
    );
    expect(screen.getByText("当前终端尚未检测到可用产物")).toBeInTheDocument();

    rerender(
      <TerminalArtifactList
        onActionRequest={vi.fn()}
        snapshot={snapshot(
          [artifact("1", { label: "安全标签", value: "secret-raw-value" })],
          true,
        )}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("检测已降级");
    expect(screen.queryByText("secret-raw-value")).not.toBeInTheDocument();
  });

  it("uses roving focus and routes the primary action", () => {
    const onActionRequest = vi.fn();
    render(
      <TerminalArtifactList
        onActionRequest={onActionRequest}
        snapshot={snapshot([artifact("1"), artifact("2")])}
      />,
    );
    const options = screen.getAllByRole("listitem");

    options[0]?.focus();
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(options[1]!, { key: "Enter" });

    expect(onActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "copy",
        artifact: expect.objectContaining({ id: "2" }),
        route: "execute",
      }),
    );
  });

  it("routes sensitive copy to confirmation and agent send to preview", () => {
    const onActionRequest = vi.fn();
    render(
      <TerminalArtifactList
        onActionRequest={onActionRequest}
        snapshot={snapshot([artifact("1", { sensitivity: "sensitive" })])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }));

    expect(onActionRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actionId: "copy", route: "confirmation" }),
    );
    expect(onActionRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionId: "send-to-agent",
        route: "preview",
      }),
    );
  });

  it("只读模式不渲染动作且不通过键盘触发请求", () => {
    const onActionRequest = vi.fn();
    render(
      <TerminalArtifactList
        onActionRequest={onActionRequest}
        showActions={false}
        snapshot={snapshot([artifact("readonly")])}
      />,
    );

    const item = screen.getByRole("listitem");
    expect(screen.queryByRole("button", { name: "复制" })).toBeNull();
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onActionRequest).not.toHaveBeenCalled();
  });
});
