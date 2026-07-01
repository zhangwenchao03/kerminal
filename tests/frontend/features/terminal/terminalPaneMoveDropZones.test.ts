import { describe, expect, it } from "vitest";
import {
  resolveTerminalPaneMoveDropTarget,
  resolveTerminalPaneMoveDropZone,
  resolveTerminalPaneMoveWorkspaceDropTarget,
} from "../../../../src/features/terminal/terminalPaneMoveDropZones";

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
    ).toEqual({ paneId: "pane-b", scope: "pane", zone: "center" });
  });

  it("resolves workspace edge docking before pane-local swap zones", () => {
    expect(
      resolveTerminalPaneMoveWorkspaceDropTarget(
        ["pane-a", "pane-b", "pane-c"],
        "pane-a",
        {
          bottom: 300,
          height: 200,
          left: 0,
          right: 900,
          top: 100,
          width: 900,
        },
        { clientX: 860, clientY: 200 },
        { inset: 120 },
      ),
    ).toEqual({
      paneId: "pane-b",
      scope: "workspace",
      zone: "right",
    });
  });
});
