import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../components/ui/resizable";
import { Fragment } from "react";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/settingsModel";
import type {
  TerminalLayoutNode,
  TerminalPane,
  TerminalSplitDirection,
} from "../workspace/types";
import { TerminalPaneErrorBoundary } from "./TerminalPaneErrorBoundary";
import { TerminalPaneCard } from "./TerminalPaneCard";

interface TerminalPaneLayoutProps {
  focusedPaneId: string;
  layout: TerminalLayoutNode;
  onClosePane: (paneId: string) => void;
  onCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenLogs?: () => void;
  onOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  panesById: Map<string, TerminalPane>;
  resolvedTheme: ResolvedTheme;
  terminalAppearance: TerminalAppearance;
}

type NormalizedTerminalSplitLayout = Extract<
  TerminalLayoutNode,
  { type: "split" }
>;

function normalizeRootLayout(
  layout: TerminalLayoutNode,
): NormalizedTerminalSplitLayout {
  if (layout.type === "split") {
    return layout;
  }

  return {
    children: [layout],
    direction: "horizontal",
    id: `root-${layout.paneId}`,
    type: "split",
  };
}

function TerminalPaneLayoutNode({
  focusedPaneId,
  layout,
  onClosePane,
  onCurrentCwdChange,
  onFocusPane,
  onOpenLogs,
  onOutputHistoryChange,
  onSplitPane,
  panesById,
  resolvedTheme,
  terminalAppearance,
}: TerminalPaneLayoutProps) {
  if (layout.type !== "pane") {
    return (
      <TerminalPaneLayout
        focusedPaneId={focusedPaneId}
        layout={layout}
        onClosePane={onClosePane}
        onCurrentCwdChange={onCurrentCwdChange}
        onFocusPane={onFocusPane}
        onOpenLogs={onOpenLogs}
        onOutputHistoryChange={onOutputHistoryChange}
        onSplitPane={onSplitPane}
        panesById={panesById}
        resolvedTheme={resolvedTheme}
        terminalAppearance={terminalAppearance}
      />
    );
  }

  const pane = panesById.get(layout.paneId);
  if (!pane) {
    return null;
  }

  return (
    <TerminalPaneErrorBoundary onOpenLogs={onOpenLogs} pane={pane}>
      <TerminalPaneCard
        focused={pane.id === focusedPaneId}
        onClosePane={onClosePane}
        onCurrentCwdChange={onCurrentCwdChange}
        onFocusPane={onFocusPane}
        onOpenLogs={onOpenLogs}
        onOutputHistoryChange={onOutputHistoryChange}
        onSplitPane={onSplitPane}
        pane={pane}
        resolvedTheme={resolvedTheme}
        terminalAppearance={terminalAppearance}
      />
    </TerminalPaneErrorBoundary>
  );
}

export function TerminalPaneLayout({
  focusedPaneId,
  layout,
  onClosePane,
  onCurrentCwdChange,
  onFocusPane,
  onOpenLogs,
  onOutputHistoryChange,
  onSplitPane,
  panesById,
  resolvedTheme,
  terminalAppearance,
}: TerminalPaneLayoutProps) {
  const normalizedLayout = normalizeRootLayout(layout);

  return (
    <ResizablePanelGroup
      direction={normalizedLayout.direction}
      id={normalizedLayout.id}
    >
      {normalizedLayout.children.map((child, index) => {
        const childKey = child.type === "pane" ? child.paneId : child.id;

        return (
          <Fragment key={childKey}>
            {index > 0 ? (
              <ResizableHandle
                aria-label="调整终端分屏大小"
                key={`handle-${childKey}`}
              />
            ) : null}
            <ResizablePanel
              defaultSize={`${100 / normalizedLayout.children.length}%`}
              key={childKey}
              minSize="20%"
            >
              <TerminalPaneLayoutNode
                focusedPaneId={focusedPaneId}
                layout={child}
                onClosePane={onClosePane}
                onCurrentCwdChange={onCurrentCwdChange}
                onFocusPane={onFocusPane}
                onOpenLogs={onOpenLogs}
                onOutputHistoryChange={onOutputHistoryChange}
                onSplitPane={onSplitPane}
                panesById={panesById}
                resolvedTheme={resolvedTheme}
                terminalAppearance={terminalAppearance}
              />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}
