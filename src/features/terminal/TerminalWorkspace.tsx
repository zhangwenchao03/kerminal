import {
  AlertTriangle,
  Check,
  ChevronDown,
  Columns2,
  Copy,
  PanelBottom,
  Send,
  SplitSquareHorizontal,
} from "lucide-react";
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
import { Button } from "../../components/ui/button";
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
import type {
  TerminalPane,
  TerminalSplitDirection,
  TerminalTab,
} from "../workspace/types";
import { isTerminalSessionTab } from "../workspace/types";
import { TerminalPaneLayout } from "./TerminalPaneLayout";
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
  onFocusPane: (paneId: string) => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onOpenLogs?: () => void;
  onRenameTab: (tabId: string, title: string) => void;
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
  onFocusPane,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onOpenLogs,
  onRenameTab,
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
        if (
          !pane ||
          (pane.mode !== "local" &&
            pane.mode !== "ssh" &&
            pane.mode !== "container")
        ) {
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
              "fixed z-50 w-56 rounded-xl border border-black/10 bg-white p-1.5 text-sm shadow-xl shadow-black/15 dark:border-white/10 dark:bg-zinc-950",
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
              "fixed z-50 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white/96 text-sm shadow-2xl shadow-black/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96",
            )}
            onClick={(event) => event.stopPropagation()}
            ref={tabOverviewMenuRef}
            role="menu"
            style={{ left: tabOverviewPosition.x, top: tabOverviewPosition.y }}
          >
            <div className="flex items-center justify-between border-b border-black/8 px-3 py-2.5 dark:border-white/8">
              <div className="font-medium text-zinc-950 dark:text-zinc-50">
                所有标签
              </div>
              <div className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
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
                      "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition",
                      active
                        ? "bg-sky-500/12 text-sky-700 dark:bg-sky-400/16 dark:text-sky-100"
                        : "text-zinc-700 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-200 dark:hover:bg-white/8 dark:hover:text-zinc-50",
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
      className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#f1f1f4] dark:bg-[#18181a]"
      data-density={interfaceDensity}
    >
      <div
        className={cn(
          "relative flex items-end border-b border-black/8 bg-white/72 pl-2 pr-40 pt-1 backdrop-blur-xl dark:border-white/8 dark:bg-[#111113]/92",
          tabBarHeightClass,
        )}
        data-tauri-drag-region
      >
        <div
          aria-label="终端标签栏"
          className="scrollbar-none flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
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
                  "flex h-9 shrink-0 items-center gap-1 rounded-t-xl border px-1.5 transition",
                  groupActive
                    ? "-mb-px border-black/8 border-b-transparent bg-[#f1f1f4] dark:border-white/8 dark:border-b-transparent dark:bg-[#18181a]"
                    : "border-transparent bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
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
        <button
          aria-expanded={tabOverviewOpen}
          aria-label="查看所有标签"
          className={cn(
            "absolute bottom-1 right-28 z-20 flex h-8 w-8 items-center justify-center rounded-xl border border-black/8 bg-white/80 text-zinc-500 shadow-sm shadow-black/10 backdrop-blur transition hover:bg-white hover:text-zinc-950 dark:border-white/8 dark:bg-zinc-900/90 dark:text-zinc-400 dark:shadow-black/30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            tabOverviewOpen &&
              "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100",
          )}
          onClick={toggleTabOverview}
          ref={tabOverviewButtonRef}
          title="查看所有标签"
          type="button"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
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
        <div
          className={cn(
            "flex items-center gap-2 border-b border-black/8 transition-[margin-right] duration-200 ease-out dark:border-white/8",
            toolbarPaddingClass,
          )}
          style={contentInsetStyle}
        >
          <Button
            aria-label="左右分屏"
            onClick={() => onSplitPane("horizontal")}
            size="sm"
            variant="secondary"
          >
            <Columns2 className="h-4 w-4" />
            左右
          </Button>
          <Button
            aria-label="上下分屏"
            onClick={() => onSplitPane("vertical")}
            size="sm"
            variant="secondary"
          >
            <PanelBottom className="h-4 w-4" />
            上下
          </Button>
          <Button
            aria-label="关闭当前分屏"
            onClick={() => onClosePane(focusedPaneId)}
            size="sm"
            variant="ghost"
          >
            <SplitSquareHorizontal className="h-4 w-4" />
            关闭分屏
          </Button>
          <label className="sr-only" htmlFor="broadcast-command">
            批量命令
          </label>
          <input
            className="h-9 min-w-0 flex-1 rounded-xl border border-black/8 bg-white/80 px-3 font-mono text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-sky-400/50 focus:ring-4 focus:ring-sky-500/10 dark:border-white/8 dark:bg-black/20 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            id="broadcast-command"
            onChange={(event) => handleDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                requestBroadcast();
              }
            }}
            placeholder="向所有分屏发送命令..."
            value={broadcastDraft}
          />
          <span className="hidden shrink-0 rounded-lg bg-black/5 px-2 py-1 text-xs text-zinc-500 dark:bg-white/7 xl:inline">
            {broadcastTargets.length} 个目标
          </span>
          <Button size="sm" variant="secondary">
            <Copy className="h-4 w-4" />
            片段
          </Button>
          <Button
            disabled={!canBroadcastCommand(broadcastAnalysis) || sendingBroadcast}
            onClick={requestBroadcast}
            size="sm"
            variant="primary"
          >
            <Send className="h-4 w-4" />
            {sendingBroadcast ? "发送中" : "发送到全部"}
          </Button>
        </div>
      ) : null}

      {hasActiveSplit && pendingBroadcast ? (
        <div
          className="transition-[margin-right] duration-200 ease-out"
          style={contentInsetStyle}
        >
          <BroadcastConfirmation
            analysis={pendingBroadcast}
            disabled={sendingBroadcast}
            onCancel={() => setPendingBroadcast(null)}
            onConfirm={() => void executeBroadcast(pendingBroadcast)}
          />
        </div>
      ) : null}

      {hasActiveSplit && (broadcastStatus || broadcastError) ? (
        <div
          className={cn(
            "border-b border-black/8 px-3 py-2 text-sm transition-[margin-right] duration-200 ease-out dark:border-white/8",
            broadcastError
              ? "bg-rose-500/10 text-rose-100"
              : "bg-emerald-500/10 text-emerald-100",
          )}
          role={broadcastError ? "alert" : "status"}
          style={contentInsetStyle}
        >
          {broadcastError ?? broadcastStatus}
        </div>
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
                    <div className="flex h-full items-center justify-center rounded-2xl border border-black/8 bg-white/60 text-sm text-zinc-500 dark:border-white/8 dark:bg-white/5 dark:text-zinc-400">
                      此标签暂不可用。
                    </div>
                  )
                )}
              </div>
            );
          })
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-black/8 bg-white/60 text-sm text-zinc-500 dark:border-white/8 dark:bg-white/5">
            暂无终端 tab
          </div>
        )}
      </div>
    </main>
  );
}

function BroadcastConfirmation({
  analysis,
  disabled,
  onCancel,
  onConfirm,
}: {
  analysis: BroadcastCommandAnalysis;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-label="确认批量发送"
      className="border-b border-amber-300/20 bg-amber-500/10 px-3 py-3"
      role="dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            确认批量发送
          </div>
          <div className="mt-2 truncate rounded-lg bg-black/10 px-3 py-2 font-mono text-sm text-zinc-900 dark:bg-black/25 dark:text-zinc-100">
            {analysis.command}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {analysis.reasons.map((reason) => (
              <span
                className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-xs text-amber-100"
                key={reason}
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={disabled}
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            取消
          </Button>
          <Button
            disabled={disabled}
            onClick={onConfirm}
            size="sm"
            variant="primary"
          >
            确认发送
          </Button>
        </div>
      </div>
    </div>
  );
}
