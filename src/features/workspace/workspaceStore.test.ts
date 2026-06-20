import { beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "../settings/settingsModel";
import { browserPreviewProfiles } from "../../lib/profileApi";
import { collectPaneIds } from "./workspaceLayout";
import {
  localMachineIdForProfile,
  resetWorkspaceStore,
  useWorkspaceStore,
} from "./workspaceStore";
import {
  isSftpTransferWorkspaceTab,
  isTerminalSessionTab,
  type TerminalSessionTab,
  type TerminalTab,
} from "./types";
import {
  apiContainer,
  bashProfile,
  pwshProfile,
  remoteHostTree,
  remoteHostTreeWithRdp,
  remoteHostTreeWithTerminalTransports,
  remoteHostTreeWithTools,
  unorderedRemoteHostTree,
} from "./workspaceStore.testSupport";

function requireTerminalSessionTab(
  tab: TerminalTab | undefined,
): TerminalSessionTab {
  if (!isTerminalSessionTab(tab)) {
    throw new Error("Expected a terminal session tab.");
  }
  return tab;
}

describe("workspaceStore", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("tracks selected machine, focused pane and active tool independently", () => {
    useWorkspaceStore.getState().selectMachine("local-powershell");
    useWorkspaceStore.getState().focusPane("pane-local");
    useWorkspaceStore.getState().setActiveTool("sftp");

    expect(useWorkspaceStore.getState().selectedMachineId).toBe("local-powershell");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-local");
    expect(useWorkspaceStore.getState().activeTool).toBe("sftp");
  });

  it("tracks sidebar search and broadcast drafts", () => {
    useWorkspaceStore.getState().setMachineSearch("prod");
    useWorkspaceStore.getState().setBroadcastDraft("uptime");

    expect(useWorkspaceStore.getState().machineSearch).toBe("prod");
    expect(useWorkspaceStore.getState().broadcastDraft).toBe("uptime");
  });

  it("updates a pane runtime cwd without changing its startup cwd", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");
    const pane = useWorkspaceStore
      .getState()
      .terminalPanes.find((candidate) => candidate.remoteHostId === "host-lab");

    expect(pane).toBeDefined();
    expect(pane?.remoteHostProduction).toBe(true);
    useWorkspaceStore
      .getState()
      .updatePaneCurrentCwd(pane?.id ?? "", "/var/log");

    const updatedPane = useWorkspaceStore
      .getState()
      .terminalPanes.find((candidate) => candidate.id === pane?.id);
    expect(updatedPane?.currentCwd).toBe("/var/log");
    expect(updatedPane?.cwd).toBeUndefined();
  });

  it("syncs restored pane production flags when remote hosts refresh", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-1",
      selectedMachineId: "host-lab",
      sidebarMachines: [],
      terminalPanes: [
        {
          id: "pane-ssh-1",
          machineId: "host-lab",
          mode: "ssh",
          prompt: "root@192.168.1.253:~$",
          remoteHostId: "host-lab",
          status: "offline",
          title: "lab server",
          lines: [],
        },
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: { paneId: "pane-ssh-1", type: "pane" },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    expect(
      useWorkspaceStore.getState().terminalPanes[0]?.remoteHostProduction,
    ).toBeUndefined();

    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    expect(useWorkspaceStore.getState().terminalPanes[0]).toMatchObject({
      remoteHostId: "host-lab",
      remoteHostProduction: true,
    });
  });

  it("stores normalized app settings", () => {
    useWorkspaceStore.getState().setSettings({
      ...defaultAppSettings,
      terminal: {
        ...defaultAppSettings.terminal,
        fontSize: 99,
        lineHeight: 0.2,
      },
      themeMode: "light",
    });

    expect(useWorkspaceStore.getState().settings).toMatchObject({
      terminal: {
        fontSize: 24,
        lineHeight: 1,
      },
      themeMode: "light",
    });
  });

  it("starts with the browser preview profile as the fallback terminal config", () => {
    const state = useWorkspaceStore.getState();

    expect(state.profiles).toEqual(browserPreviewProfiles);
    expect(state.activeProfileId).toBe(browserPreviewProfiles[0].id);
  });

  it("starts without an implicit terminal tab", () => {
    const state = useWorkspaceStore.getState();

    expect(state.terminalTabs).toEqual([]);
    expect(state.terminalPanes).toEqual([]);
    expect(state.activeTabId).toBe("");
    expect(state.focusedPaneId).toBe("");
  });

  it("loads remote host groups without seeded local sidebar entries", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.title)).toEqual(["实验室"]);
    expect(state.machineGroups[0].machines[0]).toMatchObject({
      authType: "key",
      description: "root@192.168.1.253:2222",
      host: "192.168.1.253",
      id: "host-lab",
      production: true,
      status: "warning",
    });
  });

  it("orders remote groups and hosts by sort order when loading the tree", () => {
    useWorkspaceStore.getState().setRemoteHostTree(unorderedRemoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.id)).toEqual([
      "group-a",
      "group-z",
    ]);
    expect(state.machineGroups[1].machines.map((machine) => machine.id)).toEqual(
      ["host-z-1", "host-z-2"],
    );
  });

  it("maps Telnet and Serial hosts to terminal-only machines and opens panes", () => {
    useWorkspaceStore
      .getState()
      .setRemoteHostTree(remoteHostTreeWithTerminalTransports);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups[0].machines).toMatchObject([
      {
        description: "legacy.internal:2323",
        id: "telnet-legacy",
        kind: "telnet",
        target: { hostId: "telnet-legacy", kind: "telnet" },
      },
      {
        description: "COM9 · 115200 bps",
        id: "serial-console",
        kind: "serial",
        target: { hostId: "serial-console", kind: "serial" },
      },
    ]);

    useWorkspaceStore.getState().openTelnetTerminal("telnet-legacy");
    useWorkspaceStore.getState().openSerialTerminal("serial-console");

    expect(useWorkspaceStore.getState().terminalPanes).toMatchObject([
      {
        machineId: "telnet-legacy",
        mode: "telnet",
        prompt: "legacy.internal:2323>",
        target: { hostId: "telnet-legacy", kind: "telnet" },
      },
      {
        machineId: "serial-console",
        mode: "serial",
        prompt: "COM9>",
        target: { hostId: "serial-console", kind: "serial" },
      },
    ]);
  });

  it("adds a Docker container under its SSH host and opens it with enter options", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });

    const afterAdd = useWorkspaceStore.getState();
    expect(afterAdd.selectedMachineId).toBe("docker:host-lab:c0ffee1234567890");
    expect(afterAdd.machineGroups[0].machines.map((machine) => machine.id)).toEqual([
      "host-lab",
      "docker:host-lab:c0ffee1234567890",
    ]);
    expect(afterAdd.machineGroups[0].machines[1]).toMatchObject({
      kind: "dockerContainer",
      name: "api",
      parentMachineId: "host-lab",
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });

    useWorkspaceStore
      .getState()
      .openContainerTerminal("docker:host-lab:c0ffee1234567890");

    const pane = useWorkspaceStore.getState().terminalPanes[0];
    expect(pane).toMatchObject({
      machineId: "docker:host-lab:c0ffee1234567890",
      mode: "container",
      remoteHostId: "host-lab",
      remoteHostProduction: true,
      shell: "exec bash -l",
      target: {
        containerId: "c0ffee1234567890",
        hostId: "host-lab",
        kind: "dockerContainer",
        user: "root",
        workdir: "/workspace",
      },
    });

    useWorkspaceStore
      .getState()
      .openContainerTerminal("docker:host-lab:c0ffee1234567890");
    expect(useWorkspaceStore.getState().terminalTabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("adds a local terminal tab to the selected machine group", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({
      groupId: "group-lab",
      title: "工具终端",
    });

    const group = useWorkspaceStore.getState().machineGroups[0];
    expect(group.id).toBe("group-lab");
    expect(group.machines.map((machine) => machine.id)).toEqual([
      "machine-local-1",
      "host-lab",
    ]);
    expect(group.machines[0]).toMatchObject({
      kind: "local",
      name: "工具终端",
      remoteGroupId: "group-lab",
    });
  });

  it("adds a copied local profile card to the requested group", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);

    useWorkspaceStore
      .getState()
      .addLocalProfileMachine(pwshProfile, "group-tools");

    const state = useWorkspaceStore.getState();
    const toolsGroup = state.machineGroups.find(
      (group) => group.id === "group-tools",
    );
    expect(state.selectedMachineId).toBe(localMachineIdForProfile("profile-pwsh"));
    expect(toolsGroup?.machines[0]).toMatchObject({
      id: localMachineIdForProfile("profile-pwsh"),
      kind: "local",
      name: "PowerShell 7",
      remoteGroupId: "group-tools",
      shell: "pwsh.exe",
    });
  });

  it("moves persistent sidebar machines between groups", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore
      .getState()
      .addLocalProfileMachine(pwshProfile, "group-lab");

    useWorkspaceStore
      .getState()
      .moveSidebarMachine(localMachineIdForProfile("profile-pwsh"), "group-tools");

    const state = useWorkspaceStore.getState();
    expect(
      state.machineGroups
        .find((group) => group.id === "group-lab")
        ?.machines.some(
          (machine) => machine.id === localMachineIdForProfile("profile-pwsh"),
        ),
    ).toBe(false);
    expect(
      state.machineGroups
        .find((group) => group.id === "group-tools")
        ?.machines[0],
    ).toMatchObject({
      id: localMachineIdForProfile("profile-pwsh"),
      remoteGroupId: "group-tools",
    });
  });

  it("pins a sidebar group above existing groups", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);

    useWorkspaceStore.getState().pinMachineGroup("group-tools");

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.id)).toEqual([
      "group-tools",
      "group-lab",
    ]);
    expect(state.machineGroups[0].pinned).toBe(true);
    expect(state.machineGroups[0].sortOrder).toBeLessThan(
      state.machineGroups[1].sortOrder ?? 0,
    );
  });

  it("unpins a previously pinned sidebar group back into normal ordering", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore.getState().pinMachineGroup("group-tools");

    useWorkspaceStore.getState().pinMachineGroup("group-tools", false);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.id)).toEqual([
      "group-lab",
      "group-tools",
    ]);
    expect(state.machineGroups[1]).toMatchObject({
      id: "group-tools",
      pinned: false,
      sortOrder: 20,
    });
  });

  it("keeps a Docker container in an arbitrary selected group after restore", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      groupId: "group-tools",
      shell: "exec sh",
    });
    const savedContainer = useWorkspaceStore
      .getState()
      .machineGroups.flatMap((group) => group.machines)
      .find((machine) => machine.kind === "dockerContainer");

    expect(savedContainer).toMatchObject({
      kind: "dockerContainer",
      name: "api",
      parentMachineId: "host-lab",
      remoteGroupId: "group-tools",
      shell: "exec sh",
    });
    expect(
      useWorkspaceStore
        .getState()
        .machineGroups.find((group) => group.id === "group-tools")
        ?.machines.map((machine) => machine.id),
    ).toEqual(["docker:host-lab:c0ffee1234567890"]);

    resetWorkspaceStore();
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: savedContainer?.id ?? "",
      sidebarMachines: savedContainer ? [savedContainer] : [],
      terminalPanes: [],
      terminalTabs: [],
    });

    const restoredToolsGroup = useWorkspaceStore
      .getState()
      .machineGroups.find((group) => group.id === "group-tools");
    expect(restoredToolsGroup?.machines).toHaveLength(1);
    expect(restoredToolsGroup?.machines[0]).toMatchObject({
      kind: "dockerContainer",
      name: "api",
      remoteGroupId: "group-tools",
      shell: "exec sh",
    });
  });

  it("restores a Docker sidebar machine from the saved workspace session", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });
    const savedContainer = useWorkspaceStore
      .getState()
      .machineGroups.flatMap((group) => group.machines)
      .find((machine) => machine.kind === "dockerContainer");

    expect(savedContainer).toBeDefined();

    resetWorkspaceStore();
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: savedContainer?.id ?? "",
      sidebarMachines: savedContainer ? [savedContainer] : [],
      terminalPanes: [],
      terminalTabs: [],
    });

    const restoredMachines = useWorkspaceStore.getState().machineGroups[0].machines;
    expect(restoredMachines.map((machine) => machine.id)).toEqual([
      "host-lab",
      "docker:host-lab:c0ffee1234567890",
    ]);
    expect(restoredMachines[1]).toMatchObject({
      kind: "dockerContainer",
      name: "api",
      parentMachineId: "host-lab",
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });
  });

  it("clears selected machine when the selected remote host disappears and no sidebar machine remains", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().selectMachine("host-lab");
    useWorkspaceStore.getState().setRemoteHostTree([]);

    expect(useWorkspaceStore.getState().selectedMachineId).toBe("");
  });

  it("preserves manually created local machines when remote host tree refreshes", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "手动本地会话" });
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.title)).toEqual([
      "默认分组",
      "实验室",
    ]);
    expect(state.machineGroups[0].machines[0]).toMatchObject({
      kind: "local",
      name: "手动本地会话",
    });
  });

  it("loads profiles and selects the default profile when current selection is absent", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);

    const state = useWorkspaceStore.getState();
    expect(state.profiles).toEqual([pwshProfile, bashProfile]);
    expect(state.activeProfileId).toBe("profile-bash");
  });

  it("does not render loaded terminal profiles as implicit sidebar machines", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);

    const state = useWorkspaceStore.getState();
    expect(state.profiles).toEqual([pwshProfile, bashProfile]);
    expect(state.machineGroups).toEqual([]);
  });

  it("keeps user-added profile-backed local machines when the remote host tree refreshes", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().selectProfile("profile-pwsh");
    useWorkspaceStore.getState().addTerminalTab();
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.title)).toEqual([
      "默认分组",
      "实验室",
    ]);
    expect(state.machineGroups[0].machines.map((machine) => machine.id)).toEqual(
      [localMachineIdForProfile("profile-pwsh")],
    );
    expect(state.machineGroups[1].machines[0].id).toBe("host-lab");
  });

  it("renames the default machine group and keeps the title after refresh", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().addTerminalTab({ title: "本地会话" });
    useWorkspaceStore.getState().renameMachineGroup("__ungrouped__", "本地会话");
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.title)).toEqual([
      "本地会话",
      "实验室",
    ]);
    expect(state.machineGroups[0].id).toBe("__ungrouped__");
  });

  it("uses the selected profile when adding a local terminal tab", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().selectProfile("profile-pwsh");
    useWorkspaceStore.getState().addTerminalTab();

    const state = useWorkspaceStore.getState();
    const pane = state.terminalPanes[state.terminalPanes.length - 1];
    const tab = state.terminalTabs[state.terminalTabs.length - 1];
    expect(tab.machineId).toBe(localMachineIdForProfile("profile-pwsh"));
    expect(state.terminalTabs[state.terminalTabs.length - 1].title).toBe(
      "PowerShell 7",
    );
    expect(pane).toMatchObject({
      args: ["-NoLogo"],
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      profileId: "profile-pwsh",
      shell: "pwsh.exe",
      title: "PowerShell 7",
    });
  });

  it("opens a profile-backed local machine from the sidebar", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().selectProfile("profile-pwsh");
    useWorkspaceStore.getState().addTerminalTab();
    useWorkspaceStore.getState().closeTerminalTab("tab-local-1");
    useWorkspaceStore
      .getState()
      .openLocalTerminal(localMachineIdForProfile("profile-pwsh"));

    const state = useWorkspaceStore.getState();
    const pane = state.terminalPanes[state.terminalPanes.length - 1];
    const tab = state.terminalTabs[state.terminalTabs.length - 1];
    expect(state.selectedMachineId).toBe(localMachineIdForProfile("profile-pwsh"));
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalPanes).toHaveLength(1);
    expect(tab).toMatchObject({
      machineId: localMachineIdForProfile("profile-pwsh"),
      title: "PowerShell 7",
    });
    expect(pane).toMatchObject({
      args: ["-NoLogo"],
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      machineId: localMachineIdForProfile("profile-pwsh"),
      profileId: "profile-pwsh",
      shell: "pwsh.exe",
    });
  });

  it("updates a local machine card and its launch config", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().selectProfile("profile-pwsh");
    useWorkspaceStore.getState().addTerminalTab();
    const machineId = localMachineIdForProfile("profile-pwsh");

    useWorkspaceStore.getState().updateLocalMachine(machineId, {
      args: ["-NoExit"],
      cwd: "C:\\work",
      env: { NODE_ENV: "test" },
      shell: "pwsh.exe",
      title: "Renamed PowerShell",
    });

    const state = useWorkspaceStore.getState();
    const machine = state.machineGroups[0].machines[0];
    expect(machine).toMatchObject({
      args: ["-NoExit"],
      cwd: "C:\\work",
      env: { NODE_ENV: "test" },
      id: machineId,
      name: "Renamed PowerShell",
      shell: "pwsh.exe",
    });
    expect(state.terminalTabs[0]).toMatchObject({
      machineId,
      title: "Renamed PowerShell",
    });
    expect(state.terminalPanes[0]).toMatchObject({
      args: ["-NoExit"],
      cwd: "C:\\work",
      env: { NODE_ENV: "test" },
      shell: "pwsh.exe",
      title: "Renamed PowerShell",
    });
  });

  it("focuses an already-open local machine instead of creating another tab", () => {
    const machineId = localMachineIdForProfile("profile-pwsh");
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().openLocalTerminal(machineId);
    const openedState = useWorkspaceStore.getState();
    const openedTabId = openedState.activeTabId;
    const tabCount = openedState.terminalTabs.length;
    const paneCount = openedState.terminalPanes.length;

    useWorkspaceStore.getState().openLocalTerminal(machineId);

    const state = useWorkspaceStore.getState();
    expect(state.activeTabId).toBe(openedTabId);
    expect(state.terminalTabs).toHaveLength(tabCount);
    expect(state.terminalPanes).toHaveLength(paneCount);
  });

  it("adds a local terminal tab from explicit runtime options", () => {
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().selectProfile("profile-pwsh");
    useWorkspaceStore.getState().addTerminalTab({
      args: ["--login"],
      cwd: "C:\\work",
      env: { LANG: "zh_CN.UTF-8" },
      shell: "bash.exe",
      title: "AI 本地终端",
    });

    const state = useWorkspaceStore.getState();
    const pane = state.terminalPanes[state.terminalPanes.length - 1];
    const tab = state.terminalTabs[state.terminalTabs.length - 1];
    expect(tab.title).toBe("AI 本地终端");
    expect(pane.profileId).toBeUndefined();
    expect(pane).toMatchObject({
      args: ["--login"],
      cwd: "C:\\work",
      env: { LANG: "zh_CN.UTF-8" },
      shell: "bash.exe",
      title: "AI 本地终端",
    });
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

  it("ignores unknown tool panel selection requests", () => {
    const before = useWorkspaceStore.getState();

    useWorkspaceStore.getState().setActiveTool("unknown" as never);

    expect(useWorkspaceStore.getState().activeTool).toBe(before.activeTool);
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

  it("maps RDP-tagged remote hosts as RDP sidebar machines", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithRdp);

    const state = useWorkspaceStore.getState();
    const rdpMachine = state.machineGroups[0].machines[0];

    expect(rdpMachine).toMatchObject({
      authType: "password",
      credentialRef: "credential:ssh/rdp-office/password",
      description: "administrator@rdp.internal:3389",
      host: "rdp.internal",
      id: "rdp-office",
      kind: "rdp",
      name: "office-rdp",
      port: 3389,
      username: "administrator",
    });
    expect(rdpMachine.target).toBeUndefined();
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
