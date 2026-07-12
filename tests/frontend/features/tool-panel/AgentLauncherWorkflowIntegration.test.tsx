import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentLauncherView } from "../../../../src/features/tool-panel/agent-launcher/AgentLauncherView";

const baseProps = {
  actionError: null,
  actionState: null,
  agentActions: [],
  agentTechnicalDetail: "",
  currentAgentTargetLabel: "未绑定",
  customCommand: "",
  customCommandOpen: false,
  loadError: null,
  loadState: "idle" as const,
  onCancelRestore: vi.fn(),
  onContinueRestore: vi.fn(),
  onCustomCommandChange: vi.fn(),
  onCustomCommandSubmit: vi.fn(),
  onLaunch: vi.fn(),
  onNewSession: vi.fn(),
  onRetry: vi.fn(),
  onWorkflowRename: vi.fn().mockResolvedValue(true),
  renamingSessionId: null,
  restoreChoice: null,
  statusAvailable: true,
  visible: true,
};

describe("AgentLauncher workflow integration", () => {
  it("展示统一状态并只以上抛 session id 的方式执行继续和同 Agent 新会话", () => {
    const onWorkflowContinue = vi.fn();
    const onWorkflowNewSession = vi.fn();

    render(
      <AgentLauncherView
        {...baseProps}
        onWorkflowContinue={onWorkflowContinue}
        onWorkflowNewSession={onWorkflowNewSession}
        workflowSnapshot={{
          disposed: false,
          historyMetadata: [],
          loading: false,
          queueMetadata: [],
          revision: 1,
          sessions: [
            {
              agentId: "codex",
              agentSessionId: "ags-1",
              repositoryStatus: "active",
              runtimeStatus: "waitingForUser",
              statusSource: "terminalSignal",
              title: "Codex",
            },
          ],
          stale: false,
        }}
      />,
    );

    expect(screen.getByLabelText("Agent 状态：等待人工")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续对话" }));
    fireEvent.click(screen.getByRole("button", { name: "同 Agent 新会话" }));
    expect(onWorkflowContinue).toHaveBeenCalledWith("ags-1");
    expect(onWorkflowNewSession).toHaveBeenCalledWith("ags-1");
  });

  it("历史仅展示 metadata，不渲染 prompt 正文", () => {
    render(
      <AgentLauncherView
        {...baseProps}
        onWorkflowContinue={vi.fn()}
        onWorkflowNewSession={vi.fn()}
        workflowSnapshot={{
          disposed: false,
          historyMetadata: [
            {
              action: "sent",
              createdAt: "2026-07-11T00:00:00.000Z",
              id: "history-1",
              outcome: "sent",
              sessionId: "ags-1",
              submit: true,
              textBytes: 128,
            },
          ],
          loading: false,
          queueMetadata: [],
          revision: 1,
          sessions: [],
          stale: false,
        }}
      />,
    );

    expect(
      screen.getByRole("list", { name: "Agent 操作历史" }),
    ).toHaveTextContent("128 B");
    expect(screen.queryByText("secret prompt body")).not.toBeInTheDocument();
  });

  it("按当前目标筛选会话并允许修改 Kerminal 会话标题", async () => {
    const onWorkflowRename = vi.fn().mockResolvedValue(true);
    render(
      <AgentLauncherView
        {...baseProps}
        currentAgentTarget={{ targetRef: "ssh:prod" }}
        onWorkflowContinue={vi.fn()}
        onWorkflowNewSession={vi.fn()}
        onWorkflowRename={onWorkflowRename}
        workflowSnapshot={{
          disposed: false,
          historyMetadata: [],
          loading: false,
          queueMetadata: [],
          revision: 1,
          sessions: [
            {
              agentId: "codex",
              agentSessionId: "ags-current",
              repositoryStatus: "active",
              runtimeStatus: "running",
              statusSource: "repository",
              target: { targetRef: "ssh:prod" },
              title: "生产排障",
            },
            {
              agentId: "claude",
              agentSessionId: "ags-other",
              repositoryStatus: "active",
              runtimeStatus: "done",
              statusSource: "repository",
              target: { targetRef: "ssh:staging" },
              title: "测试环境",
            },
          ],
          stale: false,
        }}
      />,
    );

    expect(screen.getByText("生产排障")).toBeInTheDocument();
    expect(screen.queryByText("测试环境")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重命名 生产排障" }));
    fireEvent.change(screen.getByRole("textbox", { name: "会话标题" }), {
      target: { value: "生产发布检查" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存标题" }));

    await waitFor(() =>
      expect(onWorkflowRename).toHaveBeenCalledWith(
        "ags-current",
        "生产发布检查",
      ),
    );
  });
});
