import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tools } from "../../../../src/features/workspace/workspaceData";
import type { Machine, TerminalTab } from "../../../../src/features/workspace/types";
import { clearServerInfoSnapshotCacheForTest } from "../../../../src/features/tool-panel/ServerInfoToolContent";
import { ToolPanel } from "../../../../src/features/tool-panel/ToolPanel";

const portForwardApiMocks = vi.hoisted(() => ({
  closePortForward: vi.fn(),
  createPortForward: vi.fn(),
  listPortForwards: vi.fn(),
  stopPortForward: vi.fn(),
}));

const serverInfoApiMocks = vi.hoisted(() => ({
  getServerInfoSnapshot: vi.fn(),
}));
const diagnosticsApiMocks = vi.hoisted(() => ({
  createDiagnosticsBundle: vi.fn(),
  getRuntimeHealthSnapshot: vi.fn(),
}));
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

vi.mock("../../../../src/lib/portForwardApi", () => ({
  closePortForward: (...args: unknown[]) =>
    portForwardApiMocks.closePortForward(...args),
  createPortForward: (...args: unknown[]) =>
    portForwardApiMocks.createPortForward(...args),
  listPortForwards: (...args: unknown[]) =>
    portForwardApiMocks.listPortForwards(...args),
  stopPortForward: (...args: unknown[]) =>
    portForwardApiMocks.stopPortForward(...args),
}));

vi.mock("../../../../src/lib/serverInfoApi", () => ({
  getServerInfoSnapshot: (...args: unknown[]) =>
    serverInfoApiMocks.getServerInfoSnapshot(...args),
}));
vi.mock("../../../../src/lib/diagnosticsApi", () => ({
  createDiagnosticsBundle: (...args: unknown[]) =>
    diagnosticsApiMocks.createDiagnosticsBundle(...args),
  getRuntimeHealthSnapshot: (...args: unknown[]) =>
    diagnosticsApiMocks.getRuntimeHealthSnapshot(...args),
}));
vi.mock("../../../../src/lib/tmuxApi", () => ({
  tmuxAttachSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxAttachSession(...args),
  tmuxCapturePane: (...args: unknown[]) =>
    tmuxApiMocks.tmuxCapturePane(...args),
  tmuxCreateSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxCreateSession(...args),
  tmuxDetachCurrent: (...args: unknown[]) =>
    tmuxApiMocks.tmuxDetachCurrent(...args),
  tmuxKillSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxKillSession(...args),
  tmuxListPanes: (...args: unknown[]) => tmuxApiMocks.tmuxListPanes(...args),
  tmuxListSessions: (...args: unknown[]) =>
    tmuxApiMocks.tmuxListSessions(...args),
  tmuxListWindows: (...args: unknown[]) =>
    tmuxApiMocks.tmuxListWindows(...args),
  tmuxProbe: (...args: unknown[]) => tmuxApiMocks.tmuxProbe(...args),
  tmuxRenameSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxRenameSession(...args),
}));
vi.mock("../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: () => <div data-testid="monaco-editor" />,
}));

const sshMachine: Machine = {
  authType: "key",
  credentialRef: "C:/keys/prod_ed25519",
  description: "deploy@prod.internal:22",
  host: "prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  port: 22,
  production: true,
  status: "warning",
  tags: ["ssh", "prod"],
  username: "deploy",
};

const sshTerminalTab: TerminalTab = {
  id: "tab-prod-api",
  layout: { paneId: "pane-prod-api", type: "pane" },
  machineId: sshMachine.id,
  title: sshMachine.name,
};

const localMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  latencyMs: 1,
  name: "PowerShell",
  status: "online",
  tags: ["local", "dev"],
};

const containerMachine: Machine = {
  containerId: "c0ffee1234567890",
  containerName: "api",
  description: "prod api / api",
  id: "docker:prod-api:c0ffee1234567890",
  kind: "dockerContainer",
  name: "api",
  parentMachineId: "prod-api",
  runtime: "docker",
  status: "online",
  tags: ["container", "docker"],
  target: {
    containerId: "c0ffee1234567890",
    containerName: "api",
    hostId: "prod-api",
    kind: "dockerContainer",
    runtime: "docker",
    workdir: "/app",
  },
};

describe("ToolPanel", () => {
  beforeEach(() => {
    clearServerInfoSnapshotCacheForTest();
    portForwardApiMocks.closePortForward.mockReset();
    portForwardApiMocks.createPortForward.mockReset();
    portForwardApiMocks.listPortForwards.mockReset();
    portForwardApiMocks.stopPortForward.mockReset();
    portForwardApiMocks.listPortForwards.mockResolvedValue([]);
    portForwardApiMocks.createPortForward.mockResolvedValue({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "prod-api",
      hostName: "prod api",
      id: "forward-new",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });
    portForwardApiMocks.closePortForward.mockResolvedValue(true);
    portForwardApiMocks.stopPortForward.mockResolvedValue(true);
    serverInfoApiMocks.getServerInfoSnapshot.mockReset();
    serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValue({
      architecture: "x86_64",
      capturedAt: "1",
      cpuCount: 4,
      cpuCoreUsagePercents: [9.5, 17.25, 0, 22.75],
      cpuModel: "AMD EPYC 7B13",
      cpuUsagePercent: 12.4,
      diskMount: "/",
      diskTotalBytes: 64 * 1024 * 1024 * 1024,
      diskUsedBytes: 16 * 1024 * 1024 * 1024,
      disks: [
        {
          availableBytes: 48 * 1024 * 1024 * 1024,
          filesystem: "/dev/sda1",
          mount: "/",
          totalBytes: 64 * 1024 * 1024 * 1024,
          usedBytes: 16 * 1024 * 1024 * 1024,
        },
      ],
      gpus: [
        {
          driverVersion: "555.42",
          memoryTotalBytes: 24 * 1024 * 1024 * 1024,
          memoryUsedBytes: 6 * 1024 * 1024 * 1024,
          name: "NVIDIA RTX 4090",
          temperatureCelsius: 54,
          utilizationPercent: 36.5,
          vendor: "NVIDIA",
        },
      ],
      gpuProbeStatus: "nvidia_smi",
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
      kernel: "6.8.0",
      loadAverage: [0.1, 0.2, 0.3],
      memoryTotalBytes: 8 * 1024 * 1024 * 1024,
      memoryUsedBytes: 4 * 1024 * 1024 * 1024,
      memoryBuffersBytes: 256 * 1024 * 1024,
      memoryCachedBytes: 1024 * 1024 * 1024,
      networkInterfaces: [
        {
          name: "eth0",
          rxBytes: 1024,
          txBytes: 2048,
        },
      ],
      networkRxBytes: 1024,
      networkTxBytes: 2048,
      os: "Linux",
      port: 22,
      processCount: 154,
      runningProcessCount: 3,
      swapTotalBytes: 2 * 1024 * 1024 * 1024,
      swapUsedBytes: 0,
      topProcesses: [
        {
          cpuUsagePercent: 8.2,
          memoryBytes: 73_400_320,
          memoryPercent: 1.4,
          name: "kerminal-agent",
          pid: 101,
        },
      ],
      uptimeSeconds: 90_000,
      username: "deploy",
    });
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockReset();
    diagnosticsApiMocks.createDiagnosticsBundle.mockReset();
    diagnosticsApiMocks.createDiagnosticsBundle.mockResolvedValue({
      bytesWritten: 2048,
      createdAt: "1710000000",
      fileName: "diagnostics-1710000000.json",
      id: "diagnostics-1",
      path: "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
      redacted: true,
      sections: ["app", "paths"],
    });
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockResolvedValue({
      capturedAt: "1",
      process: {
        cpuUsagePercent: 3.6,
        diskReadBytes: 1024,
        diskWrittenBytes: 2048,
        memoryBytes: 186 * 1024 * 1024,
        name: "kerminal",
        pid: 1425,
        startedAtSeconds: 1,
        uptimeSeconds: 1840,
        virtualMemoryBytes: 520 * 1024 * 1024,
      },
      redacted: true,
      sampling: {
        cpuRefreshedTwice: true,
        cpuSampleIntervalMs: 200,
        source: "sysinfo",
      },
      storage: {
        appLogFile: "C:/Users/me/.kerminal/logs/kerminal.log",
        appLogFileSizeBytes: 64 * 1024,
        appLogMaxFileSizeBytes: 1_000_000,
        appLogRotationKeepFiles: 5,
        commandDatabaseFile: "C:/Users/me/.kerminal/data/command.sqlite",
        commandDatabaseFileSizeBytes: 768 * 1024,
        diagnostics: "C:/Users/me/.kerminal/diagnostics",
        logs: "C:/Users/me/.kerminal/logs",
        root: "C:/Users/me/.kerminal",
        rootSizeBytes: 16 * 1024 * 1024,
      },
      system: {
        arch: "x86_64",
        availableMemoryBytes: 9 * 1024 * 1024 * 1024,
        bootTimeSeconds: 1,
        cpuCoreUsagePercents: [10.4, 15.6, 10.9, 12.7],
        cpuCount: 4,
        globalCpuUsagePercent: 18.4,
        gpus: [
          {
            driverVersion: "preview",
            memoryTotalBytes: 8 * 1024 * 1024 * 1024,
            memoryUsedBytes: 2 * 1024 * 1024 * 1024,
            name: "NVIDIA GeForce RTX 4060",
            temperatureCelsius: 48,
            utilizationPercent: 22.5,
            vendor: "NVIDIA",
          },
        ],
        hostName: "devbox",
        kernelVersion: "10",
        os: "Windows",
        osVersion: "11",
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        totalSwapBytes: 2 * 1024 * 1024 * 1024,
        uptimeSeconds: 86_400,
        usedMemoryBytes: 7 * 1024 * 1024 * 1024,
        usedSwapBytes: 256 * 1024 * 1024,
      },
    });
    tmuxApiMocks.tmuxProbe.mockReset();
    tmuxApiMocks.tmuxProbe.mockResolvedValue({
      available: true,
      target: { kind: "ssh", hostId: "prod-api" },
      targetRef: "ssh:prod-api",
      version: "tmux 3.4",
    });
    tmuxApiMocks.tmuxListSessions.mockReset();
    tmuxApiMocks.tmuxListSessions.mockResolvedValue([]);
    tmuxApiMocks.tmuxListWindows.mockReset();
    tmuxApiMocks.tmuxListWindows.mockResolvedValue([]);
    tmuxApiMocks.tmuxListPanes.mockReset();
    tmuxApiMocks.tmuxListPanes.mockResolvedValue([]);
    tmuxApiMocks.tmuxCapturePane.mockReset();
    tmuxApiMocks.tmuxCapturePane.mockResolvedValue({
      lines: 0,
      paneId: "%0",
      text: "",
      truncated: false,
    });
    tmuxApiMocks.tmuxAttachSession.mockReset();
    tmuxApiMocks.tmuxCreateSession.mockReset();
    tmuxApiMocks.tmuxDetachCurrent.mockReset();
    tmuxApiMocks.tmuxKillSession.mockReset();
    tmuxApiMocks.tmuxRenameSession.mockReset();
  });

  it("renders only the rail when no tool drawer is active", () => {
    render(
      <ToolPanel
        activeTool={null}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "工具面板" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "打开 Agent Launcher" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Agent Launcher" }),
    ).not.toBeInTheDocument();
  });

  it("renders the active Agent Launcher tool", async () => {
    render(
      <ToolPanel
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "工具面板" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole(
        "button",
        { name: "Open Codex" },
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Claude" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Custom Agent" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("历史会话")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Agent 栈：rig-core、rmcp/i),
    ).not.toBeInTheDocument();
  }, 20000);

  it("requests a tool switch from the rail", async () => {
    const user = userEvent.setup();
    const onActiveToolChange = vi.fn();

    render(
      <ToolPanel
        activeTool="agentLauncher"
        onActiveToolChange={onActiveToolChange}
        tools={tools}
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开 文件" }));

    expect(onActiveToolChange).toHaveBeenCalledWith("sftp");
  });

  it("opens the tmux tool from the rail", async () => {
    const user = userEvent.setup();
    const onActiveToolChange = vi.fn();

    const { rerender } = render(
      <ToolPanel
        activeTool={null}
        activeMachine={sshMachine}
        activeTab={sshTerminalTab}
        onActiveToolChange={onActiveToolChange}
        tools={tools}
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开 tmux" }));
    expect(onActiveToolChange).toHaveBeenCalledWith("tmux");

    rerender(
      <ToolPanel
        activeTool="tmux"
        activeMachine={sshMachine}
        activeTab={sshTerminalTab}
        onActiveToolChange={onActiveToolChange}
        tools={tools}
      />,
    );

    expect(await screen.findByText("tmux 3.4")).toBeInTheDocument();
    expect(screen.getByText("no sessions")).toBeInTheDocument();
  });

  it("shows the diagnostics bundle action on the logs title row", async () => {
    const user = userEvent.setup();

    render(
      <ToolPanel
        activeTool="logs"
        activeMachine={localMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    const logsTitle = screen.getByRole("heading", { name: "日志" });
    const header = logsTitle.closest("header");
    expect(header).toBeInTheDocument();
    const createBundleButton = within(header as HTMLElement).getByRole(
      "button",
      { name: "生成诊断包" },
    );
    expect(createBundleButton).toBeInTheDocument();
    await user.hover(createBundleButton);
    expect(
      await screen.findByRole("tooltip", { name: "生成诊断包" }),
    ).toBeInTheDocument();

    await user.click(createBundleButton);

    expect(
      await screen.findByRole("status", { name: "诊断包生成结果" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
      ),
    ).toBeInTheDocument();
  });

  it("does not render settings content inside the right tool panel", async () => {
    render(
      <ToolPanel
        activeTool="settings"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      await screen.findByRole(
        "button",
        { name: "Open Codex" },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("终端外观")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 设置" }),
    ).not.toBeInTheDocument();
  });

  it("shows local runtime system metrics for local machines", async () => {
    render(
      <ToolPanel
        activeTool="system"
        activeMachine={localMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("本机运行体验")).toBeInTheDocument();
    expect(screen.queryByText("远程服务器")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "展开CPU详情" }),
    ).toBeInTheDocument();
    expect(serverInfoApiMocks.getServerInfoSnapshot).not.toHaveBeenCalled();
  });

  it("loads and refreshes system metrics for the active SSH host", async () => {
    const user = userEvent.setup();

    render(
      <ToolPanel
        activeTool="system"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("prod-api-01")).toBeInTheDocument();
    expect(screen.queryByText("本机运行体验")).not.toBeInTheDocument();
    expect(
      screen.queryByText("NVIDIA GeForce RTX 4060"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("内存").length).toBeGreaterThan(0);
    expect(screen.getByText("磁盘")).toBeInTheDocument();
    expect(screen.getByText("进程")).toBeInTheDocument();
    const intervalSelect = screen.getByRole("combobox", {
      name: "服务器信息采集间隔",
    });
    expect(intervalSelect).toHaveAttribute("aria-valuetext", "3s");
    await user.click(intervalSelect);
    expect(screen.getByRole("option", { name: "手动" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "手动" }));
    expect(intervalSelect).toHaveAttribute("aria-valuetext", "手动");
    expect(
      screen.getByRole("button", { name: "展开CPU详情" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "展开网络详情" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("等待采样").length).toBeGreaterThan(0);
    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "prod-api",
      target: {
        hostId: "prod-api",
        kind: "ssh",
      },
    });

    await user.click(screen.getByRole("button", { name: "展开CPU详情" }));
    expect(
      screen.getByRole("button", { name: "收起CPU详情" }),
    ).toBeInTheDocument();
    expect(screen.getByText("核心数")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getByText("17.3%")).toBeInTheDocument();
    expect(screen.getByText("AMD EPYC 7B13")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开GPU详情" }));
    expect(screen.getAllByText("NVIDIA RTX 4090").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "展开网络详情" }));
    expect(screen.getAllByText("上行").length).toBeGreaterThan(0);
    expect(screen.getAllByText("下行").length).toBeGreaterThan(0);
    expect(screen.getByText("等待下一次采集")).toBeInTheDocument();
    expect(screen.getAllByText("eth0").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "展开进程详情" }));
    expect(screen.getByText("kerminal-agent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "刷新服务器信息" }));

    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledTimes(2);
  });

  it("shows primary network rates and expands all network interfaces", async () => {
    const user = userEvent.setup();
    serverInfoApiMocks.getServerInfoSnapshot
      .mockResolvedValueOnce({
        architecture: "x86_64",
        capturedAt: "10",
        cpuCount: 4,
        diskMount: "/",
        host: "prod.internal",
        hostId: "prod-api",
        hostName: "prod api",
        hostname: "prod-api-01",
        memoryTotalBytes: 8 * 1024 * 1024 * 1024,
        memoryUsedBytes: 4 * 1024 * 1024 * 1024,
        networkInterfaces: [
          {
            name: "lo",
            rxBytes: 1_000_000,
            txBytes: 1_000_000,
          },
          {
            name: "eth0",
            rxBytes: 10 * 1024,
            txBytes: 5 * 1024,
          },
          {
            name: "tailscale0",
            rxBytes: 2 * 1024,
            txBytes: 1024,
          },
        ],
        networkRxBytes: 1_012_288,
        networkTxBytes: 1_006_144,
        os: "Linux",
        port: 22,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        uptimeSeconds: 90_000,
        username: "deploy",
      })
      .mockResolvedValueOnce({
        architecture: "x86_64",
        capturedAt: "13",
        cpuCount: 4,
        diskMount: "/",
        host: "prod.internal",
        hostId: "prod-api",
        hostName: "prod api",
        hostname: "prod-api-01",
        memoryTotalBytes: 8 * 1024 * 1024 * 1024,
        memoryUsedBytes: 4 * 1024 * 1024 * 1024,
        networkInterfaces: [
          {
            name: "lo",
            rxBytes: 1_000_000,
            txBytes: 1_000_000,
          },
          {
            name: "eth0",
            rxBytes: 16 * 1024,
            txBytes: 8 * 1024,
          },
          {
            name: "tailscale0",
            rxBytes: 5 * 1024,
            txBytes: 2_560,
          },
        ],
        networkRxBytes: 1_021_504,
        networkTxBytes: 1_010_752,
        os: "Linux",
        port: 22,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        uptimeSeconds: 90_003,
        username: "deploy",
      });

    render(
      <ToolPanel
        activeTool="system"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("prod-api-01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新服务器信息" }));
    await waitFor(() => {
      expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledTimes(2);
    });

    expect(
      screen.getByText("流量排行 eth0 · 3 个接口 · 3.0s采样"),
    ).toBeInTheDocument();
    expect(screen.getByText("eth0")).toBeInTheDocument();
    expect(screen.getAllByText("1.0 KB/s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2.0 KB/s").length).toBeGreaterThan(0);
    expect(screen.queryByText("lo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开网络详情" }));
    expect(screen.getAllByText("eth0").length).toBeGreaterThan(0);
    expect(screen.getByText("lo")).toBeInTheDocument();
    expect(screen.getByText("tailscale0")).toBeInTheDocument();
    expect(screen.getAllByText("流量排行 #1").length).toBeGreaterThan(0);
    expect(screen.queryByText("主网卡")).not.toBeInTheDocument();
  });

  it("renders nullable SSH system metrics without crashing", async () => {
    serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
      architecture: null,
      capturedAt: "1",
      cpuCount: null,
      cpuCoreUsagePercents: null,
      cpuUsagePercent: null,
      diskMount: null,
      diskTotalBytes: null,
      diskUsedBytes: null,
      gpus: null,
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: null,
      kernel: null,
      loadAverage: null,
      memoryTotalBytes: null,
      memoryUsedBytes: null,
      networkRxBytes: null,
      networkTxBytes: null,
      os: null,
      port: 22,
      swapTotalBytes: null,
      swapUsedBytes: null,
      uptimeSeconds: null,
      username: "deploy",
    });

    render(
      <ToolPanel
        activeTool="system"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("远程服务器")).toBeInTheDocument();
    await waitFor(() => {
      expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
        hostId: "prod-api",
        target: {
          hostId: "prod-api",
          kind: "ssh",
        },
      });
    });
    expect(screen.queryByText("系统加载失败")).not.toBeInTheDocument();
    expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("loads system metrics from the active container target", async () => {
    render(
      <ToolPanel
        activeTool="system"
        activeMachine={containerMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("容器系统")).toBeInTheDocument();
    expect(screen.queryByText("本机运行体验")).not.toBeInTheDocument();
    expect(screen.getByText("api · docker @ prod-api")).toBeInTheDocument();
    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "prod-api",
      target: {
        containerId: "c0ffee1234567890",
        containerName: "api",
        hostId: "prod-api",
        kind: "dockerContainer",
        runtime: "docker",
        workdir: "/app",
      },
    });
  });

  it("shows zero GPUs while keeping the empty GPU details aligned", async () => {
    serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
      capturedAt: "1",
      gpus: [],
      gpuProbeStatus: "nvidia_smi_no_devices",
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
      port: 22,
      username: "deploy",
    });

    render(
      <ToolPanel
        activeTool="system"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("0 张")).toBeInTheDocument();
    expect(screen.getByText("0 张显卡")).toBeInTheDocument();
    const gpuToggle = screen.getByRole("button", { name: "展开GPU详情" });
    await userEvent.click(gpuToggle);
    expect(
      screen.getByRole("button", { name: "收起GPU详情" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/NVIDIA-SMI has failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/未返回可用 NVIDIA GPU/)).not.toBeInTheDocument();
  });

  it("renders lspci GPU fallback devices without utilization", async () => {
    serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
      architecture: "x86_64",
      capturedAt: "1",
      cpuCount: 8,
      cpuCoreUsagePercents: [11, 12, 13, 14, 15, 16, 17, 18],
      cpuUsagePercent: 14.5,
      diskMount: "/",
      diskTotalBytes: 64 * 1024 * 1024 * 1024,
      diskUsedBytes: 16 * 1024 * 1024 * 1024,
      gpus: [
        {
          name: "Intel Corporation UHD Graphics",
        },
      ],
      gpuProbeStatus: "lspci",
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
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
      username: "deploy",
    });
    const user = userEvent.setup();

    render(
      <ToolPanel
        activeTool="system"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("1 张设备，仅静态识别")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开GPU详情" }));
    expect(
      screen.getByText("Intel Corporation UHD Graphics"),
    ).toBeInTheDocument();
    expect(screen.getByText("暂无 GPU 使用率或显存。")).toBeInTheDocument();
  });

  it("renders nvidia-smi list fallback devices without treating them as missing", async () => {
    serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValueOnce({
      architecture: "x86_64",
      capturedAt: "1",
      cpuCount: 8,
      cpuCoreUsagePercents: [11, 12, 13, 14, 15, 16, 17, 18],
      cpuUsagePercent: 14.5,
      diskMount: "/",
      diskTotalBytes: 64 * 1024 * 1024 * 1024,
      diskUsedBytes: 16 * 1024 * 1024 * 1024,
      gpus: [
        {
          name: "NVIDIA RTX 4500 Ada Generation",
          vendor: "NVIDIA",
        },
      ],
      gpuProbeStatus: "nvidia_smi_list",
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
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
      username: "deploy",
    });
    const user = userEvent.setup();

    render(
      <ToolPanel
        activeTool="system"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("1 张设备，仅静态识别")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开GPU详情" }));
    expect(
      screen.getByText("NVIDIA RTX 4500 Ada Generation"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/未返回可用 NVIDIA GPU/)).not.toBeInTheDocument();
  });

  it("shows an empty SFTP state for non SSH machines", async () => {
    render(
      <ToolPanel
        activeTool="sftp"
        activeMachine={localMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      await screen.findByText("远程文件浏览", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/连接 SSH 主机或容器后显示文件/),
    ).toBeInTheDocument();
  });

  it("renders the shared remote file panel for an active container machine", async () => {
    render(
      <ToolPanel
        activeTool="sftp"
        activeMachine={containerMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      await screen.findByText("docker:prod-api:api", undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("package.json", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("SFTP 文件浏览")).not.toBeInTheDocument();
  });

  it("shows an empty port forwarding state for non SSH machines", async () => {
    render(
      <ToolPanel
        activeTool="ports"
        activeMachine={localMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.getByText(/请选择 SSH 主机/)).toBeInTheDocument();
  });

  it("creates and stops a local port forward for the active SSH host", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          bindHost: "127.0.0.1",
          createdAt: "1",
          hostId: "prod-api",
          hostName: "prod api",
          id: "forward-1",
          kind: "local",
          name: "PostgreSQL 隧道",
          sourcePort: 15432,
          status: "running",
          targetHost: "127.0.0.1",
          targetPort: 5432,
        },
      ])
      .mockResolvedValueOnce([]);
    portForwardApiMocks.createPortForward.mockResolvedValueOnce({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "prod-api",
      hostName: "prod api",
      id: "forward-1",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });

    render(
      <ToolPanel
        activeTool="ports"
        activeMachine={sshMachine}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    await user.click(
      await screen.findByRole(
        "button",
        { name: "添加隧道" },
        { timeout: 5000 },
      ),
    );
    await user.type(await screen.findByLabelText("名称"), "PostgreSQL 隧道");
    await user.click(screen.getByRole("button", { name: "开启隧道" }));

    expect(portForwardApiMocks.createPortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        bindHost: "127.0.0.1",
        hostId: "prod-api",
        kind: "local",
        name: "PostgreSQL 隧道",
        sourcePort: 15432,
        targetHost: "127.0.0.1",
        targetPort: 5432,
      }),
    );
    expect(await screen.findByText("PostgreSQL 隧道")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止" }));

    expect(portForwardApiMocks.stopPortForward).toHaveBeenCalledWith(
      "forward-1",
    );
  });
});
