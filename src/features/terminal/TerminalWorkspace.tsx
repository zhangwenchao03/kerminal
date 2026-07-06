import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import type {
  InterfaceDensity,
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/settingsModel";
import {
  analyzeBroadcastCommand,
  canBroadcastCommand,
  type BroadcastCommandAnalysis,
} from "./broadcastCommandPolicy";
import { collectPaneIds } from "../workspace/workspaceLayout";
import {
  isTerminalSessionTab,
  type MachineStatus,
  type MachineGroup,
  type TerminalPane,
  type TerminalSplitDirection,
  type TerminalSplitLayoutSizes,
  type TerminalTab,
  type TerminalTabGroupPreference,
  type TerminalTabGroupPreferences,
  type WorkspaceFileDirtyState,
} from "../workspace/types";
import { dispatchWorkspaceFileTabCommand } from "../workspace/workspaceFileTabActions";
import { resolveWorkspaceTabCloseDecision } from "../workspace/workspaceTabCloseGuardModel";
import { TerminalBroadcastBar } from "./TerminalBroadcastBar";
import { TerminalTabOverviewMenu } from "./TerminalTabOverviewMenu";
import { TerminalWorkspaceContent } from "./TerminalWorkspaceContent";
import type {
  TerminalPaneMoveDropZone,
  TerminalPaneMoveScope,
} from "./terminalPaneMoveDropZones";
import type { TerminalSplitDropIndicator } from "./TerminalSplitDropOverlay";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import type { ConnectionState } from "./XtermPane.helpers";
import { useTerminalBroadcastTargets } from "./useTerminalBroadcastTargets";
import {
  buildTerminalTabGroups,
  clampContextMenuPosition,
  CloseTabsConfirmationDialog,
  CloseWorkspaceFileTabsConfirmationDialog,
  TerminalTabButton,
  TerminalTabContextMenuItems,
  TerminalTabGroupContextMenuItems,
  TerminalTabGroupEditDialog,
  TerminalTabGroupHeader,
  TerminalTabRenameDialog,
  type TerminalTabGroup,
  type TerminalTabContextMenu,
  type TerminalTabContextMenuPayload,
} from "./terminalTabChrome";

const terminalContextMenuPanelClassName =
  "kerminal-context-menu kerminal-floating-enter fixed z-[1000] w-56";
const TAB_OVERVIEW_OVERFLOW_TOLERANCE = 1;

export interface BroadcastCommandRequest {
  command: string;
  data: string;
  targetPaneIds: string[];
}

export interface BroadcastCommandResult {
  missingPaneIds: string[];
  sentPaneIds: string[];
}

interface TerminalWorkspaceProps {
  activeTabId: string;
  broadcastDraft: string;
  contentRightInset?: number;
  focusedPaneId: string;
  interfaceDensity?: InterfaceDensity;
  machineGroups?: MachineGroup[];
  panes: TerminalPane[];
  resolvedTheme: ResolvedTheme;
  tabs: TerminalTab[];
  tabGroupPreferences?: TerminalTabGroupPreferences;
  terminalAppearance: TerminalAppearance;
  onBroadcastCommand: (
    request: BroadcastCommandRequest,
  ) => Promise<BroadcastCommandResult>;
  onBroadcastDraftChange: (draft: string) => void;
  onClosePane: (paneId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTerminal?: () => void;
  onFocusPane: (paneId: string) => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onMovePane?: (
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMoveDropZone,
    scope?: TerminalPaneMoveScope,
  ) => void;
  onPaneConnectionStateChange?: (
    paneId: string,
    state: ConnectionState,
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
  onOpenLogs?: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  onUpdateTabGroupPreference?: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
  leftTitleBarInset?: number;
  reserveRightTitleBarControls?: boolean;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  renderCustomTab?: (tab: TerminalTab, active: boolean) => ReactNode;
  onSelectTab: (tabId: string) => void;
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  splitDropIndicator?: TerminalSplitDropIndicator | null;
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
}

export function TerminalWorkspace({
  activeTabId,
  broadcastDraft,
  contentRightInset = 0,
  focusedPaneId,
  interfaceDensity = "comfortable",
  leftTitleBarInset = 0,
  machineGroups = [],
  onBroadcastCommand,
  onBroadcastDraftChange,
  onClosePane,
  onCloseTab,
  onCreateTerminal,
  onFocusPane,
  onOpenAgentTool,
  onOpenConnection,
  onMovePane,
  onPaneConnectionStateChange,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onSplitLayoutSizesChange,
  onOpenLogs,
  onRevealWorkspaceFileInSftp,
  onRenameTab,
  onUpdateTabGroupPreference,
  reserveRightTitleBarControls = true,
  resolvePaneLines,
  resolvePaneOutputHistory,
  renderCustomTab,
  onSelectTab,
  onSplitPane,
  panes,
  resolvedTheme,
  splitDropIndicator,
  tabs,
  tabGroupPreferences = {},
  terminalAppearance,
  workspaceFileDirtyState = {},
}: TerminalWorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const tabGroups = useMemo(
    () => buildTerminalTabGroups(tabs, tabGroupPreferences),
    [tabGroupPreferences, tabs],
  );
  const [collapsedTabGroupIds, setCollapsedTabGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [contextMenu, setContextMenu] = useState<TerminalTabContextMenu | null>(
    null,
  );
  const [editingTabGroup, setEditingTabGroup] =
    useState<TerminalTabGroup | null>(null);
  const [renamingTab, setRenamingTab] = useState<TerminalTab | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabOverviewButtonRef = useRef<HTMLButtonElement>(null);
  const tabOverviewMenuRef = useRef<HTMLDivElement>(null);
  const [tabOverviewOpen, setTabOverviewOpen] = useState(false);
  const [tabOverviewAvailable, setTabOverviewAvailable] = useState(false);
  const [tabOverviewPosition, setTabOverviewPosition] = useState({
    x: 0,
    y: 0,
  });
  const panesById = useMemo(
    () => new Map(panes.map((pane) => [pane.id, pane])),
    [panes],
  );
  const tabStatusById = useMemo(
    () =>
      new Map(
        tabs.map((tab) => [tab.id, resolveTerminalTabStatus(tab, panesById)]),
      ),
    [panesById, tabs],
  );
  const activePaneIds = useMemo(
    () =>
      activeTab && isTerminalSessionTab(activeTab)
        ? collectPaneIds(activeTab.layout)
        : [],
    [activeTab],
  );
  const hasActiveSplit = activePaneIds.length > 1;
  const {
    broadcastTargets,
    broadcastTargetMode,
    broadcastTargetOptions,
    handleBroadcastTargetModeChange,
    handleToggleCustomTarget,
    productionTargetCount,
    selectedTargetPaneIds,
  } = useTerminalBroadcastTargets({
    activePaneIds,
    focusedPaneId,
    panesById,
  });
  const broadcastAnalysis = useMemo(
    () => analyzeBroadcastCommand(broadcastDraft, broadcastTargets),
    [broadcastDraft, broadcastTargets],
  );
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(
    null,
  );
  const [pendingDirtyCloseTabIds, setPendingDirtyCloseTabIds] = useState<
    string[] | null
  >(null);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const contextTab =
    contextMenu?.type === "tab"
      ? tabs.find((tab) => tab.id === contextMenu.tabId)
      : undefined;
  const contextTabGroup =
    contextMenu?.type === "group"
      ? tabGroups.find((group) => group.id === contextMenu.groupId)
      : contextTab
        ? tabGroups.find((group) =>
            group.tabs.some((tab) => tab.id === contextTab.id),
          )
        : undefined;
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const tabBarHeightClass = compactDensity
    ? "h-9"
    : spaciousDensity
      ? "h-10"
      : "h-9";
  const toolbarPaddingClass = compactDensity
    ? "px-2 py-1.5"
    : spaciousDensity
      ? "px-4 py-3"
      : "px-3 py-2";
  const workspacePaddingClass = compactDensity
    ? "p-1.5"
    : spaciousDensity
      ? "p-3"
      : "p-2";
  const terminalInset = compactDensity ? 6 : spaciousDensity ? 12 : 8;
  const contentInsetStyle =
    contentRightInset > 0
      ? ({ marginRight: contentRightInset } satisfies CSSProperties)
      : undefined;
  const tabBarStyle =
    leftTitleBarInset > 0
      ? ({ paddingLeft: leftTitleBarInset } satisfies CSSProperties)
      : undefined;
  const shouldShowTabOverview = tabs.length > 1 && tabOverviewAvailable;

  const updateTabOverviewAvailability = useCallback(() => {
    const tabList = tabListRef.current;
    const hasHorizontalOverflow = tabList
      ? tabList.scrollWidth - tabList.clientWidth >
        TAB_OVERVIEW_OVERFLOW_TOLERANCE
      : false;
    setTabOverviewAvailable(hasHorizontalOverflow);
  }, []);

  useEffect(() => {
    setCollapsedTabGroupIds((current) => {
      const validIds = new Set(
        tabGroups.filter((group) => group.grouped).map((group) => group.id),
      );
      const next = new Set([...current].filter((id) => validIds.has(id)));
      if (next.size === current.size) {
        return current;
      }
      return next;
    });
  }, [tabGroups]);

  useLayoutEffect(() => {
    updateTabOverviewAvailability();
    const frameId =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateTabOverviewAvailability)
        : undefined;
    const tabList = tabListRef.current;

    window.addEventListener("resize", updateTabOverviewAvailability);
    if (!tabList || typeof ResizeObserver === "undefined") {
      return () => {
        if (frameId !== undefined) {
          window.cancelAnimationFrame(frameId);
        }
        window.removeEventListener("resize", updateTabOverviewAvailability);
      };
    }

    const resizeObserver = new ResizeObserver(updateTabOverviewAvailability);
    resizeObserver.observe(tabList);
    for (const child of Array.from(tabList.children)) {
      resizeObserver.observe(child);
    }

    return () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", updateTabOverviewAvailability);
      resizeObserver.disconnect();
    };
  }, [tabGroups, updateTabOverviewAvailability]);

  useEffect(() => {
    if (!shouldShowTabOverview && tabOverviewOpen) {
      setTabOverviewOpen(false);
    }
  }, [shouldShowTabOverview, tabOverviewOpen]);

  useEffect(() => {
    if (hasActiveSplit) {
      return;
    }

    setBroadcastStatus(null);
    setBroadcastError(null);
  }, [hasActiveSplit]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

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

  useEffect(() => {
    if (!editingTabGroup) {
      return;
    }

    const nextGroup = tabGroups.find(
      (group) => group.id === editingTabGroup.id,
    );
    if (!nextGroup) {
      setEditingTabGroup(null);
      return;
    }

    if (nextGroup !== editingTabGroup) {
      setEditingTabGroup(nextGroup);
    }
  }, [editingTabGroup, tabGroups]);

  useEffect(() => {
    if (!renamingTab) {
      return;
    }

    if (!tabs.some((tab) => tab.id === renamingTab.id)) {
      setRenamingTab(null);
    }
  }, [renamingTab, tabs]);

  useLayoutEffect(() => {
    if (!contextMenu) {
      return;
    }

    const menuElement = contextMenuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    const nextPosition = clampContextMenuPosition(
      contextMenu.x,
      contextMenu.y,
      rect.width,
      rect.height,
    );
    if (nextPosition.x === contextMenu.x && nextPosition.y === contextMenu.y) {
      return;
    }
    setContextMenu((current) =>
      current === contextMenu ? { ...current, ...nextPosition } : current,
    );
  }, [contextMenu]);

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

  const executeBroadcast = useCallback(
    async (analysis: BroadcastCommandAnalysis) => {
      if (!canBroadcastCommand(analysis)) {
        setBroadcastError(
          analysis.command
            ? "当前 tab 没有可发送的真实终端分屏。"
            : "请输入要发送的命令。",
        );
        return;
      }

      setSendingBroadcast(true);
      setBroadcastError(null);
      try {
        const result = await onBroadcastCommand({
          command: analysis.command,
          data: analysis.data,
          targetPaneIds: analysis.targets.map((target) => target.paneId),
        });
        const skipped =
          result.missingPaneIds.length > 0
            ? `，${result.missingPaneIds.length} 个分屏尚未连接`
            : "";
        setBroadcastStatus(
          `已发送到 ${result.sentPaneIds.length} 个分屏${skipped}。`,
        );
        if (result.sentPaneIds.length > 0) {
          onBroadcastDraftChange("");
        }
      } catch (error) {
        setBroadcastError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setSendingBroadcast(false);
      }
    },
    [onBroadcastCommand, onBroadcastDraftChange],
  );

  const requestBroadcast = useCallback(() => {
    setBroadcastStatus(null);
    setBroadcastError(null);
    if (!canBroadcastCommand(broadcastAnalysis)) {
      void executeBroadcast(broadcastAnalysis);
      return;
    }
    void executeBroadcast(broadcastAnalysis);
  }, [broadcastAnalysis, executeBroadcast]);

  const handleDraftChange = useCallback(
    (draft: string) => {
      setBroadcastStatus(null);
      setBroadcastError(null);
      onBroadcastDraftChange(draft);
    },
    [onBroadcastDraftChange],
  );
  const toggleTabGroup = useCallback((groupId: string) => {
    setCollapsedTabGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);
  const openContextMenu = useCallback(
    (event: ReactMouseEvent, menu: TerminalTabContextMenuPayload) => {
      event.preventDefault();
      event.stopPropagation();
      const position = clampContextMenuPosition(
        event.clientX,
        event.clientY,
        0,
        0,
      );
      setContextMenu({ ...menu, ...position });
    },
    [],
  );
  const runMenuAction = useCallback((action?: () => void) => {
    setContextMenu(null);
    action?.();
  }, []);
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
  const requestCloseTabs = useCallback(
    (tabIds: string[], confirmedDirtyFiles = false) => {
      const decision = resolveWorkspaceTabCloseDecision({
        confirmTerminalClose: terminalAppearance.confirmCloseTab,
        confirmedDirtyFiles,
        tabIds,
        tabs,
        workspaceFileDirtyState,
      });
      if (decision.kind === "confirmDirtyFiles") {
        setPendingDirtyCloseTabIds(decision.tabIds);
        return;
      }
      if (decision.kind === "confirmTerminalTabs") {
        setPendingCloseTabIds(decision.tabIds);
        return;
      }
      for (const tabId of decision.tabIds) {
        onCloseTab(tabId);
      }
    },
    [
      onCloseTab,
      tabs,
      terminalAppearance.confirmCloseTab,
      workspaceFileDirtyState,
    ],
  );
  const confirmCloseTabs = useCallback(() => {
    if (!pendingCloseTabIds) {
      return;
    }
    for (const tabId of pendingCloseTabIds) {
      onCloseTab(tabId);
    }
    setPendingCloseTabIds(null);
  }, [onCloseTab, pendingCloseTabIds]);
  const confirmDirtyFileCloseTabs = useCallback(() => {
    if (!pendingDirtyCloseTabIds) {
      return;
    }
    requestCloseTabs(pendingDirtyCloseTabIds, true);
    setPendingDirtyCloseTabIds(null);
  }, [pendingDirtyCloseTabIds, requestCloseTabs]);
  const contextMenuElement =
    contextMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-label="终端标签操作菜单"
            className={terminalContextMenuPanelClassName}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            ref={contextMenuRef}
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === "tab" && contextTab ? (
              <TerminalTabContextMenuItems
                activeTabId={activeTabId}
                group={contextTabGroup}
                onCloseTabs={requestCloseTabs}
                onCopyWorkspaceFilePath={(tab) => {
                  void writeDesktopClipboardText(tab.path);
                }}
                onReloadWorkspaceFile={(tabId) =>
                  dispatchWorkspaceFileTabCommand({
                    command: "reload",
                    tabId,
                  })
                }
                onRequestRename={setRenamingTab}
                onRevealWorkspaceFileInSftp={onRevealWorkspaceFileInSftp}
                onSelectTab={onSelectTab}
                runMenuAction={runMenuAction}
                tab={contextTab}
                tabs={tabs}
              />
            ) : null}
            {contextMenu.type === "group" && contextTabGroup ? (
              <TerminalTabGroupContextMenuItems
                collapsed={collapsedTabGroupIds.has(contextTabGroup.id)}
                group={contextTabGroup}
                onCloseTabs={requestCloseTabs}
                onRequestEdit={
                  onUpdateTabGroupPreference ? setEditingTabGroup : undefined
                }
                runMenuAction={runMenuAction}
                tabs={tabs}
                toggleTabGroup={toggleTabGroup}
              />
            ) : null}
          </div>,
          document.body,
        )
      : null;
  const tabOverviewElement = (
    <TerminalTabOverviewMenu
      activeTabId={activeTabId}
      menuRef={tabOverviewMenuRef}
      onSelectTab={selectTabFromOverview}
      open={tabOverviewOpen}
      position={tabOverviewPosition}
      tabGroups={tabGroups}
      tabs={tabs}
      tabStatusById={tabStatusById}
      terminalAppearance={terminalAppearance}
    />
  );

  return (
    <main
      aria-label="终端工作区"
      className="kerminal-workspace-surface flex h-full w-full min-w-0 flex-col overflow-hidden"
      data-density={interfaceDensity}
    >
      <div
        className={cn(
          "kerminal-material-nav relative z-20 flex items-center border-b border-[var(--border-subtle)] shadow-[inset_0_-1px_0_var(--border-subtle)]",
          reserveRightTitleBarControls ? "pr-40" : "pr-2",
          tabBarHeightClass,
        )}
        data-tauri-drag-region
        style={tabBarStyle}
      >
        <div
          aria-label="终端标签栏"
          className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
          data-tauri-drag-region
          onWheel={handleTabListWheel}
          ref={tabListRef}
        >
          {tabGroups.map((group) => {
            const collapsed = collapsedTabGroupIds.has(group.id);
            const groupActive = group.tabs.some(
              (tab) => tab.id === activeTabId,
            );
            if (!group.grouped) {
              return group.tabs.map((tab) => (
                <TerminalTabButton
                  active={tab.id === activeTabId}
                  key={tab.id}
                  onCloseTab={(tabId) => requestCloseTabs([tabId])}
                  onContextMenu={(event) =>
                    openContextMenu(event, { tabId: tab.id, type: "tab" })
                  }
                  onSelectTab={onSelectTab}
                  showClose
                  tabNumber={
                    terminalAppearance.showTabNumbers
                      ? tabs.findIndex((candidate) => candidate.id === tab.id) +
                        1
                      : undefined
                  }
                  status={tabStatusById.get(tab.id)}
                  tab={tab}
                  workspaceFileDirty={workspaceFileDirtyState[tab.id]}
                />
              ));
            }

            return (
              <div
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-1 rounded-xl border px-1.5 transition-[background-color,border-color,box-shadow]",
                  groupActive
                    ? group.activeContainerClassName
                    : group.containerClassName,
                )}
                key={group.id}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute left-3 right-3 top-0 h-0.5 rounded-full",
                    group.accentClassName,
                  )}
                />
                <TerminalTabGroupHeader
                  collapsed={collapsed}
                  group={group}
                  onContextMenu={(event) =>
                    openContextMenu(event, { groupId: group.id, type: "group" })
                  }
                  onToggle={() => toggleTabGroup(group.id)}
                />
                {!collapsed
                  ? group.tabs.map((tab) => (
                      <TerminalTabButton
                        active={tab.id === activeTabId}
                        compact
                        key={tab.id}
                        onCloseTab={(tabId) => requestCloseTabs([tabId])}
                        onContextMenu={(event) =>
                          openContextMenu(event, {
                            tabId: tab.id,
                            type: "tab",
                          })
                        }
                        onSelectTab={onSelectTab}
                        showClose
                        tabNumber={
                          terminalAppearance.showTabNumbers
                            ? tabs.findIndex(
                                (candidate) => candidate.id === tab.id,
                              ) + 1
                            : undefined
                        }
                        status={tabStatusById.get(tab.id)}
                        tab={tab}
                        workspaceFileDirty={workspaceFileDirtyState[tab.id]}
                      />
                    ))
                  : null}
              </div>
            );
          })}
        </div>
        {shouldShowTabOverview ? (
          <button
            aria-expanded={tabOverviewOpen}
            aria-label="查看所有标签"
            className={cn(
              "kerminal-focus-ring kerminal-pressable kerminal-muted-surface absolute bottom-0.5 z-20 flex h-8 w-8 items-center justify-center rounded-xl border text-zinc-500 shadow-sm shadow-black/10 backdrop-blur hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:shadow-black/30 dark:hover:text-zinc-100",
              reserveRightTitleBarControls ? "right-28" : "right-3",
              tabOverviewOpen &&
                "border-sky-500/30 bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100",
            )}
            onClick={toggleTabOverview}
            ref={tabOverviewButtonRef}
            title="查看所有标签"
            type="button"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {contextMenuElement}
      {tabOverviewElement}
      <TerminalTabRenameDialog
        onClose={() => setRenamingTab(null)}
        onRenameTab={onRenameTab}
        tab={renamingTab}
      />
      <TerminalTabGroupEditDialog
        group={editingTabGroup}
        onClose={() => setEditingTabGroup(null)}
        onSave={(groupId, preference) =>
          onUpdateTabGroupPreference?.(groupId, preference)
        }
      />
      <CloseTabsConfirmationDialog
        onClose={() => setPendingCloseTabIds(null)}
        onConfirm={confirmCloseTabs}
        tabCount={pendingCloseTabIds?.length ?? 0}
      />
      <CloseWorkspaceFileTabsConfirmationDialog
        dirtyTabCount={
          pendingDirtyCloseTabIds?.filter(
            (tabId) => workspaceFileDirtyState[tabId],
          ).length ?? 0
        }
        onClose={() => setPendingDirtyCloseTabIds(null)}
        onConfirm={confirmDirtyFileCloseTabs}
        tabCount={pendingDirtyCloseTabIds?.length ?? 0}
      />

      {hasActiveSplit ? (
        <TerminalBroadcastBar
          analysis={broadcastAnalysis}
          draft={broadcastDraft}
          error={broadcastError}
          focusedPaneId={focusedPaneId}
          onDraftChange={handleDraftChange}
          onRequestBroadcast={requestBroadcast}
          onTargetModeChange={handleBroadcastTargetModeChange}
          onToggleCustomTarget={handleToggleCustomTarget}
          productionTargetCount={productionTargetCount}
          selectedTargetPaneIds={selectedTargetPaneIds}
          sending={sendingBroadcast}
          status={broadcastStatus}
          style={contentInsetStyle}
          targetMode={broadcastTargetMode}
          targetOptions={broadcastTargetOptions}
          toolbarPaddingClass={toolbarPaddingClass}
        />
      ) : null}

      <TerminalWorkspaceContent
        activeTab={activeTab}
        contentInsetStyle={contentInsetStyle}
        focusedPaneId={focusedPaneId}
        machineGroups={machineGroups}
        onClosePane={onClosePane}
        onCreateTerminal={onCreateTerminal}
        onFocusPane={onFocusPane}
        onOpenAgentTool={onOpenAgentTool}
        onOpenConnection={onOpenConnection}
        onOpenLogs={onOpenLogs}
        onMovePane={onMovePane}
        onPaneConnectionStateChange={onPaneConnectionStateChange}
        onPaneCurrentCwdChange={onPaneCurrentCwdChange}
        onPaneOutputHistoryChange={onPaneOutputHistoryChange}
        onSplitLayoutSizesChange={onSplitLayoutSizesChange}
        onSplitPane={onSplitPane}
        panesById={panesById}
        resolvePaneLines={resolvePaneLines}
        resolvePaneOutputHistory={resolvePaneOutputHistory}
        renderCustomTab={renderCustomTab}
        resolvedTheme={resolvedTheme}
        splitDropIndicator={splitDropIndicator}
        tabs={tabs}
        terminalAppearance={terminalAppearance}
        terminalInset={terminalInset}
        workspacePaddingClass={workspacePaddingClass}
      />
    </main>
  );
}

function resolveTerminalTabStatus(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
): MachineStatus {
  if (!isTerminalSessionTab(tab)) {
    return "online";
  }
  const statuses = collectPaneIds(tab.layout)
    .map((paneId) => panesById.get(paneId)?.status)
    .filter((status): status is MachineStatus => Boolean(status));
  if (statuses.length === 0) {
    return "offline";
  }
  if (statuses.every((status) => status === "online")) {
    return "online";
  }
  if (statuses.every((status) => status === "offline")) {
    return "offline";
  }
  return "warning";
}
