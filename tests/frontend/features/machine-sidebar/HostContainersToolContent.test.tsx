import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dockerContainerTarget,
  dockerContainerTargetCapabilities,
} from "../../../../src/lib/targetModel";
import type { DockerContainerSummary } from "../../../../src/lib/dockerApi";
import type { Machine } from "../../../../src/features/workspace/types";
import { HostContainersToolContent } from "../../../../src/features/machine-sidebar/HostContainersToolContent";

vi.mock("../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: () => <textarea aria-label="Compose YAML Monaco editor" />,
}));

const host: Machine = {
  description: "root@10.0.0.12:22",
  host: "10.0.0.12",
  id: "ubuntu-dev",
  kind: "ssh",
  name: "ubuntu-dev",
  port: 22,
  remoteGroupId: "group-dev",
  status: "offline",
  tags: ["ssh", "dev"],
  username: "root",
};

const localMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  name: "PowerShell",
  status: "online",
  tags: ["local"],
};

function container(
  input: Partial<DockerContainerSummary> &
    Pick<DockerContainerSummary, "id" | "name">,
): DockerContainerSummary {
  const { id, name, ...overrides } = input;
  const hostId = input.hostId ?? host.id;
  const runtime = input.runtime ?? "docker";
  const target = dockerContainerTarget({
    containerId: id,
    containerName: name,
    hostId,
    runtime,
  });

  return {
    ...overrides,
    capabilities: dockerContainerTargetCapabilities,
    hostId,
    id,
    image: input.image ?? "kerminal/api:latest",
    name,
    ports: input.ports ?? [],
    runtime,
    shortId: input.shortId ?? id.slice(0, 12),
    state: input.state ?? input.status ?? "running",
    status: input.status ?? "running",
    statusText: input.statusText ?? "Up 12 minutes",
    target,
  };
}

function inspectorProps() {
  return {
    onFetchContainerStats: vi.fn().mockResolvedValue({
      blockIo: "0B / 0B",
      containerId: "c0ffee1234567890",
      cpuPercent: "0.42%",
      hostId: host.id,
      memoryPercent: "4.1%",
      memoryUsage: "42MiB / 1GiB",
      networkIo: "1kB / 2kB",
      pids: "7",
      raw: "{\"CPUPerc\":\"0.42%\"}",
      runtime: "docker",
    }),
    onInspectContainer: vi.fn().mockResolvedValue({
      command: ["serve"],
      containerId: "c0ffee1234567890",
      entrypoint: ["/entrypoint.sh"],
      hostId: host.id,
      id: "c0ffee1234567890",
      image: "kerminal/api:latest",
      labels: {},
      name: "api",
      networks: ["bridge"],
      ports: ["0.0.0.0:8080->80/tcp"],
      rawJson: "{}",
      running: true,
      runtime: "docker",
      status: "running",
    }),
    onOpenContainerLogs: vi.fn(),
  };
}

describe("HostContainersToolContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a quiet empty state until an SSH host is selected", () => {
    const onListDockerContainers = vi.fn();

    render(
      <HostContainersToolContent
        onListDockerContainers={onListDockerContainers}
        selectedMachine={localMachine}
      />,
    );

    expect(screen.getByTestId("host-containers-tool-empty")).toHaveTextContent(
      "选择 SSH 主机后查看 Docker、Podman 和 Compose。",
    );
    expect(onListDockerContainers).not.toHaveBeenCalled();
  });

  it("loads host containers and keeps terminal, logs, and pin actions in the right panel", async () => {
    const user = userEvent.setup();
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const props = inspectorProps();
    const onEnterContainer = vi.fn();
    const onListDockerContainers = vi.fn().mockResolvedValue([api]);
    const onPinContainer = vi.fn();

    render(
      <HostContainersToolContent
        {...props}
        onEnterContainer={onEnterContainer}
        onListDockerContainers={onListDockerContainers}
        onPinContainer={onPinContainer}
        selectedMachine={host}
      />,
    );

    expect(await screen.findByTestId("host-containers-tool-content")).toHaveTextContent(
      "ubuntu-dev",
    );
    expect(onListDockerContainers).toHaveBeenCalledWith({
      hostId: "ubuntu-dev",
      includeStopped: true,
      runtime: "docker",
    });

    await user.click(screen.getByRole("button", { name: "进入容器 api" }));
    expect(onEnterContainer).toHaveBeenCalledWith(api);

    await user.click(
      screen.getByRole("button", { name: "查看容器 api 日志" }),
    );
    expect(props.onOpenContainerLogs).toHaveBeenCalledWith(api);

    await user.click(
      screen.getByRole("button", { name: "固定所选容器到侧栏" }),
    );
    expect(onPinContainer).toHaveBeenCalledWith(api);
  });

  it("selects the initial container when opened from a pinned sidebar item", async () => {
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const worker = container({
      id: "f00d123456789abc",
      image: "kerminal/worker:latest",
      name: "worker",
      shortId: "f00d12345678",
    });
    const props = inspectorProps();

    render(
      <HostContainersToolContent
        {...props}
        initialContainerId={worker.id}
        onListDockerContainers={vi.fn().mockResolvedValue([api, worker])}
        selectedMachine={host}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "进入容器 worker" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("host-container-selection-summary")).toHaveTextContent(
      "worker",
    );
    await waitFor(() => {
      expect(props.onInspectContainer).toHaveBeenCalledWith({
        containerId: worker.id,
        hostId: host.id,
        runtime: "docker",
      });
    });
  });

  it("opens Compose YAML from the container list in the central workspace tab", async () => {
    const user = userEvent.setup();
    const api = container({
      compose: {
        configFiles: ["compose.yaml"],
        project: "kerminal",
        service: "api",
        workingDir: "/srv/kerminal",
      },
      id: "c0ffee1234567890",
      name: "api",
    });
    const onOpenWorkspaceFileTab = vi.fn();

    render(
      <HostContainersToolContent
        {...inspectorProps()}
        onListDockerContainers={vi.fn().mockResolvedValue([api])}
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        selectedMachine={host}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "刷新 Compose 应用 kerminal",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("/srv/kerminal")).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", {
        name: "打开 Compose YAML kerminal",
      }),
    );

    expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
      access: "readonly",
      path: "/srv/kerminal/compose.yaml",
      rootPath: "/srv/kerminal",
      source: "composeYaml",
      target: { hostId: "ubuntu-dev", kind: "ssh" },
    });
  });

  it("keeps sidebar container actions on the row menu without rendering the bottom inspector", async () => {
    const user = userEvent.setup();
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const props = inspectorProps();
    const onPinContainer = vi.fn();

    render(
      <HostContainersToolContent
        {...props}
        onListDockerContainers={vi.fn().mockResolvedValue([api])}
        onPinContainer={onPinContainer}
        presentation="sidebar"
        selectedMachine={host}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "进入容器 api" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("host-container-selection-summary"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "概览" })).not.toBeInTheDocument();
    expect(props.onInspectContainer).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "更多容器操作 api" }),
    );

    expect(screen.getByRole("menuitem", { name: "日志" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "固定" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "监控" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "日志" }));
    expect(props.onOpenContainerLogs).toHaveBeenCalledWith(api);

    await user.click(
      screen.getByRole("button", { name: "更多容器操作 api" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "固定" }));
    expect(onPinContainer).toHaveBeenCalledWith(api);
  });

  it("uses one container summary and keeps sidebar rows focused on status and ports", async () => {
    const user = userEvent.setup();
    const onEnterContainer = vi.fn();
    const api = container({
      id: "c0ffee1234567890",
      name: "api",
      ports: ["0.0.0.0:8080->80/tcp"],
    });
    const db = container({
      id: "deadbeef98765432",
      image: "postgres:16",
      name: "postgres",
      state: "exited",
      status: "exited",
      statusText: "Exited (0) 2 hours ago",
    });

    render(
      <HostContainersToolContent
        {...inspectorProps()}
        onEnterContainer={onEnterContainer}
        onListDockerContainers={vi.fn().mockResolvedValue([api, db])}
        presentation="sidebar"
        selectedMachine={host}
      />,
    );

    expect(await screen.findByTestId("host-container-summary")).toHaveTextContent(
      "1 运行 · 1 停止 · 0 Compose · 2 独立",
    );
    const apiRow = screen.getByRole("option", { name: "容器 api" });
    expect(within(apiRow).getByText("运行中")).toBeInTheDocument();
    expect(within(apiRow).getByText("0.0.0.0:8080->80/tcp")).toBeInTheDocument();
    expect(within(apiRow).queryByText("kerminal/api:latest")).not.toBeInTheDocument();
    expect(within(apiRow).queryByText("c0ffee123456")).not.toBeInTheDocument();
    expect(within(apiRow).queryByText("Up 12 minutes")).not.toBeInTheDocument();

    apiRow.focus();
    await user.keyboard("{Enter}");
    expect(onEnterContainer).toHaveBeenCalledWith(api);
  });

  it("starts a stopped container directly and refreshes the right panel list", async () => {
    const user = userEvent.setup();
    const db = container({
      id: "deadbeef98765432",
      image: "postgres:16",
      name: "postgres",
      state: "exited",
      status: "exited",
      statusText: "Exited (0) 2 hours ago",
    });
    const onLifecycleContainer = vi.fn().mockResolvedValue(undefined);
    const onListDockerContainers = vi.fn().mockResolvedValue([db]);

    render(
      <HostContainersToolContent
        {...inspectorProps()}
        onLifecycleContainer={onLifecycleContainer}
        onListDockerContainers={onListDockerContainers}
        selectedMachine={host}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "启动容器 postgres" }),
    );

    expect(onLifecycleContainer).toHaveBeenCalledWith("start", db, undefined);
    await waitFor(() => {
      expect(onListDockerContainers).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps raw container failures collapsed behind a recovery message", async () => {
    const user = userEvent.setup();
    const onListDockerContainers = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "docker_runtime lease poisoned token=container-internal-secret",
        ),
      );

    render(
      <HostContainersToolContent
        {...inspectorProps()}
        onListDockerContainers={onListDockerContainers}
        selectedMachine={host}
      />,
    );

    expect(await screen.findByText("无法读取容器")).toBeVisible();
    expect(
      screen.getByText("请确认主机连接和容器运行时可用，然后重试。"),
    ).toBeVisible();
    const technicalDetail = screen.getByText(/docker_runtime lease poisoned/);
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(
      screen.queryByText(/container-internal-secret/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("技术详情"));

    expect(technicalDetail.closest("details")).toHaveAttribute("open");
  });
});
