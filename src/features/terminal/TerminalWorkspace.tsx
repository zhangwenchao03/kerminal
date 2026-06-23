import { Check, ChevronDown } from "lucide-react";
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
  isBroadcastCommandTargetMode,
  type BroadcastCommandAnalysis,
} from "./broadcastCommandPolicy";
import { collectPaneIds } from "../workspace/workspaceLayout";
import type {
  TerminalPane,
  TerminalSplitDirection,
  TerminalTab,
} from "../workspace/types";
import { isTerminalSessionTab } from "../workspace/types";
import { TerminalPaneLayout } from "./TerminalPaneLayout";
import { TerminalEmptyState } from "./TerminalEmptyState";
import { TerminalBroadcastBar } from "./TerminalBroadcastBar";
import {
  buildTerminalTabGroups,
  clampContextMenuPosition,
  CloseTabsConfirmationDialog,
  TerminalTabButton,
  TerminalTabContextMenuItems,
  TerminalTabGroupContextMenuItems,
  TerminalTabGroupHeader,
  TerminalTabRenameDialog,
  type TerminalTabContextMenu,
  type TerminalTabContextMenuPayload,
} from "./terminalTabChrome";

const terminalFloatingPanelClassName =
  "kerminal-floating-enter fixed z-[1000] border border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-sm shadow-2xl shadow-black/20 backdrop-blur-xl dark:shadow-black/50";
const terminalOverviewItemClassName =
  "kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left";
const terminalOverviewIdleClassName =
  "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50";
const TAB_OVERVIEW_ALWAYS_SHOW_COUNT = 9;
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
  panes: TerminalPane[];
  resolvedTheme: ResolvedTheme;
  tabs: TerminalTab[];
  terminalAppearance: TerminalAppearance;
  onBroadcastCommand: (
    request: BroadcastCommandRequest,
  ) => Promise<BroadcastCommandResult>;
  onBroadcastDraftChange: (draft: string) => void;
  onClosePane: (paneId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTerminal?: () => void;
  onFocusPane: (paneId: string) => void;
  onOpenAiTool?: () => void;
  onOpenConnection?: () => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onOpenLogs?: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  reserveRightTitleBarControls?: boolean;
  renderCustomTab?: (tab: TerminalTab, active: boolean) => ReactNode;
  onSelectTab: (tabId: string) => void;
  onSplitPane: (direction: TerminalSplitDirection) => void;
}

export function TerminalWorkspace({
  activeTabId,
  broadcastDraft,
  contentRightInset = 0,
  focusedPaneId,
  interfaceDensity = "comfortable",
  onBroadcastCommand,
  onBroadcastDraftChange,
  onClosePane,
  onCloseTab,
  onCreateTerminal,
  onFocusPane,
  onOpenAiTool,
  onOpenConnection,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onOpenLogs,
  onRenameTab,
  reserveRightTitleBarControls = true,
  renderCustomTab,
  onSelectTab,
  onSplitPane,
  panes,
  resolvedTheme,
  tabs,
  terminalAppearance,
}: TerminalWorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const tabGroups = useMemo(() => buildTerminalTabGroups(tabs), [tabs]);
  const [collapsedTabGroupIds, setCollapsedTabGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [contextMenu, setContextMenu] = useState<TerminalTabContextMenu | null>(
    null,
  );
  const [renamingTab, setRenamingTab] = useState<TerminalTab | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabOverviewButtonRef = useRef<HTMLButtonElement>(null);
  const tabOverviewMenuRef = useRef<HTMLDivElement>(null);
  const [tabOverviewOpen, setTabOverviewOpen] = useState(false);
  const [tabOverviewAvailable, setTabOverviewAvailable] = useState(
    () => tabs.length >= TAB_OVERVIEW_ALWAYS_SHOW_COUNT,
  );
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
  const broadcastTargets = useMemo(
    () =>
      activePaneIds.flatMap((paneId) => {
        const pane = panesById.get(paneId);
        if (!pane || !isBroadcastCommandTargetMode(pane.mode)) {
          return [];
        }
        return [
          {
            mode: pane.mode,
            paneId: pane.id,
            title: pane.title,
          },
        ];
      }),
    [activePaneIds, panesById],
  );
  const broadcastAnalysis = useMemo(
    () => analyzeBroadcastCommand(broadcastDraft, broadcastTargets),
    [broadcastDraft, broadcastTargets],
  );
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [pendingBroadcast, setPendingBroadcast] =
    useState<BroadcastCommandAnalysis | null>(null);
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
    ? "h-10"
    : spaciousDensity
      ? "h-12"
      : "h-11";
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
  const shouldShowTabOverview =
    tabs.length > 1 && tabOverviewAvailable;

  const updateTabOverviewAvailability = useCallback(() => {
    const tabList = tabListRef.current;
    const hasHorizontalOverflow = tabList
      ? tabList.scrollWidth - tabList.clientWidth > TAB_OVERVIEW_OVERFLOW_TOLERANCE
      : false;
    setTabOverviewAvailable(
      tabs.length >= TAB_OVERVIEW_ALWAYS_SHOW_COUNT || hasHorizontalOverflow,
    );
  }, [tabs.length]);

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
    setPendingBroadcast(null);
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
  }, [tabOverviewOpen, tabs.length]);

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
        setPendingBroadcast(null);
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
    if (broadcastAnalysis.requiresConfirmation) {
      setPendingBroadcast(broadcastAnalysis);
      return;
    }
    void executeBroadcast(broadcastAnalysis);
  }, [broadcastAnalysis, executeBroadcast]);

  const confirmPendingBroadcast = useCallback(() => {
    if (!pendingBroadcast) {
      return;
    }
    void executeBroadcast(pendingBroadcast);
  }, [executeBroadcast, pendingBroadcast]);

  const handleDraftChange = useCallback(
    (draft: string) => {
      setPendingBroadcast(null);
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
      const position = clampContextMenuPosition(event.clientX, event.clientY, 0, 0);
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
            className={cn(
              terminalFloatingPanelClassName,
              "w-56 rounded-xl p-1.5 shadow-xl",
            )}
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
                所有标签
              </div>
              <div className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {tabs.length} 个
              </div>
            </div>
            <div className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5">
              {tabs.map((tab, index) => {
                const active = tab.id === activeTabId;
                const title = terminalAppearance.showTabNumbers
                  ? `${index + 1} · ${tab.title}`
                  : tab.title;
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      terminalOverviewItemClassName,
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
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
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
      className="kerminal-terminal-surface flex h-full w-full min-w-0 flex-col overflow-hidden"
      data-density={interfaceDensity}
    >
      <div
        className={cn(
          "kerminal-material-nav relative z-20 flex items-center border-b border-[var(--border-subtle)] pl-2 pt-1 shadow-[inset_0_-1px_0_var(--border-subtle)]",
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
            const groupActive = group.tabs.some((tab) => tab.id === activeTabId);
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
                      ? tabs.findIndex((candidate) => candidate.id === tab.id) + 1
                      : undefined
                  }
                  tab={tab}
                />
              ));
            }

            return (
              <div
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1 rounded-xl border px-1.5 transition-[background-color,border-color,box-shadow]",
                  groupActive
                    ? "border-sky-500/50 bg-sky-500/12 shadow-md shadow-sky-500/15 ring-1 ring-sky-400/25 dark:border-sky-300/40 dark:bg-sky-400/14 dark:ring-sky-300/20"
                    : "border-[var(--border-subtle)] bg-[var(--surface-solid)] shadow-sm shadow-black/5 hover:border-sky-500/25 hover:bg-[var(--surface-hover)] dark:shadow-black/20 dark:hover:border-sky-300/25",
                )}
                key={group.id}
              >
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
                            ? tabs.findIndex((candidate) => candidate.id === tab.id) + 1
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
              "kerminal-focus-ring kerminal-pressable kerminal-muted-surface absolute bottom-1 z-20 flex h-8 w-8 items-center justify-center rounded-xl border text-zinc-500 shadow-sm shadow-black/10 backdrop-blur hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:shadow-black/30 dark:hover:text-zinc-100",
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
          onCancelPending={() => setPendingBroadcast(null)}
          onClosePane={onClosePane}
          onConfirmPending={confirmPendingBroadcast}
          onDraftChange={handleDraftChange}
          onRequestBroadcast={requestBroadcast}
          onSplitPane={onSplitPane}
          pendingAnalysis={pendingBroadcast}
          sending={sendingBroadcast}
          status={broadcastStatus}
          style={contentInsetStyle}
          targetCount={broadcastTargets.length}
          toolbarPaddingClass={toolbarPaddingClass}
        />
      ) : null}

      <div
        className={cn(
          "relative min-h-0 flex-1 transition-[margin-right] duration-200 ease-out",
          workspacePaddingClass,
        )}
        data-terminal-workspace-content
        style={contentInsetStyle}
      >
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
                    layout={tab.layout}
                    onClosePane={onClosePane}
                    onCurrentCwdChange={onPaneCurrentCwdChange}
                    onFocusPane={onFocusPane}
                    onOpenLogs={onOpenLogs}
                    onOutputHistoryChange={onPaneOutputHistoryChange}
                    onSplitPane={onSplitPane}
                    panesById={panesById}
                    resolvedTheme={resolvedTheme}
                    terminalAppearance={terminalAppearance}
                  />
                ) : (
                  renderCustomTab?.(tab, active) ?? (
                    <div className="kerminal-solid-surface flex h-full items-center justify-center rounded-2xl border text-sm text-zinc-500 dark:text-zinc-400">
                      此标签暂不可用。
                    </div>
                  )
                )}
              </div>
            );
          })
        ) : (
          <TerminalEmptyState
            onCreateTerminal={onCreateTerminal}
            onOpenAiTool={onOpenAiTool}
            onOpenConnection={onOpenConnection}
          />
        )}
      </div>
    </main>
  );
}
