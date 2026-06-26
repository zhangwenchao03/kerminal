/**
 * Shared fixed-row virtual list for SFTP and local file panes.
 *
 * @author kongweiguang
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type UIEvent,
} from "react";
import { cn } from "../../lib/cn";
import {
  FIXED_ROW_VIRTUAL_LIST_OVERSCAN,
  FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT,
  FIXED_ROW_VIRTUAL_LIST_THRESHOLD,
  resolveVirtualFixedListWindow,
} from "./virtualFixedListModel";

const FALLBACK_VIEWPORT_ROWS = 14;

type FixedRowVirtualListProps<Item> = {
  ariaLabel: string;
  className?: string;
  entries: readonly Item[];
  getKey: (entry: Item, index: number) => Key;
  itemContainerClassName?: string;
  overscan?: number;
  renderItem: (entry: Item, index: number) => ReactNode;
  resetKey: string;
  rowHeight?: number;
  testId: string;
  threshold?: number;
};

export function FixedRowVirtualList<Item>({
  ariaLabel,
  className,
  entries,
  getKey,
  itemContainerClassName,
  overscan = FIXED_ROW_VIRTUAL_LIST_OVERSCAN,
  renderItem,
  resetKey,
  rowHeight = FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT,
  testId,
  threshold = FIXED_ROW_VIRTUAL_LIST_THRESHOLD,
}: FixedRowVirtualListProps<Item>) {
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const fallbackViewportHeight = rowHeight * FALLBACK_VIEWPORT_ROWS;
  const [viewport, setViewport] = useState({
    height: fallbackViewportHeight,
    scrollTop: 0,
  });
  const virtualized = entries.length > threshold;

  const syncViewport = useCallback(() => {
    const element = scrollElementRef.current;
    if (!element) {
      return;
    }
    const nextViewport = {
      height: element.clientHeight || fallbackViewportHeight,
      scrollTop: element.scrollTop,
    };
    setViewport((current) =>
      current.height === nextViewport.height &&
      current.scrollTop === nextViewport.scrollTop
        ? current
        : nextViewport,
    );
  }, [fallbackViewportHeight]);

  useLayoutEffect(() => {
    syncViewport();
    const element = scrollElementRef.current;
    if (!element) {
      return undefined;
    }

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(syncViewport);
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, [syncViewport]);

  useLayoutEffect(() => {
    const element = scrollElementRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = 0;
    syncViewport();
  }, [resetKey, syncViewport]);

  const virtualWindow = useMemo(
    () =>
      virtualized
        ? resolveVirtualFixedListWindow({
            itemCount: entries.length,
            overscan,
            rowHeight,
            scrollTop: viewport.scrollTop,
            viewportHeight: viewport.height,
          })
        : null,
    [entries.length, overscan, rowHeight, viewport.height, viewport.scrollTop, virtualized],
  );
  const startIndex = virtualWindow?.startIndex ?? 0;
  const endIndexExclusive = virtualWindow?.endIndexExclusive ?? entries.length;
  const renderedEntries = entries.slice(startIndex, endIndexExclusive);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const nextViewport = {
        height: element.clientHeight || fallbackViewportHeight,
        scrollTop: element.scrollTop,
      };
      setViewport((current) =>
        current.height === nextViewport.height &&
        current.scrollTop === nextViewport.scrollTop
          ? current
          : nextViewport,
      );
    },
    [fallbackViewportHeight],
  );

  return (
    <div
      aria-label={ariaLabel}
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      data-rendered-rows={renderedEntries.length}
      data-row-height={rowHeight}
      data-testid={testId}
      data-total-rows={entries.length}
      data-virtualized={virtualized ? "true" : "false"}
      onScroll={handleScroll}
      ref={scrollElementRef}
    >
      {virtualWindow ? (
        <>
          <div
            aria-hidden="true"
            style={{ height: virtualWindow.topSpacerHeight }}
          />
          <div className={itemContainerClassName}>
            {renderedEntries.map((entry, renderedIndex) => {
              const entryIndex = startIndex + renderedIndex;
              return (
                <div key={getKey(entry, entryIndex)} style={{ height: rowHeight }}>
                  {renderItem(entry, entryIndex)}
                </div>
              );
            })}
          </div>
          <div
            aria-hidden="true"
            style={{ height: virtualWindow.bottomSpacerHeight }}
          />
        </>
      ) : (
        <div className={itemContainerClassName}>
          {renderedEntries.map((entry, index) => (
            <div key={getKey(entry, index)} style={{ height: rowHeight }}>
              {renderItem(entry, index)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
