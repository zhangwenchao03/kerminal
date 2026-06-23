import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiContextSnapshotDetailDialog } from "./AiContextSnapshotDetailDialog";

const snapshotApiMock = vi.hoisted(() => ({
  getAiContextSnapshot: vi.fn(),
}));

vi.mock("../../../lib/aiConversationSnapshotApi", () => snapshotApiMock);

describe("AiContextSnapshotDetailDialog", () => {
  beforeEach(() => {
    snapshotApiMock.getAiContextSnapshot.mockReset();
  });

  it("loads and renders snapshot summary and raw context JSON", async () => {
    snapshotApiMock.getAiContextSnapshot.mockResolvedValue({
      applicationContextJson: JSON.stringify({
        activeTab: { id: "tab-prod", title: "prod-api tab" },
        selectedMachine: { id: "host-prod", name: "prod-api" },
      }),
      attachmentRefsJson: JSON.stringify([{ id: "att-audit" }]),
      conversationId: "conv-audit",
      createdAt: 1_765_000_000_000,
      generatedAt: 1_765_000_000_000,
      id: "ctx-audit",
      messageId: "audit-user",
      policyJson: JSON.stringify({ providerId: "llm-test" }),
      routeMode: "followWorkspaceTarget",
      scopeKind: "lockedPane",
      scopeRefJson: JSON.stringify({ paneId: "pane-prod" }),
      targetRefJson: JSON.stringify({
        kind: "pane",
        machineName: "prod-api",
        paneTitle: "prod-api shell",
      }),
      terminalContextJson: JSON.stringify({ sessionId: "session-prod" }),
    });

    render(
      <AiContextSnapshotDetailDialog
        onClose={vi.fn()}
        snapshotId="ctx-audit"
      />,
    );

    expect(screen.getByText("正在加载上下文快照")).toBeInTheDocument();
    expect(
      await screen.findByRole("dialog", { name: "上下文快照详情" }),
    ).toBeInTheDocument();
    expect(snapshotApiMock.getAiContextSnapshot).toHaveBeenCalledWith(
      "ctx-audit",
    );
    expect(screen.getByText("ctx-audit")).toBeInTheDocument();
    expect(screen.getByText("conv-audit")).toBeInTheDocument();
    expect(screen.getByText("audit-user")).toBeInTheDocument();
    expect(screen.getByText("lockedPane")).toBeInTheDocument();
    expect(screen.getByText("followWorkspaceTarget")).toBeInTheDocument();
    expect(screen.getByText("session-prod")).toBeInTheDocument();
    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByText(/att-audit/)).toBeInTheDocument();
    expect(screen.getAllByText(/prod-api/).length).toBeGreaterThan(0);
  });

  it("surfaces load failures and closes through the modal shell", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onError = vi.fn();
    snapshotApiMock.getAiContextSnapshot.mockRejectedValue(
      new Error("snapshot missing"),
    );

    render(
      <AiContextSnapshotDetailDialog
        onClose={onClose}
        onError={onError}
        snapshotId="ctx-missing"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "snapshot missing",
    );
    expect(onError).toHaveBeenCalledWith("snapshot missing");

    await user.click(screen.getByRole("button", { name: "关闭弹窗" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
