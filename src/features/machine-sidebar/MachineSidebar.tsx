import {
  ArrowLeftRight,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { Machine } from "../workspace/types";
import {
  POINTER_DRAG_THRESHOLD_PX,
  SIDEBAR_GROUP_DROP_TARGET_ATTRIBUTE,
  type MachineDragPreview,
  type MachineSidebarProps,
  type MachineSidebarViewMode,
  type PointerMachineDrag,
  type SidebarContextMenu,
  type SidebarContextMenuPayload,
} from "./MachineSidebar.shared";
import { MachineSidebarContainersView } from "./MachineSidebarContainersView";
import { MachineSidebarContextMenuPortal } from "./MachineSidebarContextMenuPortal";
import { MachineSidebarMachineRow } from "./MachineSidebarMachineRow";
import {
  CollapsedHostPopover,
  CollapsedMachineSidebar,
  MachineDragPreviewCard,
  PinnedGroupBadge,
  clampContextMenuPosition,
  isPinnedMachineGroup,
} from "./MachineSidebar.parts";
import { buildVisibleMachineGroups } from "./machineSidebarVisibilityModel";

export type { ConnectionOpenOptions } from "./MachineSidebar.shared";

const sidebarAccentIconButtonClassName =
  "kerminal-pressable h-8 w-8 rounded-lg text-sky-600 hover:bg-[var(--surface-hover)] dark:text-sky-300";
const sidebarIconButtonClassName =
  "kerminal-pressable h-8 w-8 rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
const sidebarSearchInputClassName =
  "kerminal-sidebar-search kerminal-field-surface w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600";
const sidebarGroupButtonClassName =
  "kerminal-focus-ring kerminal-pressable mb-1 flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";
const sidebarCountBadgeClassName =
  "rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400";
const sidebarEmptyStateClassName =
  "flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-3 py-6 text-center text-sm text-zinc-500";
const sidebarFooterClassName =
  "kerminal-sidebar-footer flex items-center justify-between border-t border-[var(--border-subtle)]";
const sidebarSettingsSelectedClassName =
  "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100";

function stringSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

export function MachineSidebar({
  activeView = "hosts",
  collapsed = false,
  collapsedGroupIds: controlledCollapsedGroupIds,
  containerHostId,
  containerInitialContainerId,
  groups,
  openMachineIds = [],
  rdpOpeningMachineIds = [],
  onActiveViewChange,
  onAddConnection,
  onAddGroup,
  onAddMachine,
  onContainerHostChange,
  onCollapsedGroupIdsChange,
  onDeleteGroup,
  onDeleteMachine,
  onDuplicateMachine,
  onEnterContainer,
  onEditGroup,
  onEditMachine,
  onExternalMachineDrag,
  onExternalMachineDragEnd,
  onExternalMachineDrop,
  onFetchContainerStats,
  onInspectContainer,
  onLifecycleContainer,
  onListDockerContainers,
  onMoveMachine,
  onSearchChange,
  onOpenContainerDetails,
  onOpenHostContainers,
  onOpenContainerLogs,
  onOpenWorkspaceFileTab,
  onOpenLocalTerminal,
  onOpenContainerTerminal,
  onOpenRdpConnection,
  onOpenSettings,
  onOpenSftp,
  onOpenSshTerminal,
  onOpenSftpTransferWorkbench,
  onOpenTransferWorkbench,
  onOpenTelnetTerminal,
  onOpenSerialTerminal,
  onPinGroup,
  onPinContainer,
  onSelectMachine,
  search,
  selectedMachineId,
  settingsSelected = false,
}: MachineSidebarProps) {
  const [uncontrolledCollapsedGroupIds, setUncontrolledCollapsedGroupIds] =
    useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(
    null,
  );
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<MachineDragPreview | null>(
    null,
  );
  const [draggingMachineId, setDraggingMachineId] = useState<string | null>(null);
  const [collapsedHostPopoverOpen, setCollapsedHostPopoverOpen] = useState(false);
  const [containerRefreshRequestId, setContainerRefreshRequestId] = useState(0);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const collapsedHostButtonRef = useRef<HTMLButtonElement>(null);
  const collapsedHostPopoverRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerMachineDrag | null>(null);
  const pointerDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressNextClickRef = useRef(false);
  const collapsedGroupIds = useMemo(
    () =>
      controlledCollapsedGroupIds
        ? new Set(controlledCollapsedGroupIds)
        : uncontrolledCollapsedGroupIds,
    [controlledCollapsedGroupIds, uncontrolledCollapsedGroupIds],
  );
  const updateCollapsedGroupIds = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      const current = new Set(
        controlledCollapsedGroupIds ?? uncontrolledCollapsedGroupIds,
      );
      const next = updater(current);
      if (stringSetsEqual(current, next)) {
        return;
      }

      if (!controlledCollapsedGroupIds) {
        setUncontrolledCollapsedGroupIds(next);
      }
      onCollapsedGroupIdsChange?.([...next].sort());
    },
    [
      controlledCollapsedGroupIds,
      onCollapsedGroupIdsChange,
      uncontrolledCollapsedGroupIds,
    ],
  );
  const openMachineIdSet = useMemo(
    () => new Set(openMachineIds),
    [openMachineIds],
  );
  const rdpOpeningMachineIdSet = useMemo(
    () => new Set(rdpOpeningMachineIds),
    [rdpOpeningMachineIds],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const hasSearch = normalizedSearch.length > 0;
  const visibleGroups = useMemo(
    () => buildVisibleMachineGroups(groups, normalizedSearch),
    [groups, normalizedSearch],
  );
  const machineCount = useMemo(
    () => groups.reduce((total, group) => total + group.machines.length, 0),
    [groups],
  );
  const allGroupsCollapsed = useMemo(
    () =>
      groups.length > 0 && groups.every((group) => collapsedGroupIds.has(group.id)),
    [collapsedGroupIds, groups],
  );
  const groupToggleLabel = allGroupsCollapsed
    ? "展开所有分组"
    : "折叠所有分组";
  const GroupToggleIcon = allGroupsCollapsed ? ChevronsUpDown : ChevronsDownUp;
  const contextGroup =
    contextMenu?.type === "group" || contextMenu?.type === "machine"
      ? groups.find((group) => group.id === contextMenu.groupId)
      : undefined;
  const contextMachine =
    contextMenu?.type === "machine"
      ? contextGroup?.machines.find(
          (machine) => machine.id === contextMenu.machineId,
        )
      : undefined;
  const contextGroupPinned = isPinnedMachineGroup(contextGroup);
  const dragTargetGroup = dragOverGroupId
    ? groups.find((group) => group.id === dragOverGroupId)
    : undefined;
  useLayoutEffect(() => {
    if (groups.length === 0) {
      return;
    }

    const nextKnownGroupIds = new Set(groups.map((group) => group.id));

    updateCollapsedGroupIds((current) => {
      const next = new Set<string>();

      for (const groupId of current) {
        if (nextKnownGroupIds.has(groupId)) {
          next.add(groupId);
        }
      }

      if (next.size !== current.size) {
        return next;
      }

      for (const groupId of next) {
        if (!current.has(groupId)) {
          return next;
        }
      }

      return current;
    });
  }, [groups, updateCollapsedGroupIds]);

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
    if (!collapsed) {
      setCollapsedHostPopoverOpen(false);
    }
  }, [collapsed]);

  useEffect(() => {
    if (!collapsedHostPopoverOpen) {
      return undefined;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        collapsedHostPopoverRef.current?.contains(target) ||
        collapsedHostButtonRef.current?.contains(target)
      ) {
        return;
      }
      setCollapsedHostPopoverOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCollapsedHostPopoverOpen(false);
      }
    };
    const closeOnResize = () => setCollapsedHostPopoverOpen(false);

    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [collapsedHostPopoverOpen]);

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

  const runMenuAction = (action?: () => void) => {
    setContextMenu(null);
    action?.();
  };

  const openContextMenu = (
    event: ReactMouseEvent,
    menu: SidebarContextMenuPayload,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = clampContextMenuPosition(event.clientX, event.clientY, 0, 0);
    const menuState = {
      ...menu,
      ...position,
    };
    setContextMenu(menuState);
  };

  const toggleGroup = (groupId: string) => {
    updateCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleAllGroups = () => {
    updateCollapsedGroupIds((current) => {
      if (groups.length === 0) {
        return current;
      }
      if (groups.every((group) => current.has(group.id))) {
        return new Set();
      }
      return new Set(groups.map((group) => group.id));
    });
  };

  const switchSidebarView = (view: MachineSidebarViewMode) => {
    if (view === "containers") {
      const selectedMachine = groups
        .flatMap((group) => group.machines)
        .find((machine) => machine.id === selectedMachineId);
      if (selectedMachine?.kind === "ssh") {
        onContainerHostChange?.(selectedMachine.id);
      }
    }
    onActiveViewChange?.(view);
  };

  const openMachineSession = (machine: Machine) => {
    if (
      machine.kind === "rdp" &&
      rdpOpeningMachineIdSet.has(machine.id)
    ) {
      return;
    }
    onSelectMachine(machine.id);
    if (machine.kind === "ssh") {
      onOpenSshTerminal?.(machine.id);
      return;
    }
    if (machine.kind === "telnet") {
      onOpenTelnetTerminal?.(machine.id);
      return;
    }
    if (machine.kind === "serial") {
      onOpenSerialTerminal?.(machine.id);
      return;
    }
    if (machine.kind === "dockerContainer") {
      onOpenContainerTerminal?.(machine.id);
      return;
    }
    if (machine.kind === "rdp") {
      onOpenRdpConnection?.(machine.id);
      return;
    }
    if (machine.kind === "local") {
      onOpenLocalTerminal?.(machine.id);
    }
  };

  const selectMachine = (machine: Machine) => {
    if (machine.kind === "dockerContainer") {
      openMachineSession(machine);
      return;
    }
    onSelectMachine(machine.id);
  };

  const openHostContainersInSidebar = (machineId: string) => {
    onSelectMachine(machineId);
    onContainerHostChange?.(machineId);
    onActiveViewChange?.("containers");
    onOpenHostContainers?.(machineId);
  };

  const openContainerDetailsInSidebar = (machineId: string) => {
    const machine = groups
      .flatMap((group) => group.machines)
      .find((candidate) => candidate.id === machineId);
    if (machine?.kind === "dockerContainer" && machine.parentMachineId) {
      onSelectMachine(machine.parentMachineId);
      onContainerHostChange?.(machine.parentMachineId);
      onActiveViewChange?.("containers");
    }
    onOpenContainerDetails?.(machineId);
  };

  const cleanupPointerDrag = (notifyExternal = false) => {
    const shouldNotifyExternal = notifyExternal && pointerDragRef.current?.active;
    pointerDragCleanupRef.current?.();
    pointerDragCleanupRef.current = null;
    pointerDragRef.current = null;
    setDragPreview(null);
    setDraggingMachineId(null);
    setDragOverGroupId(null);
    if (shouldNotifyExternal) {
      onExternalMachineDragEnd?.();
    }
  };

  const groupIdFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    return (
      element.closest<HTMLElement>(`[${SIDEBAR_GROUP_DROP_TARGET_ATTRIBUTE}]`)
        ?.dataset.machineSidebarGroupId ?? null
    );
  };

  const startPointerMachineDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    machine: Machine,
  ) => {
    if (
      (!onMoveMachine && !onExternalMachineDrag && !onExternalMachineDrop) ||
      rdpOpeningMachineIdSet.has(machine.id) ||
      event.button !== 0
    ) {
      return;
    }

    cleanupPointerDrag(true);
    pointerDragRef.current = {
      active: false,
      machineId: machine.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };

    const movePointerMachineDrag = (moveEvent: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== moveEvent.pointerId) {
        return;
      }

      const deltaX = moveEvent.clientX - drag.startX;
      const deltaY = moveEvent.clientY - drag.startY;
      if (!drag.active) {
        const distance = Math.hypot(deltaX, deltaY);
        if (distance < POINTER_DRAG_THRESHOLD_PX) {
          return;
        }
        pointerDragRef.current = { ...drag, active: true };
        suppressNextClickRef.current = true;
        setDraggingMachineId(drag.machineId);
      }

      moveEvent.preventDefault();
      const nextDragOverGroupId = groupIdFromPoint(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      const externalDragFeedback = onExternalMachineDrag?.({
        clientX: moveEvent.clientX,
        clientY: moveEvent.clientY,
        machine,
      });
      setDragOverGroupId(nextDragOverGroupId);
      setDragPreview({
        externalTargetHint: externalDragFeedback?.hint,
        machine,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });
    };

    const finishPointerMachineDrag = (upEvent: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== upEvent.pointerId) {
        return;
      }

      const targetGroupId = drag.active
        ? groupIdFromPoint(upEvent.clientX, upEvent.clientY)
        : null;
      const machineId = drag.machineId;
      const shouldMove = Boolean(drag.active && targetGroupId);
      const externalDropConsumed =
        drag.active &&
        Boolean(
          onExternalMachineDrop?.({
            clientX: upEvent.clientX,
            clientY: upEvent.clientY,
            machine,
          }),
        );
      if (drag.active) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
      }

      cleanupPointerDrag(true);
      if (externalDropConsumed) {
        upEvent.preventDefault();
        return;
      }
      if (shouldMove && targetGroupId && onMoveMachine) {
        upEvent.preventDefault();
        onMoveMachine(machineId, targetGroupId);
      }
    };

    const cancelPointerMachineDrag = (cancelEvent: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || drag.pointerId !== cancelEvent.pointerId) {
        return;
      }
      cleanupPointerDrag(true);
    };

    window.addEventListener("pointermove", movePointerMachineDrag);
    window.addEventListener("pointerup", finishPointerMachineDrag);
    window.addEventListener("pointercancel", cancelPointerMachineDrag);
    pointerDragCleanupRef.current = () => {
      window.removeEventListener("pointermove", movePointerMachineDrag);
      window.removeEventListener("pointerup", finishPointerMachineDrag);
      window.removeEventListener("pointercancel", cancelPointerMachineDrag);
    };
  };

  const handleMachineClick = (machine: Machine) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    selectMachine(machine);
  };

  useEffect(
    () => () => {
      pointerDragCleanupRef.current?.();
    },
    [],
  );

  const toggleCollapsedHostPopover = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setCollapsedHostPopoverOpen((open) => !open);
  };

  const contextMenuElement = (
    <MachineSidebarContextMenuPortal
      contextGroup={contextGroup}
      contextGroupPinned={contextGroupPinned}
      contextMachine={contextMachine}
      contextMenu={contextMenu}
      menuRef={contextMenuRef}
      onAddConnection={onAddConnection}
      onAddGroup={onAddGroup}
      onAddMachine={onAddMachine}
      onDeleteGroup={onDeleteGroup}
      onDeleteMachine={onDeleteMachine}
      onDuplicateMachine={onDuplicateMachine}
      onEditGroup={onEditGroup}
      onEditMachine={onEditMachine}
      onOpenContainerDetails={openContainerDetailsInSidebar}
      onOpenHostContainers={openHostContainersInSidebar}
      onOpenLocalTerminal={onOpenLocalTerminal}
      onOpenContainerTerminal={onOpenContainerTerminal}
      onOpenRdpConnection={onOpenRdpConnection}
      onOpenSftp={onOpenSftp}
      onOpenSshTerminal={onOpenSshTerminal}
      onOpenSftpTransferWorkbench={onOpenSftpTransferWorkbench}
      onOpenTelnetTerminal={onOpenTelnetTerminal}
      onOpenSerialTerminal={onOpenSerialTerminal}
      onPinGroup={onPinGroup}
      rdpOpeningMachineIdSet={rdpOpeningMachineIdSet}
      runMenuAction={runMenuAction}
    />
  );

  const collapsedHostPopoverElement = (
    <CollapsedHostPopover
      allGroupsCollapsed={allGroupsCollapsed}
      collapsedGroupIds={collapsedGroupIds}
      dragOverGroupId={dragOverGroupId}
      draggingMachineId={draggingMachineId}
      forceGroupsExpanded={hasSearch}
      groupCount={groups.length}
      groupToggleIcon={<GroupToggleIcon className="h-4 w-4" />}
      groupToggleLabel={groupToggleLabel}
      handleMachineClick={handleMachineClick}
      machineCount={machineCount}
      onMoveMachine={onMoveMachine}
      onSelectMachine={onSelectMachine}
      open={collapsedHostPopoverOpen}
      openContextMenu={openContextMenu}
      openMachineIdSet={openMachineIdSet}
      openMachineSession={openMachineSession}
      popoverRef={collapsedHostPopoverRef}
      rdpOpeningMachineIdSet={rdpOpeningMachineIdSet}
      selectedMachineId={selectedMachineId}
      startPointerMachineDrag={startPointerMachineDrag}
      toggleAllGroups={toggleAllGroups}
      toggleGroup={toggleGroup}
      visibleGroups={visibleGroups}
    />
  );

  const dragPreviewElement =
    dragPreview && typeof document !== "undefined"
      ? createPortal(
          <MachineDragPreviewCard
            externalTargetHint={dragPreview.externalTargetHint}
            machine={dragPreview.machine}
            targetGroupTitle={dragTargetGroup?.title}
            x={dragPreview.x}
            y={dragPreview.y}
          />,
          document.body,
        )
      : null;

  if (collapsed) {
    return (
      <CollapsedMachineSidebar
        collapsedHostButtonRef={collapsedHostButtonRef}
        collapsedHostPopoverElement={collapsedHostPopoverElement}
        collapsedHostPopoverOpen={collapsedHostPopoverOpen}
        contextMenuElement={contextMenuElement}
        dragPreviewElement={dragPreviewElement}
        onAddConnection={onAddConnection}
        onOpenSettings={onOpenSettings}
        onOpenTransferWorkbench={onOpenTransferWorkbench}
        openContextMenu={openContextMenu}
        openMachineIdSet={openMachineIdSet}
        settingsSelected={settingsSelected}
        toggleCollapsedHostPopover={toggleCollapsedHostPopover}
      />
    );
  }

  return (
    <aside
      aria-label="主机侧边栏"
      className="kerminal-material-nav kerminal-shell-sidebar relative flex h-full w-full min-w-[220px] flex-col border-r"
      onContextMenu={(event) => openContextMenu(event, { type: "root" })}
    >
      <div
        className="kerminal-sidebar-header flex flex-col"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <div
            aria-label="左栏视图"
            className="grid min-w-0 flex-1 grid-cols-2 gap-1 rounded-xl border border-[var(--border-subtle)] bg-black/[0.025] p-1 dark:bg-white/[0.045]"
            role="group"
          >
            <button
              aria-pressed={activeView === "hosts"}
              className={cn(
                "kerminal-focus-ring kerminal-pressable flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] dark:text-zinc-400",
                activeView === "hosts" &&
                  "bg-[var(--surface-selected)] text-zinc-950 shadow-sm dark:text-zinc-50",
              )}
              onClick={() => switchSidebarView("hosts")}
              type="button"
            >
              <Server className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">主机</span>
            </button>
            <button
              aria-pressed={activeView === "containers"}
              className={cn(
                "kerminal-focus-ring kerminal-pressable flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] dark:text-zinc-400",
                activeView === "containers" &&
                  "bg-[var(--surface-selected)] text-zinc-950 shadow-sm dark:text-zinc-50",
              )}
              onClick={() => switchSidebarView("containers")}
              type="button"
            >
              <Box className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">容器</span>
            </button>
          </div>
          <div className="flex w-[68px] shrink-0 items-center gap-1">
            <Button
              aria-label="打开 SFTP 传输工作台"
              className={sidebarAccentIconButtonClassName}
              disabled={!onOpenTransferWorkbench}
              onClick={onOpenTransferWorkbench}
              size="icon"
              title="SFTP 传输"
              type="button"
              variant="ghost"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            {activeView === "hosts" ? (
                <Button
                  aria-label={groupToggleLabel}
                  aria-pressed={allGroupsCollapsed}
                  className={sidebarIconButtonClassName}
                  disabled={groups.length === 0}
                  onClick={toggleAllGroups}
                  size="icon"
                  title={groupToggleLabel}
                  type="button"
                  variant="ghost"
                >
                  <GroupToggleIcon className="h-4 w-4" />
                </Button>
            ) : (
              <Button
                aria-label="刷新容器列表"
                className={sidebarIconButtonClassName}
                onClick={() =>
                  setContainerRefreshRequestId((requestId) => requestId + 1)
                }
                size="icon"
                title="刷新容器列表"
                type="button"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {activeView === "hosts" && groups.length > 0 ? (
          <label className="relative block">
            <span className="sr-only">搜索主机</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            />
            <input
              className={sidebarSearchInputClassName}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              placeholder="搜索"
              value={search}
            />
          </label>
        ) : null}
      </div>

      {activeView === "containers" ? (
        <MachineSidebarContainersView
          groups={groups}
          hostId={containerHostId}
          initialContainerId={containerInitialContainerId}
          onEnterContainer={onEnterContainer}
          onFetchContainerStats={onFetchContainerStats}
          onHostChange={onContainerHostChange}
          onInspectContainer={onInspectContainer}
          onLifecycleContainer={onLifecycleContainer}
          onListDockerContainers={onListDockerContainers}
          onOpenContainerLogs={onOpenContainerLogs}
          onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
          onPinContainer={onPinContainer}
          refreshRequestId={containerRefreshRequestId}
          selectedMachineId={selectedMachineId}
        />
      ) : (
        <div className="kerminal-sidebar-list scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
        {visibleGroups.map((group) => {
          const collapsed = !hasSearch && collapsedGroupIds.has(group.id);

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
                aria-expanded={!collapsed}
                className={sidebarGroupButtonClassName}
                onClick={() => toggleGroup(group.id)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {collapsed ? (
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
              {!collapsed ? (
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
                        showLatency
                      />
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}

        {hasSearch && visibleGroups.length === 0 ? (
          <div className={sidebarEmptyStateClassName}>
            没有结果
          </div>
        ) : groups.length === 0 ? (
          <div className={sidebarEmptyStateClassName}>
            <Server aria-hidden="true" className="mb-2 h-5 w-5 text-zinc-400" />
            <span>暂无连接</span>
            <Button
              className="mt-3"
              disabled={!onAddConnection}
              onClick={() => onAddConnection?.({ mode: "ssh" })}
              size="sm"
              type="button"
            >
              <Plus className="h-4 w-4" />
              添加连接
            </Button>
          </div>
        ) : null}
        </div>
      )}

      <div className={sidebarFooterClassName}>
        <Button
          aria-label="打开设置"
          aria-pressed={settingsSelected}
          className={cn(
            "h-8 w-8 rounded-lg",
            settingsSelected && sidebarSettingsSelectedClassName,
          )}
          onClick={onOpenSettings}
          size="icon"
          title="设置"
          variant="ghost"
        >
          <Settings className="h-4 w-4" />
        </Button>
        {groups.length > 0 ? (
          <Button
            aria-label="添加连接"
            className="h-8 w-8 rounded-lg"
            disabled={!onAddConnection}
            onClick={() => onAddConnection?.({ mode: "ssh" })}
            size="icon"
            title="添加连接"
            variant="ghost"
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {contextMenuElement}
      {dragPreviewElement}
    </aside>
  );
}

