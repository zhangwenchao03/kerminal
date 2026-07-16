import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWorkflowController } from "../../../../../src/features/agent-workflow";
import { registerXtermPanePromptSource } from "../../../../../src/features/terminal/XtermPane.promptSourceRegistry";
import type { AgentTerminalSession } from "../../../../../src/features/tool-panel/agent-launcher/AgentTerminalView";
import { useAgentSendPreview } from "../../../../../src/features/tool-panel/agent-launcher/useAgentSendPreview";

const unregisters: Array<() => void> = [];
afterEach(() => {
  unregisters.splice(0).forEach((unregister) => unregister());
  vi.useRealTimers();
});

const activeTab = { id: "tab-1", title: "Terminal", type: "terminal" } as never;
const focusedPane = {
  cwd: "/work",
  id: "pane-1",
  machineId: "local",
  mode: "shell",
  outputHistory: "context body",
  shell: "bash",
  status: "connected",
  title: "Shell",
} as never;
const session: AgentTerminalSession = {
  agentId: "codex",
  agentSessionId: "ags-1",
  args: [],
  commandLabel: "codex",
  cwd: "/agent",
  permissionMode: "default",
  shell: "codex",
  status: "running",
  tabId: "tab-1",
  target: { paneId: "pane-1", tabId: "tab-1" },
  title: "Codex",
};

function createController(options?: { previewTtlMs?: number }) {
  return new AgentWorkflowController(
    { listSessions: async () => [] },
    { subscribe: () => () => undefined },
    { send: async () => ({ accepted: true }) },
    options,
  );
}

describe("useAgentSendPreview", () => {
  it("取消和切换 session 会立即清除瞬时 preview，snapshot 只保留 metadata", () => {
    unregisters.push(
      registerXtermPanePromptSource("pane-1", {
        read: () => ({ paneId: "pane-1", selectedText: "secret body" }),
      }),
    );
    const controller = createController();
    const setActionError = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentSession }) =>
        useAgentSendPreview({
          activeTab,
          controller,
          focusedPane,
          session: currentSession,
          setActionError,
        }),
      {
        initialProps: {
          currentSession: session as AgentTerminalSession | undefined,
        },
      },
    );

    act(() => result.current.create("selection"));
    expect(result.current.preview?.text).toContain("secret body");
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(
      "secret body",
    );

    act(() => result.current.cancel(result.current.preview!.id));
    expect(result.current.preview).toBeNull();

    act(() => result.current.create("selection"));
    rerender({ currentSession: undefined });
    expect(result.current.preview).toBeNull();
    expect(controller.getSnapshot().historyMetadata[0]?.outcome).toBe(
      "cancelled",
    );
    controller.dispose();
  });

  it("TTL 到期后主动取消并清除正文", () => {
    vi.useFakeTimers();
    const controller = createController({ previewTtlMs: 1_000 });
    const { result } = renderHook(() =>
      useAgentSendPreview({
        activeTab,
        controller,
        focusedPane,
        session,
        setActionError: vi.fn(),
      }),
    );

    act(() => result.current.create("context"));
    expect(result.current.preview).not.toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.preview).toBeNull();
    expect(controller.getSnapshot().historyMetadata[0]?.outcome).toBe(
      "expired",
    );
    controller.dispose();
  });

  it("创建新预览时立即取消并释放上一份正文", () => {
    let selectedText = "first secret";
    unregisters.push(
      registerXtermPanePromptSource("pane-1", {
        read: () => ({ paneId: "pane-1", selectedText }),
      }),
    );
    const controller = createController();
    const { result, unmount } = renderHook(() =>
      useAgentSendPreview({
        activeTab,
        controller,
        focusedPane,
        session,
        setActionError: vi.fn(),
      }),
    );

    act(() => result.current.create("selection"));
    const firstPreviewId = result.current.preview!.id;
    selectedText = "second secret";
    act(() => result.current.create("selection"));

    expect(result.current.preview?.id).not.toBe(firstPreviewId);
    expect(result.current.preview?.text).toContain("second secret");
    expect(controller.getSnapshot().historyMetadata).toHaveLength(1);
    expect(controller.getSnapshot().historyMetadata[0]?.outcome).toBe(
      "cancelled",
    );
    unmount();
    controller.dispose();
  });
});
