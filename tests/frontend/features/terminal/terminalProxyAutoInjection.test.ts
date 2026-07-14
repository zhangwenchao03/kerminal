import { beforeEach, describe, expect, it, vi } from "vitest";

const storageKey = "kerminal.remoteSocksAutoInjection.v1";

async function loadModule() {
  return import("../../../../src/features/terminal/terminalProxyAutoInjection");
}

describe("terminalProxyAutoInjection", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("persists remote SOCKS auto injection across module reloads", async () => {
    let autoInjection = await loadModule();

    autoInjection.setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });

    vi.resetModules();
    autoInjection = await loadModule();

    expect(autoInjection.getRemoteSocksAutoInjection("host-a")).toEqual({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });
  });

  it("removes persisted auto injection when the matching session is cleared", async () => {
    let autoInjection = await loadModule();

    autoInjection.setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });
    expect(
      autoInjection.clearRemoteSocksAutoInjection("host-a", "forward-a"),
    ).toBe(true);

    vi.resetModules();
    autoInjection = await loadModule();

    expect(autoInjection.getRemoteSocksAutoInjection("host-a")).toBeUndefined();
  });

  it("ignores invalid persisted entries", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        injections: [
          {
            command: "",
            hostId: "host-a",
            protocol: "http",
            proxyUrl: "http://127.0.0.1:18080",
            sessionId: "forward-a",
          },
          {
            command: "export ALL_PROXY='socks5h://127.0.0.1:18081'",
            hostId: "host-b",
            protocol: "socks5",
            proxyUrl: "socks5h://127.0.0.1:18081",
            sessionId: "forward-b",
          },
        ],
        version: 1,
      }),
    );

    const autoInjection = await loadModule();

    expect(autoInjection.getRemoteSocksAutoInjection("host-a")).toBeUndefined();
    expect(autoInjection.getRemoteSocksAutoInjection("host-b")).toEqual(
      expect.objectContaining({
        hostId: "host-b",
        sessionId: "forward-b",
      }),
    );
  });
});
