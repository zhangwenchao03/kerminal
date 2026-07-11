import { describe, expect, it } from "vitest";
import {
  alignToDevicePixel,
  resolveTerminalSuggestionMenuPosition,
} from "../../../../src/features/terminal/terminalSuggestionMenuPosition";

describe("terminalSuggestionMenuPosition", () => {
  it("places the menu below when space is available", () => {
    expect(
      resolveTerminalSuggestionMenuPosition({
        anchor: { height: 18, x: 100, y: 80 },
        menuSize: { height: 240, width: 360 },
        paneSize: { height: 500, width: 800 },
      }),
    ).toMatchObject({
      left: 100,
      placement: "below",
      top: 104,
      width: 360,
    });
  });

  it("flips above and keeps the menu inside a narrow pane", () => {
    const position = resolveTerminalSuggestionMenuPosition({
      anchor: { height: 18, x: 250, y: 260 },
      menuSize: { height: 220, width: 420 },
      paneSize: { height: 300, width: 280 },
    });

    expect(position).toMatchObject({
      left: 8,
      placement: "above",
      top: 34,
      width: 264,
    });
    expect(position.maxHeight).toBe(246);
  });

  it("aligns fractional coordinates to physical pixels on high DPI panes", () => {
    const position = resolveTerminalSuggestionMenuPosition({
      anchor: { height: 17.2, x: 13.2, y: 30.2 },
      devicePixelRatio: 2,
      gap: 5.3,
      menuSize: { height: 100.1, width: 200.2 },
      paneSize: { height: 300.4, width: 400.4 },
    });

    expect(position.left).toBe(13);
    expect(position.top).toBe(52.5);
    expect(position.width).toBe(200);
    expect(alignToDevicePixel(10.26, 2)).toBe(10.5);
  });
});
