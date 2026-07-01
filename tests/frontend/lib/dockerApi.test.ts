import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("dockerApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists containers through the Tauri command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([]);
    const { listDockerContainers } = await import("../../../src/lib/dockerApi");

    await listDockerContainers({ hostId: " host-lab " });

    expect(invokeMock).toHaveBeenCalledWith("docker_list_containers", {
      request: {
        hostId: "host-lab",
        includeStopped: true,
        runtime: "docker",
      },
    });
  });

  it("provides browser preview containers outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listDockerContainers } = await import("../../../src/lib/dockerApi");

    const containers = await listDockerContainers({
      hostId: "host-lab",
      includeStopped: false,
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(containers).toHaveLength(2);
    expect(containers[0].target).toMatchObject({
      hostId: "host-lab",
      kind: "dockerContainer",
    });
    expect(containers[0].compose).toMatchObject({
      configPaths: [
        "/srv/kerminal/compose.yaml",
        "/srv/kerminal/compose.override.yaml",
      ],
      project: "kerminal",
      service: "api",
    });
    expect(containers[1].name).toBe("redis-cache");
    expect(containers[1].compose).toBeUndefined();
  });

  it("runs lifecycle commands through Tauri with normalized request fields", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      action: "restart",
      containerId: "api",
      hostId: "host-lab",
      output: "api",
      runtime: "podman",
      success: true,
    });
    const { restartDockerContainer } = await import("../../../src/lib/dockerApi");

    await restartDockerContainer({
      containerId: " api ",
      hostId: " host-lab ",
      runtime: "podman",
    });

    expect(invokeMock).toHaveBeenCalledWith("docker_restart_container", {
      request: {
        containerId: "api",
        force: false,
        hostId: "host-lab",
        runtime: "podman",
      },
    });
  });

  it("returns browser preview lifecycle results outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { removeDockerContainer } = await import("../../../src/lib/dockerApi");

    const result = await removeDockerContainer({
      containerId: " api ",
      force: true,
      hostId: " host-lab ",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: "remove",
      containerId: "api",
      hostId: "host-lab",
      runtime: "docker",
      success: true,
    });
  });

  it("loads container inspect, logs and stats through typed Tauri commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({ id: "api", labels: {}, rawJson: "{}" })
      .mockResolvedValueOnce({ logs: "ready", tail: 50 })
      .mockResolvedValueOnce({ cpuPercent: "0.42%", raw: "{}" });
    const {
      fetchDockerContainerStats,
      inspectDockerContainer,
      tailDockerContainerLogs,
    } = await import("../../../src/lib/dockerApi");

    await inspectDockerContainer({
      containerId: " api ",
      hostId: " host-lab ",
      runtime: "podman",
    });
    await tailDockerContainerLogs({
      containerId: " api ",
      hostId: " host-lab ",
      tail: 50.8,
    });
    await fetchDockerContainerStats({
      containerId: " api ",
      hostId: " host-lab ",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "docker_inspect_container", {
      request: {
        containerId: "api",
        hostId: "host-lab",
        runtime: "podman",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "docker_tail_container_logs",
      {
        request: {
          containerId: "api",
          hostId: "host-lab",
          runtime: "docker",
          tail: 50,
        },
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(3, "docker_container_stats", {
      request: {
        containerId: "api",
        hostId: "host-lab",
        runtime: "docker",
      },
    });
  });

  it("returns browser preview inspect logs and stats outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      fetchDockerContainerStats,
      inspectDockerContainer,
      tailDockerContainerLogs,
    } = await import("../../../src/lib/dockerApi");

    const inspect = await inspectDockerContainer({
      containerId: " c0ffee1234567890 ",
      hostId: " host-lab ",
    });
    const logs = await tailDockerContainerLogs({
      containerId: " c0ffee1234567890 ",
      hostId: " host-lab ",
      tail: 2000,
    });
    const stats = await fetchDockerContainerStats({
      containerId: " c0ffee1234567890 ",
      hostId: " host-lab ",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(inspect).toMatchObject({
      hostId: "host-lab",
      name: "kerminal-api-1",
      runtime: "docker",
    });
    expect(logs.tail).toBe(1000);
    expect(logs.logs).toContain("listening on :8080");
    expect(stats.cpuPercent).toBe("0.42%");
  });
});
