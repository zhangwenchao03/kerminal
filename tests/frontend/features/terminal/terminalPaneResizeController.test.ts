import { describe, expect, it, vi } from "vitest";
import { createTerminalPaneResizeController } from "../../../../src/features/terminal/terminalPaneResizeController";

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminalPaneResizeController", () => {
  it("reports initial dimensions and suppresses an identical surface sample", () => {
    const onDimensionsChange = vi.fn();
    const onGhostSuggestionLayoutChange = vi.fn();
    const resizeSession = vi.fn(async () => undefined);
    const controller = createTerminalPaneResizeController({
      initialDimensions: { cols: 80, rows: 24 },
      onDimensionsChange,
      onGhostSuggestionLayoutChange,
      resizeSession,
    });

    controller.handleSurfaceDimensions({ cols: 80, rows: 24 });

    expect(onDimensionsChange).toHaveBeenCalledOnce();
    expect(onDimensionsChange).toHaveBeenCalledWith({ cols: 80, rows: 24 });
    expect(onGhostSuggestionLayoutChange).not.toHaveBeenCalled();
    expect(resizeSession).not.toHaveBeenCalled();
  });

  it("updates UI and ghost layout before resizing the bound session", async () => {
    const order: string[] = [];
    const controller = createTerminalPaneResizeController({
      initialDimensions: { cols: 80, rows: 24 },
      onDimensionsChange: () => order.push("dimensions"),
      onGhostSuggestionLayoutChange: () => order.push("ghost"),
      resizeSession: async (sessionId, dimensions) => {
        order.push(`resize:${sessionId}:${dimensions.cols}x${dimensions.rows}`);
      },
    });
    order.length = 0;
    controller.bindSession("session-1", { cols: 80, rows: 24 });

    controller.handleSurfaceDimensions({ cols: 120, rows: 40 });
    await flushPromises();

    expect(order).toEqual([
      "dimensions",
      "resize:session-1:120x40",
      "ghost",
    ]);
    expect(controller.readDimensions()).toEqual({ cols: 120, rows: 40 });
  });

  it("reuses the latest surface dimensions after a session binds", async () => {
    const resizeSession = vi.fn(async () => undefined);
    const controller = createTerminalPaneResizeController({
      initialDimensions: { cols: 80, rows: 24 },
      onDimensionsChange: vi.fn(),
      onGhostSuggestionLayoutChange: vi.fn(),
      resizeSession,
    });
    controller.handleSurfaceDimensions({ cols: 100, rows: 30 });
    controller.bindSession("session-1", { cols: 80, rows: 24 });

    controller.requestCurrentDimensions();
    await flushPromises();

    expect(resizeSession).toHaveBeenCalledWith("session-1", {
      cols: 100,
      rows: 30,
    });
  });

  it("stops backend resize after the session is cleared", async () => {
    const resizeSession = vi.fn(async () => undefined);
    const controller = createTerminalPaneResizeController({
      initialDimensions: { cols: 80, rows: 24 },
      onDimensionsChange: vi.fn(),
      onGhostSuggestionLayoutChange: vi.fn(),
      resizeSession,
    });
    controller.bindSession("session-1", { cols: 80, rows: 24 });
    controller.clearSession("session-1");

    controller.handleSurfaceDimensions({ cols: 110, rows: 35 });
    await flushPromises();

    expect(resizeSession).not.toHaveBeenCalled();
  });
});
