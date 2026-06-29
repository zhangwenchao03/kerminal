import { beforeEach, describe, expect, it } from "vitest";
import { collectPaneIds } from "./workspaceLayout";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspaceStore";
import {
  apiContainer,
  pwshProfile,
  remoteHostTree,
  remoteHostTreeWithRdp,
  remoteHostTreeWithTools,
} from "./__tests__/support/workspaceStore.testSupport";

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

  it("opens a new SSH host tab on repeated open requests", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");
    useWorkspaceStore.getState().openSshTerminal("host-lab");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([
      "tab-ssh-1",
      "tab-ssh-2",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-ssh-1",
      "pane-ssh-2",
    ]);
    expect(state.activeTabId).toBe("tab-ssh-2");
    expect(state.focusedPaneId).toBe("pane-ssh-2");
  });

  it("opens a new SSH command terminal with a remote command", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshCommandTerminal("host-lab", {
      cwd: "/srv/kerminal",
      remoteCommand: "docker logs -f --tail 200 'c0ffee1234567890'",
      title: "api logs",
    });

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.activeTabId).toBe("tab-ssh-1");
    expect(state.focusedPaneId).toBe("pane-ssh-1");
    expect(state.selectedMachineId).toBe("host-lab");
    expect(state.terminalTabs[0]).toMatchObject({
      machineId: "host-lab",
      title: "api logs",
    });
    expect(state.terminalPanes[0]).toMatchObject({
      cwd: "/srv/kerminal",
      machineId: "host-lab",
      mode: "ssh",
      remoteCommand: "docker logs -f --tail 200 'c0ffee1234567890'",
      remoteHostId: "host-lab",
      title: "api logs",
    });
  });

  it("opens repeated local profile sidebar entries in new terminal tabs", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore.getState().setProfiles([
      { ...pwshProfile, sidebarGroupId: "group-tools" },
    ]);

    useWorkspaceStore.getState().openLocalTerminal("profile:profile-pwsh");
    useWorkspaceStore.getState().openLocalTerminal("profile:profile-pwsh");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([
      "tab-local-1",
      "tab-local-2",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
    ]);
    expect(state.terminalTabs.map((tab) => tab.machineId)).toEqual([
      "profile:profile-pwsh",
      "profile:profile-pwsh",
    ]);
    expect(state.terminalPanes.map((pane) => pane.profileId)).toEqual([
      "profile-pwsh",
      "profile-pwsh",
    ]);
    expect(state.activeTabId).toBe("tab-local-2");
    expect(state.focusedPaneId).toBe("pane-local-2");
    expect(state.selectedMachineId).toBe("profile:profile-pwsh");
  });

  it("opens tmux attach launch in a split pane and focuses an existing binding", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");

    useWorkspaceStore.getState().openTmuxAttachTerminal({
      binding: {
        attachedAt: "1",
        sessionId: "$0",
        sessionName: "api",
        targetRef: "ssh:host-lab",
      },
      cwd: "/srv/api",
      hostId: "host-lab",
      mode: "ssh",
      remoteCommand: "tmux attach-session -t $0",
      title: "tmux: api",
    });

    const splitState = useWorkspaceStore.getState();
    const tmuxPane = splitState.terminalPanes.find(
      (pane) => pane.tmuxBinding?.sessionId === "$0",
    );
    const activeTab = splitState.terminalTabs.find(
      (tab) => tab.id === splitState.activeTabId,
    );
    if (!tmuxPane || !activeTab || activeTab.kind === "sftpTransfer") {
      throw new Error("expected tmux pane in terminal tab");
    }

    expect(tmuxPane).toMatchObject({
      cwd: "/srv/api",
      machineId: "host-lab",
      mode: "ssh",
      remoteCommand: "tmux attach-session -t $0",
      title: "tmux: api",
    });
    expect(splitState.focusedPaneId).toBe(tmuxPane.id);
    expect(collectPaneIds(activeTab.layout)).toContain(tmuxPane.id);

    useWorkspaceStore.getState().openTmuxAttachTerminal({
      binding: {
        attachedAt: "2",
        sessionId: "$0",
        sessionName: "api",
        targetRef: "ssh:host-lab",
      },
      hostId: "host-lab",
      mode: "ssh",
      remoteCommand: "tmux attach-session -t $0",
      title: "tmux: api",
    });

    const focusedState = useWorkspaceStore.getState();
    expect(focusedState.terminalPanes).toHaveLength(2);
    expect(focusedState.focusedPaneId).toBe(tmuxPane.id);
  });

  it("opens a docker container terminal without pinning the container to the sidebar", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    useWorkspaceStore.getState().openDockerContainerTerminal(apiContainer);

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.terminalPanes[0]).toMatchObject({
      containerId: apiContainer.id,
      machineId: "docker:host-lab:c0ffee1234567890",
      mode: "container",
      remoteHostId: "host-lab",
      shell: undefined,
      title: "api",
    });
    expect(
      state.machineGroups.flatMap((group) => group.machines).map((machine) => machine.id),
    ).not.toContain("docker:host-lab:c0ffee1234567890");
  });

  it("focuses an existing unpinned docker container terminal on repeated enter", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    useWorkspaceStore.getState().openDockerContainerTerminal(apiContainer);
    const firstState = useWorkspaceStore.getState();
    const firstPaneId = firstState.focusedPaneId;

    useWorkspaceStore.getState().openDockerContainerTerminal(apiContainer);

    const focusedState = useWorkspaceStore.getState();
    expect(focusedState.terminalTabs).toHaveLength(1);
    expect(focusedState.terminalPanes).toHaveLength(1);
    expect(focusedState.focusedPaneId).toBe(firstPaneId);
    expect(focusedState.selectedMachineId).toBe("docker:host-lab:c0ffee1234567890");
  });

  it("does not enter stopped docker containers", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    useWorkspaceStore.getState().openDockerContainerTerminal({
      ...apiContainer,
      state: "exited",
      status: "exited",
      statusText: "Exited (0) 2 hours ago",
    });

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toEqual([]);
    expect(state.terminalPanes).toEqual([]);
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
