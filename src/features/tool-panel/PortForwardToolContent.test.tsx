import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortForwardSummary } from "../../lib/portForwardApi";
import type { Machine, TerminalPane } from "../workspace/types";
import { PortForwardToolContent } from "./PortForwardToolContent";

const portForwardApiMocks = vi.hoisted(() => ({
  createPortForward: vi.fn(),
  deletePortForward: vi.fn(),
  listPortForwards: vi.fn(),
  startPortForward: vi.fn(),
  stopPortForward: vi.fn(),
}));

const terminalRegistryMocks = vi.hoisted(() => ({
  writePaneCommand: vi.fn(),
}));

const proxyAutoInjectionMocks = vi.hoisted(() => {
  const state = new Map<string, { sessionId: string }>();
  return {
    clearHostNetworkAssistAutoInjection: vi.fn(
      (hostId: string, _sessionId?: string) => state.delete(hostId),
    ),
    getHostNetworkAssistAutoInjection: vi.fn((hostId: string) =>
      state.get(hostId),
    ),
    isHostNetworkAssistAutoInjectionEnabled: vi.fn(
      ({ hostId, sessionId }: { hostId: string; sessionId: string }) =>
        state.get(hostId)?.sessionId === sessionId,
    ),
    reset: () => {
      state.clear();
    },
    setHostNetworkAssistAutoInjection: vi.fn(
      (injection: { hostId: string; sessionId: string }) => {
        state.set(injection.hostId, injection);
      },
    ),
  };
});

vi.mock("../../lib/portForwardApi", () => ({
  createPortForward: (...args: unknown[]) =>
    portForwardApiMocks.createPortForward(...args),
  deletePortForward: (...args: unknown[]) =>
    portForwardApiMocks.deletePortForward(...args),
  listPortForwards: (...args: unknown[]) =>
    portForwardApiMocks.listPortForwards(...args),
  startPortForward: (...args: unknown[]) =>
    portForwardApiMocks.startPortForward(...args),
  stopPortForward: (...args: unknown[]) =>
    portForwardApiMocks.stopPortForward(...args),
}));

vi.mock("../terminal/terminalSessionRegistry", () => ({
  writePaneCommand: (...args: unknown[]) =>
    terminalRegistryMocks.writePaneCommand(...args),
}));

vi.mock("../terminal/terminalProxyAutoInjection", () => ({
  clearHostNetworkAssistAutoInjection: (hostId: string, sessionId?: string) =>
    proxyAutoInjectionMocks.clearHostNetworkAssistAutoInjection(
      hostId,
      sessionId,
    ),
  getHostNetworkAssistAutoInjection: (hostId: string) =>
    proxyAutoInjectionMocks.getHostNetworkAssistAutoInjection(hostId),
  isHostNetworkAssistAutoInjectionEnabled: (request: {
    hostId: string;
    sessionId: string;
  }) => proxyAutoInjectionMocks.isHostNetworkAssistAutoInjectionEnabled(request),
  setHostNetworkAssistAutoInjection: (injection: {
    hostId: string;
    sessionId: string;
  }) => proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection(injection),
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

const localMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  name: "PowerShell",
  status: "online",
  tags: ["local"],
};

const focusedSshPane: TerminalPane = {
  id: "pane-prod",
  lines: [],
  machineId: "prod-api",
  mode: "ssh",
  prompt: "$",
  remoteHostId: "prod-api",
  status: "online",
  title: "prod api",
};

function networkAssistSession(
  overrides: Partial<PortForwardSummary> = {},
): PortForwardSummary {
  return {
    bindHost: "127.0.0.1",
    createdAt: "1",
    hostId: "prod-api",
    hostName: "prod api",
    id: "forward-network",
    kind: "remote",
    name: "主机网络助手",
    origin: "networkAssist",
    proxyProtocol: "http",
    proxyUrl: "http://127.0.0.1:18080",
    purpose: "hostNetworkAssist",
    remoteBindHost: "127.0.0.1",
    sourcePort: 18080,
    status: "running",
    targetHost: "127.0.0.1",
    targetPort: 18081,
    ...overrides,
  };
}

describe("PortForwardToolContent", () => {
  beforeEach(() => {
    portForwardApiMocks.createPortForward.mockReset();
    portForwardApiMocks.deletePortForward.mockReset();
    portForwardApiMocks.listPortForwards.mockReset();
    portForwardApiMocks.listPortForwards.mockResolvedValue([]);
    portForwardApiMocks.startPortForward.mockReset();
    portForwardApiMocks.startPortForward.mockResolvedValue(networkAssistSession());
    portForwardApiMocks.stopPortForward.mockReset();
    portForwardApiMocks.stopPortForward.mockResolvedValue(true);
    terminalRegistryMocks.writePaneCommand.mockReset();
    terminalRegistryMocks.writePaneCommand.mockResolvedValue({
      paneId: "pane-prod",
      sent: true,
    });
    proxyAutoInjectionMocks.reset();
    proxyAutoInjectionMocks.clearHostNetworkAssistAutoInjection.mockClear();
    proxyAutoInjectionMocks.getHostNetworkAssistAutoInjection.mockClear();
    proxyAutoInjectionMocks.isHostNetworkAssistAutoInjectionEnabled.mockClear();
    proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection.mockClear();
  });

  it("switches scenarios and keeps fields owned by host or local endpoints", async () => {
    const user = userEvent.setup();
    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.queryByLabelText("主机目标地址")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加隧道" }));

    expect(
      await screen.findByRole("dialog", { name: "添加 SSH 隧道" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("主机目标地址"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("本机监听端口")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /暴露本机服务/ }));

    expect(screen.getByText("主机监听")).toBeInTheDocument();
    expect(screen.getByLabelText("主机监听端口")).toBeInTheDocument();
    expect(screen.getByLabelText("本机目标地址")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /主机使用本机网络/ }));

    expect(
      screen.getByRole("button", { name: "HTTP_PROXY" }),
    ).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:18080")).toBeInTheDocument();
    expect(screen.getByText("网络助手注入命令")).toBeInTheDocument();
  });

  it("creates a tunnel from the add dialog and closes the dialog", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.createPortForward.mockResolvedValue({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "prod-api",
      hostName: "prod api",
      id: "forward-created",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "添加隧道" }));
    await user.type(screen.getByLabelText("名称"), "PostgreSQL 隧道");
    await user.click(screen.getByRole("button", { name: "开启隧道" }));

    await waitFor(() =>
      expect(portForwardApiMocks.createPortForward).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "prod-api",
          kind: "local",
          name: "PostgreSQL 隧道",
          sourcePort: 15432,
          targetPort: 5432,
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "添加 SSH 隧道" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("隧道会话已创建。")).toBeInTheDocument();
  });

  it("filters sessions to the selected SSH host", async () => {
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession({ id: "forward-prod", name: "Prod proxy" }),
      networkAssistSession({
        hostId: "stage-api",
        id: "forward-stage",
        name: "Stage proxy",
      }),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("Prod proxy")).toBeInTheDocument();
    expect(screen.getByText(/用户级配置脚本只写当前远端用户 home/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制配置脚本" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制撤销脚本" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Stage proxy")).not.toBeInTheDocument();
  });

  it("injects HTTP proxy exports into the focused same-host SSH pane", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(
      <PortForwardToolContent
        focusedPane={focusedSshPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "注入代理环境" }));

    await waitFor(() =>
      expect(terminalRegistryMocks.writePaneCommand).toHaveBeenCalledWith({
        command: expect.stringContaining("HTTP_PROXY='http://127.0.0.1:18080'"),
        paneId: "pane-prod",
        source: "tool",
      }),
    );
  });

  it("disables current-pane injection when the focused SSH pane belongs to a different host", async () => {
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(
      <PortForwardToolContent
        focusedPane={{
          ...focusedSshPane,
          machineId: "stage-api",
          remoteHostId: "stage-api",
        }}
        selectedMachine={sshMachine}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "注入代理环境" }),
    ).toBeDisabled();
  });

  it("toggles later same-host SSH terminals auto-use for a network assist session", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    const enableButton = await screen.findByRole("button", {
      name: "新终端自动使用",
    });
    await user.click(enableButton);

    expect(
      proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "prod-api",
        proxyUrl: "http://127.0.0.1:18080",
        sessionId: "forward-network",
      }),
    );
    expect(
      screen.getByRole("button", { name: "关闭新终端自动使用" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "关闭新终端自动使用" }),
    );

    expect(
      proxyAutoInjectionMocks.clearHostNetworkAssistAutoInjection,
    ).toHaveBeenCalledWith("prod-api", "forward-network");
  });

  it("stops a running tunnel without deleting its saved configuration", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession()])
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "停止" }));

    expect(portForwardApiMocks.stopPortForward).toHaveBeenCalledWith(
      "forward-network",
    );
    expect(portForwardApiMocks.deletePortForward).not.toHaveBeenCalled();
    expect(await screen.findByText("隧道已停止，配置仍保留。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启动" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("starts an exited saved tunnel for the same host", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })])
      .mockResolvedValueOnce([networkAssistSession()]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "启动" }));

    expect(portForwardApiMocks.startPortForward).toHaveBeenCalledWith(
      "forward-network",
    );
    expect(await screen.findByText("主机网络助手 已启动。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
  });

  it("deletes a saved tunnel only when the delete action is used", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.deletePortForward.mockResolvedValue(true);
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })])
      .mockResolvedValueOnce([]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "删除" }));

    expect(portForwardApiMocks.deletePortForward).toHaveBeenCalledWith(
      "forward-network",
    );
    expect(await screen.findByText("隧道配置已删除。")).toBeInTheDocument();
    expect(screen.queryByText("主机网络助手")).not.toBeInTheDocument();
  });

  it("keeps restored auto-use until sessions finish loading", async () => {
    proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection({
      hostId: "prod-api",
      sessionId: "forward-network",
    });
    proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection.mockClear();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(
      await screen.findByRole("button", { name: "关闭新终端自动使用" }),
    ).toBeInTheDocument();
    expect(
      proxyAutoInjectionMocks.clearHostNetworkAssistAutoInjection,
    ).not.toHaveBeenCalled();
  });

  it("does not reuse restored auto-use when the persisted tunnel is exited", async () => {
    proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection({
      hostId: "prod-api",
      sessionId: "forward-network",
    });
    proxyAutoInjectionMocks.setHostNetworkAssistAutoInjection.mockClear();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession({ status: "exited" }),
    ]);

    render(
      <PortForwardToolContent
        focusedPane={focusedSshPane}
        selectedMachine={sshMachine}
      />,
    );

    expect(await screen.findByText("已退出")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        proxyAutoInjectionMocks.clearHostNetworkAssistAutoInjection,
      ).toHaveBeenCalledWith("prod-api", "forward-network"),
    );
    expect(
      screen.getByRole("button", { name: "注入代理环境" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "新终端自动使用" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "复制配置脚本" }),
    ).not.toBeInTheDocument();
  });

  it("shows an SSH-only empty state for non SSH machines", async () => {
    render(<PortForwardToolContent selectedMachine={localMachine} />);

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.getByText(/请选择 SSH 主机/)).toBeInTheDocument();
  });

  it("does not render a default development host badge", async () => {
    render(
      <PortForwardToolContent
        selectedMachine={{
          ...sshMachine,
          credentialRef: "C:/keys/dev_ed25519",
          description: "dev@dev.internal:22",
          host: "dev.internal",
          id: "dev-api",
          name: "dev api",
          production: false,
          status: "online",
          tags: ["ssh", "dev"],
          username: "dev",
        }}
      />,
    );

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.queryByText("开发主机")).not.toBeInTheDocument();
  });

  it("shows GatewayPorts and exposure warnings for non-loopback remote binds", async () => {
    const user = userEvent.setup();
    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "添加隧道" }));
    await user.click(screen.getByRole("button", { name: /主机使用本机网络/ }));
    await user.click(screen.getByRole("combobox", { name: "主机监听范围" }));
    await user.click(screen.getByRole("option", { name: "全部接口 (0.0.0.0)" }));

    expect(screen.getByText(/GatewayPorts/)).toBeInTheDocument();
    expect(screen.getAllByText(/生产主机/).length).toBeGreaterThan(0);
  });
});
