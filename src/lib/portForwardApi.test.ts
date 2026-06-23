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

  it("creates, lists, starts, stops and deletes port forwards through Tauri commands", async () => {
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
    invokeMock.mockResolvedValueOnce(true);
    invokeMock.mockResolvedValueOnce(true);
    const {
      createPortForward,
      deletePortForward,
      listPortForwards,
      startPortForward,
      stopPortForward,
    } = await import("./portForwardApi");

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
    await startPortForward("forward-1");
    await stopPortForward("forward-1");
    await deletePortForward("forward-1");

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
    expect(invokeMock).toHaveBeenNthCalledWith(3, "port_forward_start", {
      forwardId: "forward-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "port_forward_stop", {
      forwardId: "forward-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "port_forward_delete", {
      forwardId: "forward-1",
    });
  });

  it("keeps browser preview port forwards in memory", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      createPortForward,
      deletePortForward,
      listPortForwards,
      startPortForward,
      stopPortForward,
    } = await import("./portForwardApi");

    const created = await createPortForward({
      hostId: "host-lab",
      kind: "dynamic",
      sourcePort: 1080,
    });
    const afterCreate = await listPortForwards();
    const stopped = await stopPortForward(created.id);
    const afterStop = await listPortForwards();
    const started = await startPortForward(created.id);
    const deleted = await deletePortForward(created.id);
    const afterDelete = await listPortForwards();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(created.kind).toBe("dynamic");
    expect(afterCreate.map((session) => session.id)).toContain(created.id);
    expect(stopped).toBe(true);
    expect(afterStop[0].status).toBe("exited");
    expect(started.status).toBe("running");
    expect(deleted).toBe(true);
    expect(afterDelete.map((session) => session.id)).not.toContain(created.id);
  });

  it("keeps host network assist metadata in browser preview sessions", async () => {
    isTauriMock.mockReturnValue(false);
    const { deletePortForward, createPortForward, listPortForwards } =
      await import("./portForwardApi");

    const created = await createPortForward({
      bindHost: "0.0.0.0",
      hostId: "host-lab",
      kind: "remote",
      origin: "networkAssist",
      proxyProtocol: "http",
      purpose: "hostNetworkAssist",
      remoteBindHost: "0.0.0.0",
      sourcePort: 18080,
      targetHost: "127.0.0.1",
      targetPort: 18081,
    });
    const afterCreate = await listPortForwards();
    await deletePortForward(created.id);

    expect(created.origin).toBe("networkAssist");
    expect(created.purpose).toBe("hostNetworkAssist");
    expect(created.proxyUrl).toBe("http://127.0.0.1:18080");
    expect(afterCreate[0]).toMatchObject({
      proxyProtocol: "http",
      remoteBindHost: "0.0.0.0",
    });
  });

  it("passes host network assist preview fields through Tauri commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "host-lab",
      hostName: "lab",
      id: "forward-network",
      kind: "remote",
      name: "主机网络助手",
      sourcePort: 18080,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 18081,
    });
    const { createPortForward } = await import("./portForwardApi");

    await createPortForward({
      bindHost: "127.0.0.1",
      commandPreview: "export HTTP_PROXY='http://127.0.0.1:18080'",
      hostId: "host-lab",
      kind: "remote",
      name: "主机网络助手",
      origin: "networkAssist",
      proxyProtocol: "http",
      proxyUrl: "http://127.0.0.1:18080",
      purpose: "hostNetworkAssist",
      remoteBindHost: "127.0.0.1",
      sourcePort: 18080,
      targetHost: "127.0.0.1",
      targetPort: 18081,
    });

    expect(invokeMock).toHaveBeenCalledWith("port_forward_create", {
      request: expect.objectContaining({
        commandPreview: "export HTTP_PROXY='http://127.0.0.1:18080'",
        origin: "networkAssist",
        proxyProtocol: "http",
        proxyUrl: "http://127.0.0.1:18080",
        purpose: "hostNetworkAssist",
        remoteBindHost: "127.0.0.1",
      }),
    });
  });
});
