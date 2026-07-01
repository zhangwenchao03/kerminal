import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOutputEvent } from "../lib/terminalApi";
import { defaultAppSettings } from "../features/settings/settingsModel";
import {
  resetWorkspaceStore,
  useWorkspaceStore,
} from "../features/workspace/workspaceStore";
import {
  getKerminalShellTestMocks,
  mockElementFromPoint,
  rdpRemoteHostTree,
  remoteHostTree,
  remoteHostTreeWithPinnedTargetGroup,
  remoteHostTreeWithTargetGroup,
  testSshOptions,
} from "./__tests__/support/KerminalShell.testSupport";
import { KerminalShell } from "./KerminalShell";

const mocks = getKerminalShellTestMocks();

async function findExpandedSidebarMachine(name: RegExp) {
  const sidebar = screen.getByRole("complementary", { name: "主机侧边栏" });
  await waitFor(() => {
    if (within(sidebar).queryByRole("button", { name })) {
      return;
    }
    const hasCollapsedGroup = within(sidebar)
      .queryAllByRole("button")
      .some((button) => button.getAttribute("aria-expanded") === "false");
    if (!hasCollapsedGroup) {
      throw new Error("Waiting for sidebar machine groups to load.");
    }
  });
  const visibleMachine = within(sidebar).queryByRole("button", { name });
  if (visibleMachine) {
    return visibleMachine;
  }
  const collapsedGroupButtons = within(sidebar)
    .queryAllByRole("button")
    .filter((button) => button.getAttribute("aria-expanded") === "false");
  await act(async () => {
    for (const button of collapsedGroupButtons) {
      fireEvent.click(button);
    }
  });
  return within(sidebar).findByRole("button", { name });
}

describe("KerminalShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-language");
    document.documentElement.removeAttribute("lang");
    window.localStorage.clear();
    resetWorkspaceStore();
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockReset();
    mocks.workspaceSessionApi.saveWorkspaceSessionFile.mockReset();
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue(null);
    mocks.workspaceSessionApi.saveWorkspaceSessionFile.mockResolvedValue(
      undefined,
    );
    mocks.appTitleBar.renderCount = 0;
    mocks.nativeMenuApi.listenNativeMenuActions.mockResolvedValue(
      () => undefined,
    );
    mocks.profileApi.createProfile.mockResolvedValue({
      args: [],
      createdAt: "test",
      env: {},
      id: "profile-created",
      isDefault: false,
      name: "Created Shell",
      shell: "test-shell",
      sortOrder: 20,
      updatedAt: "test",
    });
    mocks.profileApi.detectShells.mockResolvedValue([]);
    mocks.profileApi.listProfiles.mockResolvedValue([]);
    mocks.profileApi.updateProfile.mockImplementation(async (request) => ({
      args: request.args,
      createdAt: "test",
      cwd: request.cwd,
      env: request.env,
      id: request.id,
      isDefault: request.setDefault,
      name: request.name,
      shell: request.shell,
      sortOrder: request.sortOrder,
      updatedAt: "updated",
    }));
    mocks.dockerApi.listDockerContainers.mockResolvedValue([]);
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(remoteHostTree);
    mocks.remoteHostApi.createRemoteHost.mockResolvedValue({
      authType: "agent",
      createdAt: "test",
      groupId: "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
      host: "172.16.41.60",
      id: "host-copy",
      name: "172.16.41.60 副本",
      port: 22,
      production: false,
      sshOptions: testSshOptions,
      sortOrder: 20,
      tags: ["ssh", "bbb"],
      updatedAt: "test",
      username: "ubuntu",
    });
    mocks.remoteHostApi.updateRemoteHost.mockImplementation(
      async (request) => ({
        authType: request.authType,
        createdAt: "test",
        credentialRef: request.credentialRef,
        groupId: request.groupId,
        host: request.host,
        id: request.id,
        name: request.name,
        port: request.port ?? 22,
        production: request.production ?? false,
        sshOptions: request.sshOptions,
        sortOrder: request.sortOrder,
        tags: request.tags ?? [],
        updatedAt: "test",
        username: request.username,
      }),
    );
    mocks.remoteHostApi.updateRemoteHostGroup.mockImplementation(
      async (request) => ({
        createdAt: "test",
        id: request.id,
        name: request.name,
        sortOrder: request.sortOrder,
        updatedAt: "test",
      }),
    );
    mocks.settingsApi.getSettings.mockResolvedValue(defaultAppSettings);
    mocks.settingsApi.updateSettings.mockImplementation(
      async (settings) => settings,
    );
    mocks.terminalApi.createTerminalSession.mockImplementation(
      async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
        onOutput({
          data: "local ready",
          kind: "data",
          sessionId: "session-local",
        });
        return {
          cols: 80,
          id: "session-local",
          rows: 24,
          shell: "test-shell",
          status: "running",
        };
      },
    );
    mocks.terminalApi.createSshTerminalSession.mockImplementation(
      async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
        onOutput({
          data: "ssh ready",
          kind: "data",
          sessionId: "session-ssh",
        });
        return {
          cols: 80,
          id: "session-ssh",
          rows: 24,
          shell: "ssh",
          status: "running",
        };
      },
    );
	    mocks.terminalApi.getTerminalLogState.mockResolvedValue({
	      active: false,
	      bytesWritten: 0,
	    });
	    mocks.terminalApi.closeTerminal.mockResolvedValue(undefined);
	    mocks.terminalApi.reapOrphanTerminalSessions.mockResolvedValue({
	      elapsedMs: 0,
	      reapedCount: 0,
	      sessionIds: [],
	    });
	    mocks.terminalApi.resizeTerminal.mockResolvedValue(undefined);
    mocks.serverInfoApi.getServerInfoSnapshot.mockResolvedValue({
      architecture: "x86_64",
      capturedAt: "1781763088",
      cpuCount: 32,
      cpuCoreUsagePercents: [],
      cpuUsagePercent: 8.1,
      diskMount: "/",
      diskTotalBytes: 64 * 1024 * 1024 * 1024,
      diskUsedBytes: 16 * 1024 * 1024 * 1024,
      gpus: [],
      host: "172.16.41.60",
      hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
      hostName: "172.16.41.60",
      hostname: "bwy-host",
      kernel: "6.8.0",
      loadAverage: [0.1, 0.2, 0.3],
      memoryTotalBytes: 8 * 1024 * 1024 * 1024,
      memoryUsedBytes: 4 * 1024 * 1024 * 1024,
      networkRxBytes: 1024,
      networkTxBytes: 2048,
      os: "Linux",
      port: 22,
      swapTotalBytes: 2 * 1024 * 1024 * 1024,
      swapUsedBytes: 0,
      uptimeSeconds: 90_000,
      username: "ubuntu",
    });
  });

	  it("starts without creating a local terminal when no workspace session is saved", async () => {
	    render(<KerminalShell />);

	    expect(
	      await screen.findByText("光标还没闪，AI 已经开始脑补命令了。"),
	    ).toBeInTheDocument();
    expect(
      await findExpandedSidebarMachine(/172\.16\.41\.60/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开 Agent Launcher" }),
    ).toBeInTheDocument();
	    expect(mocks.terminalApi.createTerminalSession).not.toHaveBeenCalled();
	  });

	  it("reaps local orphan PTY sessions before restoring saved terminal tabs", async () => {
	    const callOrder: string[] = [];
	    let resolveReap: (() => void) | undefined;
	    mocks.terminalApi.reapOrphanTerminalSessions.mockImplementation(
	      () =>
	        new Promise((resolve) => {
	          callOrder.push("reap:start");
	          resolveReap = () => {
	            callOrder.push("reap:done");
	            resolve({
	              elapsedMs: 3,
	              reapedCount: 1,
	              sessionIds: ["old-local-session"],
	            });
	          };
	        }),
	    );
	    mocks.terminalApi.createTerminalSession.mockImplementation(
	      async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
	        callOrder.push("create:local");
	        onOutput({
	          data: "local ready",
	          kind: "data",
	          sessionId: "session-local",
	        });
	        return {
	          cols: 80,
	          id: "session-local",
	          rows: 24,
	          shell: "test-shell",
	          status: "running",
	        };
	      },
	    );
	    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
	      activeTabId: "tab-local-restore",
	      focusedPaneId: "pane-local-restore",
	      selectedMachineId: "machine-local-restore",
	      terminalPanes: [
	        {
	          id: "pane-local-restore",
	          lines: [],
	          machineId: "machine-local-restore",
	          mode: "local",
	          prompt: "PS>",
	          shell: "test-shell",
	          status: "online",
	          title: "恢复本地会话",
	        },
	      ],
	      terminalTabs: [
	        {
	          id: "tab-local-restore",
	          layout: { type: "pane", paneId: "pane-local-restore" },
	          machineId: "machine-local-restore",
	          title: "恢复本地会话",
	        },
	      ],
	    });

	    render(<KerminalShell />);

	    await waitFor(() => {
	      expect(mocks.terminalApi.reapOrphanTerminalSessions).toHaveBeenCalledTimes(
	        1,
	      );
	    });
	    expect(mocks.terminalApi.createTerminalSession).not.toHaveBeenCalled();

	    await act(async () => {
	      resolveReap?.();
	      await Promise.resolve();
	    });

	    await waitFor(() => {
	      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledTimes(1);
	    });
	    expect(callOrder).toEqual(["reap:start", "reap:done", "create:local"]);
	  });

	  it("continues workspace restore when local orphan PTY reaping fails", async () => {
	    mocks.terminalApi.reapOrphanTerminalSessions.mockRejectedValue(
	      new Error("reaper unavailable"),
	    );
	    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
	      activeTabId: "tab-local-reap-failed",
	      focusedPaneId: "pane-local-reap-failed",
	      selectedMachineId: "machine-local-reap-failed",
	      terminalPanes: [
	        {
	          id: "pane-local-reap-failed",
	          lines: [],
	          machineId: "machine-local-reap-failed",
	          mode: "local",
	          prompt: "PS>",
	          shell: "test-shell",
	          status: "online",
	          title: "reaper 失败后恢复",
	        },
	      ],
	      terminalTabs: [
	        {
	          id: "tab-local-reap-failed",
	          layout: { type: "pane", paneId: "pane-local-reap-failed" },
	          machineId: "machine-local-reap-failed",
	          title: "reaper 失败后恢复",
	        },
	      ],
	    });

	    render(<KerminalShell />);

	    await waitFor(() => {
	      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledWith(
	        expect.objectContaining({
	          cols: 80,
	          rows: 24,
	          shell: "test-shell",
	        }),
	        expect.any(Function),
	      );
	    });
	  });

	  it("keeps host SFTP and cross-host transfer entries on separate surfaces", async () => {
    const user = userEvent.setup();
    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);

    fireEvent.contextMenu(hostButton);
    await user.click(screen.getByRole("menuitem", { name: "打开 SFTP" }));

    expect(await screen.findByLabelText("SFTP 工具内容")).toBeInTheDocument();
    expect(screen.queryByLabelText("SFTP 传输工作台")).not.toBeInTheDocument();

    fireEvent.contextMenu(hostButton);
    await user.click(screen.getByRole("menuitem", { name: "新建传输 Tab" }));

    expect(await screen.findByLabelText("SFTP 传输工作台")).toHaveTextContent(
      "right:db980b17-2ed0-44e5-b72a-6ecadf788439 locked:none",
    );
    expect(
      screen.getByRole("complementary", { name: "工具面板" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("creates a new SSH host from the SFTP transfer workbench and returns it to the requested side", async () => {
    const user = userEvent.setup();
    const createdHost = {
      authType: "agent" as const,
      createdAt: "test",
      groupId: "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
      host: "10.0.0.9",
      id: "host-created-from-transfer",
      name: "transfer-dev",
      port: 22,
      production: false,
      sshOptions: testSshOptions,
      sortOrder: 30,
      tags: [],
      updatedAt: "test",
      username: "deploy",
    };
    mocks.remoteHostApi.createRemoteHost.mockResolvedValue(createdHost);
    mocks.remoteHostApi.listRemoteHostTree
      .mockResolvedValueOnce(remoteHostTree)
      .mockResolvedValueOnce([
        {
          ...remoteHostTree[0],
          hosts: [...remoteHostTree[0].hosts, createdHost],
        },
      ]);

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    fireEvent.contextMenu(hostButton);
    await user.click(screen.getByRole("menuitem", { name: "新建传输 Tab" }));
    expect(await screen.findByLabelText("SFTP 传输工作台")).toHaveTextContent(
      "right:db980b17-2ed0-44e5-b72a-6ecadf788439",
    );

    await user.click(
      screen.getByRole("button", { name: "从右侧新建 SSH 主机" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "新建主机" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("名称"), "transfer-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.9");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await user.click(screen.getByRole("combobox", { name: "认证方式" }));
    await user.click(screen.getByRole("option", { name: /SSH Agent/ }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.createRemoteHost).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "10.0.0.9",
          name: "transfer-dev",
          username: "deploy",
        }),
      );
      expect(screen.getByLabelText("SFTP 传输工作台")).toHaveTextContent(
        "created:tab-sftp-transfer-1:right:host-created-from-transfer",
      );
    });
  });

  it("flushes the workspace session before the page is hidden", async () => {
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "",
      focusedPaneId: "",
      removedSidebarMachineIds: [],
      selectedMachineId: "",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabGroupPreferences: {},
      terminalTabs: [],
    });
    render(<KerminalShell />);

    expect(
      await screen.findByText("光标还没闪，AI 已经开始脑补命令了。"),
    ).toBeInTheDocument();

    fireEvent(window, new Event("pagehide"));

    await waitFor(() => {
      expect(mocks.workspaceSessionApi.saveWorkspaceSessionFile).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalPanes: [],
          terminalTabs: [],
        }),
      );
    });
  });

  it("keeps shell chrome stable when terminal output history changes", async () => {
    mocks.terminalApi.createTerminalSession.mockResolvedValue({
      cols: 80,
      id: "session-local-output-history",
      rows: 24,
      shell: "test-shell",
      status: "running",
    });

    render(<KerminalShell />);

    expect(
      await findExpandedSidebarMachine(/172\.16\.41\.60/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.settingsApi.getSettings).toHaveBeenCalled();
    });

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalled();
    });

    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }
    expect(paneId).toBe("pane-local-1");
    const chromeRenderCountAfterOpen = mocks.appTitleBar.renderCount;

    act(() => {
      useWorkspaceStore
        .getState()
        .updatePaneOutputHistory(paneId, "latest shell-isolated output");
    });

    expect(
      useWorkspaceStore
        .getState()
        .terminalPanes.find((pane) => pane.id === paneId)?.outputHistory,
    ).toBe("latest shell-isolated output");
    expect(mocks.appTitleBar.renderCount).toBe(chromeRenderCountAfterOpen);

    fireEvent(window, new Event("pagehide"));
    await waitFor(() => {
      const calls = mocks.workspaceSessionApi.saveWorkspaceSessionFile.mock.calls;
      const savedSession = calls[calls.length - 1]?.[0];
      expect(savedSession.terminalPanes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: paneId,
            outputHistory: "latest shell-isolated output",
          }),
        ]),
      );
    });
  });

  it("does not list Docker containers when an SSH host is selected", async () => {
    const user = userEvent.setup();

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    await user.click(hostButton);

    expect(mocks.dockerApi.listDockerContainers).not.toHaveBeenCalled();
  });

  it("runs IDEA-style settings and terminal shortcuts", async () => {
    render(<KerminalShell />);

    await waitFor(() => {
      expect(mocks.settingsApi.getSettings).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, {
      altKey: true,
      ctrlKey: true,
      key: "s",
    });
    expect(
      await screen.findByRole("dialog", { name: "设置" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, {
      ctrlKey: true,
      key: "t",
      shiftKey: true,
    });

    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalled();
    });
  });

  it("uses saved custom keybindings at runtime", async () => {
    mocks.settingsApi.getSettings.mockResolvedValue({
      ...defaultAppSettings,
      keybindings: defaultAppSettings.keybindings.map((keybinding) =>
        keybinding.action === "settings.open"
          ? {
              ...keybinding,
              binding: "Ctrl+Alt+,",
              windowsBinding: "Ctrl+Alt+,",
            }
          : keybinding,
      ),
      themeMode: "light",
    });

    render(<KerminalShell />);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
    });
    fireEvent.keyDown(window, {
      altKey: true,
      ctrlKey: true,
      key: ",",
    });

    expect(
      await screen.findByRole("dialog", { name: "设置" }),
    ).toBeInTheDocument();
  });

  it("applies the resolved theme to the document root for portal dialogs", async () => {
    render(<KerminalShell />);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    fireEvent.keyDown(window, {
      altKey: true,
      ctrlKey: true,
      key: "s",
    });

    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(dialog.closest(".dark")).toBe(document.documentElement);
  });

  it("opens keybinding settings from the Find Action style shortcut", async () => {
    render(<KerminalShell />);

    await waitFor(() => {
      expect(mocks.settingsApi.getSettings).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, {
      ctrlKey: true,
      key: "a",
      shiftKey: true,
    });

    expect(await screen.findByText("查看快捷键与动作")).toBeInTheDocument();
    expect(
      screen.getByLabelText("查看快捷键与动作 Windows 快捷键"),
    ).toHaveValue("Ctrl+Shift+A");
  });

  it("keeps the expanded left title strip available for native window dragging", () => {
    const { container } = render(<KerminalShell />);

    const dragRegions = [
      ...container.querySelectorAll("[data-tauri-drag-region]"),
    ];
    const leftTitleStrip = dragRegions.find((element) => {
      const className = element.getAttribute("class") ?? "";
      return className.includes("col-[1/2]") && className.includes("row-[1/2]");
    });
    const rightTitleStrip = dragRegions.find((element) => {
      const className = element.getAttribute("class") ?? "";
      return className.includes("col-[2/6]") && className.includes("row-[1/2]");
    });

    expect(leftTitleStrip).toBeInTheDocument();
    expect(leftTitleStrip).not.toHaveClass("border-r");
    expect(rightTitleStrip).toBeInTheDocument();
    expect(rightTitleStrip).not.toHaveClass("border-r");
  });

  it("keeps the overlaid title bar transparent so terminal tabs stay framed", () => {
    render(<KerminalShell />);

    const titleBar = screen.getByRole("banner");

    expect(titleBar).toHaveClass("z-50");
    expect(titleBar).not.toHaveClass("kerminal-material-nav");
    expect(titleBar).not.toHaveClass("border-b");
    expect(screen.getByLabelText("终端标签栏").parentElement).toHaveClass(
      "kerminal-material-nav",
    );
  });

  it("keeps the terminal navigation width independent from the right tool panel", async () => {
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    const workspace = await screen.findByRole("main", { name: "终端工作区" });
    const shell = container.firstElementChild as HTMLElement;
    expect(shell).toHaveStyle({
      gridTemplateRows: "36px minmax(0, 1fr)",
    });
    expect(workspace.parentElement).toHaveStyle({ gridColumn: "3 / 6" });

    const content = container.querySelector(
      "[data-terminal-workspace-content]",
    ) as HTMLElement;
    expect(content).toHaveStyle({ marginRight: "44px" });

    await user.click(screen.getByRole("button", { name: "打开 日志" }));

    expect(
      screen.getByRole("complementary", { name: "工具面板" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(workspace.parentElement).toHaveStyle({ gridColumn: "3 / 6" });
    expect(screen.getByLabelText("终端标签栏").parentElement).not.toHaveStyle({
      marginRight: "348px",
    });
    expect(content).toHaveStyle({ marginRight: "348px" });
  });

  it("allows the right tool panel to expand to the wider resize limit", async () => {
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    expect(
      await screen.findByText("光标还没闪，AI 已经开始脑补命令了。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开 日志" }));

    const rightSeparator = screen.getByRole("separator", {
      name: "调整工具面板宽度",
    });
    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(rightSeparator, { key: "ArrowLeft", shiftKey: true });
    }

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.style.gridTemplateColumns).toContain("720px");
  });

  it("matches the expanded left sidebar resize column to the shell glass surface", () => {
    render(<KerminalShell />);

    const leftSeparator = screen.getByRole("separator", {
      name: "调整主机侧边栏宽度",
    });

    expect(leftSeparator).toHaveClass("kerminal-shell-separator");
    expect(leftSeparator).not.toHaveClass("kerminal-material-nav");
    expect(leftSeparator).not.toHaveClass("kerminal-terminal-surface");
  });

  it("removes the whole left sidebar when collapsed from the title bar", async () => {
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    expect(
      await screen.findByRole("complementary", { name: "主机侧边栏" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "折叠主机侧边栏" }),
    );

    const shell = container.firstElementChild as HTMLElement;
    expect(
      screen.queryByRole("complementary", { name: "主机侧边栏" }),
    ).not.toBeInTheDocument();
    expect(shell.style.gridTemplateColumns).toMatch(/^0px 0px /);
    expect(screen.getByLabelText("终端标签栏").parentElement).toHaveStyle({
      paddingLeft: "48px",
    });
  });

  it("applies appearance language and workspace background settings", async () => {
    mocks.settingsApi.getSettings.mockResolvedValue({
      ...defaultAppSettings,
      appearance: {
        ...defaultAppSettings.appearance,
        backgroundEnabled: true,
        backgroundFit: "tile",
        backgroundImagePath: "C:\\Users\\dev\\Pictures\\bg.png",
        backgroundOpacity: 64,
        interfaceLanguage: "enUS",
        windowOpacity: 72,
      },
      themeMode: "light",
    });

    const { container } = render(<KerminalShell />);
    const frame = container.firstElementChild as HTMLElement;

    await waitFor(() => {
      expect(frame).toHaveAttribute("data-language", "enUS");
      expect(document.documentElement).not.toHaveClass("dark");
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(document.documentElement).toHaveAttribute("data-language", "enUS");
    });
    expect(frame).toHaveAttribute("lang", "en-US");
    expect(frame.style.backgroundImage).toContain("linear-gradient");
    expect(frame.style.backgroundImage).toContain("radial-gradient");
    expect(frame.style.backgroundColor).toBe("rgba(245, 245, 247, 0.72)");
    expect(frame.style.getPropertyValue("--app-background-veil-opacity")).toBe(
      "0.532",
    );
    expect(frame.style.backgroundImage).toContain(
      "var(--app-background-veil-opacity)",
    );
    expect(frame.style.getPropertyValue("--app-window-opacity")).toBe("0.72");
    expect(frame.style.getPropertyValue("--app-nav-surface-opacity")).toBe(
      "0.7336",
    );
    expect(frame.style.getPropertyValue("--app-workspace-surface-opacity")).toBe(
      "0.7336",
    );
    expect(frame.style.getPropertyValue("--app-terminal-header-opacity")).toBe(
      "0.7452",
    );
    expect(frame.style.getPropertyValue("--app-terminal-surface-opacity")).toBe(
      "0.6952",
    );
    expect(frame.style.backgroundImage).toContain(
      "file:///C:/Users/dev/Pictures/bg.png",
    );
    expect(frame.style.backgroundRepeat).toBe("repeat");
    expect(frame.style.backgroundSize).toBe("auto");
  });

  it("restores saved terminal tabs from the previous workspace session", async () => {
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-local-3",
      focusedPaneId: "pane-local-3",
      selectedMachineId: "machine-local-3",
      terminalPanes: [
        {
          args: ["-NoLogo"],
          cwd: "C:\\\\dev\\\\kerminal",
          env: { TERM: "xterm-256color" },
          id: "pane-local-3",
          lines: ["old output"],
          machineId: "machine-local-3",
          mode: "local",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "恢复会话",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-3",
          layout: { type: "pane", paneId: "pane-local-3" },
          machineId: "machine-local-3",
          title: "恢复会话",
        },
      ],
    });

    render(<KerminalShell />);

    expect(
      await screen.findByRole("button", { name: "恢复会话" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledWith(
        {
          args: ["-NoLogo"],
          cols: 80,
          cwd: "C:\\\\dev\\\\kerminal",
          env: { TERM: "xterm-256color" },
          rows: 24,
          shell: "pwsh.exe",
        },
        expect.any(Function),
      );
    });
  });

  it("restores saved left sidebar layout from the previous workspace session", async () => {
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "",
      focusedPaneId: "",
      removedSidebarMachineIds: [],
      selectedMachineId: "",
      shellLayout: {
        collapsedMachineGroupIds: ["30fbc381-2884-4b75-9f88-0e28f31ca8b0"],
        leftPanelCollapsed: false,
        leftPanelWidth: 312,
        toolPanelWidth: 444,
      },
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabGroupPreferences: {},
      terminalTabs: [],
    });

    const { container } = render(<KerminalShell />);
    const shell = container.firstElementChild as HTMLElement;

    await waitFor(() => {
      expect(shell).toHaveStyle({
        gridTemplateColumns: "312px 8px minmax(0, 1fr) 0px 44px",
      });
    });
    const groupButton = await screen.findByRole("button", { name: /bwy/ });
    expect(groupButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /172\.16\.41\.60/ }),
    ).not.toBeInTheDocument();

    fireEvent(window, new Event("pagehide"));

    await waitFor(() => {
      expect(
        mocks.workspaceSessionApi.saveWorkspaceSessionFile,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          shellLayout: {
            collapsedMachineGroupIds: [
              "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
            ],
            leftPanelCollapsed: false,
            leftPanelWidth: 312,
            toolPanelWidth: 444,
          },
        }),
      );
    });
  });

  it("keeps restored terminal tabs mounted when switching tabs", async () => {
    const user = userEvent.setup();
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-local-1",
      focusedPaneId: "pane-local-1",
      selectedMachineId: "machine-local-1",
      terminalPanes: [
        {
          id: "pane-local-1",
          lines: [],
          machineId: "machine-local-1",
          mode: "local",
          outputHistory: "first history\r\n",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "第一恢复会话",
        },
        {
          id: "pane-local-2",
          lines: [],
          machineId: "machine-local-2",
          mode: "local",
          outputHistory: "second history\r\n",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "第二恢复会话",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-1",
          layout: { type: "pane", paneId: "pane-local-1" },
          machineId: "machine-local-1",
          title: "第一恢复会话",
        },
        {
          id: "tab-local-2",
          layout: { type: "pane", paneId: "pane-local-2" },
          machineId: "machine-local-2",
          title: "第二恢复会话",
        },
      ],
    });

    render(<KerminalShell />);

    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledTimes(2);
    });
    const createCount =
      mocks.terminalApi.createTerminalSession.mock.calls.length;
    const closeCount = mocks.terminalApi.closeTerminal.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "第二恢复会话" }));
    await user.click(screen.getByRole("button", { name: "第一恢复会话" }));

    expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledTimes(
      createCount,
    );
    expect(mocks.terminalApi.closeTerminal).toHaveBeenCalledTimes(closeCount);
  });

  it("opens an SSH host and then renders the remote system panel", async () => {
    const user = userEvent.setup();

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    fireEvent.doubleClick(hostButton);

    await waitFor(() => {
      expect(mocks.terminalApi.createSshTerminalSession).toHaveBeenCalledWith(
        {
          cols: 80,
          hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          rows: 24,
        },
        expect.any(Function),
      );
    });

    await user.click(screen.getByRole("button", { name: "打开 系统" }));

    expect(await screen.findByText("bwy-host")).toBeInTheDocument();
    expect(mocks.serverInfoApi.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
      target: {
        hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        kind: "ssh",
      },
    });
    expect(screen.queryByText("终端分屏渲染异常")).not.toBeInTheDocument();
    expect(
      screen.queryByText("应用启动失败，请打开开发者工具查看错误。"),
    ).not.toBeInTheDocument();
  });

  it("opens a saved RDP host from the sidebar without creating an SSH terminal", async () => {
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(rdpRemoteHostTree);

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/office-rdp/);
    fireEvent.doubleClick(hostButton);

    await waitFor(() => {
      expect(mocks.connectionApi.openSavedRdpConnection).toHaveBeenCalledWith(
        "rdp-office",
      );
    });
    expect(mocks.terminalApi.createSshTerminalSession).not.toHaveBeenCalled();
  });

  it("creates a real default group when saving an SSH host without selecting a group", async () => {
    const user = userEvent.setup();
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue([]);
    mocks.remoteHostApi.createRemoteHostGroup.mockResolvedValue({
      createdAt: "test",
      id: "group-default",
      name: "默认分组",
      sortOrder: 10,
      updatedAt: "test",
    });
    mocks.remoteHostApi.createRemoteHost.mockResolvedValue({
      authType: "agent",
      createdAt: "test",
      groupId: "group-default",
      host: "10.0.0.8",
      id: "host-default",
      name: "default-dev",
      port: 22,
      production: false,
      sortOrder: 10,
      tags: ["ssh"],
      updatedAt: "test",
      username: "ubuntu",
    });

    render(<KerminalShell />);

    fireEvent.contextMenu(
      await screen.findByRole("complementary", { name: "主机侧边栏" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "添加连接" }));
    await user.click(await screen.findByRole("button", { name: "SSH" }));

    await user.type(screen.getByLabelText("名称"), "default-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.8");
    await user.type(screen.getByLabelText("用户名"), "ubuntu");
    await user.click(screen.getByRole("combobox", { name: "认证方式" }));
    await user.click(screen.getByRole("option", { name: /SSH Agent/ }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.createRemoteHostGroup).toHaveBeenCalledWith({
        name: "默认分组",
      });
      expect(mocks.remoteHostApi.createRemoteHost).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "group-default",
          host: "10.0.0.8",
          name: "default-dev",
          username: "ubuntu",
        }),
      );
    });
  });

  it("edits a profile-backed local terminal from the sidebar context menu", async () => {
    const user = userEvent.setup();
    const profile = {
      args: ["-NoLogo"],
      createdAt: "test",
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      id: "profile-pwsh",
      isDefault: true,
      name: "PowerShell 7",
      shell: "pwsh.exe",
      sortOrder: 10,
      updatedAt: "test",
    };
    mocks.profileApi.listProfiles.mockResolvedValue([profile]);

    render(<KerminalShell />);
    await waitFor(() =>
      expect(mocks.profileApi.listProfiles).toHaveBeenCalled(),
    );

    fireEvent.keyDown(window, {
      ctrlKey: true,
      key: "t",
      shiftKey: true,
    });

    const localButton = await findExpandedSidebarMachine(/PowerShell 7/);
    fireEvent.contextMenu(localButton);
    await user.click(screen.getByRole("menuitem", { name: "编辑连接配置" }));

    expect(
      await screen.findByRole("dialog", { name: "编辑连接配置" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("会话名称"), {
      target: { value: "Renamed PowerShell" },
    });
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(mocks.profileApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["-NoLogo"],
          cwd: "C:\\dev",
          env: { TERM: "xterm-256color" },
          id: "profile-pwsh",
          name: "Renamed PowerShell",
          shell: "pwsh.exe",
          sortOrder: 10,
        }),
      );
    });
    expect(
      await findExpandedSidebarMachine(/Renamed PowerShell/),
    ).toBeInTheDocument();
  });

  it("duplicates an SSH host from the sidebar context menu", async () => {
    const user = userEvent.setup();

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    fireEvent.contextMenu(hostButton);
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.createRemoteHost).toHaveBeenCalledWith({
        authType: "agent",
        credentialRef: undefined,
        groupId: "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
        host: "172.16.41.60",
        name: "172.16.41.60 副本",
        port: 22,
        production: false,
        sshOptions: testSshOptions,
        tags: ["ssh", "bbb"],
        username: "ubuntu",
      });
    });
  });

  it("moves an SSH host to another group through drag and drop", async () => {
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(
      remoteHostTreeWithTargetGroup,
    );

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    const targetSection = (await screen.findByText("工具")).closest("section");
    expect(targetSection).toBeInTheDocument();
    const restoreElementFromPoint = mockElementFromPoint(targetSection!);

    try {
      fireEvent.pointerDown(hostButton, {
        button: 0,
        clientX: 12,
        clientY: 12,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 16,
        clientY: 28,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, {
        clientX: 16,
        clientY: 28,
        pointerId: 1,
      });
    } finally {
      restoreElementFromPoint();
    }

    await waitFor(() => {
      expect(mocks.remoteHostApi.updateRemoteHost).toHaveBeenCalledWith({
        authType: "agent",
        credentialRef: undefined,
        groupId: "group-tools",
        host: "172.16.41.60",
        id: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        name: "172.16.41.60",
        port: 22,
        production: false,
        sortOrder: 10,
        sshOptions: testSshOptions,
        tags: ["ssh", "bbb"],
        username: "ubuntu",
      });
    });
  });

  it("pins a remote host group from the sidebar context menu", async () => {
    const user = userEvent.setup();
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(
      remoteHostTreeWithTargetGroup,
    );

    render(<KerminalShell />);

    const targetGroupButton = await screen.findByRole("button", {
      name: /工具/,
    });
    fireEvent.contextMenu(targetGroupButton);
    await user.click(screen.getByRole("menuitem", { name: "置顶分组" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.updateRemoteHostGroup).toHaveBeenCalledWith({
        id: "group-tools",
        name: "工具",
        sortOrder: -10,
      });
    });
  });

  it("unpins a pinned remote host group from the sidebar context menu", async () => {
    const user = userEvent.setup();
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(
      remoteHostTreeWithPinnedTargetGroup,
    );

    render(<KerminalShell />);

    const targetGroupButton = await screen.findByRole("button", {
      name: /工具/,
    });
    expect(screen.getByText("置顶")).toBeInTheDocument();
    fireEvent.contextMenu(targetGroupButton);
    await user.click(screen.getByRole("menuitem", { name: "取消置顶" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.updateRemoteHostGroup).toHaveBeenCalledWith({
        id: "group-tools",
        name: "工具",
        sortOrder: 40,
      });
    });
  });

  it("duplicates a profile-backed local terminal from the sidebar context menu", async () => {
    const user = userEvent.setup();
    const profile = {
      args: ["-NoLogo"],
      createdAt: "test",
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      id: "profile-pwsh",
      isDefault: true,
      name: "PowerShell 7",
      shell: "pwsh.exe",
      sortOrder: 10,
      updatedAt: "test",
    };
    mocks.profileApi.listProfiles.mockResolvedValue([profile]);
    mocks.profileApi.createProfile.mockResolvedValue({
      ...profile,
      id: "profile-copy",
      isDefault: false,
      name: "PowerShell 7 副本",
      sortOrder: 20,
      updatedAt: "created",
    });

    render(<KerminalShell />);
    await waitFor(() =>
      expect(mocks.profileApi.listProfiles).toHaveBeenCalled(),
    );

    fireEvent.keyDown(window, {
      ctrlKey: true,
      key: "t",
      shiftKey: true,
    });

    const localButton = await findExpandedSidebarMachine(/PowerShell 7/);
    fireEvent.contextMenu(localButton);
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    await waitFor(() => {
      expect(mocks.profileApi.createProfile).toHaveBeenCalledWith({
        args: ["-NoLogo"],
        cwd: "C:\\dev",
        env: { TERM: "xterm-256color" },
        name: "PowerShell 7 副本",
        setDefault: false,
        shell: "pwsh.exe",
        sidebarGroupId: "group-default",
      });
    });
    expect(
      await findExpandedSidebarMachine(/PowerShell 7 副本/),
    ).toBeInTheDocument();
  });
});
