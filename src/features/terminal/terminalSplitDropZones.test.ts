import { describe, expect, it } from "vitest";
import {
  resolveTerminalSplitDropZone,
  terminalSplitDropZoneToDirection,
  terminalSplitDropZoneToPlacement,
  type TerminalSplitDropZone,
} from "./terminalSplitDropZones";

const rect = {
  bottom: 220,
  height: 200,
  left: 10,
  right: 310,
  top: 20,
  width: 300,
};

describe("terminal split drop zones", () => {
  it("returns null when the pointer is outside the terminal content rect", () => {
    expect(resolveTerminalSplitDropZone(rect, { clientX: 9, clientY: 120 })).toBe(
      null,
    );
    expect(
      resolveTerminalSplitDropZone(rect, { clientX: 311, clientY: 120 }),
    ).toBe(null);
    expect(resolveTerminalSplitDropZone(rect, { clientX: 120, clientY: 19 })).toBe(
      null,
    );
    expect(
      resolveTerminalSplitDropZone(rect, { clientX: 120, clientY: 221 }),
    ).toBe(null);
  });

  it("resolves each edge hot zone", () => {
    expect(resolveTerminalSplitDropZone(rect, { clientX: 24, clientY: 120 })).toBe(
      "left",
    );
    expect(
      resolveTerminalSplitDropZone(rect, { clientX: 296, clientY: 120 }),
    ).toBe("right");
    expect(resolveTerminalSplitDropZone(rect, { clientX: 160, clientY: 34 })).toBe(
      "top",
    );
    expect(
      resolveTerminalSplitDropZone(rect, { clientX: 160, clientY: 206 }),
    ).toBe("bottom");
  });

  it("returns null for points inside the rect but outside all hot zones", () => {
    expect(
      resolveTerminalSplitDropZone(rect, { clientX: 160, clientY: 120 }),
    ).toBe(null);
  });

  it("clamps the inset so small terminal areas keep a center gap", () => {
    const smallRect = {
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
    };

    expect(
      resolveTerminalSplitDropZone(smallRect, { clientX: 39, clientY: 50 }),
    ).toBe("left");
    expect(
      resolveTerminalSplitDropZone(smallRect, { clientX: 50, clientY: 50 }),
    ).toBe(null);
    expect(
      resolveTerminalSplitDropZone(smallRect, { clientX: 61, clientY: 50 }),
    ).toBe("right");
  });

  it("chooses the closer edge when corner hot zones overlap", () => {
    expect(resolveTerminalSplitDropZone(rect, { clientX: 30, clientY: 28 })).toBe(
      "top",
    );
    expect(resolveTerminalSplitDropZone(rect, { clientX: 18, clientY: 42 })).toBe(
      "left",
    );
  });

  it("prefers left or right over top or bottom when corner distances tie", () => {
    expect(resolveTerminalSplitDropZone(rect, { clientX: 34, clientY: 44 })).toBe(
      "left",
    );
    expect(
      resolveTerminalSplitDropZone(rect, { clientX: 286, clientY: 44 }),
    ).toBe("right");
  });

  it("maps drop zones to terminal split directions", () => {
    const expected: Record<TerminalSplitDropZone, "horizontal" | "vertical"> = {
      bottom: "vertical",
      left: "horizontal",
      right: "horizontal",
      top: "vertical",
    };

    for (const [zone, direction] of Object.entries(expected)) {
      expect(terminalSplitDropZoneToDirection(zone as TerminalSplitDropZone)).toBe(
        direction,
      );
    }
  });

  it("maps drop zones to before or after placement", () => {
    const expected: Record<TerminalSplitDropZone, "after" | "before"> = {
      bottom: "after",
      left: "before",
      right: "after",
      top: "before",
    };

    for (const [zone, placement] of Object.entries(expected)) {
      expect(terminalSplitDropZoneToPlacement(zone as TerminalSplitDropZone)).toBe(
        placement,
      );
    }
  });
});
