import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import type { TerminalTab } from "../workspace/types";

export interface TerminalTabGroup {
  colorClassName: string;
  grouped: boolean;
  id: string;
  tabs: TerminalTab[];
  title: string;
}

export type TerminalTabContextMenu =
  | {
      type: "group";
      groupId: string;
      x: number;
      y: number;
    }
  | {
      type: "tab";
      tabId: string;
      x: number;
      y: number;
    };

export type TerminalTabContextMenuPayload =
  | {
      type: "group";
      groupId: string;
    }
  | {
      type: "tab";
      tabId: string;
    };

const CONTEXT_MENU_MARGIN = 8;
const tabGroupColors = [
  "bg-pink-500/22 text-pink-700 ring-pink-500/24 dark:bg-pink-400/22 dark:text-pink-100 dark:ring-pink-300/24",
  "bg-violet-500/22 text-violet-700 ring-violet-500/24 dark:bg-violet-400/22 dark:text-violet-100 dark:ring-violet-300/24",
  "bg-sky-500/22 text-sky-700 ring-sky-500/24 dark:bg-sky-400/22 dark:text-sky-100 dark:ring-sky-300/24",
  "bg-emerald-500/22 text-emerald-700 ring-emerald-500/24 dark:bg-emerald-400/22 dark:text-emerald-100 dark:ring-emerald-300/24",
  "bg-amber-500/22 text-amber-700 ring-amber-500/24 dark:bg-amber-400/22 dark:text-amber-100 dark:ring-amber-300/24",
];

export function TerminalTabButton({
  active,
  compact = false,
  onCloseTab,
  onContextMenu,
  onSelectTab,
  showClose,
  tab,
  tabNumber,
}: {
  active: boolean;
  compact?: boolean;
  onCloseTab: (tabId: string) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onSelectTab: (tabId: string) => void;
  showClose: boolean;
  tab: TerminalTab;
  tabNumber?: number;
}) {
  const title = tabNumber ? `${tabNumber} · ${tab.title}` : tab.title;

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-t-xl border px-2.5 text-sm transition",
        compact ? "max-w-[190px]" : "shrink-0",
        active
          ? "-mb-px border-black/8 border-b-transparent bg-[#f1f1f4] text-zinc-950 dark:border-white/8 dark:border-b-transparent dark:bg-[#18181a] dark:text-zinc-50"
          : "border-transparent text-zinc-500 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/7 dark:hover:text-zinc-100",
      )}
      onContextMenu={onContextMenu}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          tab.kind === "sftpTransfer" ? "bg-sky-400" : "bg-emerald-400",
        )}
      />
      <button
        aria-pressed={active}
        className={cn("truncate", compact ? "max-w-[104px]" : "max-w-[160px]")}
        onClick={() => onSelectTab(tab.id)}
        type="button"
      >
        {title}
      </button>
      {showClose ? (
        <button
          aria-label={`关闭 ${tab.title} tab`}
          className="rounded-md p-0.5 text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function TerminalTabGroupHeader({
  collapsed,
  group,
  onContextMenu,
  onToggle,
}: {
  collapsed: boolean;
  group: TerminalTabGroup;
  onContextMenu: (event: ReactMouseEvent) => void;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={collapsed ? `展开 ${group.title} 标签组` : `折叠 ${group.title} 标签组`}
      className={cn(
        "flex h-7 max-w-[148px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium ring-1 transition hover:brightness-105",
        group.colorClassName,
      )}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      title={`${group.title} (${group.tabs.length})`}
      type="button"
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{group.title}</span>
      <span className="text-[10px] opacity-70">{group.tabs.length}</span>
    </button>
  );
}

export function TerminalTabContextMenuItems({
  activeTabId,
  group,
  onCloseTabs,
  onRequestRename,
  onSelectTab,
  runMenuAction,
  tab,
  tabs,
}: {
  activeTabId: string;
  group: TerminalTabGroup | undefined;
  onCloseTabs: (tabIds: string[]) => void;
  onRequestRename: (tab: TerminalTab) => void;
  onSelectTab: (tabId: string) => void;
  runMenuAction: (action?: () => void) => void;
  tab: TerminalTab;
  tabs: TerminalTab[];
}) {
  const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
  const rightTabIds =
    tabIndex >= 0 ? tabs.slice(tabIndex + 1).map((candidate) => candidate.id) : [];
  const otherTabIds = tabs
    .filter((candidate) => candidate.id !== tab.id)
    .map((candidate) => candidate.id);
  const sameGroupOtherTabIds =
    group && group.grouped
      ? group.tabs
          .filter((candidate) => candidate.id !== tab.id)
          .map((candidate) => candidate.id)
      : [];

  return (
    <>
      <TerminalTabMenuItem
        label={tab.id === activeTabId ? "当前标签" : "切换到此标签"}
        onClick={() => runMenuAction(() => onSelectTab(tab.id))}
      />
      <TerminalTabMenuItem
        label="重命名标签"
        onClick={() => runMenuAction(() => onRequestRename(tab))}
      />
      <TerminalTabMenuItem
        danger
        label="关闭标签"
        onClick={() => runMenuAction(() => onCloseTabs([tab.id]))}
      />
      {group?.grouped ? (
        <TerminalTabMenuItem
          disabled={sameGroupOtherTabIds.length === 0}
          label="关闭同组其他标签"
          onClick={() => runMenuAction(() => onCloseTabs(sameGroupOtherTabIds))}
        />
      ) : null}
      <TerminalTabMenuItem
        disabled={rightTabIds.length === 0}
        label="关闭右侧标签"
        onClick={() => runMenuAction(() => onCloseTabs(rightTabIds))}
      />
      <TerminalTabMenuItem
        disabled={otherTabIds.length === 0}
        label="关闭其他标签"
        onClick={() => runMenuAction(() => onCloseTabs(otherTabIds))}
      />
    </>
  );
}

export function TerminalTabGroupContextMenuItems({
  collapsed,
  group,
  onCloseTabs,
  runMenuAction,
  tabs,
  toggleTabGroup,
}: {
  collapsed: boolean;
  group: TerminalTabGroup;
  onCloseTabs: (tabIds: string[]) => void;
  runMenuAction: (action?: () => void) => void;
  tabs: TerminalTab[];
  toggleTabGroup: (groupId: string) => void;
}) {
  const groupTabIds = group.tabs.map((tab) => tab.id);
  const otherTabIds = tabs
    .filter((tab) => !groupTabIds.includes(tab.id))
    .map((tab) => tab.id);

  return (
    <>
      <TerminalTabMenuItem
        label={collapsed ? "展开分组" : "折叠分组"}
        onClick={() => runMenuAction(() => toggleTabGroup(group.id))}
      />
      <TerminalTabMenuItem
        danger
        disabled={group.tabs.length === 0}
        label="关闭分组"
        onClick={() => runMenuAction(() => onCloseTabs(groupTabIds))}
      />
      <TerminalTabMenuItem
        disabled={otherTabIds.length === 0}
        label="关闭其他分组"
        onClick={() => runMenuAction(() => onCloseTabs(otherTabIds))}
      />
    </>
  );
}

export function CloseTabsConfirmationDialog({
  onClose,
  onConfirm,
  tabCount,
}: {
  onClose: () => void;
  onConfirm: () => void;
  tabCount: number;
}) {
  return (
    <ModalShell
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button onClick={onConfirm} type="button" variant="danger">
            关闭标签
          </Button>
        </>
      }
      description={`将关闭 ${tabCount} 个终端标签，相关分屏会一并结束。`}
      maxWidthClassName="max-w-md"
      onClose={onClose}
      open={tabCount > 0}
      title="确认关闭标签"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        关闭后当前标签内的终端会话会被结束。
      </div>
    </ModalShell>
  );
}

export function TerminalTabRenameDialog({
  onClose,
  onRenameTab,
  tab,
}: {
  onClose: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  tab: TerminalTab | null;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab) {
      return;
    }

    setTitle(tab.title);
    setError(null);
  }, [tab]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tab) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请输入标签名称。");
      return;
    }

    if (trimmedTitle !== tab.title) {
      onRenameTab(tab.id, trimmedTitle);
    }
    onClose();
  };

  return (
    <ModalShell
      maxWidthClassName="max-w-md"
      onClose={onClose}
      open={Boolean(tab)}
      title="重命名标签"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-2xl border border-black/8 bg-black/[0.03] p-4 dark:border-white/8 dark:bg-white/6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Pencil className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            标签信息
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              标签名称
            </span>
            <input
              autoFocus
              className="mt-1 h-9 w-full rounded-xl border border-black/10 bg-white/86 px-3 text-sm outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-black/20"
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
              }}
              placeholder="例如：生产日志"
              value={title}
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button disabled={!title.trim()} type="submit" variant="primary">
            保存标签
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function TerminalTabMenuItem({
  danger = false,
  disabled,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center rounded-lg px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
        danger
          ? "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
          : "text-zinc-700 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-200 dark:hover:bg-white/8 dark:hover:text-zinc-50",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

export function buildTerminalTabGroups(tabs: TerminalTab[]): TerminalTabGroup[] {
  const orderedMachineIds: string[] = [];
  const tabsByMachineId = new Map<string, TerminalTab[]>();

  for (const tab of tabs) {
    if (!tabsByMachineId.has(tab.machineId)) {
      orderedMachineIds.push(tab.machineId);
      tabsByMachineId.set(tab.machineId, []);
    }
    tabsByMachineId.get(tab.machineId)?.push(tab);
  }

  return orderedMachineIds.map((machineId) => {
    const groupTabs = tabsByMachineId.get(machineId) ?? [];
    const title = groupTabs[0]?.title ?? machineId;
    return {
      colorClassName: tabGroupColors[Math.abs(hashString(machineId)) % tabGroupColors.length],
      grouped: groupTabs.length > 1,
      id: machineId,
      tabs: groupTabs,
      title,
    };
  });
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const maxX = Math.max(
    CONTEXT_MENU_MARGIN,
    window.innerWidth - width - CONTEXT_MENU_MARGIN,
  );
  const maxY = Math.max(
    CONTEXT_MENU_MARGIN,
    window.innerHeight - height - CONTEXT_MENU_MARGIN,
  );

  return {
    x: Math.round(Math.min(Math.max(x, CONTEXT_MENU_MARGIN), maxX)),
    y: Math.round(Math.min(Math.max(y, CONTEXT_MENU_MARGIN), maxY)),
  };
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
