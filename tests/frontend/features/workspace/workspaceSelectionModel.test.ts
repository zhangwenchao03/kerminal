import { describe, expect, it } from "vitest";
import {
  restoredSelectedMachineId,
  sanitizeRestoredSftpTransferTabs,
  selectedMachineIdForUpdatedGroups,
  selectedMachineIdFromWorkspaceTab,
} from "../../../../src/features/workspace/workspaceSelectionModel";
import type {
  MachineGroup,
  TerminalTab,
} from "../../../../src/features/workspace/types";

const machineGroups: MachineGroup[] = [
  {
    id: "group-prod",
    title: "Production",
    machines: [
      {
        description: "SSH host",
        id: "host-prod",
        kind: "ssh",
        name: "prod",
        status: "online",
        tags: [],
      },
      {
        description: "Local profile",
        id: "local-pwsh",
        kind: "local",
        name: "PowerShell",
        status: "online",
        tags: [],
      },
    ],
  },
];

const terminalTab: TerminalTab = {
  id: "tab-ssh-pending",
  layout: { paneId: "pane-ssh-pending", type: "pane" },
  machineId: "host-pending",
  title: "pending",
};

describe("workspaceSelectionModel", () => {
  it("sanitizes restored SFTP transfer tabs against current SSH hosts", () => {
    const [tab] = sanitizeRestoredSftpTransferTabs(
      [
        {
          id: "tab-sftp",
          kind: "sftpTransfer",
          leftHostId: "local-pwsh",
          lockedLeftHostId: "missing-host",
          machineId: "host-prod",
          rightHostId: "host-prod",
          title: "Transfer",
        },
      ],
      machineGroups,
    );

    expect(tab).toMatchObject({
      id: "tab-sftp",
      kind: "sftpTransfer",
      leftHostId: "host-prod",
      lockedLeftHostId: undefined,
      machineId: "host-prod",
      rightHostId: "host-prod",
    });
  });

  it("keeps a restored active remote tab selected while hosts are pending", () => {
    expect(
      restoredSelectedMachineId({
        activeTabId: terminalTab.id,
        fallbackSelectedMachineId: "local-pwsh",
        machineGroups: [],
        selectedMachineId: "missing-selected",
        terminalTabs: [terminalTab],
      }),
    ).toBe("host-pending");
  });

  it("only keeps pending active tab selection when the caller allows it", () => {
    const options = {
      activeTabId: terminalTab.id,
      fallbackSelectedMachineId: "",
      machineGroups: [],
      terminalTabs: [terminalTab],
    };

    expect(
      selectedMachineIdForUpdatedGroups({
        ...options,
        allowPendingActiveTabSelection: true,
      }),
    ).toBe("host-pending");
    expect(
      selectedMachineIdForUpdatedGroups({
        ...options,
        allowPendingActiveTabSelection: false,
      }),
    ).toBe("");
  });

  it("selects the current host from an SFTP workspace tab", () => {
    expect(
      selectedMachineIdFromWorkspaceTab(
        {
          id: "tab-sftp",
          kind: "sftpTransfer",
          leftHostId: "local-pwsh",
          lockedLeftHostId: "missing-host",
          machineId: "sftp-transfer",
          rightHostId: "host-prod",
          title: "Transfer",
        },
        machineGroups,
      ),
    ).toBe("host-prod");
  });
});
