import { Check, ChevronDown, Layers2 } from "lucide-react";
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
  type MachineGroup,
  type TerminalPane,
  type TerminalSplitDirection,
  type TerminalSplitLayoutSizes,
  type TerminalTab,
  type TerminalTabGroupPreference,
  type TerminalTabGroupPreferences,
} from "../workspace/types";
import { TerminalBroadcastBar } from "./TerminalBroadcastBar";
import { TerminalWorkspaceContent } from "./TerminalWorkspaceContent";
import type { TerminalPaneMoveDropZone } from "./terminalPaneMoveDropZones";
import type { TerminalSplitDropIndicator } from "./TerminalSplitDropOverlay";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import { useTerminalBroadcastTargets } from "./useTerminalBroadcastTargets";
import {
  buildTerminalTabGroups,
  clampContextMenuPosition,
  CloseTabsConfirmationDialog,
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

const terminalFloatingPanelClassName =
  "kerminal-floating-enter fixed z-[1000] border border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-sm shadow-2xl shadow-black/20 backdrop-blur-xl dark:shadow-black/50";
const terminalContextMenuPanelClassName =
  "kerminal-context-menu kerminal-floating-enter fixed z-[1000] w-56";
const terminalOverviewItemClassName =
  "kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left";
const terminalOverviewIdleClassName =
  "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50";
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
  onOpenLogs?: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  onUpdateTabGroupPreference?: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
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
}

export function TerminalWorkspace({
  activeTabId,
  broadcastDraft,
  contentRightInset = 0,
  focusedPaneId,
  interfaceDensity = "comfortable",
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
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onSplitLayoutSizesChange,
  onOpenLogs,
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
    (tabIds: string[]) => {
      if (terminalAppearance.confirmCloseTab && tabIds.length > 0) {
        setPendingCloseTabIds(tabIds);
        return;
      }
      for (const tabId of tabIds) {
        onCloseTab(tabId);
      }
    },
    [onCloseTab, terminalAppearance.confirmCloseTab],
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
                onRequestRename={setRenamingTab}
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
  const tabOverviewElement =
    tabOverviewOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-label="所有终端标签"
            className={cn(
              terminalFloatingPanelClassName,
              "w-72 overflow-hidden rounded-2xl",
            )}
            onClick={(event) => event.stopPropagation()}
            ref={tabOverviewMenuRef}
            role="menu"
            style={{ left: tabOverviewPosition.x, top: tabOverviewPosition.y }}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
              <div className="font-medium text-zinc-950 dark:text-zinc-50">
                标签分组
              </div>
              <div className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {tabGroups.length} 组 / {tabs.length} 个
              </div>
            </div>
            <div className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5">
              {tabGroups.map((group) => {
                return (
                  <div
                    aria-label={`${group.title} 标签组`}
                    className="py-1"
                    key={group.id}
                    role="group"
                  >
                    <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                      <Layers2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
                        {group.title}
                      </span>
                      <span className="rounded-full bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium leading-none">
                        {group.tabs.length} 个
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {group.tabs.map((tab) => {
                        const active = tab.id === activeTabId;
                        const tabIndex = tabs.findIndex(
                          (candidate) => candidate.id === tab.id,
                        );
                        const title =
                          terminalAppearance.showTabNumbers && tabIndex >= 0
                            ? `${tabIndex + 1} · ${tab.title}`
                            : tab.title;
                        return (
                          <button
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              terminalOverviewItemClassName,
                              "pl-5",
                              active
                                ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                                : terminalOverviewIdleClassName,
                            )}
                            key={tab.id}
                            onClick={() => selectTabFromOverview(tab.id)}
                            role="menuitem"
                            type="button"
                          >
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                tab.kind === "sftpTransfer"
                                  ? "bg-sky-400"
                                  : "bg-emerald-400",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {title}
                            </span>
                            {active ? (
                              <Check className="h-3.5 w-3.5 shrink-0" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

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
                  tab={tab}
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
                        tab={tab}
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
