import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgentSendRequestSnapshot,
  requestAgentSend,
  resetAgentSendRequestStoreForTests,
  useAgentSendRequestSnapshot,
} from "../../../../../src/features/agent-workflow/agentSendRequestStore";
import { useAgentSendRequestCoordinator } from "../../../../../src/features/tool-panel/agent-launcher/useAgentSendRequestCoordinator";
import type { AgentTerminalSession } from "../../../../../src/features/tool-panel/agent-launcher/AgentTerminalView";
import type {
  TerminalPane,
  TerminalTab,
} from "../../../../../src/features/workspace/types";

const activeTab = {
  id: "tab-1",
  title: "生产终端",
} as TerminalTab;
const targetPane = {
  id: "pane-1",
  title: "prod-api",
} as TerminalPane;
const session: AgentTerminalSession = {
  agentId: "codex",
  agentSessionId: "agent-session-1",
  args: [],
  commandLabel: "codex",
  cwd: "C:/workspace",
  permissionMode: "default",
  shell: "powershell.exe",
  status: "running",
  tabId: "tab-1",
  target: {
    paneId: "pane-1",
    tabId: "tab-1",
  },
  title: "Codex",
};

describe("useAgentSendRequestCoordinator", () => {
  beforeEach(() => {
    resetAgentSendRequestStoreForTests();
  });

  it("activates the matching session and creates a preview", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();
    const setActionError = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot().request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        onActivateSession,
        request,
        sessions: [session],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      requestAgentSend({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(createPreview).toHaveBeenCalledWith("selection", {
        activeTab,
        focusedPane: targetPane,
        session,
      });
    });
    expect(onActivateSession).toHaveBeenCalledWith(
      "tab-1",
      "agent-session-1",
    );
    expect(getAgentSendRequestSnapshot().request).toBeNull();
  });

  it("keeps the short-lived request while waiting for a matching conversation", async () => {
    const setActionError = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot().request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview: vi.fn(() => true),
        onActivateSession: vi.fn(),
        request,
        sessions: [],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      requestAgentSend({
        paneId: "pane-1",
        source: "context",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(setActionError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "已选择终端内容，等待 Agent 对话",
        }),
      );
    });
    expect(getAgentSendRequestSnapshot().request).toMatchObject({
      paneId: "pane-1",
      source: "context",
      tabId: "tab-1",
    });
  });

  it("does not route a request into an unbound conversation", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();
    const setActionError = vi.fn();
    const unboundSession = {
      ...session,
      agentSessionId: "agent-session-unbound",
      target: undefined,
    };

    renderHook(() => {
      const request = useAgentSendRequestSnapshot().request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        onActivateSession,
        request,
        sessions: [unboundSession],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      requestAgentSend({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(setActionError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "已选择终端内容，等待 Agent 对话",
        }),
      );
    });
    expect(createPreview).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
    expect(getAgentSendRequestSnapshot().request).not.toBeNull();
  });

  it("cancels the request when the user leaves its source tab", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();
    const setActionError = vi.fn();
    const otherTab = { id: "tab-2", title: "其他终端" } as TerminalTab;

    renderHook(() => {
      const request = useAgentSendRequestSnapshot().request;
      useAgentSendRequestCoordinator({
        activeTab: otherTab,
        agentScopeId: "tab-2",
        createPreview,
        onActivateSession,
        request,
        sessions: [session],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      requestAgentSend({
        paneId: "pane-1",
        source: "context",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(setActionError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "发送请求已取消",
        }),
      );
    });
    expect(createPreview).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
    expect(getAgentSendRequestSnapshot().request).toBeNull();
  });

  it("keeps preview failures visible instead of opening the terminal view", async () => {
    const createPreview = vi.fn(() => false);
    const onActivateSession = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot().request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        onActivateSession,
        request,
        sessions: [session],
        setActionError: vi.fn(),
        targetPane,
      });
    });

    act(() => {
      requestAgentSend({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(createPreview).toHaveBeenCalled();
    });
    expect(onActivateSession).not.toHaveBeenCalled();
    expect(getAgentSendRequestSnapshot().request).toBeNull();
  });
});
