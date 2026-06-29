type TerminalPaneMoveDropZoneRect = Pick<
  DOMRectReadOnly,
  "bottom" | "height" | "left" | "right" | "top" | "width"
>;

export type TerminalPaneMoveDropZone =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "center";

export type TerminalPaneMoveScope = "pane" | "workspace";

export interface TerminalPaneMoveDropZonePoint {
  clientX: number;
  clientY: number;
}

export interface TerminalPaneMoveDropZoneOptions {
  allowCenter?: boolean;
  inset?: number;
}

export interface TerminalPaneMoveDropCandidate {
  paneId: string;
  rect: TerminalPaneMoveDropZoneRect;
}

export interface TerminalPaneMoveDropTarget {
  paneId: string;
  scope: TerminalPaneMoveScope;
  zone: TerminalPaneMoveDropZone;
}

const DEFAULT_HOT_ZONE_INSET = 64;
const MAX_HOT_ZONE_RATIO = 0.35;

const zonePriority: Record<Exclude<TerminalPaneMoveDropZone, "center">, number> =
  {
    left: 0,
    right: 1,
    top: 2,
    bottom: 3,
  };

export function resolveTerminalPaneMoveDropZone(
  rect: TerminalPaneMoveDropZoneRect,
  point: TerminalPaneMoveDropZonePoint,
  options: TerminalPaneMoveDropZoneOptions = {},
): TerminalPaneMoveDropZone | null {
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
    zone: Exclude<TerminalPaneMoveDropZone, "center">;
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
    if (options.allowCenter === false) {
      return null;
    }
    return "center";
  }

  candidates.sort(
    (a, b) =>
      a.distance - b.distance || zonePriority[a.zone] - zonePriority[b.zone],
  );

  return candidates[0].zone;
}

export function resolveTerminalPaneMoveDropTarget(
  candidates: TerminalPaneMoveDropCandidate[],
  sourcePaneId: string,
  point: TerminalPaneMoveDropZonePoint,
  options: TerminalPaneMoveDropZoneOptions = {},
): TerminalPaneMoveDropTarget | null {
  for (const candidate of candidates) {
    if (candidate.paneId === sourcePaneId) {
      continue;
    }

    const zone = resolveTerminalPaneMoveDropZone(
      candidate.rect,
      point,
      options,
    );
    if (zone) {
      return { paneId: candidate.paneId, scope: "pane", zone };
    }
  }

  return null;
}

export function resolveTerminalPaneMoveWorkspaceDropTarget(
  paneIds: string[],
  sourcePaneId: string,
  rect: TerminalPaneMoveDropZoneRect,
  point: TerminalPaneMoveDropZonePoint,
  options: TerminalPaneMoveDropZoneOptions = {},
): TerminalPaneMoveDropTarget | null {
  const targetPaneId = paneIds.find((paneId) => paneId !== sourcePaneId);
  if (!targetPaneId) {
    return null;
  }

  const zone = resolveTerminalPaneMoveDropZone(rect, point, {
    ...options,
    allowCenter: false,
  });
  if (!zone || zone === "center") {
    return null;
  }

  return {
    paneId: targetPaneId,
    scope: "workspace",
    zone,
  };
}
