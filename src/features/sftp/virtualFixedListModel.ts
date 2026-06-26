/**
 * Fixed-row virtual list window calculations for SFTP and local file panes.
 *
 * @author kongweiguang
 */

export const FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT = 44;
export const FIXED_ROW_VIRTUAL_LIST_THRESHOLD = 120;
export const FIXED_ROW_VIRTUAL_LIST_OVERSCAN = 8;

export type VirtualFixedListWindow = {
  bottomSpacerHeight: number;
  endIndexExclusive: number;
  renderedCount: number;
  startIndex: number;
  topSpacerHeight: number;
  totalHeight: number;
};

export function resolveVirtualFixedListWindow({
  itemCount,
  overscan,
  rowHeight,
  scrollTop,
  viewportHeight,
}: {
  itemCount: number;
  overscan: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): VirtualFixedListWindow {
  const safeItemCount = Math.max(0, Math.floor(itemCount));
  const safeRowHeight = Math.max(1, rowHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const totalHeight = safeItemCount * safeRowHeight;

  if (safeItemCount === 0) {
    return {
      bottomSpacerHeight: 0,
      endIndexExclusive: 0,
      renderedCount: 0,
      startIndex: 0,
      topSpacerHeight: 0,
      totalHeight: 0,
    };
  }

  const maxScrollTop = Math.max(0, totalHeight - Math.max(0, viewportHeight));
  const clampedScrollTop = clampFinite(scrollTop, 0, maxScrollTop);
  const firstVisibleIndex = Math.min(
    safeItemCount - 1,
    Math.floor(clampedScrollTop / safeRowHeight),
  );
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / safeRowHeight));
  const startIndex = Math.max(0, firstVisibleIndex - safeOverscan);
  const endIndexExclusive = Math.min(
    safeItemCount,
    firstVisibleIndex + visibleCount + safeOverscan,
  );
  const renderedCount = Math.max(0, endIndexExclusive - startIndex);

  return {
    bottomSpacerHeight: Math.max(0, (safeItemCount - endIndexExclusive) * safeRowHeight),
    endIndexExclusive,
    renderedCount,
    startIndex,
    topSpacerHeight: startIndex * safeRowHeight,
    totalHeight,
  };
}

function clampFinite(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
