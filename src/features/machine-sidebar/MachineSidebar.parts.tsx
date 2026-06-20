import {
  ArrowLeftRight,
  Box,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  FolderOpen,
  Monitor,
  Pencil,
  Pin,
  Plus,
  Server,
  Settings,
  Terminal,
  Trash2,
} from "lucide-react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup } from "../workspace/types";
import {
  CONTEXT_MENU_MARGIN,
  statusClasses,
  type ConnectionOpenOptions,
  type SidebarContextMenuPayload,
} from "./MachineSidebar.shared";

type CollapsedHostPopoverProps = {
  allGroupsCollapsed: boolean;
  collapsedGroupIds: ReadonlySet<string>;
  dragOverGroupId: string | null;
  draggingMachineId: string | null;
  groupCount: number;
  groupToggleIcon: ReactNode;
  groupToggleLabel: string;
  handleMachineClick: (machine: Machine) => void;
  machineCount: number;
  onMoveMachine?: (machineId: string, groupId: string) => void;
  onSelectMachine: (machineId: string) => void;
  open: boolean;
  openContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    payload: SidebarContextMenuPayload,
  ) => void;
  openMachineIdSet: ReadonlySet<string>;
  openMachineSession: (machine: Machine) => void;
  popoverRef: RefObject<HTMLDivElement | null>;
  selectedMachineId: string;
  startPointerMachineDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    machine: Machine,
  ) => void;
  toggleAllGroups: () => void;
  toggleGroup: (groupId: string) => void;
  visibleGroups: MachineGroup[];
};

export function CollapsedHostPopover({
  allGroupsCollapsed,
  collapsedGroupIds,
  dragOverGroupId,
  draggingMachineId,
  groupCount,
  groupToggleIcon,
  groupToggleLabel,
  handleMachineClick,
  machineCount,
  onMoveMachine,
  onSelectMachine,
  open,
  openContextMenu,
  openMachineIdSet,
  openMachineSession,
  popoverRef,
  selectedMachineId,
  startPointerMachineDrag,
  toggleAllGroups,
  toggleGroup,
  visibleGroups,
}: CollapsedHostPopoverProps) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-label="主机列表"
      className={cn(
        "fixed bottom-[84px] left-[72px] top-[56px] z-40 flex w-80 max-w-[calc(100vw-88px)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-zinc-950 shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-50",
      )}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={popoverRef}
      role="dialog"
    >
      <div className="flex items-start justify-between gap-2 border-b border-black/8 px-4 py-3 dark:border-white/8">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">主机</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {groupCount} 个分组 / {machineCount} 台主机
          </p>
        </div>
        <Button
          aria-label={groupToggleLabel}
          aria-pressed={allGroupsCollapsed}
          className="h-8 w-8 rounded-lg text-zinc-500 dark:text-zinc-400"
          disabled={groupCount === 0}
          onClick={toggleAllGroups}
          size="icon"
          title={groupToggleLabel}
          type="button"
          variant="ghost"
        >
          {groupToggleIcon}
        </Button>
      </div>
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {visibleGroups.map((group) => {
          const groupCollapsed = collapsedGroupIds.has(group.id);

          return (
            <section
              aria-label={group.title}
              className={cn(
                "rounded-xl transition",
                dragOverGroupId === group.id &&
                  "bg-sky-500/12 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.26)] ring-2 ring-sky-400/70 dark:bg-sky-400/14",
              )}
              key={group.id}
              data-machine-sidebar-group-id={group.id}
              onContextMenu={(event) =>
                openContextMenu(event, { groupId: group.id, type: "group" })
              }
            >
              <button
                aria-expanded={!groupCollapsed}
                className="mb-1 flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-medium text-zinc-500 transition hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/7 dark:hover:text-zinc-100"
                onClick={() => toggleGroup(group.id)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {groupCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{group.title}</span>
                  {isPinnedMachineGroup(group) ? <PinnedGroupBadge /> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {dragOverGroupId === group.id ? (
                    <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-400/16 dark:text-sky-200">
                      松开移入
                    </span>
                  ) : null}
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-white/8 dark:text-zinc-400">
                    {group.machines.length}
                  </span>
                </span>
              </button>
              {!groupCollapsed ? (
                <div className="space-y-1">
                  {group.machines.map((machine) => {
                    const selected = machine.id === selectedMachineId;
                    const Icon = machineIcon(machine, group);
                    const displayStatus = openMachineIdSet.has(machine.id)
                      ? "online"
                      : machine.status;

                    return (
                      <button
                        aria-grabbed={
                          draggingMachineId === machine.id || undefined
                        }
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition",
                          onMoveMachine && "cursor-grab active:cursor-grabbing",
                          draggingMachineId === machine.id &&
                            "scale-[0.98] bg-sky-500/6 opacity-35 ring-2 ring-dashed ring-sky-400/70 dark:bg-sky-400/8",
                          selected
                            ? "bg-black/7 text-zinc-950 shadow-sm dark:bg-white/12 dark:text-zinc-50"
                            : "text-zinc-600 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/7 dark:hover:text-zinc-50",
                        )}
                        key={machine.id}
                        onClick={() => handleMachineClick(machine)}
                        onContextMenu={(event) => {
                          onSelectMachine(machine.id);
                          openContextMenu(event, {
                            groupId: group.id,
                            machineId: machine.id,
                            type: "machine",
                          });
                        }}
                        onDoubleClick={() => {
                          if (machine.kind !== "dockerContainer") {
                            openMachineSession(machine);
                          }
                        }}
                        onPointerDown={(event) =>
                          startPointerMachineDrag(event, machine)
                        }
                        title={machineTitle(machine)}
                        type="button"
                      >
                        <span
                          className={cn(
                            "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                            machine.kind === "local"
                              ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/12 dark:text-emerald-300"
                              : "bg-sky-500/10 text-sky-600 dark:bg-sky-400/12 dark:text-sky-300",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span
                            className={cn(
                              "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950",
                              statusClasses[displayStatus],
                            )}
                            title={statusTitle(displayStatus)}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {machine.name}
                          </span>
                          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {machine.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
        {visibleGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/10 px-3 py-6 text-center text-sm text-zinc-500 dark:border-white/10">
            没有匹配的主机。
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

type CollapsedMachineSidebarProps = {
  collapsedHostButtonRef: RefObject<HTMLButtonElement | null>;
  collapsedHostPopoverElement: ReactNode;
  collapsedHostPopoverOpen: boolean;
  contextMenuElement: ReactNode;
  dragPreviewElement: ReactNode;
  onAddConnection?: (options?: ConnectionOpenOptions) => void;
  onOpenSettings?: () => void;
  onOpenTransferWorkbench?: () => void;
  openContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    payload: SidebarContextMenuPayload,
  ) => void;
  openMachineIdSet: ReadonlySet<string>;
  settingsSelected: boolean;
  toggleCollapsedHostPopover: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

export function CollapsedMachineSidebar({
  collapsedHostButtonRef,
  collapsedHostPopoverElement,
  collapsedHostPopoverOpen,
  contextMenuElement,
  dragPreviewElement,
  onAddConnection,
  onOpenSettings,
  onOpenTransferWorkbench,
  openContextMenu,
  openMachineIdSet,
  settingsSelected,
  toggleCollapsedHostPopover,
}: CollapsedMachineSidebarProps) {
  return (
    <aside
      aria-label="主机侧边栏"
      className="relative flex h-full w-full min-w-0 flex-col border-r border-black/8 bg-white/78 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/78"
      onContextMenu={(event) => openContextMenu(event, { type: "root" })}
    >
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-3">
        <button
          aria-expanded={collapsedHostPopoverOpen}
          aria-haspopup="dialog"
          aria-label="打开主机列表"
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-xl transition",
            collapsedHostPopoverOpen
              ? "bg-black/7 text-zinc-950 shadow-sm dark:bg-white/12 dark:text-zinc-50"
              : "text-zinc-500 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/7 dark:hover:text-zinc-50",
          )}
          onClick={toggleCollapsedHostPopover}
          ref={collapsedHostButtonRef}
          title="主机"
          type="button"
        >
          <Server className="h-4 w-4" />
          {openMachineIdSet.size > 0 ? (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-zinc-950"
              title="已有打开的会话"
            />
          ) : null}
        </button>
        <Button
          aria-label="打开 SFTP 传输工作台"
          disabled={!onOpenTransferWorkbench}
          onClick={onOpenTransferWorkbench}
          size="icon"
          title="SFTP 传输"
          type="button"
          variant="ghost"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-col items-center gap-2 border-t border-black/8 py-3 dark:border-white/8">
        <Button
          aria-label="打开设置"
          aria-pressed={settingsSelected}
          className={cn(
            settingsSelected &&
              "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100",
          )}
          onClick={onOpenSettings}
          size="icon"
          title="打开设置"
          variant="ghost"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          aria-label="添加连接"
          disabled={!onAddConnection}
          onClick={() => onAddConnection?.({ mode: "ssh" })}
          size="icon"
          title="添加连接"
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {collapsedHostPopoverElement}
      {contextMenuElement}
      {dragPreviewElement}
    </aside>
  );
}

export function MachineContextMenuItems({
  machine,
  onAddMachine,
  onDeleteMachine,
  onDuplicateMachine,
  onEditMachine,
  onOpenLocalTerminal,
  onOpenContainerTerminal,
  onOpenRdpConnection,
  onOpenSftp,
  onOpenSshTerminal,
  onOpenSftpTransferWorkbench,
  onOpenTelnetTerminal,
  onOpenSerialTerminal,
  runMenuAction,
}: {
  machine: Machine;
  onAddMachine?: (groupId?: string) => void;
  onDeleteMachine?: (machineId: string) => void;
  onDuplicateMachine?: (machineId: string) => void;
  onEditMachine?: (machineId: string) => void;
  onOpenLocalTerminal?: (machineId: string) => void;
  onOpenContainerTerminal?: (machineId: string) => void;
  onOpenRdpConnection?: (machineId: string) => void;
  onOpenSftp?: (machineId: string) => void;
  onOpenSshTerminal?: (machineId: string) => void;
  onOpenSftpTransferWorkbench?: (machineId: string) => void;
  onOpenTelnetTerminal?: (machineId: string) => void;
  onOpenSerialTerminal?: (machineId: string) => void;
  runMenuAction: (action?: () => void) => void;
}) {
  if (machine.kind === "local") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenLocalTerminal}
          icon={<Monitor className="h-4 w-4" />}
          label="打开本地会话"
          onClick={() =>
            runMenuAction(() => onOpenLocalTerminal?.(machine.id))
          }
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
        />
      </>
    );
  }

  if (machine.kind === "dockerContainer") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenContainerTerminal}
          icon={<Terminal className="h-4 w-4" />}
          label="进入容器终端"
          onClick={() =>
            runMenuAction(() => onOpenContainerTerminal?.(machine.id))
          }
        />
        <ContextMenuItem
          disabled={!onOpenSftp}
          icon={<FolderOpen className="h-4 w-4" />}
          label="打开 SFTP"
          onClick={() => runMenuAction(() => onOpenSftp?.(machine.id))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
        />
      </>
    );
  }

  if (machine.kind === "rdp") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenRdpConnection}
          icon={<Monitor className="h-4 w-4" />}
          label="打开 RDP 连接"
          onClick={() => runMenuAction(() => onOpenRdpConnection?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
        />
      </>
    );
  }

  if (machine.kind === "telnet") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenTelnetTerminal}
          icon={<Terminal className="h-4 w-4" />}
          label="打开 Telnet 终端"
          onClick={() => runMenuAction(() => onOpenTelnetTerminal?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
        />
      </>
    );
  }

  if (machine.kind === "serial") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenSerialTerminal}
          icon={<Terminal className="h-4 w-4" />}
          label="打开 Serial 终端"
          onClick={() => runMenuAction(() => onOpenSerialTerminal?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
        />
      </>
    );
  }

  return (
    <>
      <ContextMenuItem
        disabled={!onOpenSshTerminal}
        icon={<Terminal className="h-4 w-4" />}
        label="打开 SSH 终端"
        onClick={() => runMenuAction(() => onOpenSshTerminal?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onOpenSftp}
        icon={<FolderOpen className="h-4 w-4" />}
        label="打开 SFTP"
        onClick={() => runMenuAction(() => onOpenSftp?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onOpenSftpTransferWorkbench}
        icon={<ArrowLeftRight className="h-4 w-4" />}
        label="新建传输 Tab"
        onClick={() =>
          runMenuAction(() => onOpenSftpTransferWorkbench?.(machine.id))
        }
      />
      <ContextMenuItem
        disabled={!onEditMachine}
        icon={<Pencil className="h-4 w-4" />}
        label="编辑连接配置"
        onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onDuplicateMachine}
        icon={<Copy className="h-4 w-4" />}
        label="复制主机"
        onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onAddMachine}
        icon={<Plus className="h-4 w-4" />}
        label="添加同组连接"
        onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
      />
      <ContextMenuItem
        danger
        disabled={!onDeleteMachine}
        icon={<Trash2 className="h-4 w-4" />}
        label="删除连接"
        onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
      />
    </>
  );
}

export function ContextMenuItem({
  danger = false,
  disabled,
  icon,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
        danger
          ? "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
          : "text-zinc-700 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-200 dark:hover:bg-white/8 dark:hover:text-zinc-50",
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span
        className={cn(
          danger ? "text-red-500 dark:text-red-300" : "text-sky-500 dark:text-sky-300",
        )}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function MachineDragPreviewCard({
  machine,
  targetGroupTitle,
  x,
  y,
}: {
  machine: Machine;
  targetGroupTitle: string | undefined;
  x: number;
  y: number;
}) {
  const Icon = previewMachineIcon(machine);
  const displayStatus = machine.status;

  return (
    <div
      aria-label="正在拖动主机"
      className={cn(
        "pointer-events-none fixed z-[70] w-64 select-none rounded-2xl border border-sky-300/70 bg-white/95 p-3 text-sm text-zinc-950 shadow-2xl shadow-sky-900/24 ring-4 ring-sky-400/18 backdrop-blur-xl dark:border-sky-300/35 dark:bg-zinc-950/95 dark:text-zinc-50 dark:shadow-black/45",
      )}
      role="status"
      style={dragPreviewPosition(x, y)}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            machine.kind === "local"
              ? "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/14 dark:text-emerald-300"
              : "bg-sky-500/12 text-sky-600 dark:bg-sky-400/14 dark:text-sky-300",
          )}
        >
          <Icon className="h-4 w-4" />
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950",
              statusClasses[displayStatus],
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{machine.name}</span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            {machine.description}
          </span>
        </span>
      </div>
      <div className="mt-2 rounded-xl bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-700 dark:bg-sky-400/14 dark:text-sky-200">
        {targetGroupTitle
          ? `松开移动到 ${targetGroupTitle}`
          : "拖到分组后松开"}
      </div>
    </div>
  );
}

export function dragPreviewPosition(x: number, y: number) {
  const width = 264;
  const height = 96;
  if (typeof window === "undefined") {
    return {
      left: x + 16,
      top: y + 12,
      transform: "rotate(1deg)",
    };
  }
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - height - 8);
  return {
    left: Math.min(Math.max(x + 16, 8), maxLeft),
    top: Math.min(Math.max(y + 12, 8), maxTop),
    transform: "rotate(1deg)",
  };
}

export function PinnedGroupBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-400/12 dark:text-sky-200"
      title="已置顶"
    >
      <Pin className="h-3 w-3" />
      置顶
    </span>
  );
}

export function isPinnedMachineGroup(group: MachineGroup | undefined) {
  return Boolean(group?.pinned ?? ((group?.sortOrder ?? 0) < 0));
}

function previewMachineIcon(machine: Machine) {
  if (machine.kind === "local" || machine.kind === "rdp") {
    return Monitor;
  }
  if (machine.kind === "telnet" || machine.kind === "serial") {
    return Terminal;
  }
  if (machine.kind === "dockerContainer") {
    return Box;
  }
  if (machine.production) {
    return Cloud;
  }
  return Server;
}

export function machineIcon(machine: Machine, group: MachineGroup) {
  if (machine.kind === "local") {
    return Monitor;
  }
  if (machine.kind === "rdp") {
    return Monitor;
  }
  if (machine.kind === "telnet" || machine.kind === "serial") {
    return Terminal;
  }
  if (machine.kind === "dockerContainer") {
    return Box;
  }
  if (group.id === "cloud" || group.id === "group-cloud" || machine.production) {
    return Cloud;
  }
  return Server;
}

export function machineTitle(machine: Machine) {
  return [machine.name, machine.description, ...machine.tags].filter(Boolean).join(" · ");
}

export function statusTitle(status: Machine["status"]) {
  if (status === "online") {
    return "已打开会话";
  }
  if (status === "warning") {
    return "需要注意";
  }
  return "未打开会话";
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
