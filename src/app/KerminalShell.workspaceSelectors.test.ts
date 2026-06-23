import { describe, expect, it } from "vitest";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../features/workspace/types";
import type { WorkspaceState } from "../features/workspace/workspaceStore";
import {
  buildOpenMachineIdsSnapshot,
  buildToolPanelWorkspaceContext,
  buildToolPanelWorkspaceSnapshot,
} from "./KerminalShell.workspaceSelectors";

const tab: TerminalTab = {
  id: "tab-local-1",
  layout: { paneId: "pane-local-1", type: "pane" },
  machineId: "local-pwsh",
  title: "PowerShell",
};

const pane: TerminalPane = {
  currentCwd: "C:/dev/rust/kerminal",
  id: "pane-local-1",
  lines: ["old"],
  machineId: "local-pwsh",
  mode: "local",
  outputHistory: "old output",
  prompt: ">",
  status: "online",
  title: "PowerShell",
};

function workspaceState(overrides: Partial<WorkspaceState> = {}) {
  return {
    activeTabId: tab.id,
    focusedPaneId: pane.id,
    selectedMachineId: "local-pwsh",
    terminalPanes: [pane],
    terminalTabs: [tab],
    ...overrides,
  } as WorkspaceState;
}

describe("KerminalShell workspace selector snapshots", () => {
  it("keeps side chrome snapshots stable when only pane output history changes", () => {
    const base = workspaceState();
    const outputOnlyChange = workspaceState({
      terminalPanes: [
        {
          ...pane,
          lines: ["new visible line"],
          outputHistory: "new output",
        },
      ],
    });

    expect(buildOpenMachineIdsSnapshot(outputOnlyChange)).toBe(
      buildOpenMachineIdsSnapshot(base),
    );
    expect(buildToolPanelWorkspaceSnapshot(outputOnlyChange)).toBe(
      buildToolPanelWorkspaceSnapshot(base),
    );
  });

  it("does not count SFTP transfer tabs as open terminal sessions", () => {
    const transferTab: TerminalTab = {
      id: "tab-sftp-transfer-1",
      kind: "sftpTransfer",
      machineId: "host-lab",
      rightHostId: "host-lab",
      title: "lab server 传输",
    };

    expect(
      buildOpenMachineIdsSnapshot(
        workspaceState({
          activeTabId: transferTab.id,
          focusedPaneId: "",
          selectedMachineId: "host-lab",
          terminalPanes: [],
          terminalTabs: [transferTab],
        }),
      ),
    ).toBe("[]");
  });

  it("updates the tool panel snapshot when focused pane cwd changes", () => {
    const base = workspaceState();
    const cwdChange = workspaceState({
      terminalPanes: [
        {
          ...pane,
          currentCwd: "C:/dev/rust/kerminal/src",
        },
      ],
    });

    expect(buildToolPanelWorkspaceSnapshot(cwdChange)).not.toBe(
      buildToolPanelWorkspaceSnapshot(base),
    );
  });

  it("uses the sidebar-selected SSH host for the tool panel even when a local pane is focused", () => {
    const machineGroups: MachineGroup[] = [
      {
        id: "local",
        title: "Local",
        machines: [
          {
            description: "Local shell",
            host: "localhost",
            id: "local-pwsh",
            kind: "local",
            name: "PowerShell",
            status: "online",
            tags: [],
          },
        ],
      },
      {
        id: "remote",
        title: "Remote",
        machines: [
          {
            authType: "agent",
            description: "Lab server",
            host: "lab.example.test",
            id: "host-lab",
            kind: "ssh",
            name: "Lab",
            port: 22,
            production: false,
            remoteGroupId: "remote",
            status: "online",
            tags: [],
            username: "ops",
          },
        ],
      },
    ];

    const context = buildToolPanelWorkspaceContext(
      workspaceState({ selectedMachineId: "host-lab" }),
      machineGroups,
    );

    expect(context.focusedPane?.id).toBe("pane-local-1");
    expect(context.selectedMachine?.id).toBe("host-lab");
  });
});
