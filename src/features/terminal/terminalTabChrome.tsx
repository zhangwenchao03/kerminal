import {
  Check,
  ChevronDown,
  ChevronRight,
  Layers2,
  Pencil,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import {
  terminalTabGroupColorIds,
  isTerminalSessionTab,
  isWorkspaceFileTab,
  type MachineGroup,
  type MachineStatus,
  type TerminalPane,
  type TerminalTab,
  type TerminalTabGroupColor,
  type TerminalTabGroupPreference,
  type TerminalTabGroupPreferences,
  type WorkspaceFileTab,
} from "../workspace/types";
import { collectPaneIds } from "../workspace/workspaceLayout";

export interface TerminalTabGroup {
  activeContainerClassName: string;
  accentClassName: string;
  color: TerminalTabGroupColor;
  colorClassName: string;
  colorLabel: string;
  containerClassName: string;
  grouped: boolean;
  id: string;
  swatchClassName: string;
  tabs: TerminalTab[];
  title: string;
}

export interface TerminalTabGroupBuildOptions {
  machineGroups?: MachineGroup[];
  panes?: TerminalPane[];
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
interface TerminalTabGroupColorTheme {
  accentClassName: string;
  activeContainerClassName: string;
  colorClassName: string;
  containerClassName: string;
  id: TerminalTabGroupColor;
  label: string;
  swatchClassName: string;
}

const tabGroupColorThemes: TerminalTabGroupColorTheme[] = [
  {
    accentClassName: "bg-sky-500 dark:bg-sky-300",
    activeContainerClassName:
      "border-sky-500/45 bg-sky-500/12 shadow-md shadow-sky-500/14 ring-1 ring-sky-400/25 dark:border-sky-300/35 dark:bg-sky-400/14 dark:ring-sky-300/20",
    colorClassName:
      "bg-sky-500/16 text-sky-800 ring-sky-500/24 dark:bg-sky-400/16 dark:text-sky-50 dark:ring-sky-300/22",
    containerClassName:
      "border-sky-500/22 bg-sky-500/7 shadow-sm shadow-sky-500/8 hover:border-sky-500/36 hover:bg-sky-500/10 dark:border-sky-300/18 dark:bg-sky-400/8 dark:shadow-black/20 dark:hover:border-sky-300/30 dark:hover:bg-sky-400/12",
    id: "blue",
    label: "蓝色",
    swatchClassName: "bg-sky-500 dark:bg-sky-300",
  },
  {
    accentClassName: "bg-pink-500 dark:bg-pink-300",
    activeContainerClassName:
      "border-pink-500/42 bg-pink-500/12 shadow-md shadow-pink-500/14 ring-1 ring-pink-400/24 dark:border-pink-300/34 dark:bg-pink-400/14 dark:ring-pink-300/20",
    colorClassName:
      "bg-pink-500/16 text-pink-800 ring-pink-500/24 dark:bg-pink-400/16 dark:text-pink-50 dark:ring-pink-300/22",
    containerClassName:
      "border-pink-500/22 bg-pink-500/7 shadow-sm shadow-pink-500/8 hover:border-pink-500/36 hover:bg-pink-500/10 dark:border-pink-300/18 dark:bg-pink-400/8 dark:shadow-black/20 dark:hover:border-pink-300/30 dark:hover:bg-pink-400/12",
    id: "pink",
    label: "粉色",
    swatchClassName: "bg-pink-500 dark:bg-pink-300",
  },
  {
    accentClassName: "bg-violet-500 dark:bg-violet-300",
    activeContainerClassName:
      "border-violet-500/42 bg-violet-500/12 shadow-md shadow-violet-500/14 ring-1 ring-violet-400/24 dark:border-violet-300/34 dark:bg-violet-400/14 dark:ring-violet-300/20",
    colorClassName:
      "bg-violet-500/16 text-violet-800 ring-violet-500/24 dark:bg-violet-400/16 dark:text-violet-50 dark:ring-violet-300/22",
    containerClassName:
      "border-violet-500/22 bg-violet-500/7 shadow-sm shadow-violet-500/8 hover:border-violet-500/36 hover:bg-violet-500/10 dark:border-violet-300/18 dark:bg-violet-400/8 dark:shadow-black/20 dark:hover:border-violet-300/30 dark:hover:bg-violet-400/12",
    id: "purple",
    label: "紫色",
    swatchClassName: "bg-violet-500 dark:bg-violet-300",
  },
  {
    accentClassName: "bg-emerald-500 dark:bg-emerald-300",
    activeContainerClassName:
      "border-emerald-500/42 bg-emerald-500/12 shadow-md shadow-emerald-500/14 ring-1 ring-emerald-400/24 dark:border-emerald-300/34 dark:bg-emerald-400/14 dark:ring-emerald-300/20",
    colorClassName:
      "bg-emerald-500/16 text-emerald-800 ring-emerald-500/24 dark:bg-emerald-400/16 dark:text-emerald-50 dark:ring-emerald-300/22",
    containerClassName:
      "border-emerald-500/22 bg-emerald-500/7 shadow-sm shadow-emerald-500/8 hover:border-emerald-500/36 hover:bg-emerald-500/10 dark:border-emerald-300/18 dark:bg-emerald-400/8 dark:shadow-black/20 dark:hover:border-emerald-300/30 dark:hover:bg-emerald-400/12",
    id: "mint",
    label: "薄荷",
    swatchClassName: "bg-emerald-500 dark:bg-emerald-300",
  },
  {
    accentClassName: "bg-amber-500 dark:bg-amber-300",
    activeContainerClassName:
      "border-amber-500/42 bg-amber-500/12 shadow-md shadow-amber-500/14 ring-1 ring-amber-400/24 dark:border-amber-300/34 dark:bg-amber-400/14 dark:ring-amber-300/20",
    colorClassName:
      "bg-amber-500/16 text-amber-800 ring-amber-500/24 dark:bg-amber-400/16 dark:text-amber-50 dark:ring-amber-300/22",
    containerClassName:
      "border-amber-500/22 bg-amber-500/7 shadow-sm shadow-amber-500/8 hover:border-amber-500/36 hover:bg-amber-500/10 dark:border-amber-300/18 dark:bg-amber-400/8 dark:shadow-black/20 dark:hover:border-amber-300/30 dark:hover:bg-amber-400/12",
    id: "amber",
    label: "琥珀",
    swatchClassName: "bg-amber-500 dark:bg-amber-300",
  },
  {
    accentClassName: "bg-cyan-500 dark:bg-cyan-300",
    activeContainerClassName:
      "border-cyan-500/42 bg-cyan-500/12 shadow-md shadow-cyan-500/14 ring-1 ring-cyan-400/24 dark:border-cyan-300/34 dark:bg-cyan-400/14 dark:ring-cyan-300/20",
    colorClassName:
      "bg-cyan-500/16 text-cyan-800 ring-cyan-500/24 dark:bg-cyan-400/16 dark:text-cyan-50 dark:ring-cyan-300/22",
    containerClassName:
      "border-cyan-500/22 bg-cyan-500/7 shadow-sm shadow-cyan-500/8 hover:border-cyan-500/36 hover:bg-cyan-500/10 dark:border-cyan-300/18 dark:bg-cyan-400/8 dark:shadow-black/20 dark:hover:border-cyan-300/30 dark:hover:bg-cyan-400/12",
    id: "teal",
    label: "青色",
    swatchClassName: "bg-cyan-500 dark:bg-cyan-300",
  },
  {
    accentClassName: "bg-orange-500 dark:bg-orange-300",
    activeContainerClassName:
      "border-orange-500/42 bg-orange-500/12 shadow-md shadow-orange-500/14 ring-1 ring-orange-400/24 dark:border-orange-300/34 dark:bg-orange-400/14 dark:ring-orange-300/20",
    colorClassName:
      "bg-orange-500/16 text-orange-800 ring-orange-500/24 dark:bg-orange-400/16 dark:text-orange-50 dark:ring-orange-300/22",
    containerClassName:
      "border-orange-500/22 bg-orange-500/7 shadow-sm shadow-orange-500/8 hover:border-orange-500/36 hover:bg-orange-500/10 dark:border-orange-300/18 dark:bg-orange-400/8 dark:shadow-black/20 dark:hover:border-orange-300/30 dark:hover:bg-orange-400/12",
    id: "orange",
    label: "橙色",
    swatchClassName: "bg-orange-500 dark:bg-orange-300",
  },
  {
    accentClassName: "bg-zinc-500 dark:bg-zinc-300",
    activeContainerClassName:
      "border-zinc-500/38 bg-zinc-500/11 shadow-md shadow-black/10 ring-1 ring-zinc-400/22 dark:border-zinc-300/30 dark:bg-zinc-300/12 dark:ring-zinc-200/18",
    colorClassName:
      "bg-zinc-500/14 text-zinc-800 ring-zinc-500/22 dark:bg-zinc-300/14 dark:text-zinc-50 dark:ring-zinc-200/18",
    containerClassName:
      "border-zinc-500/20 bg-zinc-500/7 shadow-sm shadow-black/6 hover:border-zinc-500/34 hover:bg-zinc-500/10 dark:border-zinc-300/16 dark:bg-zinc-300/8 dark:shadow-black/20 dark:hover:border-zinc-300/26 dark:hover:bg-zinc-300/11",
    id: "gray",
    label: "灰色",
    swatchClassName: "bg-zinc-500 dark:bg-zinc-300",
  },
];

const tabGroupThemeById = new Map(
  tabGroupColorThemes.map((theme) => [theme.id, theme]),
);

const terminalTabIdleClassName =
  "border-[var(--border-subtle)] bg-[var(--surface-solid)] text-zinc-600 shadow-sm shadow-black/5 hover:border-sky-500/25 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:shadow-black/20 dark:hover:border-sky-300/25 dark:hover:text-zinc-100";
const terminalTabCompactIdleClassName =
  "border-transparent bg-transparent text-zinc-600 hover:bg-white/55 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/8 dark:hover:text-zinc-50";
const terminalTabCompactActiveClassName =
  "border-white/70 bg-white/72 text-zinc-950 shadow-sm shadow-black/8 ring-1 ring-white/70 dark:border-white/14 dark:bg-white/14 dark:text-zinc-50 dark:shadow-black/20 dark:ring-white/12";
const terminalTabMenuItemClassName = "kerminal-context-menu-item";
const terminalTabMenuIdleClassName = "";

export function terminalTabStatusDotClassName(
  tab: TerminalTab,
  status: MachineStatus = "online",
  dirty = false,
) {
  if (tab.kind === "sftpTransfer") {
    return "bg-sky-400";
  }
  if (tab.kind === "workspaceFile") {
    return dirty ? "bg-amber-400" : "bg-emerald-400";
  }
  if (status === "offline") {
    return "bg-zinc-400 dark:bg-zinc-500";
  }
  if (status === "warning") {
    return "bg-amber-400";
  }
  return "bg-emerald-400";
}

export function TerminalTabButton({
  active,
  compact = false,
  onCloseTab,
  onContextMenu,
  onSelectTab,
  showClose,
  status = "online",
  tab,
  tabNumber,
  workspaceFileDirty,
}: {
  active: boolean;
  compact?: boolean;
  onCloseTab: (tabId: string) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onSelectTab: (tabId: string) => void;
  showClose: boolean;
  status?: MachineStatus;
  tab: TerminalTab;
  tabNumber?: number;
  workspaceFileDirty?: boolean;
}) {
  const title = tabNumber ? `${tabNumber} · ${tab.title}` : tab.title;

  return (
    <div
      className={cn(
        "relative z-30 flex items-center gap-2 border text-sm transition-[background-color,border-color,box-shadow,color,transform] duration-150",
        compact ? "h-8 rounded-lg px-2" : "h-9 rounded-xl px-2.5",
        compact ? "max-w-[190px]" : "shrink-0",
        active
          ? compact
            ? terminalTabCompactActiveClassName
            : "border-sky-500/60 bg-sky-500/14 text-sky-800 shadow-md shadow-sky-500/15 ring-1 ring-sky-400/30 dark:border-sky-300/45 dark:bg-sky-400/16 dark:text-sky-50 dark:ring-sky-300/25"
          : compact
            ? terminalTabCompactIdleClassName
            : terminalTabIdleClassName,
      )}
      onContextMenu={onContextMenu}
    >
      <button
        aria-label={title}
        aria-pressed={active}
        className="kerminal-focus-ring absolute inset-0 appearance-none rounded-[inherit] border-0 bg-transparent p-0"
        onClick={() => onSelectTab(tab.id)}
        type="button"
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative z-10 h-2 w-2 shrink-0 rounded-full",
          terminalTabStatusDotClassName(tab, status, workspaceFileDirty),
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative z-10 min-w-0 truncate rounded-md text-left",
          compact ? "max-w-[104px]" : "max-w-[160px]",
        )}
      >
        {title}
      </span>
      {showClose ? (
        <button
          aria-label={`关闭 ${tab.title} tab`}
          className="kerminal-focus-ring kerminal-pressable relative z-20 rounded-md p-0.5 text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:hover:text-zinc-100"
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
      aria-label={
        collapsed ? `展开 ${group.title} 标签组` : `折叠 ${group.title} 标签组`
      }
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex h-9 max-w-[220px] items-center gap-1.5 rounded-xl border border-white/35 px-2.5 text-sm font-semibold ring-1 shadow-sm shadow-black/5 hover:brightness-105 dark:border-white/10 dark:shadow-black/20",
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
      <Layers2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
      <span className="truncate">{group.title}</span>
      <span className="rounded-full bg-white/40 px-1.5 text-[10px] leading-4 opacity-80 dark:bg-white/10">
        {group.tabs.length}
      </span>
    </button>
  );
}

export function TerminalTabContextMenuItems({
  activeTabId,
  group,
  onCloseTabs,
  onCopyWorkspaceFilePath,
  onReloadWorkspaceFile,
  onRequestRename,
  onRevealWorkspaceFileInSftp,
  onSelectTab,
  runMenuAction,
  tab,
  tabs,
}: {
  activeTabId: string;
  group: TerminalTabGroup | undefined;
  onCloseTabs: (tabIds: string[]) => void;
  onCopyWorkspaceFilePath?: (tab: WorkspaceFileTab) => void;
  onReloadWorkspaceFile?: (tabId: string) => void;
  onRequestRename: (tab: TerminalTab) => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  runMenuAction: (action?: () => void) => void;
  tab: TerminalTab;
  tabs: TerminalTab[];
}) {
  const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
  const rightTabIds =
    tabIndex >= 0
      ? tabs.slice(tabIndex + 1).map((candidate) => candidate.id)
      : [];
  const otherTabIds = tabs
    .filter((candidate) => candidate.id !== tab.id)
    .map((candidate) => candidate.id);
  const sameGroupOtherTabIds =
    group && group.grouped
      ? group.tabs
          .filter((candidate) => candidate.id !== tab.id)
          .map((candidate) => candidate.id)
      : [];
  const workspaceFileTab = isWorkspaceFileTab(tab) ? tab : null;
  const canRevealWorkspaceFileInSftp =
    workspaceFileTab?.target.kind === "ssh" &&
    Boolean(onRevealWorkspaceFileInSftp);

  return (
    <>
      <TerminalTabMenuItem
        label={tab.id === activeTabId ? "当前标签" : "切换到此标签"}
        onClick={() => runMenuAction(() => onSelectTab(tab.id))}
      />
      {workspaceFileTab ? (
        <>
          <TerminalTabMenuItem
            disabled={!onCopyWorkspaceFilePath}
            label="复制完整路径"
            onClick={() =>
              runMenuAction(() => onCopyWorkspaceFilePath?.(workspaceFileTab))
            }
          />
          <TerminalTabMenuItem
            disabled={!canRevealWorkspaceFileInSftp}
            label="在 SFTP 中显示"
            onClick={() =>
              runMenuAction(() =>
                onRevealWorkspaceFileInSftp?.(workspaceFileTab.id),
              )
            }
          />
          <TerminalTabMenuItem
            disabled={!onReloadWorkspaceFile}
            label="重新加载"
            onClick={() =>
              runMenuAction(() => onReloadWorkspaceFile?.(workspaceFileTab.id))
            }
          />
        </>
      ) : null}
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
  onRequestEdit,
  runMenuAction,
  tabs,
  toggleTabGroup,
}: {
  collapsed: boolean;
  group: TerminalTabGroup;
  onCloseTabs: (tabIds: string[]) => void;
  onRequestEdit?: (group: TerminalTabGroup) => void;
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
        disabled={!onRequestEdit}
        label="编辑分组"
        onClick={() => runMenuAction(() => onRequestEdit?.(group))}
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
      description={`将关闭 ${tabCount} 个终端标签。`}
      onClose={onClose}
      open={tabCount > 0}
      size="compact"
      title="确认关闭标签"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        当前标签内的会话会结束。
      </div>
    </ModalShell>
  );
}

export function CloseWorkspaceFileTabsConfirmationDialog({
  dirtyTabCount,
  onClose,
  onConfirm,
  tabCount,
}: {
  dirtyTabCount: number;
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
            放弃修改并关闭
          </Button>
        </>
      }
      description={`将关闭 ${tabCount} 个标签，其中 ${dirtyTabCount} 个文件有未保存修改。`}
      onClose={onClose}
      open={tabCount > 0}
      size="compact"
      title="关闭未保存文件"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        未保存的文件修改会丢失。
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
      onClose={onClose}
      open={Boolean(tab)}
      size="compact"
      title="重命名标签"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="kerminal-muted-surface rounded-2xl border p-4">
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
              className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm"
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
              }}
              placeholder="例如：生产日志"
              value={title}
            />
          </label>
          {error ? (
            <p
              className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
              role="alert"
            >
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

export function TerminalTabGroupEditDialog({
  group,
  onClose,
  onSave,
}: {
  group: TerminalTabGroup | null;
  onClose: () => void;
  onSave: (groupId: string, preference: TerminalTabGroupPreference) => void;
}) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState<TerminalTabGroupColor>("blue");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!group) {
      return;
    }

    setTitle(group.title);
    setColor(group.color);
    setError(null);
  }, [group]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!group) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请输入分组名称。");
      return;
    }

    onSave(group.id, {
      color,
      title: trimmedTitle,
    });
    onClose();
  };

  return (
    <ModalShell
      onClose={onClose}
      open={Boolean(group)}
      size="small"
      title="编辑标签组"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="kerminal-muted-surface rounded-2xl border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Layers2 className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            分组信息
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              分组名称
            </span>
            <input
              autoFocus
              className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm"
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
              }}
              placeholder="例如：生产环境"
              value={title}
            />
          </label>
          <div className="mt-4">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              背景颜色
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {tabGroupColorThemes.map((theme) => {
                const selected = theme.id === color;
                return (
                  <button
                    aria-label={`选择${theme.label}分组颜色`}
                    aria-pressed={selected}
                    className={cn(
                      "kerminal-focus-ring kerminal-pressable flex h-8 w-8 items-center justify-center rounded-full border transition",
                      selected
                        ? "border-sky-500/50 bg-[var(--surface-selected)] shadow-sm shadow-sky-500/20"
                        : "border-[var(--border-subtle)] bg-[var(--surface-solid)] hover:bg-[var(--surface-hover)]",
                    )}
                    key={theme.id}
                    onClick={() => setColor(theme.id)}
                    title={theme.label}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] items-center justify-center rounded-full",
                        theme.swatchClassName,
                      )}
                    >
                      {selected ? (
                        <Check className="h-3 w-3 text-white drop-shadow dark:text-zinc-950" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {error ? (
            <p
              className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button disabled={!title.trim()} type="submit" variant="primary">
            保存
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
        terminalTabMenuItemClassName,
        danger
          ? "kerminal-context-menu-item--danger"
          : terminalTabMenuIdleClassName,
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-label">{label}</span>
    </button>
  );
}

export function buildTerminalTabGroups(
  tabs: TerminalTab[],
  preferences: TerminalTabGroupPreferences = {},
  options: TerminalTabGroupBuildOptions = {},
): TerminalTabGroup[] {
  const orderedGroupIds: string[] = [];
  const tabsByGroupId = new Map<string, TerminalTab[]>();
  const panesById = new Map(
    (options.panes ?? []).map((pane) => [pane.id, pane]),
  );

  for (const tab of tabs) {
    const groupId = resolveTerminalTabGroupId(tab, panesById);
    if (!tabsByGroupId.has(groupId)) {
      orderedGroupIds.push(groupId);
      tabsByGroupId.set(groupId, []);
    }
    tabsByGroupId.get(groupId)?.push(tab);
  }

  const usedColors = new Set<TerminalTabGroupColor>();
  return orderedGroupIds.map((groupId) => {
    const groupTabs = tabsByGroupId.get(groupId) ?? [];
    const preference = preferences[groupId];
    const title =
      preference?.title?.trim() ||
      defaultTerminalTabGroupTitle(groupId, groupTabs, options.machineGroups);
    const color =
      preference?.color ?? nextDefaultTerminalTabGroupColor(usedColors);
    usedColors.add(color);
    const theme = tabGroupThemeById.get(color) ?? tabGroupColorThemes[0];
    return {
      activeContainerClassName: theme.activeContainerClassName,
      accentClassName: theme.accentClassName,
      color,
      colorClassName: theme.colorClassName,
      colorLabel: theme.label,
      containerClassName: theme.containerClassName,
      grouped: groupTabs.length > 1,
      id: groupId,
      swatchClassName: theme.swatchClassName,
      tabs: groupTabs,
      title,
    };
  });
}

function resolveTerminalTabGroupId(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
) {
  if (isWorkspaceFileTab(tab) && tab.target.kind !== "local") {
    return tab.target.hostId;
  }

  if (isTerminalSessionTab(tab)) {
    const firstRemoteHostId = collectPaneIds(tab.layout)
      .map((paneId) => panesById.get(paneId)?.remoteHostId)
      .find((remoteHostId): remoteHostId is string => Boolean(remoteHostId));
    if (firstRemoteHostId) {
      return firstRemoteHostId;
    }
  }

  return tab.machineId;
}

function defaultTerminalTabGroupTitle(
  groupId: string,
  groupTabs: TerminalTab[],
  machineGroups: MachineGroup[] | undefined,
) {
  const firstTab = groupTabs[0];
  if (!firstTab) {
    return groupId;
  }
  if (firstTab.machineId === groupId) {
    return firstTab.title;
  }
  return findMachineGroupTitle(machineGroups, groupId) ?? firstTab.title;
}

function findMachineGroupTitle(
  machineGroups: MachineGroup[] | undefined,
  machineId: string,
) {
  for (const group of machineGroups ?? []) {
    const machine = group.machines.find(
      (candidate) => candidate.id === machineId,
    );
    if (machine) {
      return machine.name;
    }
  }
  return undefined;
}

function nextDefaultTerminalTabGroupColor(
  usedColors: Set<TerminalTabGroupColor>,
) {
  const fallbackIndex = usedColors.size % terminalTabGroupColorIds.length;
  return (
    terminalTabGroupColorIds.find((color) => !usedColors.has(color)) ??
    terminalTabGroupColorIds[fallbackIndex] ??
    "blue"
  );
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
