import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableNativeContextMenu,
  shouldDisableNativeContextMenu,
} from "../../../src/lib/nativeContextMenu";

const apiMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => apiMocks.isTauri(),
}));

describe("nativeContextMenu", () => {
  beforeEach(() => {
    apiMocks.isTauri.mockReset();
    vi.unstubAllEnvs();
  });

  it("enables the global guard only for packaged Tauri builds", () => {
    vi.stubEnv("PROD", true);
    apiMocks.isTauri.mockReturnValue(true);

    expect(shouldDisableNativeContextMenu()).toBe(true);

    apiMocks.isTauri.mockReturnValue(false);

    expect(shouldDisableNativeContextMenu()).toBe(false);

    vi.stubEnv("PROD", false);
    apiMocks.isTauri.mockReturnValue(true);

    expect(shouldDisableNativeContextMenu()).toBe(false);
  });

  it("prevents native context menus without blocking custom listeners", () => {
    const button = document.createElement("button");
    const customContextMenuListener = vi.fn();
    button.addEventListener("contextmenu", customContextMenuListener);
    document.body.append(button);

    const dispose = disableNativeContextMenu({ enabled: true });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(customContextMenuListener).toHaveBeenCalledTimes(1);

    dispose();
    button.remove();
  });

  it("removes the context menu guard when disposed", () => {
    const target = new EventTarget();
    const dispose = disableNativeContextMenu({ enabled: true, target });
    const guardedEvent = new Event("contextmenu", { cancelable: true });

    target.dispatchEvent(guardedEvent);

    expect(guardedEvent.defaultPrevented).toBe(true);

    dispose();

    const releasedEvent = new Event("contextmenu", { cancelable: true });

    target.dispatchEvent(releasedEvent);

    expect(releasedEvent.defaultPrevented).toBe(false);
  });

  it("leaves context menu events untouched when disabled", () => {
    const target = new EventTarget();
    disableNativeContextMenu({ enabled: false, target });
    const event = new Event("contextmenu", { cancelable: true });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
