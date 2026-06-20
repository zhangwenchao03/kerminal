import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("portForwardApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("creates, lists and closes port forwards through Tauri commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "host-lab",
      hostName: "lab",
      id: "forward-1",
      kind: "local",
      name: "PostgreSQL",
      sourcePort: 15432,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce(true);
    const { closePortForward, createPortForward, listPortForwards } =
      await import("./portForwardApi");

    await createPortForward({
      bindHost: "",
      hostId: "host-lab",
      kind: "local",
      name: "PostgreSQL",
      sourcePort: 15432,
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });
    await listPortForwards();
    await closePortForward("forward-1");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "port_forward_create", {
      request: {
        bindHost: "127.0.0.1",
        hostId: "host-lab",
        kind: "local",
        name: "PostgreSQL",
        sourcePort: 15432,
        targetHost: "127.0.0.1",
        targetPort: 5432,
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "port_forward_list");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "port_forward_close", {
      forwardId: "forward-1",
    });
  });

  it("keeps browser preview port forwards in memory", async () => {
    isTauriMock.mockReturnValue(false);
    const { closePortForward, createPortForward, listPortForwards } =
      await import("./portForwardApi");

    const created = await createPortForward({
      hostId: "host-lab",
      kind: "dynamic",
      sourcePort: 1080,
    });
    const afterCreate = await listPortForwards();
    const closed = await closePortForward(created.id);
    const afterClose = await listPortForwards();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(created.kind).toBe("dynamic");
    expect(afterCreate.map((session) => session.id)).toContain(created.id);
    expect(closed).toBe(true);
    expect(afterClose.map((session) => session.id)).not.toContain(created.id);
  });
});
