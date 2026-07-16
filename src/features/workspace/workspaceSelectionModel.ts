// @author kongweiguang

import { findMachine } from "./workspaceMachineModel";
import type { MachineGroup, TerminalTab } from "./types";
import { isSftpTransferWorkspaceTab, isWorkspaceFileTab } from "./types";
import { workspaceFileTargetHostId } from "./workspaceFileTabModel";

interface RestoredSelectedMachineIdOptions {
  activeTabId: string;
  fallbackSelectedMachineId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalTabs: TerminalTab[];
}

interface SelectedMachineIdForUpdatedGroupsOptions {
  activeTabId: string;
  allowPendingActiveTabSelection: boolean;
  fallbackSelectedMachineId: string;
  machineGroups: MachineGroup[];
  terminalTabs: TerminalTab[];
}

export function sanitizeRestoredSftpTransferTabs(
  tabs: TerminalTab[],
  machineGroups: MachineGroup[],
): TerminalTab[] {
  return tabs.map((tab) => {
    if (!isSftpTransferWorkspaceTab(tab)) {
      return tab;
    }

    const lockedLeftHostId = validSshHostId(machineGroups, tab.lockedLeftHostId);
    const leftHostId =
      lockedLeftHostId ?? validSshHostId(machineGroups, tab.leftHostId);
    const rightHostId = validSshHostId(machineGroups, tab.rightHostId);
    const machineHostId = validSshHostId(machineGroups, tab.machineId);
    const primaryHostId =
      rightHostId ?? lockedLeftHostId ?? leftHostId ?? machineHostId;

    return {
      ...tab,
      leftHostId: leftHostId ?? machineHostId,
      lockedLeftHostId,
      machineId: primaryHostId ?? "sftp-transfer",
      rightHostId,
    };
  });
}

export function restoredSelectedMachineId({
  activeTabId,
  fallbackSelectedMachineId,
  machineGroups,
  selectedMachineId,
  terminalTabs,
}: RestoredSelectedMachineIdOptions): string {
  const activeTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
  // 空工作区没有当前目标，历史侧栏选择不能恢复成运行态上下文。
  if (!activeTab) {
    return "";
  }
  const activeTabCandidate = selectedMachineIdCandidateFromTab(
    activeTab,
  );

  return (
    validMachineId(machineGroups, activeTabCandidate) ||
    activeTabCandidate ||
    validMachineId(machineGroups, selectedMachineId) ||
    pendingRemoteSelectionId(selectedMachineId) ||
    validMachineId(machineGroups, fallbackSelectedMachineId) ||
    ""
  );
}

export function selectedMachineIdForUpdatedGroups({
  activeTabId,
  allowPendingActiveTabSelection,
  fallbackSelectedMachineId,
  machineGroups,
  terminalTabs,
}: SelectedMachineIdForUpdatedGroupsOptions): string {
  const activeTabCandidate = selectedMachineIdCandidateFromTab(
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0],
  );

  return (
    validMachineId(machineGroups, fallbackSelectedMachineId) ||
    validMachineId(machineGroups, activeTabCandidate) ||
    (allowPendingActiveTabSelection
      ? pendingRemoteSelectionId(fallbackSelectedMachineId) ||
        activeTabCandidate
      : "") ||
    ""
  );
}

export function selectedMachineIdFromWorkspaceTab(
  tab: TerminalTab | undefined,
  machineGroups: MachineGroup[],
): string {
  return validMachineId(machineGroups, selectedMachineIdCandidateFromTab(tab));
}

function pendingRemoteSelectionId(machineId: string | undefined): string {
  return machineId && machineId !== "sftp-transfer" ? machineId : "";
}

function selectedMachineIdCandidateFromTab(
  tab: TerminalTab | undefined,
): string {
  if (!tab) {
    return "";
  }
  if (isSftpTransferWorkspaceTab(tab)) {
    return (
      tab.rightHostId ||
      tab.lockedLeftHostId ||
      tab.leftHostId ||
      (tab.machineId === "sftp-transfer" ? "" : tab.machineId)
    );
  }
  if (isWorkspaceFileTab(tab)) {
    return workspaceFileTargetHostId(tab.target) ?? tab.machineId;
  }
  return tab.machineId;
}

function validSshHostId(
  machineGroups: MachineGroup[],
  machineId: string | undefined,
): string | undefined {
  const machine = machineId ? findMachine(machineGroups, machineId) : undefined;
  return machine?.kind === "ssh" ? machine.id : undefined;
}

function validMachineId(
  machineGroups: MachineGroup[],
  machineId: string | undefined,
): string {
  if (!machineId || machineId === "sftp-transfer") {
    return "";
  }
  return findMachine(machineGroups, machineId)?.id ?? "";
}
