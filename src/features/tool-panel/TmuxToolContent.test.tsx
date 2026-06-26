import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../workspace/types";
import { TmuxToolContent } from "./TmuxToolContent";

const tmuxApiMocks = vi.hoisted(() => ({
  tmuxAttachSession: vi.fn(),
  tmuxCapturePane: vi.fn(),
  tmuxCreateSession: vi.fn(),
  tmuxDetachCurrent: vi.fn(),
  tmuxKillSession: vi.fn(),
  tmuxListPanes: vi.fn(),
  tmuxListSessions: vi.fn(),
  tmuxListWindows: vi.fn(),
  tmuxProbe: vi.fn(),
  tmuxRenameSession: vi.fn(),
}));

const terminalApiMocks = vi.hoisted(() => ({
  writeTerminal: vi.fn(),
}));

const desktopClipboardApiMocks = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

const terminalSessionRegistryMocks = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
  writePaneCommand: vi.fn(),
}));

vi.mock("../../lib/tmuxApi", () => ({
  tmuxAttachSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxAttachSession(...args),
  tmuxCapturePane: (...args: unknown[]) =>
    tmuxApiMocks.tmuxCapturePane(...args),
  tmuxCreateSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxCreateSession(...args),
  tmuxDetachCurrent: (...args: unknown[]) =>
    tmuxApiMocks.tmuxDetachCurrent(...args),
  tmuxKillSession: (...args: unknown[]) => tmuxApiMocks.tmuxKillSession(...args),
  tmuxListPanes: (...args: unknown[]) => tmuxApiMocks.tmuxListPanes(...args),
  tmuxListSessions: (...args: unknown[]) =>
    tmuxApiMocks.tmuxListSessions(...args),
  tmuxListWindows: (...args: unknown[]) =>
    tmuxApiMocks.tmuxListWindows(...args),
  tmuxProbe: (...args: unknown[]) => tmuxApiMocks.tmuxProbe(...args),
  tmuxRenameSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxRenameSession(...args),
}));

vi.mock("../../lib/terminalApi", () => ({
  writeTerminal: (...args: unknown[]) => terminalApiMocks.writeTerminal(...args),
}));

vi.mock("../../lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMocks.writeDesktopClipboardText(...args),
}));

vi.mock("../terminal/terminalSessionRegistry", () => ({
  getTerminalPaneSession: (...args: unknown[]) =>
    terminalSessionRegistryMocks.getTerminalPaneSession(...args),
  writePaneCommand: (...args: unknown[]) =>
    terminalSessionRegistryMocks.writePaneCommand(...args),
}));

const sshMachine: Machine = {
  description: "deploy@prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  status: "online",
  tags: ["ssh"],
};

const focusedPane = {
  id: "pane-1",
  lines: [],
  machineId: "prod-api",
  mode: "ssh" as const,
  prompt: "$",
  remoteHostId: "prod-api",
  status: "online" as const,
  title: "prod api",
};

const session = {
  activityAt: 100,
  attached: false,
  clients: 0,
  currentPath: "/srv/api",
  id: "$0",
  name: "api",
  status: "running" as const,
  targetRef: "ssh:prod-api",
  windows: 1,
};

describe("TmuxToolContent", () => {
  beforeEach(async () => {
    for (const mock of Object.values(tmuxApiMocks)) {
      mock.mockReset();
    }
    terminalApiMocks.writeTerminal.mockReset();
    terminalApiMocks.writeTerminal.mockResolvedValue(undefined);
    desktopClipboardApiMocks.writeDesktopClipboardText.mockReset();
    desktopClipboardApiMocks.writeDesktopClipboardText.mockResolvedValue({
      ok: true,
    });
    terminalSessionRegistryMocks.writePaneCommand.mockReset();
    terminalSessionRegistryMocks.getTerminalPaneSession.mockReset();
    terminalSessionRegistryMocks.getTerminalPaneSession.mockReturnValue(
      "terminal-session-1",
    );
    terminalSessionRegistryMocks.writePaneCommand.mockResolvedValue({
      paneId: "pane-1",
      sent: true,
      sessionId: "terminal-session-1",
      target: "ssh",
    });
    tmuxApiMocks.tmuxProbe.mockResolvedValue({
      available: true,
      target: { kind: "ssh", hostId: "prod-api" },
      targetRef: "ssh:prod-api",
      version: "tmux 3.4",
    });
    tmuxApiMocks.tmuxListSessions.mockResolvedValue([session]);
    tmuxApiMocks.tmuxListWindows.mockResolvedValue([
      {
        active: true,
        id: "@0",
        index: 0,
        layout: "layout",
        name: "shell",
        panes: 1,
        sessionId: "$0",
      },
    ]);
    tmuxApiMocks.tmuxListPanes.mockResolvedValue([
      {
        active: true,
        currentCommand: "bash",
        currentPath: "/srv/api",
        dead: false,
        height: 24,
        id: "%0",
        index: 0,
        width: 80,
        windowId: "@0",
      },
    ]);
    tmuxApiMocks.tmuxCapturePane.mockResolvedValue({
      lines: 120,
      paneId: "%0",
      text: "npm run dev",
      truncated: false,
    });
  });

  it("renders tmux sessions without loading details for an SSH target", async () => {
    render(<TmuxToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("tmux 3.4")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("/srv/api")).toBeInTheDocument();
    expect(screen.getByText("常用")).toBeInTheDocument();
    expect(screen.getByText("命令")).toBeInTheDocument();
    expect(screen.getByText("快捷键")).toBeInTheDocument();
    expect(screen.getByText("tmux ls")).toBeInTheDocument();
    expect(screen.getByText("列出所有会话")).toBeInTheDocument();
    expect(screen.getByText("Ctrl-b d")).toBeInTheDocument();
    expect(screen.getByText("快捷键退出当前 tmux 连接")).toBeInTheDocument();
    const commandRows = within(
      screen.getByRole("list", { name: "常用 tmux 命令" }),
    ).getAllByRole("listitem");
    const shortcutRows = within(
      screen.getByRole("list", { name: "常用 tmux 快捷键" }),
    ).getAllByRole("listitem");
    expect(commandRows).toHaveLength(10);
    expect(shortcutRows).toHaveLength(10);
    expect(within(commandRows[0]).getByText("tmux ls")).toBeInTheDocument();
    expect(
      within(shortcutRows[0]).getByText("Ctrl-b d"),
    ).toBeInTheDocument();
    expect(
      within(commandRows[0]).getByRole("button", { name: "复制命令" }),
    ).toBeEnabled();
    expect(
      within(commandRows[0]).getByRole("button", { name: "发送到终端" }),
    ).toBeDisabled();
    expect(tmuxApiMocks.tmuxProbe).toHaveBeenCalledWith({
      target: { target: { hostId: "prod-api", kind: "ssh" } },
    });
    expect(tmuxApiMocks.tmuxListWindows).not.toHaveBeenCalled();
    expect(tmuxApiMocks.tmuxListPanes).not.toHaveBeenCalled();
    expect(tmuxApiMocks.tmuxCapturePane).not.toHaveBeenCalled();
  });

  it("copies and sends a common tmux command to the focused terminal", async () => {
    const user = userEvent.setup();

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    const commandRows = within(
      await screen.findByRole("list", { name: "常用 tmux 命令" }),
    ).getAllByRole("listitem");
    const firstCommandRow = within(commandRows[0]);

    await user.click(firstCommandRow.getByRole("button", { name: "复制命令" }));
    await waitFor(() =>
      expect(
        desktopClipboardApiMocks.writeDesktopClipboardText,
      ).toHaveBeenCalledWith("tmux ls"),
    );

    await user.click(firstCommandRow.getByRole("button", { name: "发送到终端" }));
    await waitFor(() =>
      expect(
        terminalSessionRegistryMocks.writePaneCommand,
      ).toHaveBeenCalledWith({
        command: "tmux ls",
        paneId: "pane-1",
        source: "tool",
        tabId: undefined,
      }),
    );
  });

  it("copies and sends a common tmux shortcut to the focused terminal", async () => {
    const user = userEvent.setup();

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    const quickrefRows = within(
      await screen.findByRole("list", { name: "常用 tmux 快捷键" }),
    ).getAllByRole("listitem");
    const detachShortcutRow = quickrefRows.find((row) =>
      within(row).queryByText("Ctrl-b d"),
    );
    expect(detachShortcutRow).toBeDefined();
    const shortcutRow = within(detachShortcutRow as HTMLElement);

    await user.click(shortcutRow.getByRole("button", { name: "复制快捷键" }));
    await waitFor(() =>
      expect(
        desktopClipboardApiMocks.writeDesktopClipboardText,
      ).toHaveBeenCalledWith("Ctrl-b d"),
    );

    await user.click(shortcutRow.getByRole("button", { name: "发送到终端" }));
    await waitFor(() =>
      expect(terminalApiMocks.writeTerminal).toHaveBeenCalledWith(
        "terminal-session-1",
        "\u0002d",
      ),
    );
    expect(
      terminalSessionRegistryMocks.writePaneCommand,
    ).not.toHaveBeenCalledWith(expect.objectContaining({ command: "Ctrl-b d" }));
  });

  it("shows a clipboard permission error when quickref copy is unavailable", async () => {
    const user = userEvent.setup();
    desktopClipboardApiMocks.writeDesktopClipboardText.mockResolvedValueOnce({
      ok: false,
      reason: "unavailable",
    });

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    const commandRows = within(
      await screen.findByRole("list", { name: "常用 tmux 命令" }),
    ).getAllByRole("listitem");
    await user.click(
      within(commandRows[0]).getByRole("button", { name: "复制命令" }),
    );

    expect(
      await screen.findByText("复制失败：当前环境没有剪贴板权限"),
    ).toBeInTheDocument();
  });

  it("shows unavailable state when tmux is missing", async () => {
    tmuxApiMocks.tmuxProbe.mockResolvedValueOnce({
      available: false,
      reason: "tmux not found",
      target: { kind: "ssh", hostId: "prod-api" },
      targetRef: "ssh:prod-api",
    });
    tmuxApiMocks.tmuxListSessions.mockResolvedValueOnce([]);

    render(<TmuxToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("tmux unavailable")).toBeInTheDocument();
    expect(await screen.findAllByText("tmux not found")).toHaveLength(2);
    expect(tmuxApiMocks.tmuxListSessions).not.toHaveBeenCalled();
  });

  it("shows an actionable compatibility hint when tmux session parsing fails", async () => {
    tmuxApiMocks.tmuxListSessions.mockRejectedValueOnce(
      new Error("参数不合法: tmux session name 为空"),
    );

    render(<TmuxToolContent selectedMachine={sshMachine} />);

    expect(
      await screen.findByText(/tmux 会话列表读取失败：目标 tmux 输出格式不兼容/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tmux probe failed/)).not.toBeInTheDocument();
  });

  it("creates a session from the dialog", async () => {
    const user = userEvent.setup();
    tmuxApiMocks.tmuxCreateSession.mockResolvedValue({
      ...session,
      id: "$1",
      name: "api-dev",
    });

    render(<TmuxToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "新建会话" }));
    const input = screen.getByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "api-dev");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(tmuxApiMocks.tmuxCreateSession).toHaveBeenCalledWith({
        cwd: undefined,
        name: "api-dev",
        target: { target: { hostId: "prod-api", kind: "ssh" } },
      }),
    );
    expect(await screen.findByText("api-dev")).toBeInTheDocument();
  });

  it("uses semantic colors for dialog action buttons", async () => {
    const user = userEvent.setup();

    render(<TmuxToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "新建会话" }));
    expect(screen.getByRole("button", { name: "Create" })).toHaveClass(
      "bg-[#0A84FF]",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(await screen.findByRole("button", { name: "删除" }));
    const killButtons = screen.getAllByRole("button", { name: "Kill" });
    expect(killButtons[killButtons.length - 1]).toHaveClass("text-red-600");
  });

  it("writes attach command through the focused pane session binding", async () => {
    const user = userEvent.setup();

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "连接" }));

    await waitFor(() =>
      expect(terminalSessionRegistryMocks.writePaneCommand).toHaveBeenCalledWith({
        command: "tmux 'attach-session' '-t' '$0'",
        paneId: "pane-1",
        source: "tool",
        tabId: undefined,
      }),
    );
  });

  it("detaches the focused tmux pane from the header action", async () => {
    const user = userEvent.setup();
    const attachedPane = {
      ...focusedPane,
      tmuxBinding: {
        attachedAt: "1",
        sessionId: "$0",
        sessionName: "api",
        targetRef: "ssh:prod-api",
      },
    };
    tmuxApiMocks.tmuxDetachCurrent.mockResolvedValue(true);

    render(
      <TmuxToolContent
        focusedPane={attachedPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "退出 tmux" }));

    await waitFor(() =>
      expect(tmuxApiMocks.tmuxDetachCurrent).toHaveBeenCalledWith("pane-1"),
    );
    expect(terminalApiMocks.writeTerminal).toHaveBeenCalledWith(
      "terminal-session-1",
      "\u0002d",
    );
  });

  it("keeps detach enabled after attaching through the current terminal", async () => {
    const user = userEvent.setup();
    tmuxApiMocks.tmuxDetachCurrent.mockResolvedValue(true);

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "退出 tmux" }));

    await waitFor(() =>
      expect(tmuxApiMocks.tmuxDetachCurrent).toHaveBeenCalledWith("pane-1"),
    );
    expect(terminalApiMocks.writeTerminal).toHaveBeenCalledWith(
      "terminal-session-1",
      "\u0002d",
    );
  });

  it("falls back to tmux detach-client when the focused pane has no tracked binding", async () => {
    const user = userEvent.setup();
    terminalSessionRegistryMocks.getTerminalPaneSession.mockReturnValue(
      undefined,
    );
    tmuxApiMocks.tmuxDetachCurrent.mockResolvedValue(false);

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "退出 tmux" }));

    await waitFor(() =>
      expect(tmuxApiMocks.tmuxDetachCurrent).toHaveBeenCalledWith("pane-1"),
    );
    expect(terminalSessionRegistryMocks.writePaneCommand).toHaveBeenCalledWith({
      command: "tmux detach-client",
      paneId: "pane-1",
      source: "tool",
      tabId: undefined,
    });
  });

  it("shows a focused terminal readiness error when the pane session binding is missing", async () => {
    const user = userEvent.setup();
    terminalSessionRegistryMocks.writePaneCommand.mockResolvedValueOnce({
      paneId: "pane-1",
      reason: "missing-session",
      sent: false,
    });

    render(
      <TmuxToolContent
        focusedPane={focusedPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "连接" }));

    expect(
      await screen.findByText("attach failed: terminal session is not ready"),
    ).toBeInTheDocument();
  });
});
