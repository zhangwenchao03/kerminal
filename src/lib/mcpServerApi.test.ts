import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("mcpServerApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("loads the local HTTP MCP server status", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
    });
    const { getMcpHttpServerStatus } = await import("./mcpServerApi");

    const current = await getMcpHttpServerStatus();

    expect(invokeMock).toHaveBeenCalledWith("mcp_http_server_status");
    expect(current).toEqual({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
    });
  });

  it("starts the local HTTP MCP server", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
    });
    const { startMcpHttpServer } = await import("./mcpServerApi");

    const started = await startMcpHttpServer();

    expect(invokeMock).toHaveBeenCalledWith("mcp_http_server_start", {
      request: null,
    });
    expect(started).toMatchObject({
      endpoint: "http://127.0.0.1:30456/mcp",
      port: 30456,
      running: true,
    });
  });

  it("stops the local HTTP MCP server", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    const { stopMcpHttpServer } = await import("./mcpServerApi");

    const stopped = await stopMcpHttpServer();

    expect(invokeMock).toHaveBeenCalledWith("mcp_http_server_stop");
    expect(stopped).toMatchObject({
      endpoint: null,
      port: null,
      running: false,
    });
  });

  it("normalizes partial server status responses", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      running: 0,
    });
    const { getMcpHttpServerStatus } = await import("./mcpServerApi");

    const current = await getMcpHttpServerStatus();

    expect(current).toEqual({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
  });

  it("uses a browser preview status without exposing old catalog APIs", async () => {
    isTauriMock.mockReturnValue(false);
    const api = await import("./mcpServerApi");

    await expect(api.getMcpHttpServerStatus()).resolves.toEqual({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    await expect(api.startMcpHttpServer()).resolves.toMatchObject({
      running: false,
    });
    await expect(api.stopMcpHttpServer()).resolves.toMatchObject({
      running: false,
    });
    expect("getMcpGatewayManifest" in api).toBe(false);
    expect("readMcpResource" in api).toBe(false);
    expect("renderMcpPrompt" in api).toBe(false);
    expect("listMcpTools" in api).toBe(false);
    expect("listToolRegistry" in api).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
