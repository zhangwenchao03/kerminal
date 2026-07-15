import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  getCurrentWebview: vi.fn(),
  listen: vi.fn(),
  onDragDropEvent: vi.fn(),
  openPath: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: tauriMocks.convertFileSrc,
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: tauriMocks.getCurrentWebview,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: tauriMocks.openPath,
  openUrl: tauriMocks.openUrl,
}));

import { createDesktopRuntimePort } from "../../../../src/lib/desktopRuntimeApi";

describe("desktopRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getCurrentWebview.mockReturnValue({
      onDragDropEvent: tauriMocks.onDragDropEvent,
    });
  });

  it("uses explicit preview semantics without desktop side effects", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const runtime = createDesktopRuntimePort(false);

    expect(runtime.mode).toBe("preview");
    expect(runtime.convertLocalFileSrc("C:/wallpaper.png")).toBeUndefined();
    expect(await runtime.openPath("C:/snippets")).toBe("unsupported");
    await runtime.openUrl("https://example.com");
    const unlisten = await runtime.listen("event", vi.fn());
    const unlistenDragDrop = await runtime.listenToDragDrop(vi.fn());
    unlisten();
    unlistenDragDrop();

    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(tauriMocks.openPath).not.toHaveBeenCalled();
    expect(tauriMocks.listen).not.toHaveBeenCalled();
    expect(tauriMocks.getCurrentWebview).not.toHaveBeenCalled();
  });

  it("delegates desktop-only operations to Tauri adapters", async () => {
    const unlisten = vi.fn();
    tauriMocks.listen.mockResolvedValue(unlisten);
    tauriMocks.onDragDropEvent.mockResolvedValue(unlisten);
    const runtime = createDesktopRuntimePort(true);
    const handler = vi.fn();

    expect(runtime.convertLocalFileSrc("C:/wallpaper.png")).toBe(
      "asset://C:/wallpaper.png",
    );
    expect(await runtime.openPath("C:/snippets")).toBe("opened");
    await runtime.openUrl("https://example.com");
    const dispose = await runtime.listen<string>("event", handler);
    const dragDropHandler = vi.fn();
    const disposeDragDrop = await runtime.listenToDragDrop(dragDropHandler);
    const registeredHandler = tauriMocks.listen.mock.calls[0]?.[1];
    registeredHandler?.({ payload: "ready" });
    const registeredDragDropHandler = tauriMocks.onDragDropEvent.mock.calls[0]?.[0];
    registeredDragDropHandler?.({ payload: { type: "leave" } });

    expect(tauriMocks.openPath).toHaveBeenCalledWith("C:/snippets");
    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com");
    expect(handler).toHaveBeenCalledWith("ready");
    expect(dragDropHandler).toHaveBeenCalledWith({ type: "leave" });
    expect(dispose).toBe(unlisten);
    expect(disposeDragDrop).toBe(unlisten);
  });
});
