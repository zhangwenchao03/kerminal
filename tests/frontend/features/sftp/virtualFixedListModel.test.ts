import { describe, expect, it } from "vitest";
import {
  FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT,
  resolveVirtualFixedListWindow,
} from "../../../../src/features/sftp/virtualFixedListModel";

describe("resolveVirtualFixedListWindow", () => {
  it("returns an empty window for empty lists", () => {
    expect(
      resolveVirtualFixedListWindow({
        itemCount: 0,
        overscan: 8,
        rowHeight: FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT,
        scrollTop: 0,
        viewportHeight: 440,
      }),
    ).toEqual({
      bottomSpacerHeight: 0,
      endIndexExclusive: 0,
      renderedCount: 0,
      startIndex: 0,
      topSpacerHeight: 0,
      totalHeight: 0,
    });
  });

  it("adds overscan around the visible rows", () => {
    const window = resolveVirtualFixedListWindow({
      itemCount: 500,
      overscan: 2,
      rowHeight: 44,
      scrollTop: 44 * 20,
      viewportHeight: 44 * 5,
    });

    expect(window).toEqual({
      bottomSpacerHeight: (500 - 27) * 44,
      endIndexExclusive: 27,
      renderedCount: 9,
      startIndex: 18,
      topSpacerHeight: 18 * 44,
      totalHeight: 500 * 44,
    });
  });

  it("clamps overscroll to the last valid rows", () => {
    const window = resolveVirtualFixedListWindow({
      itemCount: 20,
      overscan: 3,
      rowHeight: 44,
      scrollTop: 100_000,
      viewportHeight: 44 * 4,
    });

    expect(window.endIndexExclusive).toBe(20);
    expect(window.startIndex).toBe(13);
    expect(window.renderedCount).toBe(7);
    expect(window.bottomSpacerHeight).toBe(0);
  });

  it("uses a minimum row height for invalid input", () => {
    const window = resolveVirtualFixedListWindow({
      itemCount: 3,
      overscan: -2,
      rowHeight: 0,
      scrollTop: Number.NaN,
      viewportHeight: 2,
    });

    expect(window).toMatchObject({
      endIndexExclusive: 2,
      renderedCount: 2,
      startIndex: 0,
      topSpacerHeight: 0,
      totalHeight: 3,
    });
  });
});
