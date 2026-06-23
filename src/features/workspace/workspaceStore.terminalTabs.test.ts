import { beforeEach, describe, expect, it } from "vitest";
import { collectPaneIds } from "./workspaceLayout";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspaceStore";
import { remoteHostTree } from "./workspaceStore.testSupport";
import {
  isSftpTransferWorkspaceTab,
  isTerminalSessionTab,
  type TerminalSessionTab,
  type TerminalTab,
} from "./types";

function requireTerminalSessionTab(
  tab: TerminalTab | undefined,
): TerminalSessionTab {
  if (!isTerminalSessionTab(tab)) {
    throw new Error("Expected a terminal session tab.");
  }
  return tab;
}

describe("workspaceStore terminal tabs", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("selects a tab and focuses its first pane", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().selectTab("tab-local-1");

    expect(useWorkspaceStore.getState().activeTabId).toBe("tab-local-1");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-local-1");
  });

  it("renames a terminal tab title", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().renameTerminalTab("tab-local-1", "生产日志");

    expect(useWorkspaceStore.getState().terminalTabs[0].title).toBe("生产日志");
    expect(useWorkspaceStore.getState().terminalPanes[0].title).toBe(
      "本地 PowerShell",
    );
  });

  it("ignores unknown tab selection requests", () => {
    const before = useWorkspaceStore.getState();

    useWorkspaceStore.getState().selectTab("missing-tab");

    const after = useWorkspaceStore.getState();
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.focusedPaneId).toBe(before.focusedPaneId);
  });

  it("adds a local terminal tab and focuses its pane", () => {
    useWorkspaceStore.getState().addTerminalTab();

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-1");
    expect(state.selectedMachineId).toBe("machine-local-1");
    expect(state.machineGroups[0]).toMatchObject({
      id: "__ungrouped__",
      title: "默认分组",
    });
  });

  it("opens a saved SSH host in a new terminal tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");

    const state = useWorkspaceStore.getState();
    const pane = state.terminalPanes[state.terminalPanes.length - 1];
    const tab = state.terminalTabs[state.terminalTabs.length - 1];

    expect(state.activeTabId).toBe("tab-ssh-1");
    expect(state.focusedPaneId).toBe("pane-ssh-1");
    expect(state.selectedMachineId).toBe("host-lab");
    expect(tab).toMatchObject({
      id: "tab-ssh-1",
      machineId: "host-lab",
      title: "lab server",
    });
    expect(pane).toMatchObject({
      id: "pane-ssh-1",
      machineId: "host-lab",
      mode: "ssh",
      prompt: "root@192.168.1.253:~$",
      remoteHostId: "host-lab",
      title: "lab server",
    });
  });

  it("splits the focused pane in the active tab", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");

    const state = useWorkspaceStore.getState();
    const activeTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === state.activeTabId),
    );

    expect(state.terminalPanes).toHaveLength(2);
    expect(state.focusedPaneId).toBe("pane-local-2");
    expect(activeTab.layout).toMatchObject({
      type: "split",
      direction: "horizontal",
    });
    expect(collectPaneIds(activeTab.layout)).toEqual([
      "pane-local-1",
      "pane-local-2",
    ]);
  });

  it("ignores focus requests outside the active tab layout", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().focusPane("pane-local-1");

    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-local-2");

    useWorkspaceStore.getState().splitFocusedPane("vertical");
    useWorkspaceStore.getState().addTerminalTab({ title: "第三本地终端" });

    const state = useWorkspaceStore.getState();
    const secondTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === "tab-local-2"),
    );
    expect(collectPaneIds(secondTab.layout)).toEqual([
      "pane-local-2",
      "pane-local-3",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
      "pane-local-3",
      "pane-local-4",
    ]);
    expect(state.focusedPaneId).toBe("pane-local-4");
  });

  it("does not close panes outside the active tab layout", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");

    useWorkspaceStore.getState().closePane("pane-local-1");

    const state = useWorkspaceStore.getState();
    const firstTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === "tab-local-1"),
    );
    const secondTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === "tab-local-2"),
    );
    expect(state.activeTabId).toBe("tab-local-2");
    expect(state.focusedPaneId).toBe("pane-local-3");
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
      "pane-local-3",
    ]);
    expect(collectPaneIds(firstTab.layout)).toEqual(["pane-local-1"]);
    expect(collectPaneIds(secondTab.layout)).toEqual([
      "pane-local-2",
      "pane-local-3",
    ]);
  });

  it("keeps the last pane in a tab when closePane is requested", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().closePane("pane-local-1");

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.focusedPaneId).toBe("pane-local-1");
    expect(requireTerminalSessionTab(state.terminalTabs[0]).layout).toEqual({
      type: "pane",
      paneId: "pane-local-1",
    });
  });

  it("closes a pane from a split tab and focuses the remaining pane", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore.getState().closePane("pane-local-1");

    const state = useWorkspaceStore.getState();
    const activeTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === state.activeTabId),
    );

    expect(state.terminalPanes.map((pane) => pane.id)).not.toContain(
      "pane-local-1",
    );
    expect(state.focusedPaneId).toBe("pane-local-2");
    expect(activeTab.layout).toEqual({
      type: "pane",
      paneId: "pane-local-2",
    });
  });

  it("closes a tab and removes its panes when multiple tabs exist", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().closeTerminalTab("tab-local-2");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual(["tab-local-1"]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual(["pane-local-1"]);
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-1");
  });

  it("keeps the focused pane in the active tab when closing an inactive tab", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().selectTab("tab-local-1");
    useWorkspaceStore.getState().focusPane("pane-local-2");

    useWorkspaceStore.getState().closeTerminalTab("tab-local-2");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual(["tab-local-1"]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
    ]);
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-2");
  });

  it("closes the last terminal tab and leaves an empty workspace", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().closeTerminalTab("tab-local-1");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toEqual([]);
    expect(state.terminalPanes).toEqual([]);
    expect(state.activeTabId).toBe("");
    expect(state.focusedPaneId).toBe("");
  });

  it("opens an SFTP transfer tab without creating a terminal pane", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });

    const state = useWorkspaceStore.getState();
    const tab = state.terminalTabs.find((candidate) =>
      candidate.id.startsWith("tab-sftp-transfer-"),
    );

    expect(tab && isSftpTransferWorkspaceTab(tab)).toBe(true);
    expect(tab).toMatchObject({
      kind: "sftpTransfer",
      rightHostId: "host-lab",
      machineId: "host-lab",
      title: "lab server 传输",
    });
    expect(state.terminalPanes).toEqual([]);
    expect(state.focusedPaneId).toBe("");
    expect(state.activeTabId).toBe(tab?.id);
  });

  it("does not consume pane ids when splitting an active transfer tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });

    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual(["pane-local-1"]);
    expect(state.focusedPaneId).toBe("pane-local-1");
  });

  it("keeps transfer tabs when closing terminal tabs", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });
    useWorkspaceStore.getState().closeTerminalTab("tab-local-1");

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes).toEqual([]);
    expect(state.terminalTabs).toHaveLength(1);
    expect(isSftpTransferWorkspaceTab(state.terminalTabs[0])).toBe(true);
    expect(state.activeTabId).toBe(state.terminalTabs[0].id);
    expect(state.focusedPaneId).toBe("");
  });

  it("closes the active transfer tab and restores focus to the terminal tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    const terminalTabId = useWorkspaceStore.getState().activeTabId;
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });
    const transferTabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().closeTerminalTab(transferTabId);

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([terminalTabId]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual(["pane-local-1"]);
    expect(state.activeTabId).toBe(terminalTabId);
    expect(state.focusedPaneId).toBe("pane-local-1");
  });

  it("restores a saved terminal session and avoids generated id collisions", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-local-7",
      focusedPaneId: "pane-local-8",
      selectedMachineId: "machine-local-7",
      sidebarMachines: [],
      terminalPanes: [
        {
          cwd: "C:\\\\restored",
          id: "pane-local-8",
          lines: ["old output"],
          machineId: "machine-local-7",
          mode: "local",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "恢复会话",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-7",
          layout: { type: "pane", paneId: "pane-local-8" },
          machineId: "machine-local-7",
          title: "恢复会话",
        },
      ],
    });
    useWorkspaceStore.getState().addTerminalTab({ title: "新会话" });

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes[0].lines).toEqual([]);
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([
      "tab-local-7",
      "tab-local-8",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-8",
      "pane-local-9",
    ]);
  });
});
