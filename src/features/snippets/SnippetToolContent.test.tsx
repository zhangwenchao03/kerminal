import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalPane, TerminalTab } from "../workspace/types";
import { SnippetToolContent } from "./SnippetToolContent";

const snippetApiMocks = vi.hoisted(() => ({
  createSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
  listSnippets: vi.fn(),
}));

const workflowApiMocks = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
}));

const terminalSessionRegistryMocks = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
  writeSnippetCommand: vi.fn(),
  writeWorkflowCommand: vi.fn(),
}));

vi.mock("../../lib/snippetApi", () => ({
  createSnippet: (...args: unknown[]) => snippetApiMocks.createSnippet(...args),
  deleteSnippet: (...args: unknown[]) => snippetApiMocks.deleteSnippet(...args),
  listSnippets: (...args: unknown[]) => snippetApiMocks.listSnippets(...args),
}));

vi.mock("../../lib/workflowApi", () => ({
  createWorkflow: (...args: unknown[]) =>
    workflowApiMocks.createWorkflow(...args),
  deleteWorkflow: (...args: unknown[]) =>
    workflowApiMocks.deleteWorkflow(...args),
  listWorkflows: (...args: unknown[]) =>
    workflowApiMocks.listWorkflows(...args),
}));

vi.mock("../terminal/terminalSessionRegistry", () => terminalSessionRegistryMocks);

const localPane: TerminalPane = {
  id: "pane-1",
  latencyMs: 1,
  lines: [],
  machineId: "local-powershell",
  mode: "local",
  profileId: "profile-local",
  prompt: "PS C:\\dev\\rust\\kerminal>",
  shell: "pwsh.exe",
  status: "online",
  title: "本地 PowerShell",
};

const sshPane: TerminalPane = {
  id: "pane-ssh",
  latencyMs: 12,
  lines: [],
  machineId: "prod-api",
  mode: "ssh",
  prompt: "deploy@prod-api:~$",
  remoteHostId: "prod-api",
  shell: "ssh",
  status: "warning",
  title: "prod api",
};

const activeTab: TerminalTab = {
  id: "tab-1",
  layout: {
    paneId: "pane-1",
    type: "pane",
  },
  machineId: "local-powershell",
  title: "本地",
};

describe("SnippetToolContent", () => {
  beforeEach(() => {
    snippetApiMocks.createSnippet.mockReset();
    snippetApiMocks.deleteSnippet.mockReset();
    snippetApiMocks.listSnippets.mockReset();
    workflowApiMocks.createWorkflow.mockReset();
    workflowApiMocks.deleteWorkflow.mockReset();
    workflowApiMocks.listWorkflows.mockReset();
    terminalSessionRegistryMocks.getTerminalPaneSession.mockReset();
    terminalSessionRegistryMocks.getTerminalPaneSession.mockReturnValue(
      "session-1",
    );
    terminalSessionRegistryMocks.writeSnippetCommand.mockReset();
    terminalSessionRegistryMocks.writeSnippetCommand.mockResolvedValue({
      paneId: "pane-1",
      sent: true,
      sessionId: "session-1",
      target: "local",
    });
    terminalSessionRegistryMocks.writeWorkflowCommand.mockReset();
    terminalSessionRegistryMocks.writeWorkflowCommand.mockResolvedValue({
      paneId: "pane-1",
      sent: true,
      sessionId: "session-1",
      target: "local",
    });
    snippetApiMocks.listSnippets.mockResolvedValue([
      {
        command: "git status --short",
        createdAt: "1",
        description: "日常开发检查",
        id: "snippet-git",
        scope: "local",
        sortOrder: 10,
        tags: ["git", "daily"],
        title: "检查 Git 状态",
        updatedAt: "1",
      },
    ]);
    snippetApiMocks.createSnippet.mockResolvedValue({
      command: "git status --short",
      createdAt: "2",
      description: null,
      id: "snippet-new",
      scope: "any",
      sortOrder: 20,
      tags: ["git"],
      title: "新片段",
      updatedAt: "2",
    });
    snippetApiMocks.deleteSnippet.mockResolvedValue(true);
    workflowApiMocks.listWorkflows.mockResolvedValue([]);
    workflowApiMocks.createWorkflow.mockResolvedValue({
      createdAt: "2",
      description: null,
      id: "workflow-new",
      scope: "any",
      sortOrder: 20,
      steps: [
        {
          command: "npm run check",
          createdAt: "2",
          description: null,
          id: "workflow-new-step-1",
          requiresConfirmation: false,
          scope: null,
          sortOrder: 10,
          title: "运行检查",
          updatedAt: "2",
        },
      ],
      tags: ["quality"],
      title: "新工作流",
      updatedAt: "2",
    });
    workflowApiMocks.deleteWorkflow.mockResolvedValue(true);
  });

  it("loads command snippets", async () => {
    render(<SnippetToolContent />);

    expect(await screen.findByText("检查 Git 状态")).toBeInTheDocument();
    expect(screen.getAllByText("git status --short").length).toBeGreaterThan(0);
    expect(screen.queryByText("Git 状态")).not.toBeInTheDocument();
    expect(snippetApiMocks.listSnippets).toHaveBeenCalledWith({
      query: undefined,
      scope: undefined,
    });
  });

  it("shows read-only preset snippets when user snippets are empty", async () => {
    const user = userEvent.setup();
    snippetApiMocks.listSnippets.mockResolvedValueOnce([]);

    render(
      <SnippetToolContent activeTabId={activeTab.id} focusedPane={localPane} />,
    );

    expect(await screen.findByText("empty snippets")).toBeInTheDocument();
    expect(screen.queryByText("Git 状态")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预设命令 14" }));

    expect(await screen.findByText("Git 状态")).toBeInTheDocument();
    expect(screen.getByText(/预设 \//)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除片段 Git 状态" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "运行片段 Git 状态" }));

    expect(terminalSessionRegistryMocks.writeSnippetCommand).toHaveBeenCalledWith({
      command: "git status --short\ngit branch --show-current",
      paneId: "pane-1",
      tabId: "tab-1",
    });
  });

  it("creates a command snippet", async () => {
    const user = userEvent.setup();
    snippetApiMocks.listSnippets
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          command: "npm run check",
          createdAt: "2",
          description: "完整质量门禁",
          id: "snippet-check",
          scope: "any",
          sortOrder: 20,
          tags: ["quality"],
          title: "一键检查",
          updatedAt: "2",
        },
      ]);

    render(<SnippetToolContent />);

    await user.click(screen.getByRole("button", { name: "添加脚本片段" }));
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "一键检查");
    await user.clear(screen.getByLabelText("脚本内容"));
    await user.type(screen.getByLabelText("脚本内容"), "npm run check");
    await user.clear(screen.getByLabelText("说明"));
    await user.type(screen.getByLabelText("说明"), "完整质量门禁");
    await user.clear(screen.getByLabelText("分组标签"));
    await user.type(screen.getByLabelText("分组标签"), "quality");
    await user.click(screen.getByRole("button", { name: "保存片段" }));

    expect(snippetApiMocks.createSnippet).toHaveBeenCalledWith({
      command: "npm run check",
      description: "完整质量门禁",
      scope: "any",
      tags: ["quality"],
      title: "一键检查",
    });
    expect(await screen.findByText("一键检查")).toBeInTheDocument();
  });

  it("fills snippet variables and sends the rendered command to the focused pane", async () => {
    const user = userEvent.setup();
    snippetApiMocks.listSnippets.mockResolvedValueOnce([
      {
        command: "echo {{ name }}",
        createdAt: "3",
        description: "带变量片段",
        id: "snippet-echo",
        scope: "any",
        sortOrder: 30,
        tags: ["demo"],
        title: "问候",
        updatedAt: "3",
      },
    ]);

    render(
      <SnippetToolContent activeTabId={activeTab.id} focusedPane={localPane} />,
    );

    expect(await screen.findByText("问候")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "运行片段 问候" }));
    await user.type(screen.getByLabelText("变量 name"), "Kerminal");

    expect(screen.getByText("echo Kerminal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发送到当前分屏" }));

    expect(terminalSessionRegistryMocks.writeSnippetCommand).toHaveBeenCalledWith({
      command: "echo Kerminal",
      paneId: "pane-1",
      tabId: "tab-1",
    });
    expect(await screen.findByText("已发送到 本地 PowerShell。")).toBeInTheDocument();
  });

  it("blocks snippets whose scope does not match the focused pane", async () => {
    snippetApiMocks.listSnippets.mockResolvedValueOnce([
      {
        command: "journalctl -u app.service -n 200 --no-pager",
        createdAt: "3",
        description: "远程日志",
        id: "snippet-ssh-log",
        scope: "ssh",
        sortOrder: 30,
        tags: ["ssh"],
        title: "查看服务日志",
        updatedAt: "3",
      },
    ]);

    render(<SnippetToolContent focusedPane={localPane} />);

    expect(await screen.findByText("查看服务日志")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "运行片段 查看服务日志" }),
    ).toBeDisabled();
    expect(terminalSessionRegistryMocks.writeSnippetCommand).not.toHaveBeenCalled();
  });

  it("shows an error when the focused pane session is not connected", async () => {
    const user = userEvent.setup();
    terminalSessionRegistryMocks.writeSnippetCommand.mockResolvedValueOnce({
      paneId: "pane-1",
      reason: "missing-session",
      sent: false,
    });

    render(<SnippetToolContent focusedPane={localPane} />);

    expect(await screen.findByText("检查 Git 状态")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "运行片段 检查 Git 状态" }),
    );

    expect(await screen.findByText(/当前分屏尚未连接/)).toBeInTheDocument();
  });

  it("blocks local snippets when the focused pane is SSH", async () => {
    render(<SnippetToolContent focusedPane={sshPane} />);

    expect(await screen.findByText("检查 Git 状态")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "运行片段 检查 Git 状态" }),
    ).toBeDisabled();
  });

  it("creates a workflow from the add dialog without rendering the workflow editor", async () => {
    const user = userEvent.setup();

    render(<SnippetToolContent />);

    expect(await screen.findByText("检查 Git 状态")).toBeInTheDocument();
    expect(screen.queryByText("新建工作流")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加脚本片段" }));
    await user.click(screen.getByRole("button", { name: "workflow" }));
    await user.type(screen.getByLabelText("标题"), "两步检查");
    await user.type(screen.getByLabelText("脚本内容"), "echo one");
    await user.type(screen.getByLabelText("说明"), "两步检查");
    await user.type(screen.getByLabelText("分组标签"), "quality");
    await user.click(screen.getByRole("button", { name: "保存工作流" }));

    expect(workflowApiMocks.createWorkflow).toHaveBeenCalledWith({
      description: "两步检查",
      scope: "any",
      steps: [
        {
          command: "echo one",
          description: "两步检查",
          requiresConfirmation: false,
          title: "两步检查",
        },
      ],
      tags: ["quality"],
      title: "两步检查",
    });
  });
});
