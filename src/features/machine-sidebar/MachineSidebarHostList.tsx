import { ChevronDown, ChevronRight, Plus, Server } from "lucide-react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup } from "../workspace/contracts/index";
import type { ConnectionOpenOptions, SidebarContextMenuPayload } from "./MachineSidebar.shared";
import { MachineSidebarMachineRow } from "./MachineSidebarMachineRow";
import { PinnedGroupBadge, isPinnedMachineGroup } from "./MachineSidebar.primitives";

const groupButtonClassName =
  "kerminal-focus-ring kerminal-pressable mb-1 flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100";
const countBadgeClassName =
  "rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400";
const emptyStateClassName =
  "flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-3 py-6 text-center text-sm text-zinc-500";

export function MachineSidebarHostList({
  collapsedGroupIds, dragOverGroupId, draggingMachineId, groups, hasSearch,
  onAddConnection, onMachineClick, onMoveMachine, onOpenContextMenu,
  onOpenMachineSession, onSelectMachine, onStartPointerDrag, onToggleGroup,
  openMachineIdSet, rdpOpeningMachineIdSet, selectedMachineId, visibleGroups,
}: {
  collapsedGroupIds: ReadonlySet<string>;
  dragOverGroupId: string | null;
  draggingMachineId: string | null;
  groups: MachineGroup[];
  hasSearch: boolean;
  onAddConnection?: (options?: ConnectionOpenOptions) => void;
  onMachineClick: (machine: Machine) => void;
  onMoveMachine?: (machineId: string, groupId: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent, payload: SidebarContextMenuPayload) => void;
  onOpenMachineSession: (machine: Machine) => void;
  onSelectMachine: (machineId: string) => void;
  onStartPointerDrag: (event: ReactPointerEvent<HTMLButtonElement>, machine: Machine) => void;
  onToggleGroup: (groupId: string) => void;
  openMachineIdSet: ReadonlySet<string>;
  rdpOpeningMachineIdSet: ReadonlySet<string>;
  selectedMachineId: string;
  visibleGroups: MachineGroup[];
}) {
  return (
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
            data-machine-sidebar-group-id={group.id}
            key={group.id}
            onContextMenu={(event) => onOpenContextMenu(event, { groupId: group.id, type: "group" })}
          >
            <button aria-expanded={!collapsed} className={groupButtonClassName} onClick={() => onToggleGroup(group.id)} type="button">
              <span className="flex min-w-0 items-center gap-1.5">
                {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{group.title}</span>
                {isPinnedMachineGroup(group) ? <PinnedGroupBadge /> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {dragOverGroupId === group.id ? <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-400/16 dark:text-sky-200">松开移入</span> : null}
                <span className={countBadgeClassName}>{group.machines.length}</span>
              </span>
            </button>
            {!collapsed ? <div className="space-y-1">
              {group.machines.map((machine) => (
                <MachineSidebarMachineRow
                  canMove={Boolean(onMoveMachine)}
                  dragging={draggingMachineId === machine.id}
                  group={group}
                  hasOpenTerminalSession={openMachineIdSet.has(machine.id)}
                  key={machine.id}
                  machine={machine}
                  onClick={() => onMachineClick(machine)}
                  onContextMenu={(event) => {
                    onSelectMachine(machine.id);
                    onOpenContextMenu(event, { groupId: group.id, machineId: machine.id, type: "machine" });
                  }}
                  onDoubleClick={machine.kind === "dockerContainer" ? undefined : () => onOpenMachineSession(machine)}
                  onPointerDown={(event) => onStartPointerDrag(event, machine)}
                  rdpOpening={rdpOpeningMachineIdSet.has(machine.id)}
                  selected={machine.id === selectedMachineId}
                  showLatency
                />
              ))}
            </div> : null}
          </section>
        );
      })}
      {hasSearch && visibleGroups.length === 0 ? <div className={emptyStateClassName}>没有结果</div> : groups.length === 0 ? (
        <div className={emptyStateClassName}>
          <Server aria-hidden="true" className="mb-2 h-5 w-5 text-zinc-400" />
          <span>暂无连接</span>
          <Button className="mt-3" disabled={!onAddConnection} onClick={() => onAddConnection?.({ mode: "ssh" })} size="sm" type="button">
            <Plus className="h-4 w-4" />添加连接
          </Button>
        </div>
      ) : null}
    </div>
  );
}
