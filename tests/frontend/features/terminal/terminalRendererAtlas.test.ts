import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererController,
  type TerminalRendererTerminal,
} from "../../../../src/features/terminal/terminalRenderer";

class AtlasTestTerminal implements TerminalRendererTerminal {
  element: HTMLElement | null = document.createElement("div");
  rows = 12;

  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this as unknown as Terminal);
  }

  refresh(): void {}
}

class SharedAtlasWebglAddon implements ITerminalAddon {
  static instances: SharedAtlasWebglAddon[] = [];

  activate = vi.fn();
  clearTextureAtlas = vi.fn();
  dispose = vi.fn();
  textureAtlas = document.createElement("canvas");

  constructor() {
    SharedAtlasWebglAddon.instances.push(this);
  }

  onContextLoss(): IDisposable {
    return { dispose: vi.fn() };
  }
}

describe("terminalRenderer shared atlas disposal", () => {
  beforeEach(() => {
    SharedAtlasWebglAddon.instances = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => null,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disposes WebGL without clearing the atlas shared by sibling panes", async () => {
    const controller = createTerminalRendererController({
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: SharedAtlasWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new AtlasTestTerminal(),
    });

    controller.attach();
    await flushPromises();
    controller.updateMode("cpu");

    expect(SharedAtlasWebglAddon.instances[0].dispose).toHaveBeenCalled();
    expect(
      SharedAtlasWebglAddon.instances[0].clearTextureAtlas,
    ).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "cpu",
    });
  });

  it("releases a disposed controller without mutating the shared atlas", async () => {
    const controller = createTerminalRendererController({
      loadWebglAddon: vi
        .fn()
        .mockResolvedValue({ WebglAddon: SharedAtlasWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new AtlasTestTerminal(),
    });

    controller.attach();
    await flushPromises();
    controller.dispose();

    expect(SharedAtlasWebglAddon.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(
      SharedAtlasWebglAddon.instances[0].clearTextureAtlas,
    ).not.toHaveBeenCalled();
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
