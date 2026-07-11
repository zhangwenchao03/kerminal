import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextInspectorToolContent } from "../../../../../src/features/tool-panel/context-inspector";
import type { WorkspaceContextProjection } from "../../../../../src/features/workspace/context";

function context(
  overrides: Partial<WorkspaceContextProjection> = {},
): WorkspaceContextProjection {
  return {
    schemaVersion: 1,
    revision: 7,
    generatedAt: "2026-07-11T08:00:00.000Z",
    activeTabId: "tab-1",
    focusedPaneId: "pane-1",
    machine: {
      id: "host-1",
      name: "Production API",
      kind: "ssh",
      status: "online",
      production: true,
      groupId: "group-1",
    },
    target: {
      id: "host-1",
      kind: "ssh",
      label: "api.example.test",
      production: true,
      hostLabel: "api.example.test",
    },
    location: {
      cwd: "/srv/app/a-very-long-directory-name-that-must-wrap",
      cwdSource: "osc7",
      pathStyle: "posix",
      confidence: "medium",
    },
    subject: {
      kind: "terminalPane",
      id: "pane-1",
      title: "API shell",
    },
    resources: {
      tabs: [{ id: "tab-1", title: "API", kind: "terminal", active: true }],
      panes: [
        {
          id: "pane-1",
          title: "shell",
          machineId: "host-1",
          mode: "ssh",
          status: "online",
          focused: true,
        },
      ],
      activeTabPaneIds: ["pane-1"],
      workspaceFileCount: 2,
      dirtyWorkspaceFileCount: 1,
      sftpRevealRequest: null,
    },
    runtime: {
      connectionStatus: "online",
      paneMode: "ssh",
      latencyMs: 28,
      tmuxAttached: false,
    },
    agent: { sessionId: null, status: "unavailable" },
    freshness: {
      state: "partial",
      sources: [
        { source: "workspace", status: "available", revision: 7 },
        { source: "runtime", status: "error", diagnosticId: "runtime-error" },
      ],
    },
    diagnostics: [
      {
        id: "runtime-error",
        code: "source-error",
        severity: "warning",
        summary: "运行态暂时不可用，已保留其它上下文。",
        source: "runtime",
        recoverable: true,
      },
    ],
    ...overrides,
  };
}

describe("ContextInspectorToolContent", () => {
  it("在 partial/error 下仍渲染全部只读分区", () => {
    render(<ContextInspectorToolContent context={context()} />);

    for (const heading of [
      "机器",
      "目标",
      "页签与窗格",
      "位置",
      "资源",
      "运行态",
      "Agent",
      "新鲜度",
      "诊断",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(
      screen.getByText("运行态暂时不可用，已保留其它上下文。"),
    ).toBeVisible();
    expect(screen.getAllByText("生产目标")).toHaveLength(2);
  });

  it("动作和可用跳转只转发稳定 id", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onNavigate = vi.fn();
    render(
      <ContextInspectorToolContent
        actions={[
          {
            id: "terminal.split",
            title: "拆分终端",
            effect: "local",
            available: true,
            priority: 10,
          },
        ]}
        context={context()}
        isNavigationAvailable={(navigationId) =>
          navigationId.startsWith("location:")
        }
        onAction={onAction}
        onNavigate={onNavigate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "拆分终端" }));
    await user.click(screen.getByRole("button", { name: /当前目录/ }));

    expect(onAction).toHaveBeenCalledWith("terminal.split");
    expect(onNavigate).toHaveBeenCalledWith(
      "location:/srv/app/a-very-long-directory-name-that-must-wrap",
    );
  });

  it("未被集成层支持的 navigationId 只显示为只读文本", () => {
    render(
      <ContextInspectorToolContent
        context={context()}
        isNavigationAvailable={(navigationId) =>
          navigationId.startsWith("tab:")
        }
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /活动页签/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /当前目录/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /焦点窗格/ })).toBeNull();
    expect(
      screen.getByText("/srv/app/a-very-long-directory-name-that-must-wrap"),
    ).toBeVisible();
  });

  it("disabled action 不触发回调且显示原因", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ContextInspectorToolContent
        actions={[
          {
            id: "remote.stop",
            title: "停止服务",
            effect: "remote",
            available: false,
            disabledReason: "需要现有确认流程",
          },
        ]}
        context={context()}
        onAction={onAction}
      />,
    );

    const button = screen.getByRole("button", { name: "停止服务" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "需要现有确认流程");
    await user.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("autoFocus、Home 和 End 使用稳定焦点顺序", () => {
    render(
      <ContextInspectorToolContent
        actions={[
          {
            id: "first",
            title: "首个动作",
            effect: "read",
            available: true,
          },
        ]}
        autoFocus
        context={context()}
        isNavigationAvailable={() => true}
        onNavigate={() => undefined}
      />,
    );

    const first = screen.getByRole("button", { name: "首个动作" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(screen.getByRole("button", { name: /当前目录/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(first).toHaveFocus();
  });
});
