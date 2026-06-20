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
    const { listDockerContainers } = await import("./dockerApi");

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
    const { listDockerContainers } = await import("./dockerApi");

    const containers = await listDockerContainers({
      hostId: "host-lab",
      includeStopped: false,
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(containers).toHaveLength(1);
    expect(containers[0].target).toMatchObject({
      hostId: "host-lab",
      kind: "dockerContainer",
    });
  });
});
