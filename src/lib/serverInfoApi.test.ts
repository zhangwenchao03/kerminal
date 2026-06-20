import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("serverInfoApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("loads server info through the Tauri command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      capturedAt: "1",
      gpus: [],
      host: "lab.internal",
      hostId: "host-lab",
      hostName: "lab",
      port: 22,
      username: "deploy",
    });
    const { getServerInfoSnapshot } = await import("./serverInfoApi");

    const snapshot = await getServerInfoSnapshot({ hostId: "host-lab" });

    expect(snapshot.hostName).toBe("lab");
    expect(invokeMock).toHaveBeenCalledWith("server_info_snapshot", {
      request: { hostId: "host-lab" },
    });
  });

  it("returns a Chinese browser preview snapshot outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { getServerInfoSnapshot } = await import("./serverInfoApi");

    const snapshot = await getServerInfoSnapshot({ hostId: "host-lab" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(snapshot.hostId).toBe("host-lab");
    expect(snapshot.hostName).toBe("浏览器预览主机");
    expect(snapshot.memoryTotalBytes).toBeGreaterThan(0);
    expect(snapshot.gpus?.[0]?.name).toBe("NVIDIA RTX 4090");
    expect(snapshot.loadAverage?.length).toBe(3);
  });
});
