import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererController,
  type TerminalRendererTerminal,
} from "../../../../src/features/terminal/terminalRenderer";

class StressTerminal implements TerminalRendererTerminal {
  element: HTMLElement | null = document.createElement("div");
  rows = 24;

  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this as unknown as Terminal);
  }
}

class StressWebglAddon implements ITerminalAddon {
  static activeListeners = 0;
  static disposeCount = 0;

  private listeners = new Set<() => void>();
  textureAtlas = document.createElement("canvas");

  activate(): void {}

  dispose(): void {
    StressWebglAddon.disposeCount += 1;
    StressWebglAddon.activeListeners -= this.listeners.size;
    this.listeners.clear();
  }

  onContextLoss(listener: () => void): IDisposable {
    this.listeners.add(listener);
    StressWebglAddon.activeListeners += 1;
    return {
      dispose: () => {
        if (this.listeners.delete(listener)) {
          StressWebglAddon.activeListeners -= 1;
        }
      },
    };
  }
}

describe("terminalRenderer lifecycle stress", () => {
  it("returns listeners, timers, canvases, and contexts to zero after 500 cycles", async () => {
    StressWebglAddon.activeListeners = 0;
    StressWebglAddon.disposeCount = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    for (let index = 0; index < 500; index += 1) {
      const controller = createTerminalRendererController({
        loadWebglAddon: async () => ({ WebglAddon: StressWebglAddon }),
        paneId: `stress-${index}`,
        rendererType: "auto",
        terminal: new StressTerminal(),
      });

      controller.attach();
      await Promise.resolve();
      await Promise.resolve();
      controller.dispose();
      controller.dispose();

      const diagnostics = controller.getDiagnostics();
      expect(diagnostics.activeTimerCount).toBe(0);
      expect(diagnostics.lifecycle.state).toBe("disposed");
      expect(diagnostics.telemetry.resources).toEqual(
        expect.objectContaining({
          activeCanvases: 0,
          activeContexts: 0,
          activeGpuPanes: 0,
        }),
      );
    }

    expect(StressWebglAddon.activeListeners).toBe(0);
    expect(StressWebglAddon.disposeCount).toBe(500);
  });
});
