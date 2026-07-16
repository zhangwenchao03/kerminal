import { useCallback, useRef, useState } from "react";
import type {
  MachineSidebarExternalDragFeedback,
  MachineSidebarMachineDragEvent,
} from "../features/machine-sidebar/MachineSidebar.shared";
import type { TerminalSplitDropIndicator } from "../features/terminal/TerminalSplitDropOverlay";
import {
  resolveTerminalSplitDropZone,
  terminalSplitDropZoneToDirection,
  terminalSplitDropZoneToPlacement,
  type TerminalSplitDropZone,
} from "../features/terminal/terminalSplitDropZones";
import { isTerminalSplitMachineKind } from "../features/terminal/terminalSplitTargets";
import type { SplitFocusedPaneOptions } from "../features/workspace/workspaceStoreContract";
import {
  isTerminalSessionTab,
  type TerminalSplitDirection,
  type TerminalTab,
} from "../features/workspace/types";
import { terminalSplitDropZoneLabel } from "./KerminalShell.contextWorkspaceShellHelpers";

const TERMINAL_WORKSPACE_CONTENT_SELECTOR =
  "[data-terminal-workspace-content]";

/** 终端拖放控制器依赖的 shell 状态与分屏命令。 */
export interface UseKerminalShellTerminalDropOptions {
  activeTabId: string;
  focusedPaneId: string;
  splitFocusedPane: (
    direction: TerminalSplitDirection,
    options?: SplitFocusedPaneOptions,
  ) => void;
  terminalTabs: TerminalTab[];
}

/** 提供给 shell 布局和主机侧栏的终端拖放状态与事件处理器。 */
export interface KerminalShellTerminalDropController {
  handleExternalMachineDrag: (
    event: MachineSidebarMachineDragEvent,
  ) => MachineSidebarExternalDragFeedback | undefined;
  handleExternalMachineDragEnd: () => void;
  handleExternalMachineDrop: (
    event: MachineSidebarMachineDragEvent,
  ) => boolean;
  terminalSplitDropIndicator: TerminalSplitDropIndicator | null;
}

/** 管理侧栏主机拖入当前终端分屏时的命中计算、提示和提交。 */
export function useKerminalShellTerminalDrop({
  activeTabId,
  focusedPaneId,
  splitFocusedPane,
  terminalTabs,
}: UseKerminalShellTerminalDropOptions): KerminalShellTerminalDropController {
  const [terminalSplitDropIndicator, setTerminalSplitDropIndicator] =
    useState<TerminalSplitDropIndicator | null>(null);
  const terminalSplitDropZoneRef = useRef<TerminalSplitDropZone | null>(null);

  const resolveTerminalDropZone = useCallback(
    (event: MachineSidebarMachineDragEvent) => {
      const activeTab =
        terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
      if (
        !activeTab ||
        !isTerminalSessionTab(activeTab) ||
        !focusedPaneId ||
        !isTerminalSplitMachineKind(event.machine.kind) ||
        typeof document === "undefined"
      ) {
        return null;
      }
      const terminalContent = document.querySelector<HTMLElement>(
        TERMINAL_WORKSPACE_CONTENT_SELECTOR,
      );
      if (!terminalContent) {
        return null;
      }
      return resolveTerminalSplitDropZone(
        terminalContent.getBoundingClientRect(),
        event,
      );
    },
    [activeTabId, focusedPaneId, terminalTabs],
  );

  const handleExternalMachineDrag = useCallback(
    (event: MachineSidebarMachineDragEvent) => {
      const zone = resolveTerminalDropZone(event);
      terminalSplitDropZoneRef.current = zone;
      if (!zone) {
        setTerminalSplitDropIndicator(null);
        return undefined;
      }
      setTerminalSplitDropIndicator((current) =>
        current?.machineName === event.machine.name && current.zone === zone
          ? current
          : { machineName: event.machine.name, zone },
      );
      return {
        hint: `松开分屏到${terminalSplitDropZoneLabel(zone)}`,
      };
    },
    [resolveTerminalDropZone],
  );

  const handleExternalMachineDragEnd = useCallback(() => {
    terminalSplitDropZoneRef.current = null;
    setTerminalSplitDropIndicator(null);
  }, []);

  const handleExternalMachineDrop = useCallback(
    (event: MachineSidebarMachineDragEvent) => {
      const zone = resolveTerminalDropZone(event);
      handleExternalMachineDragEnd();
      if (!zone) {
        return false;
      }
      splitFocusedPane(terminalSplitDropZoneToDirection(zone), {
        placement: terminalSplitDropZoneToPlacement(zone),
        targetMachineId: event.machine.id,
      });
      return true;
    },
    [handleExternalMachineDragEnd, resolveTerminalDropZone, splitFocusedPane],
  );

  return {
    handleExternalMachineDrag,
    handleExternalMachineDragEnd,
    handleExternalMachineDrop,
    terminalSplitDropIndicator,
  };
}
