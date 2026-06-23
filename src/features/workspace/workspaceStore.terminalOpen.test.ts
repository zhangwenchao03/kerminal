import { beforeEach, describe, expect, it } from "vitest";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspaceStore";
import { remoteHostTree, remoteHostTreeWithRdp } from "./workspaceStore.testSupport";

describe("workspaceStore terminal open actions", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("ignores missing or mismatched machines without consuming generated ids", () => {
    useWorkspaceStore.getState().openSshTerminal("missing-host");
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithRdp);
    useWorkspaceStore.getState().openSshTerminal("rdp-office");

    expect(useWorkspaceStore.getState().terminalTabs).toEqual([]);
    expect(useWorkspaceStore.getState().terminalPanes).toEqual([]);

    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");

    expect(useWorkspaceStore.getState().terminalTabs[0]?.id).toBe("tab-ssh-1");
    expect(useWorkspaceStore.getState().terminalPanes[0]?.id).toBe("pane-ssh-1");
  });

  it("advances generated ids after restoring a remote terminal session", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-ssh-7",
      focusedPaneId: "pane-ssh-8",
      selectedMachineId: "host-lab",
      sidebarMachines: [],
      terminalPanes: [
        {
          id: "pane-ssh-8",
          lines: [],
          machineId: "host-lab",
          mode: "ssh",
          prompt: "root@192.168.1.253:~$",
          remoteHostId: "host-lab",
          status: "warning",
          title: "lab server",
        },
      ],
      terminalTabs: [
        {
          id: "tab-ssh-7",
          layout: { paneId: "pane-ssh-8", type: "pane" },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    useWorkspaceStore.getState().openSshTerminal("host-lab");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([
      "tab-ssh-7",
      "tab-ssh-8",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-ssh-8",
      "pane-ssh-9",
    ]);
    expect(state.activeTabId).toBe("tab-ssh-8");
    expect(state.focusedPaneId).toBe("pane-ssh-9");
  });

  it("opens SFTP transfer tabs with only existing SSH host refs", () => {
    useWorkspaceStore
      .getState()
      .setRemoteHostTree([...remoteHostTree, ...remoteHostTreeWithRdp]);

    useWorkspaceStore.getState().openSftpTransferTab({
      leftHostId: "host-lab",
      lockedLeftHostId: "host-removed",
      rightHostId: "rdp-office",
    });

    const state = useWorkspaceStore.getState();
    const tab = state.terminalTabs[0];
    if (tab?.kind !== "sftpTransfer") {
      throw new Error("expected SFTP transfer tab");
    }

    expect(tab.leftHostId).toBe("host-lab");
    expect(tab.lockedLeftHostId).toBeUndefined();
    expect(tab.machineId).toBe("host-lab");
    expect(tab.rightHostId).toBeUndefined();
    expect(tab.title).toBe("lab server 传输");
    expect(state.selectedMachineId).toBe("host-lab");
  });

  it("sanitizes restored SFTP transfer tabs against current SSH machines", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-sftp-transfer-7",
      focusedPaneId: "pane-stale",
      selectedMachineId: "host-removed",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-7",
          kind: "sftpTransfer",
          leftHostId: "host-removed",
          lockedLeftHostId: "host-removed",
          machineId: "host-removed",
          rightHostId: "host-lab",
          title: "旧传输",
        },
      ],
    });

    const state = useWorkspaceStore.getState();
    const tab = state.terminalTabs[0];
    if (tab?.kind !== "sftpTransfer") {
      throw new Error("expected SFTP transfer tab");
    }

    expect(tab.leftHostId).toBeUndefined();
    expect(tab.lockedLeftHostId).toBeUndefined();
    expect(tab.machineId).toBe("host-lab");
    expect(tab.rightHostId).toBe("host-lab");
    expect(state.focusedPaneId).toBe("");
    expect(state.selectedMachineId).toBe("host-lab");
  });

  it("keeps valid restored SFTP transfer machine ids as host refs", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-sftp-transfer-9",
      focusedPaneId: "",
      selectedMachineId: "",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-9",
          kind: "sftpTransfer",
          machineId: "host-lab",
          title: "旧传输",
        },
      ],
    });

    const state = useWorkspaceStore.getState();
    const tab = state.terminalTabs[0];
    if (tab?.kind !== "sftpTransfer") {
      throw new Error("expected SFTP transfer tab");
    }

    expect(tab.leftHostId).toBe("host-lab");
    expect(tab.lockedLeftHostId).toBeUndefined();
    expect(tab.machineId).toBe("host-lab");
    expect(tab.rightHostId).toBeUndefined();
    expect(state.selectedMachineId).toBe("host-lab");
  });

  it("restores hostless SFTP transfer tabs without selecting synthetic machines", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-sftp-transfer-1",
      focusedPaneId: "",
      selectedMachineId: "sftp-transfer",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-1",
          kind: "sftpTransfer",
          machineId: "sftp-transfer",
          title: "SFTP 传输",
        },
      ],
    });

    const state = useWorkspaceStore.getState();
    const tab = state.terminalTabs[0];
    if (tab?.kind !== "sftpTransfer") {
      throw new Error("expected SFTP transfer tab");
    }

    expect(tab.machineId).toBe("sftp-transfer");
    expect(state.selectedMachineId).toBe("");
  });
});
