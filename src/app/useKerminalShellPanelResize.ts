// @author kongweiguang

import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { ToolId } from "../features/workspace/types";
import type { WorkspaceShellLayout } from "../features/workspace/workspaceSession";
import {
  clampPanelWidth,
  initialPanelWidth,
  resolveShellLayout,
} from "./KerminalShell.helpers";

const TOOL_PANEL_INITIAL_MAX_WIDTH = 444;
const TOOL_PANEL_INITIAL_MIN_WIDTH = 340;
const TOOL_PANEL_MIN_WIDTH = 300;
const TOOL_PANEL_RESIZE_MAX_WIDTH = 720;

function normalizeCollapsedMachineGroupIds(groupIds: readonly string[] = []) {
  return [...new Set(groupIds.filter(Boolean))].sort();
}

export function useKerminalShellPanelResize({
  activeTool,
  viewportWidth,
  workspaceFrameRef,
}: {
  activeTool: ToolId | null;
  viewportWidth: number;
  workspaceFrameRef: RefObject<HTMLDivElement | null>;
}) {
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    initialPanelWidth(0.22, {
      max: 320,
      min: 240,
    }),
  );
  const [toolPanelWidth, setToolPanelWidth] = useState(() =>
    initialPanelWidth(0.24, {
      max: TOOL_PANEL_INITIAL_MAX_WIDTH,
      min: TOOL_PANEL_INITIAL_MIN_WIDTH,
    }),
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [collapsedMachineGroupIds, setCollapsedMachineGroupIds] = useState<
    string[]
  >([]);

  const handleCollapsedMachineGroupIdsChange = useCallback(
    (groupIds: string[]) => {
      setCollapsedMachineGroupIds(normalizeCollapsedMachineGroupIds(groupIds));
    },
    [],
  );

  const handleWorkspaceShellLayoutRestored = useCallback(
    (layout: WorkspaceShellLayout) => {
      if (typeof layout.leftPanelWidth === "number") {
        setLeftPanelWidth(
          clampPanelWidth(layout.leftPanelWidth, { max: 520, min: 220 }),
        );
      }
      if (typeof layout.toolPanelWidth === "number") {
        setToolPanelWidth(
          clampPanelWidth(layout.toolPanelWidth, {
            max: TOOL_PANEL_RESIZE_MAX_WIDTH,
            min: TOOL_PANEL_MIN_WIDTH,
          }),
        );
      }
      if (typeof layout.leftPanelCollapsed === "boolean") {
        setLeftPanelCollapsed(layout.leftPanelCollapsed);
      }
      setCollapsedMachineGroupIds(
        normalizeCollapsedMachineGroupIds(layout.collapsedMachineGroupIds),
      );
    },
    [],
  );

  const workspaceShellLayout = useMemo<WorkspaceShellLayout>(
    () => ({
      collapsedMachineGroupIds,
      leftPanelCollapsed,
      leftPanelWidth,
      toolPanelWidth,
    }),
    [
      collapsedMachineGroupIds,
      leftPanelCollapsed,
      leftPanelWidth,
      toolPanelWidth,
    ],
  );

  const layout = resolveShellLayout({
    activeToolOpen: activeTool !== null,
    leftPanelCollapsed,
    leftPanelWidth,
    toolPanelWidth,
    viewportWidth,
  });

  const beginPanelResize = useCallback(
    (panel: "left" | "tools", event: PointerEvent<HTMLDivElement>) => {
      if (
        (panel === "left" && layout.effectiveLeftPanelCollapsed) ||
        (panel === "tools" && !layout.effectiveRightPanelOpen)
      ) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startLeftWidth = leftPanelWidth;
      const startToolWidth = toolPanelWidth;
      const frameWidth =
        workspaceFrameRef.current?.getBoundingClientRect().width ??
        window.innerWidth;
      const terminalMinWidth = 360;

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (panel === "left") {
          const maxLeftWidth =
            frameWidth - layout.rightPanelColumnWidth - terminalMinWidth;
          setLeftPanelWidth(
            clampPanelWidth(startLeftWidth + moveEvent.clientX - startX, {
              max: Math.min(520, maxLeftWidth),
              min: 220,
            }),
          );
          return;
        }

        const maxToolWidth =
          frameWidth - layout.leftPanelColumnWidth - terminalMinWidth;
        setToolPanelWidth(
          clampPanelWidth(startToolWidth - (moveEvent.clientX - startX), {
            max: Math.min(TOOL_PANEL_RESIZE_MAX_WIDTH, maxToolWidth),
            min: TOOL_PANEL_MIN_WIDTH,
          }),
        );
      };
      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
    },
    [
      layout.effectiveLeftPanelCollapsed,
      layout.effectiveRightPanelOpen,
      layout.leftPanelColumnWidth,
      layout.rightPanelColumnWidth,
      leftPanelWidth,
      toolPanelWidth,
      workspaceFrameRef,
    ],
  );

  const resizeWithKeyboard = useCallback(
    (panel: "left" | "tools", event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      if (
        (panel === "left" && layout.effectiveLeftPanelCollapsed) ||
        (panel === "tools" && !layout.effectiveRightPanelOpen)
      ) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 40 : 16;
      if (panel === "left") {
        setLeftPanelWidth((current) =>
          clampPanelWidth(
            current + (event.key === "ArrowRight" ? step : -step),
            {
              max: 520,
              min: 220,
            },
          ),
        );
        return;
      }

      setToolPanelWidth((current) =>
        clampPanelWidth(current + (event.key === "ArrowLeft" ? step : -step), {
          max: TOOL_PANEL_RESIZE_MAX_WIDTH,
          min: TOOL_PANEL_MIN_WIDTH,
        }),
      );
    },
    [layout.effectiveLeftPanelCollapsed, layout.effectiveRightPanelOpen],
  );

  return {
    beginPanelResize,
    collapsedMachineGroupIds,
    handleCollapsedMachineGroupIdsChange,
    handleWorkspaceShellLayoutRestored,
    leftPanelCollapsed,
    resizeWithKeyboard,
    setLeftPanelCollapsed,
    workspaceShellLayout,
    ...layout,
  };
}
