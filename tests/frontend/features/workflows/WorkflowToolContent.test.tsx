import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandWorkflow } from "../../../../src/lib/workflowApi";
import { WorkflowToolContent } from "../../../../src/features/workflows/WorkflowToolContent";

const workflowApiMocks = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
}));

const terminalSessionRegistryMocks = vi.hoisted(() => ({
  writeWorkflowCommand: vi.fn(),
}));

vi.mock("../../../../src/lib/workflowApi", () => ({
  createWorkflow: (...args: unknown[]) =>
    workflowApiMocks.createWorkflow(...args),
  deleteWorkflow: (...args: unknown[]) =>
    workflowApiMocks.deleteWorkflow(...args),
  listWorkflows: (...args: unknown[]) => workflowApiMocks.listWorkflows(...args),
}));

vi.mock("../../../../src/features/terminal/terminalSessionRegistry", () => terminalSessionRegistryMocks);

describe("WorkflowToolContent", () => {
  beforeEach(() => {
    workflowApiMocks.createWorkflow.mockReset();
    workflowApiMocks.deleteWorkflow.mockReset();
    workflowApiMocks.listWorkflows.mockReset();
    terminalSessionRegistryMocks.writeWorkflowCommand.mockReset();
    terminalSessionRegistryMocks.writeWorkflowCommand.mockResolvedValue({
      paneId: "pane-1",
      sent: true,
      sessionId: "session-1",
      target: "local",
    });
  });

  it("announces workflow loading without showing an empty state early", async () => {
    let resolveList!: (workflows: CommandWorkflow[]) => void;
    workflowApiMocks.listWorkflows.mockReturnValue(
      new Promise<CommandWorkflow[]>((resolve) => {
        resolveList = resolve;
      }),
    );

    render(<WorkflowToolContent />);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载工作流");
    expect(screen.queryByText("暂无命令工作流。")).not.toBeInTheDocument();

    resolveList([]);

    expect(await screen.findByText("暂无命令工作流。")).toBeInTheDocument();
  });

  it("announces workflow load failures", async () => {
    workflowApiMocks.listWorkflows.mockRejectedValueOnce(
      new Error("workflow list failed"),
    );

    render(<WorkflowToolContent />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workflow list failed",
    );
    expect(screen.queryByText("暂无命令工作流。")).not.toBeInTheDocument();
  });

  it("distinguishes filtered empty results from an empty workflow library", async () => {
    const user = userEvent.setup();
    workflowApiMocks.listWorkflows.mockResolvedValue([]);

    render(<WorkflowToolContent />);

    expect(await screen.findByText("暂无命令工作流。")).toBeInTheDocument();

    await user.type(screen.getByLabelText("搜索工作流"), "deploy");

    expect(
      await screen.findByText("当前筛选下没有命令工作流。"),
    ).toBeInTheDocument();
  });

  it("keeps the workflow draft when workflows reload from external config", async () => {
    const user = userEvent.setup();
    workflowApiMocks.listWorkflows.mockResolvedValue([]);
    const { rerender } = render(<WorkflowToolContent configRevision={1} />);

    expect(await screen.findByText("暂无命令工作流。")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("工作流标题"));
    await user.type(screen.getByLabelText("工作流标题"), "外部刷新草稿");

    rerender(<WorkflowToolContent configRevision={2} />);

    expect(screen.getByLabelText("工作流标题")).toHaveValue("外部刷新草稿");
    expect(
      await screen.findByText("cfg: workflows reloaded; draft kept"),
    ).toBeInTheDocument();
  });
});
