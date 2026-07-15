import {
  ArrowLeftRight,
  Box,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Info,
  FolderOpen,
  LoaderCircle,
  Monitor,
  Pencil,
  Pin,
  Plus,
  Search,
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
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup } from "../workspace/contracts/index";
import {
  CONTEXT_MENU_MARGIN,
  statusClasses,
  type ConnectionOpenOptions,
  type SidebarContextMenuPayload,
} from "./MachineSidebar.shared";
import {
  MACHINE_ASSET_MENU_DOMAIN,
  type MachineSidebarMenuAction,
  type MachineSidebarMenuDomain,
} from "./machineSidebarMenuModel";
import { buildVisibleMachineGroups } from "./machineSidebarVisibilityModel";
import {
  MachineSidebarMachineRow,
  sidebarDisplayStatus,
} from "./MachineSidebarMachineRow";

const collapsedPopoverSurfaceClassName =
  "kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover fixed bottom-[84px] left-[72px] top-[56px] flex w-80 max-w-[calc(100vw-88px)] flex-col overflow-hidden rounded-[var(--radius-panel)] border text-[var(--text-primary)]";
const sidebarPopoverHeaderClassName =
  "kerminal-sidebar-header flex items-start justify-between gap-2 border-b border-[var(--border-subtle)]";
const sidebarSmallIconButtonClassName =
  "kerminal-pressable h-8 w-8 rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
const sidebarGroupButtonClassName =
  "kerminal-focus-ring kerminal-pressable mb-1 flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";
const sidebarCountBadgeClassName =
  "rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400";
const sidebarStatusDotClassName =
  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-nav-glass)]";
const sidebarEmptyStateClassName =
  "rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-3 py-6 text-center text-sm text-zinc-500";
const collapsedSidebarRootClassName =
  "kerminal-material-nav kerminal-shell-sidebar relative flex h-full w-full min-w-0 flex-col border-r";
const collapsedSidebarButtonBaseClassName =
  "kerminal-sidebar-collapsed-button kerminal-focus-ring kerminal-pressable relative flex items-center justify-center rounded-xl transition";
const collapsedSidebarButtonSelectedClassName =
  "bg-[var(--surface-selected)] text-zinc-950 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 dark:text-zinc-50 dark:ring-sky-300/15";
const collapsedSidebarButtonIdleClassName =
  "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50";
const collapsedSidebarFooterClassName =
  "kerminal-sidebar-collapsed-stack flex flex-col items-center border-t border-[var(--border-subtle)]";
const sidebarSettingsSelectedClassName =
  "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100";
const contextMenuItemBaseClassName =
  "kerminal-context-menu-item";
const contextMenuItemIdleClassName =
  "";
const contextMenuItemDangerClassName =
  "kerminal-context-menu-item--danger";
const dragPreviewSurfaceClassName =
  "kerminal-layer-drag-preview pointer-events-none fixed w-64 select-none rounded-[var(--radius-card)] border border-sky-300/60 bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-floating)] ring-2 ring-sky-400/18 dark:border-sky-300/35";
const dragPreviewHintClassName =
  "mt-2 rounded-xl bg-[var(--surface-selected)] px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-200";

type CollapsedHostPopoverProps = {
  allGroupsCollapsed: boolean;
  collapsedGroupIds: ReadonlySet<string>;
  dragOverGroupId: string | null;
  draggingMachineId: string | null;
  forceGroupsExpanded: boolean;
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
  rdpOpeningMachineIdSet: ReadonlySet<string>;
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
  forceGroupsExpanded,
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
  rdpOpeningMachineIdSet,
  selectedMachineId,
  startPointerMachineDrag,
  toggleAllGroups,
  toggleGroup,
  visibleGroups,
}: CollapsedHostPopoverProps) {
  const [popoverSearch, setPopoverSearch] = useState("");
  const normalizedPopoverSearch = popoverSearch.trim().toLowerCase();
  const popoverVisibleGroups = useMemo(
    () => buildVisibleMachineGroups(visibleGroups, normalizedPopoverSearch),
    [normalizedPopoverSearch, visibleGroups],
  );
  const forcePopoverGroupsExpanded =
    forceGroupsExpanded || Boolean(normalizedPopoverSearch);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-label="主机列表"
      className={collapsedPopoverSurfaceClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={popoverRef}
      role="dialog"
    >
      <div className={sidebarPopoverHeaderClassName}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">主机</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {groupCount} 个分组 / {machineCount} 台主机
          </p>
        </div>
        <Button
          aria-label={groupToggleLabel}
          aria-pressed={allGroupsCollapsed}
          className={sidebarSmallIconButtonClassName}
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
      <label className="relative mx-3 mt-3 block min-w-0">
        <span className="sr-only">搜索主机列表</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
          strokeWidth={1.8}
        />
        <input
          aria-label="搜索主机列表"
          className="kerminal-sidebar-search kerminal-field-surface h-8 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
          onChange={(event) => setPopoverSearch(event.currentTarget.value)}
          placeholder="搜索主机、分组或标签..."
          value={popoverSearch}
        />
      </label>
      <div className="kerminal-sidebar-popover-list scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
        {popoverVisibleGroups.map((group) => {
          const groupCollapsed =
            !forcePopoverGroupsExpanded && collapsedGroupIds.has(group.id);

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
                className={sidebarGroupButtonClassName}
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
                  <span className={sidebarCountBadgeClassName}>
                    {group.machines.length}
                  </span>
                </span>
              </button>
              {!groupCollapsed ? (
                <div className="space-y-1">
                  {group.machines.map((machine) => {
                    const selected = machine.id === selectedMachineId;

                    return (
                      <MachineSidebarMachineRow
                        canMove={Boolean(onMoveMachine)}
                        dragging={draggingMachineId === machine.id}
                        group={group}
                        hasOpenTerminalSession={openMachineIdSet.has(machine.id)}
                        key={machine.id}
                        machine={machine}
                        onClick={() => handleMachineClick(machine)}
                        onContextMenu={(event) => {
                          onSelectMachine(machine.id);
                          openContextMenu(event, {
                            groupId: group.id,
                            machineId: machine.id,
                            type: "machine",
                          });
                        }}
                        onDoubleClick={
                          machine.kind === "dockerContainer"
                            ? undefined
                            : () => openMachineSession(machine)
                        }
                        onPointerDown={(event) =>
                          startPointerMachineDrag(event, machine)
                        }
                        rdpOpening={rdpOpeningMachineIdSet.has(machine.id)}
                        selected={selected}
                      />
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
        {visibleGroups.length === 0 ? (
          <div className={sidebarEmptyStateClassName}>
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
      className={collapsedSidebarRootClassName}
      onContextMenu={(event) => openContextMenu(event, { type: "root" })}
    >
      <div className="kerminal-sidebar-collapsed-stack scrollbar-none flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
        <button
          aria-expanded={collapsedHostPopoverOpen}
          aria-haspopup="dialog"
          aria-label="打开主机列表"
          className={cn(
            collapsedSidebarButtonBaseClassName,
            collapsedHostPopoverOpen
              ? collapsedSidebarButtonSelectedClassName
              : collapsedSidebarButtonIdleClassName,
          )}
          onClick={toggleCollapsedHostPopover}
          ref={collapsedHostButtonRef}
          title="主机"
          type="button"
        >
          <Server className="h-4 w-4" />
          {openMachineIdSet.size > 0 ? (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[var(--surface-nav-glass)]"
              title="已有打开的会话"
            />
          ) : null}
        </button>
        <Button
          aria-label="打开 SFTP 传输工作台"
          className="kerminal-pressable text-sky-600 hover:bg-[var(--surface-hover)] dark:text-sky-300"
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
      <div className={collapsedSidebarFooterClassName}>
        <Button
          aria-label="打开设置"
          aria-pressed={settingsSelected}
          className={cn(
            settingsSelected && sidebarSettingsSelectedClassName,
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
          className="kerminal-pressable hover:bg-[var(--surface-hover)]"
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
  onOpenContainerDetails,
  onOpenHostContainers,
  onOpenRdpConnection,
  onOpenSftp,
  onOpenSshTerminal,
  onOpenSftpTransferWorkbench,
  onOpenTelnetTerminal,
  onOpenSerialTerminal,
  rdpOpening = false,
  runMenuAction,
}: {
  machine: Machine;
  onAddMachine?: (groupId?: string) => void;
  onDeleteMachine?: (machineId: string) => void;
  onDuplicateMachine?: (machineId: string) => void;
  onEditMachine?: (machineId: string) => void;
  onOpenLocalTerminal?: (machineId: string) => void;
  onOpenContainerTerminal?: (machineId: string) => void;
  onOpenContainerDetails?: (machineId: string) => void;
  onOpenHostContainers?: (machineId: string) => void;
  onOpenRdpConnection?: (machineId: string) => void;
  onOpenSftp?: (machineId: string) => void;
  onOpenSshTerminal?: (machineId: string) => void;
  onOpenSftpTransferWorkbench?: (machineId: string) => void;
  onOpenTelnetTerminal?: (machineId: string) => void;
  onOpenSerialTerminal?: (machineId: string) => void;
  rdpOpening?: boolean;
  runMenuAction: (action?: () => void) => void;
}) {
  const machineMenuDomain = MACHINE_ASSET_MENU_DOMAIN;

  if (machine.kind === "local") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenLocalTerminal}
          icon={<Monitor className="h-4 w-4" />}
          label="打开本地会话"
          menuAction="openLocalTerminal"
          menuDomain={machineMenuDomain}
          onClick={() =>
            runMenuAction(() => onOpenLocalTerminal?.(machine.id))
          }
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          menuAction="editMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          menuAction="duplicateMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          menuAction="addMachineToGroup"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          menuAction="deleteMachine"
          menuDomain={machineMenuDomain}
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
          menuAction="openContainerTerminal"
          menuDomain={machineMenuDomain}
          onClick={() =>
            runMenuAction(() => onOpenContainerTerminal?.(machine.id))
          }
        />
        <ContextMenuItem
          disabled={!onOpenContainerDetails}
          icon={<Info className="h-4 w-4" />}
          label="详情"
          menuAction="openContainerDetails"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onOpenContainerDetails?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onOpenSftp}
          icon={<FolderOpen className="h-4 w-4" />}
          label="打开 SFTP"
          menuAction="openSftp"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onOpenSftp?.(machine.id))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          menuAction="deleteMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onDeleteMachine?.(machine.id))}
        />
      </>
    );
  }

  if (machine.kind === "rdp") {
    return (
      <>
        <ContextMenuItem
          disabled={!onOpenRdpConnection || rdpOpening}
          icon={
            rdpOpening ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Monitor className="h-4 w-4" />
            )
          }
          label={rdpOpening ? "正在打开 RDP..." : "打开 RDP 连接"}
          menuAction="openRdpConnection"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onOpenRdpConnection?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          menuAction="editMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          menuAction="duplicateMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          menuAction="addMachineToGroup"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          menuAction="deleteMachine"
          menuDomain={machineMenuDomain}
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
          menuAction="openTelnetTerminal"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onOpenTelnetTerminal?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          menuAction="editMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          menuAction="duplicateMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          menuAction="addMachineToGroup"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          menuAction="deleteMachine"
          menuDomain={machineMenuDomain}
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
          menuAction="openSerialTerminal"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onOpenSerialTerminal?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onEditMachine}
          icon={<Pencil className="h-4 w-4" />}
          label="编辑连接配置"
          menuAction="editMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onDuplicateMachine}
          icon={<Copy className="h-4 w-4" />}
          label="复制主机"
          menuAction="duplicateMachine"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
        />
        <ContextMenuItem
          disabled={!onAddMachine}
          icon={<Plus className="h-4 w-4" />}
          label="添加同组连接"
          menuAction="addMachineToGroup"
          menuDomain={machineMenuDomain}
          onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
        />
        <ContextMenuItem
          danger
          disabled={!onDeleteMachine}
          icon={<Trash2 className="h-4 w-4" />}
          label="删除连接"
          menuAction="deleteMachine"
          menuDomain={machineMenuDomain}
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
        menuAction="openSshTerminal"
        menuDomain={machineMenuDomain}
        onClick={() => runMenuAction(() => onOpenSshTerminal?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onOpenHostContainers}
        icon={<Box className="h-4 w-4" />}
        label="容器"
        menuAction="openHostContainers"
        menuDomain={machineMenuDomain}
        onClick={() => runMenuAction(() => onOpenHostContainers?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onOpenSftp}
        icon={<FolderOpen className="h-4 w-4" />}
        label="打开 SFTP"
        menuAction="openSftp"
        menuDomain={machineMenuDomain}
        onClick={() => runMenuAction(() => onOpenSftp?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onOpenSftpTransferWorkbench}
        icon={<ArrowLeftRight className="h-4 w-4" />}
        label="新建传输 Tab"
        menuAction="openSftpTransferWorkbench"
        menuDomain={machineMenuDomain}
        onClick={() =>
          runMenuAction(() => onOpenSftpTransferWorkbench?.(machine.id))
        }
      />
      <ContextMenuItem
        disabled={!onEditMachine}
        icon={<Pencil className="h-4 w-4" />}
        label="编辑连接配置"
        menuAction="editMachine"
        menuDomain={machineMenuDomain}
        onClick={() => runMenuAction(() => onEditMachine?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onDuplicateMachine}
        icon={<Copy className="h-4 w-4" />}
        label="复制主机"
        menuAction="duplicateMachine"
        menuDomain={machineMenuDomain}
        onClick={() => runMenuAction(() => onDuplicateMachine?.(machine.id))}
      />
      <ContextMenuItem
        disabled={!onAddMachine}
        icon={<Plus className="h-4 w-4" />}
        label="添加同组连接"
        menuAction="addMachineToGroup"
        menuDomain={machineMenuDomain}
        onClick={() => runMenuAction(() => onAddMachine?.(machine.remoteGroupId))}
      />
      <ContextMenuItem
        danger
        disabled={!onDeleteMachine}
        icon={<Trash2 className="h-4 w-4" />}
        label="删除连接"
        menuAction="deleteMachine"
        menuDomain={machineMenuDomain}
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
  menuAction,
  menuDomain,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  menuAction?: MachineSidebarMenuAction;
  menuDomain?: MachineSidebarMenuDomain;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        contextMenuItemBaseClassName,
        danger ? contextMenuItemDangerClassName : contextMenuItemIdleClassName,
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      data-menu-action={menuAction}
      data-menu-domain={menuDomain}
      type="button"
    >
      <span className="kerminal-context-menu-icon">
        {icon}
      </span>
      <span className="kerminal-context-menu-label">{label}</span>
    </button>
  );
}

export function MachineDragPreviewCard({
  externalTargetHint,
  machine,
  targetGroupTitle,
  x,
  y,
}: {
  externalTargetHint?: string;
  machine: Machine;
  targetGroupTitle: string | undefined;
  x: number;
  y: number;
}) {
  const Icon = previewMachineIcon(machine);
  const displayStatus = sidebarDisplayStatus(machine, false);

  return (
    <div
      aria-label="正在拖动主机"
      className={dragPreviewSurfaceClassName}
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
              sidebarStatusDotClassName,
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
      <div className={dragPreviewHintClassName}>
        {targetGroupTitle
          ? `松开移动到 ${targetGroupTitle}`
          : externalTargetHint
            ? externalTargetHint
          : "拖到分组后松开"}
      </div>
    </div>
  );
}

function dragPreviewPosition(x: number, y: number) {
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
