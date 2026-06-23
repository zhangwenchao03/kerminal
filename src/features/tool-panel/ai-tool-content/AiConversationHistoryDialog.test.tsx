import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";
import { buildAiConversationSlotDescriptor } from "./aiConversationPersistence";
import { AiConversationHistoryDialog } from "./AiConversationHistoryDialog";
import type { AiConversation } from "./aiToolContentModel";
import { historyRowFromConversation } from "./useAiConversationHistoryList";

const activeTab: TerminalTab = {
  id: "tab-prod",
  layout: { paneId: "pane-prod", type: "pane" },
  machineId: "host-prod",
  title: "prod-api tab",
};

const focusedPane: TerminalPane = {
  id: "pane-prod",
  latencyMs: 2,
  lines: [],
  machineId: "host-prod",
  mode: "ssh",
  prompt: "$",
  status: "online",
  title: "prod-api shell",
};

const selectedMachine: Machine = {
  description: "生产 SSH 主机",
  id: "host-prod",
  kind: "ssh",
  name: "prod-api",
  production: true,
  status: "online",
  tags: ["prod"],
};

const currentSlot = buildAiConversationSlotDescriptor({
  activeTab,
  focusedPane,
  selectedMachine,
});

describe("AiConversationHistoryDialog", () => {
  it("renders server-backed rows and emits search, filter and page actions", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    const onQueryChange = vi.fn();
    const rows = buildConversations().map(historyRowFromConversation);
    const dialogProps = {
      activeConversationId: "conv-prod",
      canFilterCurrentHost: true,
      canNextPage: true,
      canPreviousPage: false,
      currentSlot,
      filter: "all" as const,
      loading: false,
      onClose: vi.fn(),
      onDelete: vi.fn(),
      onFilterChange,
      onNextPage,
      onPreviousPage,
      onQueryChange,
      onSelect: vi.fn(),
      open: true,
      page: 1,
      query: "",
      rows: rows.slice(0, 6),
      usingRemoteRows: true,
    };
    const { rerender } = render(<AiConversationHistoryDialog {...dialogProps} />);

    expect(screen.getByRole("dialog", { name: "历史会话" })).toBeInTheDocument();
    expect(screen.getByText("生产排障")).toBeInTheDocument();
    expect(screen.getByText("分页会话 4")).toBeInTheDocument();
    expect(screen.queryByText("分页会话 5")).not.toBeInTheDocument();
    expect(screen.getByText("第 1 页")).toBeInTheDocument();
    expect(screen.getByText(/后端分页/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(onNextPage).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "当前目标" }));
    expect(onFilterChange).toHaveBeenCalledWith("currentTarget");
    await user.type(screen.getByRole("searchbox", { name: "搜索历史会话" }), "rsync");
    expect(onQueryChange).toHaveBeenCalled();

    rerender(
      <AiConversationHistoryDialog
        {...dialogProps}
        canNextPage={false}
        page={2}
        query="rsync"
        rows={[rows[1]]}
      />,
    );
    expect(screen.getByText("发布策略")).toBeInTheDocument();
    expect(screen.queryByText("生产排障")).not.toBeInTheDocument();
    expect(screen.getByText("第 2 页")).toBeInTheDocument();
  });

  it("shows row status and provider model metadata", () => {
    const rows = buildConversations().map(historyRowFromConversation);
    render(
      <AiConversationHistoryDialog
        activeConversationId="conv-prod"
        canFilterCurrentHost
        canNextPage={false}
        canPreviousPage={false}
        currentSlot={currentSlot}
        filter="all"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onFilterChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        open
        page={1}
        query=""
        rows={[
          {
            ...rows[0],
            model: "gpt-4.1",
            providerLabel: "OpenAI",
            status: "waiting",
          },
        ]}
        usingRemoteRows
      />,
    );

    const row = screen.getByRole("row", { name: /生产排障/ });
    expect(within(row).getByText("待确认")).toBeInTheDocument();
    expect(within(row).getByText("OpenAI · gpt-4.1")).toBeInTheDocument();
  });

  it("shows unknown status without breaking row actions", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const rows = buildConversations().map(historyRowFromConversation);
    render(
      <AiConversationHistoryDialog
        activeConversationId="conv-other"
        canFilterCurrentHost
        canNextPage={false}
        canPreviousPage={false}
        currentSlot={currentSlot}
        filter="all"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onFilterChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        open
        page={1}
        query=""
        rows={[
          {
            ...rows[0],
            status: "paused",
          },
        ]}
      />,
    );

    const row = screen.getByRole("row", { name: /生产排障/ });
    expect(within(row).getByText("paused")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "继续会话 生产排障" }));
    expect(onSelect).toHaveBeenCalledWith(
      "conv-prod",
      expect.objectContaining({ id: "conv-prod", targetKey: "pane:pane-prod" }),
    );
  });

  it("continues and deletes the selected conversation from table actions", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onSelect = vi.fn();

    render(
      <AiConversationHistoryDialog
        activeConversationId="conv-prod"
        canFilterCurrentHost
        canNextPage={false}
        canPreviousPage={false}
        currentSlot={currentSlot}
        filter="all"
        onClose={vi.fn()}
        onDelete={onDelete}
        onFilterChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={onSelect}
        open
        page={1}
        query=""
        rows={buildConversations().slice(0, 2).map(historyRowFromConversation)}
      />,
    );

    const row = screen.getByRole("row", { name: /生产排障/ });
    await user.click(within(row).getByRole("button", { name: "继续会话 生产排障" }));
    expect(onSelect).toHaveBeenCalledWith(
      "conv-prod",
      expect.objectContaining({ id: "conv-prod", targetKey: "pane:pane-prod" }),
    );

    await user.click(within(row).getByRole("button", { name: "删除对话 生产排障" }));
    expect(onDelete).toHaveBeenCalledWith("conv-prod");
  });

  it("shows loading and backend fallback errors", () => {
    const { rerender } = render(
      <AiConversationHistoryDialog
        activeConversationId="conv-prod"
        canFilterCurrentHost
        canNextPage={false}
        canPreviousPage={false}
        currentSlot={currentSlot}
        filter="all"
        loading
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onFilterChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        open
        page={1}
        query=""
        rows={[]}
        usingRemoteRows
      />,
    );

    expect(screen.getByText("正在加载历史会话")).toBeInTheDocument();
    rerender(
      <AiConversationHistoryDialog
        activeConversationId="conv-prod"
        canFilterCurrentHost
        canNextPage={false}
        canPreviousPage={false}
        currentSlot={currentSlot}
        error="storage unavailable"
        filter="all"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onFilterChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        open
        page={1}
        query=""
        rows={[]}
        usingRemoteRows={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("storage unavailable");
  });

  it("downgrades backend fallback errors when local rows are still available", () => {
    render(
      <AiConversationHistoryDialog
        activeConversationId="conv-prod"
        canFilterCurrentHost
        canNextPage={false}
        canPreviousPage={false}
        currentSlot={currentSlot}
        error="storage unavailable"
        filter="all"
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onFilterChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        open
        page={1}
        query=""
        rows={buildConversations().slice(0, 1).map(historyRowFromConversation)}
        usingRemoteRows={false}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("storage unavailable");
    expect(screen.getByText("生产排障")).toBeInTheDocument();
  });
});

function buildConversations(): AiConversation[] {
  const now = Date.now();
  return [
    conversation({
      content: "prod-api systemctl status 报错，需要继续排障。",
      id: "conv-prod",
      messages: 3,
      scopeRef: {
        kind: "pane",
        machineId: "host-prod",
        machineName: "prod-api",
        paneId: "pane-prod",
        paneTitle: "prod-api shell",
        tabId: "tab-prod",
        tabTitle: "prod-api tab",
      },
      targetKey: "pane:pane-prod",
      title: "生产排障",
      updatedAt: now,
    }),
    conversation({
      content: "请检查 rsync 部署脚本。",
      id: "conv-deploy",
      messages: 1,
      scopeRef: {
        kind: "pane",
        machineId: "host-deploy",
        machineName: "deploy-box",
        paneId: "pane-deploy",
        paneTitle: "deploy shell",
        tabId: "tab-deploy",
        tabTitle: "deploy tab",
      },
      targetKey: "pane:pane-deploy",
      title: "发布策略",
      updatedAt: now - 1_000,
    }),
    ...Array.from({ length: 7 }, (_, index) =>
      conversation({
        content: `分页内容 ${index + 1}`,
        id: `conv-page-${index + 1}`,
        messages: 1,
        scopeRef: {
          kind: "pane",
          machineId: `host-page-${index + 1}`,
          machineName: `page-host-${index + 1}`,
          paneId: `pane-page-${index + 1}`,
          paneTitle: `page shell ${index + 1}`,
        },
        targetKey: `pane:pane-page-${index + 1}`,
        title: `分页会话 ${index + 1}`,
        updatedAt: now - (index + 2) * 1_000,
      }),
    ),
  ];
}

function conversation(input: {
  content: string;
  id: string;
  messages: number;
  scopeRef: Record<string, string>;
  targetKey: string;
  title: string;
  updatedAt: number;
}): AiConversation {
  return {
    createdAt: input.updatedAt - 10_000,
    hostId: input.scopeRef.machineId,
    id: input.id,
    messages: Array.from({ length: input.messages }, (_, index) => ({
      content: index === 0 ? input.content : `AI 回复 ${index}`,
      createdAt: input.updatedAt - index * 100,
      id: `${input.id}-message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
    })),
    paneId: input.scopeRef.paneId,
    scopeKind: "lockedPane",
    scopeRefJson: JSON.stringify(input.scopeRef),
    tabId: input.scopeRef.tabId,
    targetKey: input.targetKey,
    title: input.title,
    updatedAt: input.updatedAt,
  };
}
