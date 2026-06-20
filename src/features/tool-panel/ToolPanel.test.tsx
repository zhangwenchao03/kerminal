import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tools } from "../workspace/workspaceData";
import type { Machine } from "../workspace/types";
import { clearServerInfoSnapshotCacheForTest } from "./ServerInfoToolContent";
import { ToolPanel } from "./ToolPanel";

const portForwardApiMocks = vi.hoisted(() => ({
  closePortForward: vi.fn(),
  createPortForward: vi.fn(),
  listPortForwards: vi.fn(),
}));

const serverInfoApiMocks = vi.hoisted(() => ({
  getServerInfoSnapshot: vi.fn(),
}));
const diagnosticsApiMocks = vi.hoisted(() => ({
  getRuntimeHealthSnapshot: vi.fn(),
}));
const aiContextApiMocks = vi.hoisted(() => ({
  getAiTerminalContextSnapshot: vi.fn(),
}));

vi.mock("../../lib/portForwardApi", () => ({
  closePortForward: (...args: unknown[]) =>
    portForwardApiMocks.closePortForward(...args),
  createPortForward: (...args: unknown[]) =>
    portForwardApiMocks.createPortForward(...args),
  listPortForwards: (...args: unknown[]) =>
    portForwardApiMocks.listPortForwards(...args),
}));

vi.mock("../../lib/serverInfoApi", () => ({
  getServerInfoSnapshot: (...args: unknown[]) =>
    serverInfoApiMocks.getServerInfoSnapshot(...args),
}));
vi.mock("../../lib/diagnosticsApi", () => ({
  getRuntimeHealthSnapshot: (...args: unknown[]) =>
    diagnosticsApiMocks.getRuntimeHealthSnapshot(...args),
}));
vi.mock("../../lib/aiContextApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiContextApi")>(
    "../../lib/aiContextApi",
  );
  return {
    ...actual,
    getAiTerminalContextSnapshot:
      aiContextApiMocks.getAiTerminalContextSnapshot,
  };
});
vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="monaco-editor" />,
}));
vi.mock("../../lib/monacoSetup", () => ({}));

const sshMachine: Machine = {
  authType: "key",
  credentialRef: "credential:ssh/prod",
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
        databaseFile: "C:/Users/me/.kerminal/kerminal.db",
        databaseFileSizeBytes: 768 * 1024,
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
    aiContextApiMocks.getAiTerminalContextSnapshot.mockReset();
    aiContextApiMocks.getAiTerminalContextSnapshot.mockResolvedValue({
      generatedAt: "1",
      output: {
        capturedBytes: 16,
        data: "浏览器预览模式",
        maxBytes: 12288,
        truncated: false,
      },
      policy: {
        includesFullHistory: false,
        includesRecentOutput: true,
        maxOutputBytes: 12288,
        mode: "currentTerminal",
        secretRedaction: true,
      },
      redacted: false,
      session: {
        cols: 80,
        id: "session-1",
        rows: 24,
        shell: "browser-preview",
        status: "running",
      },
      source: {
        paneId: "pane-1",
        paneTitle: "本地 PowerShell",
      },
    });
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
    expect(screen.getByRole("button", { name: "打开 Kerminal Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kerminal Agent" })).not.toBeInTheDocument();
  });

  it("renders the active AI tool as a chat assistant", async () => {
    const user = userEvent.setup();

    render(
      <ToolPanel
        activeTool="ai"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "工具面板" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole(
        "heading",
        { name: "Kerminal Agent" },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("历史会话")).not.toBeInTheDocument();
    expect(
      screen.getByText("描述你想做什么，Kerminal Agent 会结合当前应用上下文和终端状态协助你。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看历史会话" }));
    expect(screen.getByText("历史会话")).toBeInTheDocument();
    expect(screen.queryByText(/Agent 栈：rig-core、rmcp/i)).not.toBeInTheDocument();
  });

  it("requests a tool switch from the rail", async () => {
    const user = userEvent.setup();
    const onActiveToolChange = vi.fn();

    render(
      <ToolPanel
        activeTool="ai"
        onActiveToolChange={onActiveToolChange}
        tools={tools}
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开 文件" }));

    expect(onActiveToolChange).toHaveBeenCalledWith("sftp");
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
        "heading",
        { name: "Kerminal Agent" },
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
        onActiveToolChange={vi.fn()}
        selectedMachine={localMachine}
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

  it("loads and refreshes system metrics for the selected SSH host", async () => {
    const user = userEvent.setup();

    render(
      <ToolPanel
        activeTool="system"
        onActiveToolChange={vi.fn()}
        selectedMachine={sshMachine}
        tools={tools}
      />,
    );

    expect(await screen.findByText("prod-api-01")).toBeInTheDocument();
    expect(screen.queryByText("本机运行体验")).not.toBeInTheDocument();
    expect(screen.queryByText("NVIDIA GeForce RTX 4060")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "展开CPU详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开网络详情" })).toBeInTheDocument();
    expect(screen.getAllByText("等待采样").length).toBeGreaterThan(0);
    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "prod-api",
      target: {
        hostId: "prod-api",
        kind: "ssh",
      },
    });

    await user.click(screen.getByRole("button", { name: "展开CPU详情" }));
    expect(screen.getByRole("button", { name: "收起CPU详情" })).toBeInTheDocument();
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
        onActiveToolChange={vi.fn()}
        selectedMachine={sshMachine}
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
        onActiveToolChange={vi.fn()}
        selectedMachine={sshMachine}
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

  it("loads system metrics from the selected container target", async () => {
    render(
      <ToolPanel
        activeTool="system"
        onActiveToolChange={vi.fn()}
        selectedMachine={containerMachine}
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
        onActiveToolChange={vi.fn()}
        selectedMachine={sshMachine}
        tools={tools}
      />,
    );

    expect(await screen.findByText("1 张设备，仅静态识别")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开GPU详情" }));
    expect(screen.getByText("Intel Corporation UHD Graphics")).toBeInTheDocument();
    expect(screen.getByText("暂未采集到可绘制的 GPU 使用率或显存占用。")).toBeInTheDocument();
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
        onActiveToolChange={vi.fn()}
        selectedMachine={sshMachine}
        tools={tools}
      />,
    );

    expect(await screen.findByText("1 张设备，仅静态识别")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开GPU详情" }));
    expect(screen.getByText("NVIDIA RTX 4500 Ada Generation")).toBeInTheDocument();
    expect(screen.queryByText(/未返回可用 NVIDIA GPU/)).not.toBeInTheDocument();
  });

  it("shows an empty SFTP state for non SSH machines", async () => {
    render(
      <ToolPanel
        activeTool="sftp"
        onActiveToolChange={vi.fn()}
        selectedMachine={localMachine}
        tools={tools}
      />,
    );

    expect(await screen.findByText("远程文件浏览")).toBeInTheDocument();
    expect(
      screen.getByText(/当前终端连接到 SSH 主机或容器后/),
    ).toBeInTheDocument();
  });

  it("renders the shared remote file panel for a selected container machine", async () => {
    render(
      <ToolPanel
        activeTool="sftp"
        onActiveToolChange={vi.fn()}
        selectedMachine={containerMachine}
        tools={tools}
      />,
    );

    expect(await screen.findByText("docker:prod-api:api")).toBeInTheDocument();
    expect(await screen.findByText("package.json")).toBeInTheDocument();
    expect(screen.queryByText("SFTP 文件浏览")).not.toBeInTheDocument();
  });

  it("shows an empty port forwarding state for non SSH machines", async () => {
    render(
      <ToolPanel
        activeTool="ports"
        onActiveToolChange={vi.fn()}
        selectedMachine={localMachine}
        tools={tools}
      />,
    );

    expect(await screen.findByText("端口转发")).toBeInTheDocument();
    expect(
      screen.getByText(/当前终端连接到 SSH 主机后/),
    ).toBeInTheDocument();
  });

  it("creates and stops a local port forward for the selected SSH host", async () => {
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

    render(
      <ToolPanel
        activeTool="ports"
        onActiveToolChange={vi.fn()}
        selectedMachine={sshMachine}
        tools={tools}
      />,
    );

    await user.type(await screen.findByLabelText("名称"), "PostgreSQL 隧道");
    await user.click(screen.getByRole("button", { name: "创建转发" }));

    expect(portForwardApiMocks.createPortForward).toHaveBeenCalledWith({
      bindHost: "127.0.0.1",
      hostId: "prod-api",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });
    expect(await screen.findByText("PostgreSQL 隧道")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止转发" }));

    expect(portForwardApiMocks.closePortForward).toHaveBeenCalledWith("forward-1");
  });

});
