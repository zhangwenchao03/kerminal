import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNativeMenuAction,
  listenNativeMenuActions,
  nativeMenuActions,
  NATIVE_MENU_ACTION_EVENT,
} from "../../../src/lib/nativeMenuApi";

const apiMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => apiMocks.isTauri(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => apiMocks.listen(...args),
}));

describe("nativeMenuApi", () => {
  beforeEach(() => {
    apiMocks.isTauri.mockReset();
    apiMocks.listen.mockReset();
  });

  it("returns a no-op listener in browser preview mode", async () => {
    apiMocks.isTauri.mockReturnValue(false);
    const handler = vi.fn();

    const unlisten = await listenNativeMenuActions(handler);
    unlisten();

    expect(apiMocks.listen).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("listens for native menu actions in Tauri and filters unknown payloads", async () => {
    apiMocks.isTauri.mockReturnValue(true);
    const unlisten = vi.fn();
    const handler = vi.fn();
    let listener:
      | ((event: { payload?: { action?: string } }) => void)
      | undefined;
    apiMocks.listen.mockImplementation(async (_event, callback) => {
      listener = callback as typeof listener;
      return unlisten;
    });

    const returnedUnlisten = await listenNativeMenuActions(handler);

    expect(apiMocks.listen).toHaveBeenCalledWith(
      NATIVE_MENU_ACTION_EVENT,
      expect.any(Function),
    );
    listener?.({ payload: { action: "newTerminal" } });
    listener?.({ payload: { action: "unknown" } });
    listener?.({});
    returnedUnlisten();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("newTerminal");
    expect(unlisten).toHaveBeenCalled();
  });

  it("validates the public native menu action set", () => {
    expect(nativeMenuActions).toContain("openSettings");
    expect(nativeMenuActions).toContain("editCopy");
    expect(isNativeMenuAction("splitVertical")).toBe(true);
    expect(isNativeMenuAction("editPaste")).toBe(true);
    expect(isNativeMenuAction("copy")).toBe(false);
    expect(isNativeMenuAction(null)).toBe(false);
  });
});
