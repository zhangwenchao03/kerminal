import { describe, expect, it } from "vitest";
import {
  appendTerminalOutputHistory,
  normalizeWorkspaceSessionSnapshot,
  TERMINAL_OUTPUT_HISTORY_MAX_CHARS,
} from "./workspaceSession";

describe("workspaceSession", () => {
  it("normalizes a persisted wrapper object without trusting stale focus", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      session: {
        activeTabId: "missing-tab",
        focusedPaneId: "pane-stale",
        selectedMachineId: "",
        terminalPanes: [
          {
            id: "pane-container-12",
            machineId: "docker:host-lab:c0ffee",
            mode: "container",
            prompt: "api:/workspace$",
            remoteHostId: "host-lab",
            status: "online",
            title: "api",
          },
          {
            id: "pane-orphan",
            machineId: "machine-orphan",
            mode: "local",
            prompt: "PS>",
            status: "online",
            title: "orphan",
          },
        ],
        terminalTabs: [
          {
            id: "tab-container-9",
            layout: { paneId: "pane-container-12", type: "pane" },
            machineId: "docker:host-lab:c0ffee",
            title: "api",
          },
        ],
      },
    });

    expect(session.activeTabId).toBe("tab-container-9");
    expect(session.focusedPaneId).toBe("pane-container-12");
    expect(session.selectedMachineId).toBe("host-lab");
    expect(session.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-container-12",
    ]);
  });

  it("drops terminal tabs whose restored layout has no live panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-broken",
      focusedPaneId: "pane-missing",
      terminalPanes: [
        {
          id: "pane-live",
          machineId: "machine-live",
          mode: "local",
          prompt: "PS>",
          status: "online",
          title: "Live",
        },
      ],
      terminalTabs: [
        {
          id: "tab-broken",
          layout: { paneId: "pane-missing", type: "pane" },
          machineId: "machine-missing",
          title: "Broken",
        },
        {
          id: "tab-live",
          layout: {
            children: [
              { paneId: "pane-missing", type: "pane" },
              { paneId: "pane-live", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-4",
            type: "split",
          },
          machineId: "machine-live",
          title: "Live",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-live");
    expect(session.focusedPaneId).toBe("pane-live");
    expect(session.terminalPanes.map((pane) => pane.id)).toEqual(["pane-live"]);
    expect(session.terminalTabs).toEqual([
      {
        id: "tab-live",
        layout: { paneId: "pane-live", type: "pane" },
        machineId: "machine-live",
        title: "Live",
      },
    ]);
  });

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

  it("normalizes terminal tab group preferences", () => {
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
          status: "online",
          title: "prod",
        },
      ],
      terminalTabGroupPreferences: {
        "host-prod": {
          color: "pink",
          title: " 生产组 ",
        },
        "host-test": {
          color: "unsupported",
          title: "",
        },
      },
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "prod",
        },
      ],
    });

    expect(session.terminalTabGroupPreferences).toEqual({
      "host-prod": {
        color: "pink",
        title: "生产组",
      },
    });
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

  it("does not select the synthetic SFTP transfer machine id", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-sftp-transfer-1",
      focusedPaneId: "",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-1",
          kind: "sftpTransfer",
          title: "SFTP 传输",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-sftp-transfer-1");
    expect(session.focusedPaneId).toBe("");
    expect(session.selectedMachineId).toBe("");
    expect(session.terminalTabs[0]).toMatchObject({
      kind: "sftpTransfer",
      machineId: "sftp-transfer",
    });
  });

  it("trims restored output history without keeping a dangling surrogate", () => {
    const outputHistory = `\uD83D\uDE00${"b".repeat(
      TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 1,
    )}`;
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "machine-local",
          mode: "local",
          outputHistory,
          prompt: "PS>",
          status: "online",
          title: "Local",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "machine-local",
          title: "Local",
        },
      ],
    });

    expect(session.terminalPanes[0]?.outputHistory).toBe(
      "b".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 1),
    );
  });

  it("keeps append output history bounded and stable for empty chunks", () => {
    const currentHistory = "stable";

    expect(appendTerminalOutputHistory(currentHistory, "")).toBe(currentHistory);
    expect(
      appendTerminalOutputHistory(
        "a".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 1),
        "bc",
      ),
    ).toEqual(`${"a".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2)}bc`);
    expect(
      appendTerminalOutputHistory(
        `\uD83D\uDE00${"b".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2)}`,
        "c",
      ),
    ).toEqual(`${"b".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2)}c`);
  });
});
