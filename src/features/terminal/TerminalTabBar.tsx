import { ChevronDown } from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "../../lib/cn";
import type { TerminalAppearance } from "../settings/settingsModel";
import type {
  MachineStatus,
  TerminalTab,
  WorkspaceFileDirtyState,
} from "../workspace/types";
import {
  TerminalTabButton,
  TerminalTabGroupHeader,
  type TerminalTabContextMenuPayload,
  type TerminalTabGroup,
} from "./terminalTabChrome";
import {
  resolveTerminalTabGroupPresentation,
  resolveTerminalTabPresentation,
  type TerminalTabPresentation,
} from "./terminalTabPresentationModel";

interface TerminalTabBarProps {
  activeTabId: string;
  collapsedGroupIds: ReadonlySet<string>;
  heightClassName: string;
  onOpenContextMenu: (
    event: ReactMouseEvent,
    payload: TerminalTabContextMenuPayload,
  ) => void;
  onRequestCloseTab: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onToggleOverview: (event: ReactMouseEvent) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  overviewButtonRef: RefObject<HTMLButtonElement | null>;
  overviewOpen: boolean;
  reserveRightTitleBarControls: boolean;
  shouldShowOverview: boolean;
  style?: CSSProperties;
  tabGroups: TerminalTabGroup[];
  tabListRef: RefObject<HTMLDivElement | null>;
  tabPresentationById: ReadonlyMap<string, TerminalTabPresentation>;
  tabs: TerminalTab[];
  tabStatusById: ReadonlyMap<string, MachineStatus>;
  terminalAppearance: TerminalAppearance;
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 终端标签栏的纯展示与命令转发层，避免工作区组件继续膨胀。 */
export function TerminalTabBar({
  activeTabId,
  collapsedGroupIds,
  heightClassName,
  onOpenContextMenu,
  onRequestCloseTab,
  onSelectTab,
  onToggleGroup,
  onToggleOverview,
  onWheel,
  overviewButtonRef,
  overviewOpen,
  reserveRightTitleBarControls,
  shouldShowOverview,
  style,
  tabGroups,
  tabListRef,
  tabPresentationById,
  tabs,
  tabStatusById,
  terminalAppearance,
  workspaceFileDirtyState,
}: TerminalTabBarProps) {
  return (
    <div
      className={cn(
        "kerminal-material-nav relative z-20 flex items-center border-b border-[var(--border-subtle)] shadow-[inset_0_-1px_0_var(--border-subtle)]",
        reserveRightTitleBarControls ? "pr-40" : "pr-2",
        heightClassName,
      )}
      data-tauri-drag-region
      style={style}
    >
      <div
        aria-label="终端标签栏"
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
        data-tauri-drag-region
        onWheel={onWheel}
        ref={tabListRef}
      >
        {tabGroups.map((group) => {
          const collapsed = collapsedGroupIds.has(group.id);
          const groupActive = group.tabs.some(
            (tab) => tab.id === activeTabId,
          );
          const groupPresentation = resolveTerminalTabGroupPresentation(
            group.tabs.map(
              (tab) =>
                tabPresentationById.get(tab.id) ??
                resolveTerminalTabPresentation([]),
            ),
            !collapsed,
          );
          if (!group.grouped) {
            return group.tabs.map((tab) => (
              <TerminalTabButton
                active={tab.id === activeTabId}
                identityAccent={group.identityAccent}
                key={tab.id}
                onCloseTab={onRequestCloseTab}
                onContextMenu={(event) =>
                  onOpenContextMenu(event, { tabId: tab.id, type: "tab" })
                }
                onSelectTab={onSelectTab}
                presentation={tabPresentationById.get(tab.id)}
                showClose
                status={tabStatusById.get(tab.id)}
                tab={tab}
                tabNumber={
                  terminalAppearance.showTabNumbers
                    ? tabs.findIndex((candidate) => candidate.id === tab.id) + 1
                    : undefined
                }
                workspaceFileDirty={workspaceFileDirtyState[tab.id]}
              />
            ));
          }

          return (
            <div
              className="relative flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] px-1 shadow-sm shadow-black/5 dark:shadow-black/20"
              key={group.id}
            >
              <TerminalTabGroupHeader
                active={collapsed && groupActive}
                collapsed={collapsed}
                group={group}
                onContextMenu={(event) =>
                  onOpenContextMenu(event, { groupId: group.id, type: "group" })
                }
                onToggle={() => onToggleGroup(group.id)}
                presentation={groupPresentation}
              />
              {!collapsed
                ? group.tabs.map((tab) => (
                    <TerminalTabButton
                      active={tab.id === activeTabId}
                      compact
                      key={tab.id}
                      onCloseTab={onRequestCloseTab}
                      onContextMenu={(event) =>
                        onOpenContextMenu(event, {
                          tabId: tab.id,
                          type: "tab",
                        })
                      }
                      onSelectTab={onSelectTab}
                      presentation={tabPresentationById.get(tab.id)}
                      showClose
                      status={tabStatusById.get(tab.id)}
                      tab={tab}
                      tabNumber={
                        terminalAppearance.showTabNumbers
                          ? tabs.findIndex(
                              (candidate) => candidate.id === tab.id,
                            ) + 1
                          : undefined
                      }
                      workspaceFileDirty={workspaceFileDirtyState[tab.id]}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
      {shouldShowOverview ? (
        <button
          aria-expanded={overviewOpen}
          aria-label="查看所有标签"
          className={cn(
            "kerminal-focus-ring kerminal-pressable kerminal-muted-surface absolute bottom-0.5 z-20 flex h-8 w-8 items-center justify-center rounded-lg border text-zinc-500 shadow-sm shadow-black/10 backdrop-blur hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:shadow-black/30 dark:hover:text-zinc-100",
            reserveRightTitleBarControls ? "right-28" : "right-3",
            overviewOpen &&
              "border-sky-500/30 bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100",
          )}
          onClick={onToggleOverview}
          ref={overviewButtonRef}
          title="查看所有标签"
          type="button"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
