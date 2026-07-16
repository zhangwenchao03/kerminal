import type {
  TerminalSplitDirection,
  TerminalSplitPlacement,
} from "../workspace/contracts/index";

export type TerminalSplitDropZone = "left" | "right" | "top" | "bottom";

export interface TerminalSplitDropZonePoint {
  clientX: number;
  clientY: number;
}

export interface TerminalSplitDropZoneOptions {
  inset?: number;
}

type TerminalSplitDropZoneRect = Pick<
  DOMRectReadOnly,
  "bottom" | "height" | "left" | "right" | "top" | "width"
>;

const DEFAULT_HOT_ZONE_INSET = 96;
const MAX_HOT_ZONE_RATIO = 0.4;

const zonePriority: Record<TerminalSplitDropZone, number> = {
  left: 0,
  right: 1,
  top: 2,
  bottom: 3,
};

export function resolveTerminalSplitDropZone(
  rect: TerminalSplitDropZoneRect,
  point: TerminalSplitDropZonePoint,
  options: TerminalSplitDropZoneOptions = {},
): TerminalSplitDropZone | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const { clientX, clientY } = point;
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }

  const requestedInset = Math.max(0, options.inset ?? DEFAULT_HOT_ZONE_INSET);
  const horizontalInset = Math.min(
    requestedInset,
    rect.width * MAX_HOT_ZONE_RATIO,
  );
  const verticalInset = Math.min(
    requestedInset,
    rect.height * MAX_HOT_ZONE_RATIO,
  );
  const candidates: Array<{
    distance: number;
    zone: TerminalSplitDropZone;
  }> = [];

  const leftDistance = clientX - rect.left;
  const rightDistance = rect.right - clientX;
  const topDistance = clientY - rect.top;
  const bottomDistance = rect.bottom - clientY;

  if (leftDistance <= horizontalInset) {
    candidates.push({ distance: leftDistance, zone: "left" });
  }
  if (rightDistance <= horizontalInset) {
    candidates.push({ distance: rightDistance, zone: "right" });
  }
  if (topDistance <= verticalInset) {
    candidates.push({ distance: topDistance, zone: "top" });
  }
  if (bottomDistance <= verticalInset) {
    candidates.push({ distance: bottomDistance, zone: "bottom" });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      a.distance - b.distance || zonePriority[a.zone] - zonePriority[b.zone],
  );

  return candidates[0].zone;
}

export function terminalSplitDropZoneToDirection(
  zone: TerminalSplitDropZone,
): TerminalSplitDirection {
  return zone === "left" || zone === "right" ? "horizontal" : "vertical";
}

export function terminalSplitDropZoneToPlacement(
  zone: TerminalSplitDropZone,
): TerminalSplitPlacement {
  return zone === "left" || zone === "top" ? "before" : "after";
}
