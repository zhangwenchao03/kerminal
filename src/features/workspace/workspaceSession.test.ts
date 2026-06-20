import { describe, expect, it } from "vitest";
import { normalizeWorkspaceSessionSnapshot } from "./workspaceSession";

describe("workspaceSession", () => {
  it("preserves remote host production flags for restored panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      selectedMachineId: "",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-prod",
          mode: "ssh",
          prompt: "root@prod:~$",
          remoteHostId: "host-prod",
          remoteHostProduction: true,
          status: "warning",
          title: "prod",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "prod",
        },
      ],
    });

    expect(session.terminalPanes[0]?.remoteHostProduction).toBe(true);
    expect(session.selectedMachineId).toBe("host-prod");
  });

  it("ignores non-boolean remote host production flags from older snapshots", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-prod",
          mode: "ssh",
          prompt: "root@prod:~$",
          remoteHostId: "host-prod",
          remoteHostProduction: "true",
          status: "warning",
          title: "prod",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "prod",
        },
      ],
    });

    expect(session.terminalPanes[0]?.remoteHostProduction).toBeUndefined();
  });

  it("preserves local sidebar machine group assignment", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "machine-local-1",
      sidebarMachines: [
        {
          id: "machine-local-1",
          kind: "local",
          name: "工具终端",
          remoteGroupId: "group-tools",
          status: "online",
          tags: ["local"],
        },
      ],
      terminalPanes: [],
      terminalTabs: [],
    });

    expect(session.sidebarMachines[0]).toMatchObject({
      id: "machine-local-1",
      kind: "local",
      remoteGroupId: "group-tools",
    });
  });

  it("restores SFTP transfer tabs without requiring terminal panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-sftp-transfer-4",
      focusedPaneId: "pane-stale",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-4",
          kind: "sftpTransfer",
          leftHostId: "host-left",
          lockedLeftHostId: "host-left",
          machineId: "host-left",
          rightHostId: "host-right",
          title: "host-left 传输",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-sftp-transfer-4");
    expect(session.focusedPaneId).toBe("");
    expect(session.selectedMachineId).toBe("host-right");
    expect(session.terminalPanes).toEqual([]);
    expect(session.terminalTabs[0]).toMatchObject({
      kind: "sftpTransfer",
      leftHostId: "host-left",
      lockedLeftHostId: "host-left",
      rightHostId: "host-right",
    });
  });
});
