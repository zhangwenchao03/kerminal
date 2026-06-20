import type {
  TerminalLayoutNode,
  TerminalSplitDirection,
} from "./types";

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
): TerminalLayoutNode {
  if (layout.type === "pane") {
    if (layout.paneId !== targetPaneId) {
      return layout;
    }

    return {
      type: "split",
      id: splitId,
      direction,
      children: [
        { type: "pane", paneId: targetPaneId },
        { type: "pane", paneId: newPaneId },
      ],
    };
  }

  return {
    ...layout,
    children: layout.children.map((child) =>
      splitPaneInLayout(child, targetPaneId, newPaneId, direction, splitId),
    ),
  };
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

  return {
    ...layout,
    children,
  };
}
