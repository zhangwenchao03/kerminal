import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { clampContextMenuPosition, type TerminalTabGroup } from "./terminalTabChrome";

const TAB_OVERVIEW_OVERFLOW_TOLERANCE = 1;

interface UseTerminalTabOverviewOptions {
  collapsedTabGroupIds: ReadonlySet<string>;
  onSelectTab: (tabId: string) => void;
  tabGroups: TerminalTabGroup[];
  tabCount: number;
}

export function useTerminalTabOverview({
  collapsedTabGroupIds,
  onSelectTab,
  tabGroups,
  tabCount,
}: UseTerminalTabOverviewOptions) {
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabOverviewButtonRef = useRef<HTMLButtonElement>(null);
  const tabOverviewMenuRef = useRef<HTMLDivElement>(null);
  const [tabOverviewOpen, setTabOverviewOpen] = useState(false);
  const [tabOverviewAvailable, setTabOverviewAvailable] = useState(false);
  const tabOverviewAvailableRef = useRef(false);
  const [tabOverviewPosition, setTabOverviewPosition] = useState({ x: 0, y: 0 });
  const shouldShowTabOverview = tabCount > 1 && tabOverviewAvailable;
  const measurementKey = useMemo(
    () =>
      tabGroups
        .map((group) =>
          [
            group.id,
            group.title,
            group.grouped ? "grouped" : "single",
            collapsedTabGroupIds.has(group.id) ? "collapsed" : "expanded",
            group.tabs.map((tab) => tab.id).join(","),
          ].join(":"),
        )
        .join("|"),
    [collapsedTabGroupIds, tabGroups],
  );

  const updateAvailability = useCallback(() => {
    const tabList = tabListRef.current;
    const hasHorizontalOverflow = tabList
      ? tabList.scrollWidth - tabList.clientWidth >
        TAB_OVERVIEW_OVERFLOW_TOLERANCE
      : false;
    if (tabOverviewAvailableRef.current === hasHorizontalOverflow) {
      return;
    }
    tabOverviewAvailableRef.current = hasHorizontalOverflow;
    setTabOverviewAvailable(hasHorizontalOverflow);
  }, []);

  useEffect(() => {
    updateAvailability();
    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateAvailability)
        : undefined;
    const tabList = tabListRef.current;

    window.addEventListener("resize", updateAvailability);
    if (!tabList || typeof ResizeObserver === "undefined") {
      return () => {
        if (frameId !== undefined) {
          window.cancelAnimationFrame(frameId);
        }
        window.removeEventListener("resize", updateAvailability);
      };
    }

    const resizeObserver = new ResizeObserver(updateAvailability);
    resizeObserver.observe(tabList);
    for (const child of Array.from(tabList.children)) {
      resizeObserver.observe(child);
    }

    return () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", updateAvailability);
      resizeObserver.disconnect();
    };
  }, [measurementKey, updateAvailability]);

  useEffect(() => {
    if (!shouldShowTabOverview && tabOverviewOpen) {
      setTabOverviewOpen(false);
    }
  }, [shouldShowTabOverview, tabOverviewOpen]);

  useEffect(() => {
    if (!tabOverviewOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        tabOverviewMenuRef.current?.contains(target) ||
        tabOverviewButtonRef.current?.contains(target)
      ) {
        return;
      }
      setTabOverviewOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTabOverviewOpen(false);
      }
    };
    const closeOnResize = () => setTabOverviewOpen(false);
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [tabOverviewOpen]);

  useLayoutEffect(() => {
    if (!tabOverviewOpen) {
      return;
    }
    const triggerElement = tabOverviewButtonRef.current;
    const menuElement = tabOverviewMenuRef.current;
    if (!triggerElement || !menuElement) {
      return;
    }
    const triggerRect = triggerElement.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();
    const nextPosition = clampContextMenuPosition(
      triggerRect.right - menuRect.width,
      triggerRect.bottom + 6,
      menuRect.width,
      menuRect.height,
    );
    setTabOverviewPosition((current) =>
      current.x === nextPosition.x && current.y === nextPosition.y
        ? current
        : nextPosition,
    );
  }, [tabGroups, tabOverviewOpen]);

  const handleTabListWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (target.scrollTop !== 0) {
        target.scrollTop = 0;
      }
      const maxScrollLeft = target.scrollWidth - target.clientWidth;
      if (maxScrollLeft <= 1) {
        return;
      }
      const wheelDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (wheelDelta === 0) {
        return;
      }
      event.preventDefault();
      target.scrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, target.scrollLeft + wheelDelta),
      );
    },
    [],
  );
  const toggleTabOverview = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setTabOverviewPosition({
      x: Math.round(rect.right - 288),
      y: Math.round(rect.bottom + 6),
    });
    setTabOverviewOpen((open) => !open);
  }, []);
  const selectTabFromOverview = useCallback(
    (tabId: string) => {
      setTabOverviewOpen(false);
      onSelectTab(tabId);
    },
    [onSelectTab],
  );

  return {
    handleTabListWheel,
    selectTabFromOverview,
    shouldShowTabOverview,
    tabListRef,
    tabOverviewButtonRef,
    tabOverviewMenuRef,
    tabOverviewOpen,
    tabOverviewPosition,
    toggleTabOverview,
  };
}
