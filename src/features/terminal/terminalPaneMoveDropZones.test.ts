import { describe, expect, it } from "vitest";
import {
  resolveTerminalPaneMoveDropTarget,
  resolveTerminalPaneMoveDropZone,
} from "./terminalPaneMoveDropZones";

describe("terminalPaneMoveDropZones", () => {
  const rect = {
    bottom: 300,
    height: 200,
    left: 100,
    right: 500,
    top: 100,
    width: 400,
  };

  it("resolves center as a pane swap target", () => {
    expect(
      resolveTerminalPaneMoveDropZone(rect, { clientX: 300, clientY: 200 }),
    ).toBe("center");
  });

  it("resolves edge zones by nearest edge", () => {
    expect(
      resolveTerminalPaneMoveDropZone(rect, { clientX: 110, clientY: 200 }),
    ).toBe("left");
    expect(
      resolveTerminalPaneMoveDropZone(rect, { clientX: 490, clientY: 200 }),
    ).toBe("right");
    expect(
      resolveTerminalPaneMoveDropZone(rect, { clientX: 300, clientY: 108 }),
    ).toBe("top");
    expect(
      resolveTerminalPaneMoveDropZone(rect, { clientX: 300, clientY: 292 }),
    ).toBe("bottom");
  });

  it("returns null outside a pane rect or for invalid rects", () => {
    expect(
      resolveTerminalPaneMoveDropZone(rect, { clientX: 99, clientY: 200 }),
    ).toBeNull();
    expect(
      resolveTerminalPaneMoveDropZone(
        { ...rect, width: 0 },
        { clientX: 300, clientY: 200 },
      ),
    ).toBeNull();
  });

  it("resolves a target pane while ignoring the dragged source pane", () => {
    expect(
      resolveTerminalPaneMoveDropTarget(
        [
          { paneId: "pane-a", rect },
          {
            paneId: "pane-b",
            rect: {
              bottom: 300,
              height: 200,
              left: 520,
              right: 920,
              top: 100,
              width: 400,
            },
          },
        ],
        "pane-a",
        { clientX: 720, clientY: 200 },
      ),
    ).toEqual({ paneId: "pane-b", zone: "center" });
  });
});
