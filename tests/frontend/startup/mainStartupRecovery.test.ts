import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startupMocks = vi.hoisted(() => ({
  bootstrapError: new Error("Outdated Optimize Dep"),
  createRoot: vi.fn(),
  disableNativeContextMenu: vi.fn(),
  prepareXtermWebviewCompatibility: vi.fn(),
}));

vi.mock("../../../src/lib/nativeContextMenu", () => ({
  disableNativeContextMenu: startupMocks.disableNativeContextMenu,
}));

vi.mock("../../../src/lib/xtermWebviewCompatibility", () => ({
  prepareXtermWebviewCompatibility:
    startupMocks.prepareXtermWebviewCompatibility,
}));

vi.mock("../../../src/App", () => ({
  default: () => null,
}));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: (...args: unknown[]) => startupMocks.createRoot(...args),
  },
}));

describe("main startup recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv("DEV", true);
    document.body.innerHTML = '<div id="root"></div>';
    startupMocks.bootstrapError = new Error("Outdated Optimize Dep");
    startupMocks.createRoot.mockReset();
    startupMocks.createRoot.mockImplementation(() => {
      throw startupMocks.bootstrapError;
    });
    startupMocks.disableNativeContextMenu.mockReset();
    startupMocks.prepareXtermWebviewCompatibility.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows the visible fallback when persisting a transient retry fails", async () => {
    expect(import.meta.env.DEV).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage is read only", "SecurityError");
      });
    const setTimeout = vi.spyOn(window, "setTimeout");

    await import("../../../src/main");

    const root = document.getElementById("root");
    await vi.waitFor(() => {
      expect(root).toHaveTextContent(
        "应用启动失败，请重新打开应用；如果持续失败，请通过应用日志反馈问题。",
      );
    });
    expect(setItem).toHaveBeenCalledWith(
      "kerminal:startup-import-retries",
      "1",
    );
    expect(setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 750);
    expect(startupMocks.prepareXtermWebviewCompatibility).toHaveBeenCalledTimes(
      1,
    );
    expect(startupMocks.disableNativeContextMenu).toHaveBeenCalledTimes(1);
    expect(
      startupMocks.prepareXtermWebviewCompatibility.mock.invocationCallOrder[0],
    ).toBeLessThan(
      startupMocks.disableNativeContextMenu.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["Outdated Optimize Dep", null, "1", 750],
    ["Failed to fetch dynamically imported module", "3", "4", 3_000],
  ])(
    "keeps the bounded retry contract for %s",
    async (message, storedCount, expectedCount, expectedDelay) => {
      startupMocks.bootstrapError = new Error(message);
      vi.spyOn(Storage.prototype, "getItem").mockReturnValue(storedCount);
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      const setTimeout = vi.spyOn(window, "setTimeout");

      await import("../../../src/main");

      await vi.waitFor(() => {
        expect(setItem).toHaveBeenCalledWith(
          "kerminal:startup-import-retries",
          expectedCount,
        );
      });
      expect(setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        expectedDelay,
      );
      const retryCallIndex = setTimeout.mock.calls.findIndex(
        ([, delay]) => delay === expectedDelay,
      );
      const retryHandle = setTimeout.mock.results[retryCallIndex]?.value;
      if (typeof retryHandle === "number") {
        window.clearTimeout(retryHandle);
      }
      expect(document.getElementById("root")).toBeEmptyDOMElement();
    },
  );

  it("shows the visible fallback after the fourth stored retry", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("4");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const setTimeout = vi.spyOn(window, "setTimeout");

    await import("../../../src/main");

    const root = document.getElementById("root");
    await vi.waitFor(() => {
      expect(root).toHaveTextContent(
        "应用启动失败，请重新打开应用；如果持续失败，请通过应用日志反馈问题。",
      );
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(
      setTimeout.mock.calls.some(([, delay]) => (delay ?? 0) >= 750),
    ).toBe(false);
  });
});
