import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/settingsModel";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalSplitDirection,
  TerminalSplitLayoutSizes,
} from "../workspace/types";
import { isTerminalSessionTab } from "../workspace/types";
import { collectPaneIds } from "../workspace/workspaceLayout";
import { cn } from "../../lib/cn";
import { TerminalEmptyState } from "./TerminalEmptyState";
import {
  TerminalPaneMoveDragPreview,
  TerminalPaneMoveOverlay,
  terminalPaneMoveIndicatorLabel,
  type TerminalPaneMoveIndicator,
} from "./TerminalPaneMoveOverlay";
import { TerminalPaneErrorBoundary } from "./TerminalPaneErrorBoundary";
import { TerminalPaneLayout } from "./TerminalPaneLayout";
import {
  TerminalSplitDropOverlay,
  type TerminalSplitDropIndicator,
} from "./TerminalSplitDropOverlay";
import {
  resolveTerminalPaneMoveDropTarget,
  type TerminalPaneMoveDropCandidate,
  type TerminalPaneMoveDropTarget,
  type TerminalPaneMoveDropZone,
} from "./terminalPaneMoveDropZones";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import { XtermPane } from "./XtermPane";

const terminalPaneRuntimeSlotAttribute = "data-terminal-pane-runtime-slot";
const terminalPaneCardAttribute = "data-terminal-pane-card";
const PANE_MOVE_DRAG_THRESHOLD_PX = 6;

type TerminalPaneRuntimeRect = Pick<
  CSSProperties,
  "height" | "left" | "top" | "width"
>;

interface TerminalRuntimePane {
  active: boolean;
  pane: TerminalPane;
}

interface TerminalPaneMoveDragState {
  active: boolean;
  currentX: number;
  currentY: number;
  originX: number;
  originY: number;
  pointerId: number;
  sourcePaneId: string;
}

interface TerminalWorkspaceContentProps {
  activeTab: TerminalTab | undefined;
  contentInsetStyle?: CSSProperties;
  focusedPaneId: string;
  machineGroups?: MachineGroup[];
  onClosePane: (paneId: string) => void;
  onCreateTerminal?: () => void;
  onFocusPane: (paneId: string) => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
  onOpenLogs?: () => void;
  onMovePane?: (
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMoveDropZone,
  ) => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitLayoutSizesChange?: (
    splitId: string,
    sizes: TerminalSplitLayoutSizes,
  ) => void;
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  panesById: Map<string, TerminalPane>;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  renderCustomTab?: (tab: TerminalTab, active: boolean) => ReactNode;
  resolvedTheme: ResolvedTheme;
  splitDropIndicator?: TerminalSplitDropIndicator | null;
  tabs: TerminalTab[];
  terminalAppearance: TerminalAppearance;
  terminalInset: number;
  workspacePaddingClass: string;
}

export function TerminalWorkspaceContent({
  activeTab,
  contentInsetStyle,
  focusedPaneId,
  machineGroups,
  onClosePane,
  onCreateTerminal,
  onFocusPane,
  onOpenAgentTool,
  onOpenConnection,
  onOpenLogs,
  onMovePane,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onSplitLayoutSizesChange,
  onSplitPane,
  panesById,
  resolvePaneLines,
  resolvePaneOutputHistory,
  renderCustomTab,
  resolvedTheme,
  splitDropIndicator,
  tabs,
  terminalAppearance,
  terminalInset,
  workspacePaddingClass,
}: TerminalWorkspaceContentProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [runtimeSlotRects, setRuntimeSlotRects] = useState<
    Record<string, TerminalPaneRuntimeRect>
  >({});
  const [paneMoveDrag, setPaneMoveDrag] =
    useState<TerminalPaneMoveDragState | null>(null);
  const [paneMoveTarget, setPaneMoveTarget] =
    useState<TerminalPaneMoveDropTarget | null>(null);
  const runtimePanes = useMemo(
    () => resolveTerminalRuntimePanes(tabs, activeTab, panesById),
    [activeTab, panesById, tabs],
  );
  const activePaneIds = useMemo(
    () => (isTerminalSessionTab(activeTab) ? collectPaneIds(activeTab.layout) : []),
    [activeTab],
  );
  const paneMoveIndicator = useMemo<TerminalPaneMoveIndicator | null>(() => {
    if (!paneMoveDrag?.active || !paneMoveTarget) {
      return null;
    }
    const targetTitle = panesById.get(paneMoveTarget.paneId)?.title;
    if (!targetTitle) {
      return null;
    }
    return {
      targetTitle,
      zone: paneMoveTarget.zone,
    };
  }, [paneMoveDrag, paneMoveTarget, panesById]);
  const paneMovePreview =
    paneMoveDrag?.active && typeof document !== "undefined"
      ? createPortal(
          <TerminalPaneMoveDragPreview
            hint={
              paneMoveIndicator
                ? terminalPaneMoveIndicatorLabel(paneMoveIndicator)
                : undefined
            }
            title={
              panesById.get(paneMoveDrag.sourcePaneId)?.title ?? "终端分屏"
            }
            x={paneMoveDrag.currentX}
            y={paneMoveDrag.currentY}
          />,
          document.body,
        )
      : null;
  const resolvePaneMoveTarget = useCallback(
    (
      sourcePaneId: string,
      point: { clientX: number; clientY: number },
    ): TerminalPaneMoveDropTarget | null => {
      const workspace = workspaceRef.current;
      if (!workspace) {
        return null;
      }

      const candidates: TerminalPaneMoveDropCandidate[] = [];
      workspace
        .querySelectorAll<HTMLElement>(`[${terminalPaneCardAttribute}]`)
        .forEach((card) => {
          const paneId = card.dataset.terminalPaneCard;
          if (!paneId || !activePaneIds.includes(paneId)) {
            return;
          }
          candidates.push({ paneId, rect: card.getBoundingClientRect() });
        });

      return resolveTerminalPaneMoveDropTarget(candidates, sourcePaneId, point);
    },
    [activePaneIds],
  );
  const updateRuntimeSlotRects = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const nextRects: Record<string, TerminalPaneRuntimeRect> = {};
    const slots = workspace.querySelectorAll<HTMLElement>(
      `[${terminalPaneRuntimeSlotAttribute}]`,
    );
    slots.forEach((slot) => {
      const paneId = slot.dataset.terminalPaneRuntimeSlot;
      if (!paneId) {
        return;
      }
      const slotRect = slot.getBoundingClientRect();
      nextRects[paneId] = {
        height: slotRect.height,
        left: slotRect.left - workspaceRect.left,
        top: slotRect.top - workspaceRect.top,
        width: slotRect.width,
      };
    });
    setRuntimeSlotRects((current) =>
      terminalPaneRuntimeRectsEqual(current, nextRects)
        ? current
        : nextRects,
    );
  }, []);

  const cancelPaneMoveDrag = useCallback(() => {
    setPaneMoveDrag(null);
    setPaneMoveTarget(null);
  }, []);

  const beginPaneMoveDrag = useCallback(
    (paneId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (
        !onMovePane ||
        activePaneIds.length <= 1 ||
        !activePaneIds.includes(paneId)
      ) {
        return;
      }

      setPaneMoveDrag({
        active: false,
        currentX: event.clientX,
        currentY: event.clientY,
        originX: event.clientX,
        originY: event.clientY,
        pointerId: event.pointerId,
        sourcePaneId: paneId,
      });
      setPaneMoveTarget(null);
    },
    [activePaneIds, onMovePane],
  );

  useEffect(() => {
    cancelPaneMoveDrag();
  }, [activeTab?.id, cancelPaneMoveDrag]);

  useEffect(() => {
    if (!paneMoveDrag || !onMovePane) {
      return undefined;
    }

    const movedFarEnough = (event: PointerEvent) =>
      paneMoveDrag.active ||
      Math.hypot(
        event.clientX - paneMoveDrag.originX,
        event.clientY - paneMoveDrag.originY,
      ) >= PANE_MOVE_DRAG_THRESHOLD_PX;

    const updateTarget = (event: PointerEvent) => {
      const target = resolvePaneMoveTarget(paneMoveDrag.sourcePaneId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      setPaneMoveTarget(target);
      return target;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== paneMoveDrag.pointerId) {
        return;
      }
      if (!movedFarEnough(event)) {
        return;
      }

      event.preventDefault();
      setPaneMoveDrag((current) =>
        current?.pointerId === paneMoveDrag.pointerId
          ? {
              ...current,
              active: true,
              currentX: event.clientX,
              currentY: event.clientY,
            }
          : current,
      );
      updateTarget(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== paneMoveDrag.pointerId) {
        return;
      }

      event.preventDefault();
      const target = movedFarEnough(event) ? updateTarget(event) : null;
      if (target) {
        onMovePane(paneMoveDrag.sourcePaneId, target.paneId, target.zone);
      }
      cancelPaneMoveDrag();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === paneMoveDrag.pointerId) {
        cancelPaneMoveDrag();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPaneMoveDrag();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", cancelPaneMoveDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", cancelPaneMoveDrag);
    };
  }, [cancelPaneMoveDrag, onMovePane, paneMoveDrag, resolvePaneMoveTarget]);

  useLayoutEffect(() => {
    updateRuntimeSlotRects();

    const workspace = workspaceRef.current;
    if (!workspace) {
      return undefined;
    }

    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateRuntimeSlotRects)
        : undefined;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateRuntimeSlotRects);

    resizeObserver?.observe(workspace);
    workspace
      .querySelectorAll<HTMLElement>(`[${terminalPaneRuntimeSlotAttribute}]`)
      .forEach((slot) => resizeObserver?.observe(slot));
    window.addEventListener("resize", updateRuntimeSlotRects);

    return () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateRuntimeSlotRects);
    };
  }, [activeTab?.id, tabs, terminalInset, updateRuntimeSlotRects]);

  return (
    <div
      className={cn(
        "relative min-h-0 flex-1 transition-[margin-right] duration-200 ease-out",
        workspacePaddingClass,
      )}
      data-terminal-workspace-content
      ref={workspaceRef}
      style={contentInsetStyle}
    >
      {splitDropIndicator ? (
        <TerminalSplitDropOverlay indicator={splitDropIndicator} />
      ) : null}
      {paneMoveIndicator ? (
        <TerminalPaneMoveOverlay indicator={paneMoveIndicator} />
      ) : null}
      {paneMovePreview}
      {runtimePanes.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          {runtimePanes.map(({ active, pane }) => {
            const rect = runtimeSlotRects[pane.id];
            const visible = active && Boolean(rect);
            const splitPane = (
              direction: TerminalSplitDirection,
              options?: TerminalSplitPaneOptions,
            ) => {
              const splitOptions = { ...options, sourcePaneId: pane.id };
              onFocusPane(pane.id);
              onSplitPane(direction, splitOptions);
            };

            return (
              <div
                className={cn(
                  "absolute flex min-h-0",
                  visible
                    ? "pointer-events-auto"
                    : "pointer-events-none invisible",
                )}
                key={pane.id}
                onPointerDown={() => onFocusPane(pane.id)}
                style={rect ?? { height: 1, left: 0, top: 0, width: 1 }}
              >
                <TerminalPaneErrorBoundary onOpenLogs={onOpenLogs} pane={pane}>
                  <XtermPane
                    args={pane.args}
                    currentCwd={pane.currentCwd}
                    cwd={pane.cwd}
                    env={pane.env}
                    focused={visible && pane.id === focusedPaneId}
                    paneId={pane.id}
                    profileId={pane.profileId}
                    remoteCommand={pane.remoteCommand}
                    remoteHostId={pane.remoteHostId}
                    remoteHostProduction={pane.remoteHostProduction}
                    onCurrentCwdChange={(cwd) =>
                      onPaneCurrentCwdChange?.(pane.id, cwd)
                    }
                    onOpenLogs={onOpenLogs}
                    onOutputHistoryChange={(outputHistory) =>
                      onPaneOutputHistoryChange?.(pane.id, outputHistory)
                    }
                    onSplitPane={splitPane}
                    outputHistory={pane.outputHistory}
                    resolveInitialOutputHistory={() =>
                      resolvePaneOutputHistory?.(pane.id) ?? pane.outputHistory
                    }
                    resolvedTheme={resolvedTheme}
                    shell={pane.shell}
                    target={pane.target}
                    terminalAppearance={terminalAppearance}
                    title={pane.title}
                  />
                </TerminalPaneErrorBoundary>
              </div>
            );
          })}
        </div>
      ) : null}
      {tabs.length > 0 ? (
        tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          return (
            <div
              aria-hidden={!active || undefined}
              className={cn(
                "absolute min-h-0",
                active
                  ? "pointer-events-auto z-10"
                  : "pointer-events-none invisible z-0",
              )}
              key={tab.id}
              style={{ inset: terminalInset }}
            >
              {isTerminalSessionTab(tab) ? (
                <TerminalPaneLayout
                  focusedPaneId={active ? focusedPaneId : ""}
                  draggingPaneId={
                    paneMoveDrag?.active ? paneMoveDrag.sourcePaneId : undefined
                  }
                  layout={tab.layout}
                  machineGroups={machineGroups}
                  panelGroupId={tab.id}
                  onBeginPaneDrag={
                    active && onMovePane && activePaneIds.length > 1
                      ? beginPaneMoveDrag
                      : undefined
                  }
                  onClosePane={onClosePane}
                  onCurrentCwdChange={onPaneCurrentCwdChange}
                  onFocusPane={onFocusPane}
                  onOpenLogs={onOpenLogs}
                  onOutputHistoryChange={onPaneOutputHistoryChange}
                  onSplitLayoutSizesChange={onSplitLayoutSizesChange}
                  onSplitPane={onSplitPane}
                  panesById={panesById}
                  resolvePaneLines={resolvePaneLines}
                  resolvePaneOutputHistory={resolvePaneOutputHistory}
                  resolvedTheme={resolvedTheme}
                  runtimeMount="slot"
                  terminalAppearance={terminalAppearance}
                />
              ) : (
                (renderCustomTab?.(tab, active) ?? (
                  <div className="kerminal-solid-surface flex h-full items-center justify-center rounded-2xl border text-sm text-zinc-500 dark:text-zinc-400">
                    此标签暂不可用。
                  </div>
                ))
              )}
            </div>
          );
        })
      ) : (
        <TerminalEmptyState
          onCreateTerminal={onCreateTerminal}
          onOpenAgentTool={onOpenAgentTool}
          onOpenConnection={onOpenConnection}
        />
      )}
    </div>
  );
}

function resolveTerminalRuntimePanes(
  tabs: TerminalTab[],
  activeTab: TerminalTab | undefined,
  panesById: Map<string, TerminalPane>,
): TerminalRuntimePane[] {
  const activePaneIds = new Set(
    isTerminalSessionTab(activeTab) ? collectPaneIds(activeTab.layout) : [],
  );
  const paneIds: string[] = [];
  const seenPaneIds = new Set<string>();

  for (const tab of tabs) {
    if (!isTerminalSessionTab(tab)) {
      continue;
    }
    for (const paneId of collectPaneIds(tab.layout)) {
      if (seenPaneIds.has(paneId)) {
        continue;
      }
      seenPaneIds.add(paneId);
      paneIds.push(paneId);
    }
  }

  return paneIds.flatMap((paneId) => {
    const pane = panesById.get(paneId);
    return pane ? [{ active: activePaneIds.has(paneId), pane }] : [];
  });
}

function terminalPaneRuntimeRectsEqual(
  left: Record<string, TerminalPaneRuntimeRect>,
  right: Record<string, TerminalPaneRuntimeRect>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const leftRect = left[key];
    const rightRect = right[key];
    return (
      Boolean(rightRect) &&
      leftRect.height === rightRect.height &&
      leftRect.left === rightRect.left &&
      leftRect.top === rightRect.top &&
      leftRect.width === rightRect.width
    );
  });
}
