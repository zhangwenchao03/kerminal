import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalAgentId,
  ExternalAgentWorkspaceStatus,
} from "../../lib/agentLauncherApi";
import {
  registerTerminalPaneSession,
  resetTerminalPaneSessionsForTests,
} from "../terminal/terminalSessionRegistry";
import { tools } from "../workspace/workspaceData";
import { AgentLauncherToolContent } from "./AgentLauncherToolContent";
import { ToolPanel } from "./ToolPanel";

const apiMocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  getExternalAgentWorkspaceStatus: vi.fn(),
  listAgentSessions: vi.fn(),
  prepareExternalAgentWorkspace: vi.fn(),
  rebindAgentSessionTarget: vi.fn(),
}));

const terminalMocks = vi.hoisted(() => ({
  renderXtermPane: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  currentDesktopNotificationVisibility: vi.fn(),
  sendDesktopNotification: vi.fn(),
}));

vi.mock("../../lib/agentLauncherApi", () => ({
  agentSessionRecordAgentId: (record: {
    session: { agentId?: string; agent_id?: string };
  }) => record.session.agentId ?? record.session.agent_id,
  agentSessionRecordId: (record: { session: { agentSessionId?: string; agent_session_id?: string } }) =>
    record.session.agentSessionId ?? record.session.agent_session_id,
  agentSessionRecordTarget: (record: { session: { target?: unknown } }) =>
    record.session.target,
  createAgentSession: (...args: unknown[]) =>
    apiMocks.createAgentSession(...args),
  getExternalAgentWorkspaceStatus: (...args: unknown[]) =>
    apiMocks.getExternalAgentWorkspaceStatus(...args),
  listAgentSessions: (...args: unknown[]) =>
    apiMocks.listAgentSessions(...args),
  prepareExternalAgentWorkspace: (...args: unknown[]) =>
    apiMocks.prepareExternalAgentWorkspace(...args),
  rebindAgentSessionTarget: (...args: unknown[]) =>
    apiMocks.rebindAgentSessionTarget(...args),
}));

vi.mock("../../lib/fileDialogApi", () => ({
  openLocalDirectory: vi.fn(),
}));

vi.mock("../../lib/desktopNotificationApi", () => ({
  currentDesktopNotificationVisibility: () =>
    notificationMocks.currentDesktopNotificationVisibility(),
  sendDesktopNotification: (...args: unknown[]) =>
    notificationMocks.sendDesktopNotification(...args),
}));

vi.mock("../terminal/XtermPane", () => ({
  XtermPane: (props: {
    args?: string[];
    cwd?: string;
    focused?: boolean;
    paneId?: string;
    shell?: string;
    shellAssistEnabled?: boolean;
    startupMessage?: string;
    title: string;
    transientStartupMessage?: boolean;
    onSessionFinished?: (event: { durationMs: number; sessionId: string }) => void;
  }) => {
    terminalMocks.renderXtermPane(props);
    return (
      <div
        data-args={(props.args ?? []).join(" ")}
        data-cwd={props.cwd}
        data-focused={String(props.focused)}
        data-pane-id={props.paneId}
        data-shell={props.shell}
        data-shell-assist-enabled={String(props.shellAssistEnabled)}
        data-startup-message={props.startupMessage}
        data-testid="agent-xterm"
        data-transient-startup-message={String(props.transientStartupMessage)}
      >
        {props.title}
      </div>
    );
  },
}));
vi.mock("../logs/LogToolContent", () => ({
  LogToolContent: () => <div data-testid="logs-tool">Logs tool</div>,
}));

describe("AgentLauncherToolContent", () => {
  beforeEach(() => {
    apiMocks.createAgentSession.mockReset();
    apiMocks.getExternalAgentWorkspaceStatus.mockReset();
    apiMocks.listAgentSessions.mockReset();
    apiMocks.prepareExternalAgentWorkspace.mockReset();
    apiMocks.rebindAgentSessionTarget.mockReset();
    terminalMocks.renderXtermPane.mockClear();
    notificationMocks.currentDesktopNotificationVisibility.mockReset();
    notificationMocks.sendDesktopNotification.mockReset();
    notificationMocks.currentDesktopNotificationVisibility.mockReturnValue(
      "hidden",
    );
    notificationMocks.sendDesktopNotification.mockResolvedValue({
      reason: "will-send",
      requestedPermission: false,
      sent: true,
    });
    resetTerminalPaneSessionsForTests();
    apiMocks.getExternalAgentWorkspaceStatus.mockResolvedValue(workspaceStatus());
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [],
    });
    apiMocks.createAgentSession.mockImplementation(
      async ({
        agentId,
        target,
      }: {
        agentId: string;
        target?: unknown;
      }) => ({
        session: {
          agentId,
          agentSessionId: `ags-${agentId}`,
          launch: {
            args: [],
            commandLabel: agentId,
            cwd: `C:/Users/me/.kerminal/agents/sessions/ags-${agentId}`,
            shell: agentId,
          },
          sessionRoot: `C:/Users/me/.kerminal/agents/sessions/ags-${agentId}`,
          target,
          title: agentId === "claude" ? "Claude" : agentId === "custom" ? "Custom" : "Codex",
          workspaceRoot: "C:/Users/me/.kerminal",
        },
      }),
    );
    apiMocks.prepareExternalAgentWorkspace.mockImplementation(
      async (request: {
        agentId: ExternalAgentId;
        agentSessionId: string;
        customCommand?: string;
      }) => {
        const command = request.customCommand ?? request.agentId;
        const title =
          request.agentId === "claude"
            ? "Claude"
            : request.agentId === "custom"
              ? "Custom"
              : "Codex";
        return {
          agentId: request.agentId,
          agentSessionId: request.agentSessionId,
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NoExit",
            "-Command",
            command,
          ],
          cwd: `C:/Users/me/.kerminal/agents/sessions/${request.agentSessionId}`,
          env: {
            KERMINAL_AGENT_SESSION_ID: request.agentSessionId,
            KERMINAL_MCP_ENDPOINT: `http://127.0.0.1:37657/mcp/agents/${request.agentSessionId}`,
          },
          message: `${title} workspace prepared.`,
          shell: "pwsh.exe",
          title,
        };
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts as three minimal launcher buttons", async () => {
    render(<AgentLauncherToolContent />);

    expect(await screen.findByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open Codex",
      "Open Claude",
      "Open Custom Agent",
    ]);
    expect(
      screen.queryByRole("textbox", { name: "Custom agent command" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the same three launchers while workspace status is loading", () => {
    apiMocks.getExternalAgentWorkspaceStatus.mockReturnValueOnce(new Promise(() => {}));

    render(<AgentLauncherToolContent />);

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open Codex",
      "Open Claude",
      "Open Custom Agent",
    ]);
    expect(
      screen.queryByRole("textbox", { name: "Custom agent command" }),
    ).not.toBeInTheDocument();
  });

  it("opens Codex inside the right-panel terminal from the prepared launch spec", async () => {
    const user = userEvent.setup();

    render(<AgentLauncherToolContent />);

    expect(await screen.findByRole("button", { name: "Open Codex" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Codex" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledWith({
        agentId: "codex",
        target: undefined,
        title: "Codex",
      });
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-codex",
        resumeProviderSession: false,
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute("data-shell", "pwsh.exe");
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
    expect(screen.getByTestId("agent-terminal-command")).toHaveTextContent(
      "codex · C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
    expect(terminalMocks.renderXtermPane).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NoExit",
          "-Command",
          "codex",
        ],
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        focused: true,
        shell: "pwsh.exe",
        shellAssistEnabled: false,
        startupMessage: "加载 Codex...\r\n",
        title: "Codex",
        transientStartupMessage: true,
      }),
    );
  });

  it("opens Codex with skipped permissions from the launcher context menu", async () => {
    const user = userEvent.setup();

    render(<AgentLauncherToolContent />);

    const codexButton = await screen.findByRole("button", { name: "Open Codex" });
    fireEvent.contextMenu(codexButton, { clientX: 120, clientY: 160 });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("kerminal-agent-launch-menu");
    expect(menu).toHaveClass("w-[136px]");
    expect(menu).toHaveTextContent("跳过权限打开");
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);

    await user.click(
      screen.getByRole("menuitem", {
        name: "Launch Codex with skipped permissions",
      }),
    );

    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-codex",
        resumeProviderSession: false,
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-args",
      "-NoLogo -NoProfile -NoExit -Command codex --dangerously-bypass-approvals-and-sandbox",
    );
    expect(screen.getByTestId("agent-terminal-command")).toHaveTextContent(
      "codex --dangerously-bypass-approvals-and-sandbox · C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
  });

  it("opens Claude with skipped permissions from the launcher context menu", async () => {
    const user = userEvent.setup();

    render(<AgentLauncherToolContent />);

    const claudeButton = await screen.findByRole("button", { name: "Open Claude" });
    fireEvent.contextMenu(claudeButton, { clientX: 120, clientY: 160 });

    await user.click(
      await screen.findByRole("menuitem", {
        name: "Launch Claude with skipped permissions",
      }),
    );

    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "claude",
        agentSessionId: "ags-claude",
        resumeProviderSession: false,
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-args",
      "-NoLogo -NoProfile -NoExit -Command claude --dangerously-skip-permissions",
    );
    expect(screen.getByTestId("agent-terminal-command")).toHaveTextContent(
      "claude --dangerously-skip-permissions · C:/Users/me/.kerminal/agents/sessions/ags-claude",
    );
  });

  it("binds a new agent session to the focused terminal pane", async () => {
    const user = userEvent.setup();
    registerTerminalPaneSession("pane-prod", "term-prod", {
      cwd: "/srv/app",
      remoteHostId: "prod-web",
      shell: "bash",
      tabId: "tab-main",
      target: "ssh",
      targetRef: "ssh:prod-web",
    });

    render(
      <AgentLauncherToolContent
        activeTab={{ id: "tab-main" } as never}
        focusedPane={{
          currentCwd: "/srv/app",
          cwd: "/srv/fallback",
          id: "pane-prod",
          mode: "ssh",
          shell: "bash",
        } as never}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledWith({
        agentId: "codex",
        target: {
          cwd: "/srv/app",
          liveStatus: "ready",
          paneId: "pane-prod",
          shell: "bash",
          tabId: "tab-main",
          targetKind: "ssh",
          targetRef: "ssh:prod-web",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      });
    });
    expect(await screen.findByTestId("agent-target-chip")).toHaveTextContent(
      "prod-web · /srv/app",
    );
  });

  it("rebinds the active agent session to a selected live terminal", async () => {
    const user = userEvent.setup();
    apiMocks.rebindAgentSessionTarget.mockImplementation(
      async (agentSessionId: string, target: unknown) => ({
        session: {
          agentId: "codex",
          agentSessionId,
          launch: {
            args: [],
            commandLabel: "codex",
            cwd: `C:/Users/me/.kerminal/agents/sessions/${agentSessionId}`,
            shell: "codex",
          },
          sessionRoot: `C:/Users/me/.kerminal/agents/sessions/${agentSessionId}`,
          target,
          title: "Codex",
          workspaceRoot: "C:/Users/me/.kerminal",
        },
      }),
    );
    registerTerminalPaneSession("pane-rebind", "term-rebind", {
      cwd: "/srv/rebound",
      remoteHostId: "rebind-host",
      shell: "zsh",
      tabId: "tab-rebind",
      target: "ssh",
      targetRef: "ssh:rebind-host",
    });

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));
    expect(await screen.findByTestId("agent-target-chip")).toHaveTextContent(
      "未绑定",
    );

    await user.click(screen.getByRole("button", { name: "Rebind agent target" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Bind agent target to rebind-host",
      }),
    );

    await waitFor(() => {
      expect(apiMocks.rebindAgentSessionTarget).toHaveBeenCalledWith(
        "ags-codex",
        {
          cwd: "/srv/rebound",
          liveStatus: "ready",
          paneId: "pane-rebind",
          shell: "zsh",
          tabId: "tab-rebind",
          targetKind: "ssh",
          targetRef: "ssh:rebind-host",
          targetTerminalSessionId: "term-rebind",
        },
      );
    });
    expect(screen.getByTestId("agent-target-chip")).toHaveTextContent(
      "rebind-host · /srv/rebound",
    );
  });

  it("continues a persisted Codex agent session without creating a new one", async () => {
    const user = userEvent.setup();
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [
        {
          session: {
            agentId: "codex",
            agentSessionId: "ags-restored-codex",
            launch: {
              args: [],
              commandLabel: "codex",
              cwd: "C:/Users/me/.kerminal/agents/sessions/ags-restored-codex",
              shell: "codex",
            },
            sessionRoot: "C:/Users/me/.kerminal/agents/sessions/ags-restored-codex",
            title: "Codex",
            workspaceRoot: "C:/Users/me/.kerminal",
          },
        },
      ],
    });

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    expect(await screen.findByRole("button", { name: "继续上次" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新会话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(apiMocks.createAgentSession).not.toHaveBeenCalled();
    expect(apiMocks.prepareExternalAgentWorkspace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "继续上次" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).not.toHaveBeenCalled();
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-restored-codex",
        resumeProviderSession: true,
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-restored-codex",
    );
  });

  it("continues a persisted Claude agent session", async () => {
    const user = userEvent.setup();
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [
        {
          session: {
            agentId: "claude",
            agentSessionId: "ags-restored-claude",
            launch: {
              args: [],
              commandLabel: "claude",
              cwd: "C:/Users/me/.kerminal/agents/sessions/ags-restored-claude",
              shell: "claude",
            },
            sessionRoot: "C:/Users/me/.kerminal/agents/sessions/ags-restored-claude",
            title: "Claude",
            workspaceRoot: "C:/Users/me/.kerminal",
          },
        },
      ],
    });

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Claude" }));
    await user.click(await screen.findByRole("button", { name: "继续上次" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).not.toHaveBeenCalled();
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "claude",
        agentSessionId: "ags-restored-claude",
        resumeProviderSession: true,
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveTextContent("Claude");
  });

  it("creates a fresh provider session when the restore choice selects new session", async () => {
    const user = userEvent.setup();
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [
        {
          session: {
            agentId: "codex",
            agentSessionId: "ags-restored-codex",
            launch: {
              args: [],
              commandLabel: "codex",
              cwd: "C:/Users/me/.kerminal/agents/sessions/ags-restored-codex",
              shell: "codex",
            },
            sessionRoot: "C:/Users/me/.kerminal/agents/sessions/ags-restored-codex",
            title: "Codex",
            workspaceRoot: "C:/Users/me/.kerminal",
          },
        },
      ],
    });

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));
    await user.click(await screen.findByRole("button", { name: "新会话" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledWith({
        agentId: "codex",
        target: undefined,
        title: "Codex",
      });
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-codex",
        resumeProviderSession: false,
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
  });

  it("shows stale persisted agent target as invalid after restore", async () => {
    const user = userEvent.setup();
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [
        {
          session: {
            agentId: "codex",
            agentSessionId: "ags-stale-codex",
            launch: {
              args: [],
              commandLabel: "codex",
              cwd: "C:/Users/me/.kerminal/agents/sessions/ags-stale-codex",
              shell: "codex",
            },
            sessionRoot: "C:/Users/me/.kerminal/agents/sessions/ags-stale-codex",
            target: {
              cwd: "/srv/app",
              liveStatus: "stale",
              paneId: "pane-old",
              shell: "bash",
              tabId: "tab-old",
              targetKind: "ssh",
              targetRef: "ssh:prod-web",
              targetTerminalSessionId: "term-old",
            },
            title: "Codex",
            workspaceRoot: "C:/Users/me/.kerminal",
          },
        },
      ],
    });

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    expect(await screen.findByTestId("agent-restore-target-chip")).toHaveTextContent(
      "已失效",
    );

    await user.click(screen.getByRole("button", { name: "继续上次" }));

    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-stale-codex",
        resumeProviderSession: true,
      });
    });
    expect(await screen.findByTestId("agent-target-chip")).toHaveTextContent(
      "已失效",
    );
  });

  it("returns to the launcher without closing the active agent terminal", async () => {
    const user = userEvent.setup();

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-focused",
      "true",
    );

    await user.click(
      screen.getByRole("button", { name: "Back to agent launcher" }),
    );

    expect(
      await screen.findByRole("button", { name: "Open Codex" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-xterm")).toBeInTheDocument();
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-focused",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Open Codex" }));

    expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
        "data-focused",
        "true",
      );
    });
  });

  it("keeps Codex and Claude in independent right-panel terminal sessions", async () => {
    const user = userEvent.setup();
    apiMocks.prepareExternalAgentWorkspace.mockImplementation(
      async ({
        agentId,
        agentSessionId,
      }: {
        agentId: "codex" | "claude";
        agentSessionId: string;
      }) => ({
        agentId,
        agentSessionId,
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NoExit",
          "-Command",
          agentId,
        ],
        cwd: `C:/Users/me/.kerminal/agents/sessions/${agentSessionId}`,
        message: `${agentId} workspace prepared.`,
        shell: "pwsh.exe",
        title: agentId === "codex" ? "Codex" : "Claude",
      }),
    );

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-codex",
        resumeProviderSession: false,
      });
    });

    await user.click(
      screen.getByRole("button", { name: "Back to agent launcher" }),
    );

    await user.click(await screen.findByRole("button", { name: "Open Claude" }));

    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "claude",
        agentSessionId: "ags-claude",
        resumeProviderSession: false,
      });
    });
    expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(2);

    const terminals = screen.getAllByTestId("agent-xterm");
    expect(terminals).toHaveLength(2);
    expect(terminalByTitle("Codex")).toHaveAttribute("data-focused", "false");
    expect(terminalByTitle("Codex")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
    expect(terminalByTitle("Claude")).toHaveAttribute("data-focused", "true");
    expect(terminalByTitle("Claude")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-claude",
    );

    await user.click(
      screen.getByRole("button", { name: "Back to agent launcher" }),
    );
    await user.click(screen.getByRole("button", { name: "Open Codex" }));

    expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(terminalByTitle("Codex")).toHaveAttribute("data-focused", "true");
      expect(terminalByTitle("Claude")).toHaveAttribute(
        "data-focused",
        "false",
      );
    });
  });

  it("sends a desktop notification when an enabled agent terminal finishes", async () => {
    const user = userEvent.setup();

    render(
      <AgentLauncherToolContent
        desktopNotifications={{
          backgroundOnly: true,
          enabled: true,
          importantOnly: false,
          minDurationMs: 10_000,
          throttleMs: 30_000,
        }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));
    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
    });

    const terminalCalls = terminalMocks.renderXtermPane.mock.calls;
    const terminalProps = terminalCalls[terminalCalls.length - 1]?.[0] as
      | {
          onSessionFinished?: (event: {
            durationMs: number;
            sessionId: string;
          }) => void;
        }
      | undefined;
    expect(terminalProps?.onSessionFinished).toEqual(expect.any(Function));

    act(() => {
      terminalProps?.onSessionFinished?.({
        durationMs: 12_500,
        sessionId: "term-agent-codex",
      });
    });

    expect(notificationMocks.sendDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          agentName: "Codex",
          durationMs: 12_500,
          exitCode: null,
          kind: "agent.process.finished",
          notificationKey: "agent.process.finished:ags-codex",
        },
        permissionPrompt: "important-event",
        settings: expect.objectContaining({ enabled: true }),
        visibility: "hidden",
      }),
    );
    expect(
      JSON.stringify(notificationMocks.sendDesktopNotification.mock.calls[0][0]),
    ).not.toContain("C:/Users/me/.kerminal");
    expect(
      JSON.stringify(notificationMocks.sendDesktopNotification.mock.calls[0][0]),
    ).not.toContain("KERMINAL_MCP_ENDPOINT");
    expect(
      JSON.stringify(notificationMocks.sendDesktopNotification.mock.calls[0][0]),
    ).not.toContain("-NoLogo");
  });

  it("renders from ToolPanel as the external agent launcher", async () => {
    render(
        <ToolPanel
          activeTool="agentLauncher"
          onActiveToolChange={vi.fn()}
          tools={tools}
      />,
    );

    expect(await screen.findByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Custom Agent" })).toBeInTheDocument();
  });

  it("keeps a launched agent terminal while switching right-panel tools", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ToolPanel
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledTimes(1);
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );

    rerender(
      <ToolPanel activeTool="logs" onActiveToolChange={vi.fn()} tools={tools} />,
    );

    expect(await screen.findByTestId("logs-tool")).toBeInTheDocument();
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );

    rerender(
      <ToolPanel
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
    expect(apiMocks.createAgentSession).toHaveBeenCalledTimes(1);
    expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
  });

  it("launches a user supplied custom CLI command inside the right panel", async () => {
    const user = userEvent.setup();
    apiMocks.prepareExternalAgentWorkspace.mockImplementationOnce(async (request) => ({
      agentId: "custom",
      agentSessionId: request.agentSessionId,
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-Command",
        "kimi --fast",
      ],
      cwd: "C:/Users/me/.kerminal/agents/sessions/ags-custom",
      message: "Custom workspace prepared.",
      shell: "pwsh.exe",
      title: "Custom Agent",
    }));

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Custom Agent" }));
    await user.type(screen.getByRole("textbox", { name: "Custom agent command" }), "kimi --fast");
    await user.click(
      screen.getByRole("button", { name: "Open custom agent command" }),
    );

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledWith({
        agentId: "custom",
        target: undefined,
        title: "Custom",
      });
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "custom",
        agentSessionId: "ags-custom",
        customCommand: "kimi --fast",
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute("data-shell", "pwsh.exe");
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-args",
      "-NoLogo -NoProfile -NoExit -Command kimi --fast",
    );
    expect(screen.getByTestId("agent-terminal-command")).toHaveTextContent(
      "kimi --fast · C:/Users/me/.kerminal/agents/sessions/ags-custom",
    );
  });

  it("keeps the custom launch submit disabled for an empty command", async () => {
    const user = userEvent.setup();

    render(<AgentLauncherToolContent />);

    await user.click(await screen.findByRole("button", { name: "Open Custom Agent" }));

    expect(
      screen.getByRole("button", { name: "Open custom agent command" }),
    ).toBeDisabled();

    await user.keyboard("{Enter}");

    expect(apiMocks.prepareExternalAgentWorkspace).not.toHaveBeenCalled();
  });
});

function terminalByTitle(title: string): HTMLElement {
  const terminal = screen
    .getAllByTestId("agent-xterm")
    .find((current) => current.textContent === title);
  if (!terminal) {
    throw new Error(`Expected ${title} agent terminal to be rendered.`);
  }
  return terminal;
}

function workspaceStatus(): ExternalAgentWorkspaceStatus {
  return {
    agents: {
      claude: {
        cliCommand: "claude",
        configPath: "C:/Users/me/.kerminal/.mcp.json",
        configReady: false,
        id: "claude",
        installed: true,
        statusDetail: "Claude CLI detected. MCP config needs refresh.",
        title: "Claude",
      },
      codex: {
        cliCommand: "codex",
        configPath: "C:/Users/me/.kerminal/.codex/config.toml",
        configReady: true,
        id: "codex",
        installed: true,
        statusDetail: "Codex CLI detected.",
        title: "Codex",
      },
      custom: {
        cliCommand: "",
        configPath: "",
        configReady: false,
        id: "custom",
        installed: false,
        statusDetail: "Configure a custom agent command first.",
        title: "Custom",
      },
    },
    mcpEndpoint: "http://127.0.0.1:37657/mcp",
    mcpServerRunning: true,
    workspaceDir: "C:/Users/me/.kerminal",
  };
}
