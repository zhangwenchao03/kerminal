import { describe, expect, it, vi } from "vitest";
import {
  runWindowAction,
  startWindowDragging,
  type WindowActionDependencies,
  type WindowActionTarget,
} from "../../../src/lib/windowActions";

describe("windowActions", () => {
  it.each(["close", "minimize", "toggleMaximize"] as const)(
    "does not resolve the Tauri window for browser action %s",
    async (action) => {
      const { dependencies, getCurrentWindow, target } = createDependencies(false);

      await runWindowAction(action, dependencies);

      expect(getCurrentWindow).not.toHaveBeenCalled();
      expect(target[action]).not.toHaveBeenCalled();
    },
  );

  it.each(["close", "minimize", "toggleMaximize"] as const)(
    "calls only the requested Tauri window action %s",
    async (action) => {
      const { dependencies, getCurrentWindow, target } = createDependencies(true);

      await runWindowAction(action, dependencies);

      expect(getCurrentWindow).toHaveBeenCalledTimes(1);
      expect(target[action]).toHaveBeenCalledTimes(1);
      for (const otherAction of ["close", "minimize", "toggleMaximize"] as const) {
        if (otherAction !== action) {
          expect(target[otherAction]).not.toHaveBeenCalled();
        }
      }
      expect(target.startDragging).not.toHaveBeenCalled();
    },
  );

  it("does not start dragging in browser preview", async () => {
    const { dependencies, getCurrentWindow, target } = createDependencies(false);

    await startWindowDragging(dependencies);

    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(target.startDragging).not.toHaveBeenCalled();
  });

  it("starts dragging through the current Tauri window", async () => {
    const { dependencies, getCurrentWindow, target } = createDependencies(true);

    await startWindowDragging(dependencies);

    expect(getCurrentWindow).toHaveBeenCalledTimes(1);
    expect(target.startDragging).toHaveBeenCalledTimes(1);
    expect(target.close).not.toHaveBeenCalled();
    expect(target.minimize).not.toHaveBeenCalled();
    expect(target.toggleMaximize).not.toHaveBeenCalled();
  });
});

function createDependencies(tauriRuntime: boolean) {
  const target: WindowActionTarget = {
    close: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  };
  const getCurrentWindow = vi.fn(() => target);
  const dependencies: WindowActionDependencies = {
    getCurrentWindow,
    isTauri: () => tauriRuntime,
  };

  return { dependencies, getCurrentWindow, target };
}
