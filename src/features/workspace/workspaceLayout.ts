import type {
  TerminalLayoutNode,
  TerminalSplitDirection,
  TerminalSplitLayoutSizes,
  TerminalSplitPlacement,
} from "./types";

export type TerminalPaneMovePlacement =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "center";

export interface MovePaneInLayoutCommand {
  placement: TerminalPaneMovePlacement;
  scope?: "pane" | "workspace";
  sourcePaneId: string;
  splitId: string;
  targetPaneId: string;
}

export function collectPaneIds(layout: TerminalLayoutNode): string[] {
  if (layout.type === "pane") {
    return [layout.paneId];
  }

  return layout.children.flatMap(collectPaneIds);
}

export function findFirstPaneId(
  layout: TerminalLayoutNode | undefined,
): string | undefined {
  if (!layout) {
    return undefined;
  }

  if (layout.type === "pane") {
    return layout.paneId;
  }

  return layout.children.map(findFirstPaneId).find(Boolean);
}

export function splitPaneInLayout(
  layout: TerminalLayoutNode,
  targetPaneId: string,
  newPaneId: string,
  direction: TerminalSplitDirection,
  splitId: string,
  placement: TerminalSplitPlacement = "after",
): TerminalLayoutNode {
  if (layout.type === "pane") {
    if (layout.paneId !== targetPaneId) {
      return layout;
    }

    return {
      type: "split",
      id: splitId,
      direction,
      children:
        placement === "before"
          ? [
              { type: "pane", paneId: newPaneId },
              { type: "pane", paneId: targetPaneId },
            ]
          : [
              { type: "pane", paneId: targetPaneId },
              { type: "pane", paneId: newPaneId },
            ],
    };
  }

  return {
    ...layout,
    children: layout.children.map((child) =>
      splitPaneInLayout(
        child,
        targetPaneId,
        newPaneId,
        direction,
        splitId,
        placement,
      ),
    ),
  };
}

export function updateSplitLayoutSizes(
  layout: TerminalLayoutNode,
  splitId: string,
  sizes: TerminalSplitLayoutSizes,
): TerminalLayoutNode {
  if (layout.type === "pane") {
    return layout;
  }

  const children = layout.children.map((child) =>
    updateSplitLayoutSizes(child, splitId, sizes),
  );
  const childrenChanged = children.some(
    (child, index) => child !== layout.children[index],
  );
  const currentLayout = childrenChanged ? { ...layout, children } : layout;

  if (layout.id !== splitId) {
    return currentLayout;
  }

  const nextSizes = normalizeSplitLayoutSizes(children, sizes);
  if (sameSplitLayoutSizes(layout.sizes, nextSizes)) {
    return currentLayout;
  }

  if (!nextSizes) {
    const { sizes: _sizes, ...withoutSizes } = currentLayout;
    return withoutSizes;
  }

  return { ...currentLayout, sizes: nextSizes };
}

export function movePaneInLayout(
  layout: TerminalLayoutNode,
  command: MovePaneInLayoutCommand,
): TerminalLayoutNode {
  const {
    placement,
    scope = "pane",
    sourcePaneId,
    splitId,
    targetPaneId,
  } = command;
  if (
    sourcePaneId === targetPaneId ||
    !layoutContainsPane(layout, sourcePaneId) ||
    !layoutContainsPane(layout, targetPaneId)
  ) {
    return layout;
  }

  if (placement === "center") {
    return swapPanePositionsInLayout(layout, sourcePaneId, targetPaneId);
  }

  const layoutWithoutSource = removePaneFromLayout(layout, sourcePaneId);
  if (!layoutWithoutSource || !layoutContainsPane(layoutWithoutSource, targetPaneId)) {
    return layout;
  }

  if (scope === "workspace") {
    return dockPaneAtRoot(
      layoutWithoutSource,
      { type: "pane", paneId: sourcePaneId },
      directionForMovePlacement(placement),
      splitId,
      splitPlacementForMovePlacement(placement),
    );
  }

  return insertPaneRelativeToTarget(
    layoutWithoutSource,
    { type: "pane", paneId: sourcePaneId },
    targetPaneId,
    directionForMovePlacement(placement),
    splitId,
    splitPlacementForMovePlacement(placement),
  );
}

function dockPaneAtRoot(
  layout: TerminalLayoutNode,
  sourcePane: TerminalLayoutNode,
  direction: TerminalSplitDirection,
  splitId: string,
  placement: TerminalSplitPlacement,
): TerminalLayoutNode {
  if (layout.type === "split" && layout.direction === direction) {
    const children =
      placement === "before"
        ? [sourcePane, ...layout.children]
        : [...layout.children, sourcePane];
    return splitWithoutSizes(layout, children);
  }

  return {
    type: "split",
    id: splitId,
    direction,
    children:
      placement === "before" ? [sourcePane, layout] : [layout, sourcePane],
  };
}

export function swapPanePositionsInLayout(
  layout: TerminalLayoutNode,
  sourcePaneId: string,
  targetPaneId: string,
): TerminalLayoutNode {
  if (
    sourcePaneId === targetPaneId ||
    !layoutContainsPane(layout, sourcePaneId) ||
    !layoutContainsPane(layout, targetPaneId)
  ) {
    return layout;
  }

  return replacePaneIds(layout, sourcePaneId, targetPaneId);
}

export function removePaneFromLayout(
  layout: TerminalLayoutNode,
  paneId: string,
): TerminalLayoutNode | undefined {
  if (layout.type === "pane") {
    return layout.paneId === paneId ? undefined : layout;
  }

  const children = layout.children
    .map((child) => removePaneFromLayout(child, paneId))
    .filter((child): child is TerminalLayoutNode => Boolean(child));

  if (children.length === 0) {
    return undefined;
  }

  if (children.length === 1) {
    return children[0];
  }

  const nextSizes = normalizeSplitLayoutSizes(children, layout.sizes);
  if (!nextSizes) {
    const { sizes: _sizes, ...withoutSizes } = layout;
    return {
      ...withoutSizes,
      children,
    };
  }

  return {
    ...layout,
    children,
    sizes: nextSizes,
  };
}

function normalizeSplitLayoutSizes(
  children: TerminalLayoutNode[],
  sizes: TerminalSplitLayoutSizes | undefined,
) {
  if (!sizes) {
    return undefined;
  }

  const normalized: TerminalSplitLayoutSizes = {};
  for (const child of children) {
    const key = layoutChildKey(child);
    const size = sizes[key];
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      return undefined;
    }
    normalized[key] = Math.round(size * 1000) / 1000;
  }

  return Object.keys(normalized).length === children.length
    ? normalized
    : undefined;
}

function sameSplitLayoutSizes(
  left: TerminalSplitLayoutSizes | undefined,
  right: TerminalSplitLayoutSizes | undefined,
) {
  if (!left || !right) {
    return left === right;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function layoutChildKey(child: TerminalLayoutNode) {
  return child.type === "pane" ? child.paneId : child.id;
}

function layoutContainsPane(layout: TerminalLayoutNode, paneId: string): boolean {
  if (layout.type === "pane") {
    return layout.paneId === paneId;
  }

  return layout.children.some((child) => layoutContainsPane(child, paneId));
}

function directionForMovePlacement(
  placement: Exclude<TerminalPaneMovePlacement, "center">,
): TerminalSplitDirection {
  return placement === "left" || placement === "right"
    ? "horizontal"
    : "vertical";
}

function splitPlacementForMovePlacement(
  placement: Exclude<TerminalPaneMovePlacement, "center">,
): TerminalSplitPlacement {
  return placement === "left" || placement === "top" ? "before" : "after";
}

function insertPaneRelativeToTarget(
  layout: TerminalLayoutNode,
  sourcePane: TerminalLayoutNode,
  targetPaneId: string,
  direction: TerminalSplitDirection,
  splitId: string,
  placement: TerminalSplitPlacement,
): TerminalLayoutNode {
  if (layout.type === "pane") {
    if (layout.paneId !== targetPaneId) {
      return layout;
    }

    return {
      type: "split",
      id: splitId,
      direction,
      children:
        placement === "before" ? [sourcePane, layout] : [layout, sourcePane],
    };
  }

  if (layout.direction === direction) {
    const targetIndex = layout.children.findIndex(
      (child) => child.type === "pane" && child.paneId === targetPaneId,
    );
    if (targetIndex >= 0) {
      const children = [...layout.children];
      children.splice(
        placement === "before" ? targetIndex : targetIndex + 1,
        0,
        sourcePane,
      );
      return splitWithoutSizes(layout, children);
    }
  }

  let changed = false;
  const children = layout.children.map((child) => {
    if (changed || !layoutContainsPane(child, targetPaneId)) {
      return child;
    }
    const nextChild = insertPaneRelativeToTarget(
      child,
      sourcePane,
      targetPaneId,
      direction,
      splitId,
      placement,
    );
    changed = nextChild !== child;
    return nextChild;
  });

  return changed ? splitWithoutSizes(layout, children) : layout;
}

function splitWithoutSizes(
  layout: Extract<TerminalLayoutNode, { type: "split" }>,
  children: TerminalLayoutNode[],
): TerminalLayoutNode {
  const { sizes: _sizes, ...withoutSizes } = layout;
  return {
    ...withoutSizes,
    children,
  };
}

function replacePaneIds(
  layout: TerminalLayoutNode,
  sourcePaneId: string,
  targetPaneId: string,
): TerminalLayoutNode {
  if (layout.type === "pane") {
    if (layout.paneId === sourcePaneId) {
      return { ...layout, paneId: targetPaneId };
    }
    if (layout.paneId === targetPaneId) {
      return { ...layout, paneId: sourcePaneId };
    }
    return layout;
  }

  let changed = false;
  const children = layout.children.map((child) => {
    const nextChild = replacePaneIds(child, sourcePaneId, targetPaneId);
    changed ||= nextChild !== child;
    return nextChild;
  });

  return changed ? { ...layout, children } : layout;
}
