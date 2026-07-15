import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dockerContainerTarget, dockerContainerTargetCapabilities } from "../../../../src/lib/targetModel";
import type { DockerContainerSummary } from "../../../../src/lib/dockerApi";
import { readRemoteWorkspaceTextFile } from "../../../../src/features/sftp/remoteWorkspaceEditorTransport";
import type { Machine } from "../../../../src/features/workspace/types";
import { HostContainersDialog } from "../../../../src/features/machine-sidebar/HostContainersDialog";

vi.mock("../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: ({
    language,
    path,
    theme,
    value,
  }: {
    language?: string;
    path: string;
    theme?: string;
    value?: string;
  }) => (
    <textarea
      aria-label="Compose YAML Monaco editor"
      data-language={language}
      data-path={path}
      data-theme={theme}
      readOnly
      value={value}
    />
  ),
}));

vi.mock("../../../../src/features/sftp/remoteWorkspaceEditorTransport", () => ({
  readRemoteWorkspaceTextFile: vi.fn(),
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
      raw: '{"CPUPerc":"0.42%"}',
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

describe("HostContainersDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readRemoteWorkspaceTextFile).mockResolvedValue({
      binary: false,
      bytesRead: 64,
      content: "services:\n  api:\n    image: kerminal/api:latest\n",
      encoding: "utf-8",
      hostId: host.id,
      lineEnding: "\n",
      maxBytes: 256 * 1024,
      path: "/srv/kerminal/compose.yaml",
      readonly: true,
      revision: {
        contentSha256: "sha256",
        modified: "2026-06-25T10:00:00Z",
        permissions: "0644",
        permissionsMode: 0o644,
        size: 64,
      },
      truncated: false,
    });
  });

  it("loads containers for the selected host and enters a running container", async () => {
    const user = userEvent.setup();
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const onClose = vi.fn();
    const onEnterContainer = vi.fn();
    const onListDockerContainers = vi.fn().mockResolvedValue([api]);

    render(
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        onClose={onClose}
        onEnterContainer={onEnterContainer}
        onLifecycleContainer={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        onPinContainer={vi.fn()}
        open
      />,
    );

    expect(
      await screen.findByRole("button", { name: "进入容器 api" }),
    ).toBeInTheDocument();
    expect(onListDockerContainers).toHaveBeenCalledWith({
      hostId: "ubuntu-dev",
      includeStopped: true,
      runtime: "docker",
    });

    await user.click(screen.getByRole("button", { name: "进入容器 api" }));

    expect(onEnterContainer).toHaveBeenCalledWith(api);
    expect(onClose).toHaveBeenCalled();
  });

  it("filters containers and keeps stopped containers out when requested", async () => {
    const user = userEvent.setup();
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const db = container({
      id: "deadbeef98765432",
      image: "postgres:16",
      name: "postgres",
      state: "exited",
      status: "exited",
      statusText: "Exited (0) 2 hours ago",
    });
    const onListDockerContainers = vi
      .fn()
      .mockImplementation(({ includeStopped }: { includeStopped?: boolean }) =>
        Promise.resolve(includeStopped ? [api, db] : [api]),
      );

    render(
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        onClose={vi.fn()}
        onEnterContainer={vi.fn()}
        onLifecycleContainer={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        onPinContainer={vi.fn()}
        open
      />,
    );

    expect(
      await screen.findByRole("button", { name: "进入容器 api" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索容器"), "postgres");

    expect(
      screen.queryByRole("button", { name: "进入容器 api" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "启动容器 postgres" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "包含停止容器" }));

    await waitFor(() => {
      expect(onListDockerContainers).toHaveBeenLastCalledWith({
        hostId: "ubuntu-dev",
        includeStopped: false,
        runtime: "docker",
      });
    });
  });

  it("switches runtime and pins the selected container", async () => {
    const user = userEvent.setup();
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const onPinContainer = vi.fn();
    const onListDockerContainers = vi.fn().mockResolvedValue([api]);

    render(
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        onClose={vi.fn()}
        onEnterContainer={vi.fn()}
        onLifecycleContainer={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        onPinContainer={onPinContainer}
        open
      />,
    );

    expect(
      await screen.findByRole("button", { name: "进入容器 api" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "容器运行时" }));
    await user.click(screen.getByRole("option", { name: /Podman/ }));

    await waitFor(() => {
      expect(onListDockerContainers).toHaveBeenLastCalledWith({
        hostId: "ubuntu-dev",
        includeStopped: true,
        runtime: "podman",
      });
    });

    await user.click(
      screen.getByRole("button", { name: "固定容器 api 到侧栏" }),
    );

    expect(onPinContainer).toHaveBeenCalledWith(api);
  });

  it("selects an initial container when opened from a pinned container", async () => {
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const worker = container({
      id: "f00d123456789abc",
      image: "kerminal/worker:latest",
      name: "worker",
      shortId: "f00d12345678",
    });

    render(
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        initialContainerId={worker.id}
        onClose={vi.fn()}
        onEnterContainer={vi.fn()}
        onLifecycleContainer={vi.fn()}
        onListDockerContainers={vi.fn().mockResolvedValue([api, worker])}
        onPinContainer={vi.fn()}
        open
      />,
    );

    expect(
      await screen.findByRole("button", { name: "进入容器 worker" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("worker")).toHaveLength(3);
    expect(screen.getAllByText("f00d12345678")).toHaveLength(2);
  });

  it("starts a stopped container directly and refreshes the list", async () => {
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
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        onClose={vi.fn()}
        onEnterContainer={vi.fn()}
        onLifecycleContainer={onLifecycleContainer}
        onListDockerContainers={onListDockerContainers}
        onPinContainer={vi.fn()}
        open
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "启动容器 postgres" }),
    );

    expect(onLifecycleContainer).toHaveBeenCalledWith("start", db, undefined);
    await waitFor(() =>
      expect(onListDockerContainers).toHaveBeenCalledTimes(2),
    );
  });

  it("confirms before stopping a running container", async () => {
    const user = userEvent.setup();
    const api = container({ id: "c0ffee1234567890", name: "api" });
    const onLifecycleContainer = vi.fn().mockResolvedValue(undefined);

    render(
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        onClose={vi.fn()}
        onEnterContainer={vi.fn()}
        onLifecycleContainer={onLifecycleContainer}
        onListDockerContainers={vi.fn().mockResolvedValue([api])}
        onPinContainer={vi.fn()}
        open
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "更多容器操作 api" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "停止" }));

    expect(
      screen.getByRole("dialog", { name: "停止容器" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止容器" }));

    expect(onLifecycleContainer).toHaveBeenCalledWith("stop", api, {
      force: false,
    });
  });

  it("requires exact container name before removing a stopped container", async () => {
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

    render(
      <HostContainersDialog
        {...inspectorProps()}
        host={host}
        onClose={vi.fn()}
        onEnterContainer={vi.fn()}
        onLifecycleContainer={onLifecycleContainer}
        onListDockerContainers={vi.fn().mockResolvedValue([db])}
        onPinContainer={vi.fn()}
        open
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "更多容器操作 postgres" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "删除" }));

    const confirmButton = screen.getByRole("button", { name: "删除容器" });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText("容器名"), "postgres");
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    expect(onLifecycleContainer).toHaveBeenCalledWith("remove", db, {
      force: false,
    });
  });


});
