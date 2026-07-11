import { FolderPlus, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { Machine, MachineGroup } from "../workspace/types";
import type {
  MachineSidebarProps,
  SidebarContextMenu,
} from "./MachineSidebar.shared";
import {
  ContextMenuItem,
  MachineContextMenuItems,
} from "./MachineSidebar.parts";
import {
  MACHINE_GROUP_MENU_DOMAIN,
  MACHINE_SIDEBAR_ROOT_MENU_DOMAIN,
  machineSidebarMenuDomainForContextMenu,
} from "./machineSidebarMenuModel";

const sidebarContextMenuSurfaceClassName =
  "kerminal-context-menu kerminal-floating-enter fixed z-[1000] w-56";

type MachineSidebarContextMenuPortalProps = Pick<
  MachineSidebarProps,
  | "onAddConnection"
  | "onAddGroup"
  | "onAddMachine"
  | "onDeleteGroup"
  | "onDeleteMachine"
  | "onDuplicateMachine"
  | "onEditGroup"
  | "onEditMachine"
  | "onOpenContainerDetails"
  | "onOpenHostContainers"
  | "onOpenLocalTerminal"
  | "onOpenContainerTerminal"
  | "onOpenRdpConnection"
  | "onOpenSftp"
  | "onOpenSshTerminal"
  | "onOpenSftpTransferWorkbench"
  | "onOpenTelnetTerminal"
  | "onOpenSerialTerminal"
  | "onPinGroup"
> & {
  contextGroup?: MachineGroup;
  contextGroupPinned: boolean;
  contextMachine?: Machine;
  contextMenu: SidebarContextMenu | null;
  menuRef: RefObject<HTMLDivElement | null>;
  rdpOpeningMachineIdSet: ReadonlySet<string>;
  runMenuAction: (action?: () => void) => void;
};

export function MachineSidebarContextMenuPortal({
  contextGroup,
  contextGroupPinned,
  contextMachine,
  contextMenu,
  menuRef,
  onAddConnection,
  onAddGroup,
  onAddMachine,
  onDeleteGroup,
  onDeleteMachine,
  onDuplicateMachine,
  onEditGroup,
  onEditMachine,
  onOpenContainerDetails,
  onOpenHostContainers,
  onOpenLocalTerminal,
  onOpenContainerTerminal,
  onOpenRdpConnection,
  onOpenSftp,
  onOpenSshTerminal,
  onOpenSftpTransferWorkbench,
  onOpenTelnetTerminal,
  onOpenSerialTerminal,
  onPinGroup,
  rdpOpeningMachineIdSet,
  runMenuAction,
}: MachineSidebarContextMenuPortalProps) {
  if (!contextMenu || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-label="主机操作菜单"
      className={sidebarContextMenuSurfaceClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={menuRef}
      role="menu"
      data-menu-domain={machineSidebarMenuDomainForContextMenu(
        contextMenu.type,
      )}
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      {contextMenu.type === "root" ? (
        <>
          <ContextMenuItem
            disabled={!onAddConnection}
            icon={<Plus className="h-4 w-4" />}
            label="添加连接"
            menuAction="addConnection"
            menuDomain={MACHINE_SIDEBAR_ROOT_MENU_DOMAIN}
            onClick={() =>
              runMenuAction(() => onAddConnection?.({ mode: "ssh" }))
            }
          />
          <ContextMenuItem
            disabled={!onAddGroup}
            icon={<FolderPlus className="h-4 w-4" />}
            label="新建分组"
            menuAction="addGroup"
            menuDomain={MACHINE_SIDEBAR_ROOT_MENU_DOMAIN}
            onClick={() => runMenuAction(onAddGroup)}
          />
        </>
      ) : null}
      {contextMenu.type === "group" && contextGroup ? (
        <>
          <ContextMenuItem
            disabled={!onAddMachine}
            icon={<Plus className="h-4 w-4" />}
            label="添加连接到此分组"
            menuAction="addMachineToGroup"
            menuDomain={MACHINE_GROUP_MENU_DOMAIN}
            onClick={() => runMenuAction(() => onAddMachine?.(contextGroup.id))}
          />
          <ContextMenuItem
            disabled={!onEditGroup}
            icon={<Pencil className="h-4 w-4" />}
            label="重命名分组"
            menuAction="editGroup"
            menuDomain={MACHINE_GROUP_MENU_DOMAIN}
            onClick={() => runMenuAction(() => onEditGroup?.(contextGroup.id))}
          />
          <ContextMenuItem
            disabled={!onPinGroup}
            icon={<Pin className="h-4 w-4" />}
            label={contextGroupPinned ? "取消置顶" : "置顶分组"}
            menuAction="togglePinGroup"
            menuDomain={MACHINE_GROUP_MENU_DOMAIN}
            onClick={() =>
              runMenuAction(() =>
                onPinGroup?.(contextGroup.id, !contextGroupPinned),
              )
            }
          />
          <ContextMenuItem
            danger
            disabled={!onDeleteGroup}
            icon={<Trash2 className="h-4 w-4" />}
            label="删除分组"
            menuAction="deleteGroup"
            menuDomain={MACHINE_GROUP_MENU_DOMAIN}
            onClick={() => runMenuAction(() => onDeleteGroup?.(contextGroup.id))}
          />
          <ContextMenuItem
            disabled={!onAddGroup}
            icon={<FolderPlus className="h-4 w-4" />}
            label="新建分组"
            menuAction="addGroup"
            menuDomain={MACHINE_GROUP_MENU_DOMAIN}
            onClick={() => runMenuAction(onAddGroup)}
          />
        </>
      ) : null}
      {contextMenu.type === "machine" && contextMachine ? (
        <MachineContextMenuItems
          machine={contextMachine}
          onAddMachine={onAddMachine}
          onDeleteMachine={onDeleteMachine}
          onDuplicateMachine={onDuplicateMachine}
          onEditMachine={onEditMachine}
          onOpenContainerDetails={onOpenContainerDetails}
          onOpenHostContainers={onOpenHostContainers}
          onOpenLocalTerminal={onOpenLocalTerminal}
          onOpenContainerTerminal={onOpenContainerTerminal}
          onOpenRdpConnection={onOpenRdpConnection}
          onOpenSftp={onOpenSftp}
          onOpenSshTerminal={onOpenSshTerminal}
          onOpenSftpTransferWorkbench={onOpenSftpTransferWorkbench}
          onOpenTelnetTerminal={onOpenTelnetTerminal}
          onOpenSerialTerminal={onOpenSerialTerminal}
          rdpOpening={rdpOpeningMachineIdSet.has(contextMachine.id)}
          runMenuAction={runMenuAction}
        />
      ) : null}
    </div>,
    document.body,
  );
}
