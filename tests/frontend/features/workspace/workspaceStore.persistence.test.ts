import { beforeEach, describe, expect, it } from "vitest";
import { localMachineIdForProfile, useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { apiContainer, bashProfile, pwshProfile, remoteHostTree, remoteHostTreeWithTools, resetWorkspaceStore } from "../../support/workspace/workspaceStore.testSupport";

describe("workspaceStore", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("uses current profile sidebar metadata even when the session has a stale local tombstone", () => {
    const machineId = localMachineIdForProfile("profile-pwsh");

    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "",
      focusedPaneId: "",
      removedSidebarMachineIds: [machineId],
      selectedMachineId: "",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [],
    });

    useWorkspaceStore.getState().setProfiles([
      bashProfile,
      {
        ...pwshProfile,
        sidebarGroupId: "group-tools",
      },
    ]);

    const state = useWorkspaceStore.getState();
    const toolsGroup = state.machineGroups.find(
      (group) => group.id === "group-tools",
    );
    expect(toolsGroup?.machines[0]).toMatchObject({
      id: machineId,
      kind: "local",
      name: "PowerShell 7",
      remoteGroupId: "group-tools",
    });
    expect(state.removedSidebarMachineIds).not.toContain(machineId);
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

  it("updates an existing pinned Docker container instead of duplicating it", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);

    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      groupId: "group-lab",
      shell: "exec sh",
    });
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      groupId: "group-tools",
      shell: "exec bash -l",
      user: "root",
    });

    const dockerMachines = useWorkspaceStore
      .getState()
      .machineGroups.flatMap((group) => group.machines)
      .filter((machine) => machine.kind === "dockerContainer");
    expect(dockerMachines).toHaveLength(1);
    expect(dockerMachines[0]).toMatchObject({
      id: "docker:host-lab:c0ffee1234567890",
      remoteGroupId: "group-tools",
      shell: "exec bash -l",
      user: "root",
    });
    expect(
      useWorkspaceStore
        .getState()
        .machineGroups.find((group) => group.id === "group-lab")
        ?.machines.map((machine) => machine.id),
    ).not.toContain("docker:host-lab:c0ffee1234567890");
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

  it("does not resurrect a removed local sidebar machine from restored panes", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "临时本地终端" });
    useWorkspaceStore.getState().removeSidebarMachine("machine-local-1");

    const removedState = useWorkspaceStore.getState();
    expect(
      removedState.machineGroups.flatMap((group) => group.machines.map((machine) => machine.id)),
    ).not.toContain("machine-local-1");
    expect(removedState.removedSidebarMachineIds).toEqual(["machine-local-1"]);

    resetWorkspaceStore();
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: removedState.activeTabId,
      focusedPaneId: removedState.focusedPaneId,
      removedSidebarMachineIds: removedState.removedSidebarMachineIds,
      selectedMachineId: removedState.selectedMachineId,
      sidebarMachines: [],
      terminalPanes: removedState.terminalPanes,
      terminalTabs: removedState.terminalTabs,
    });

    const restoredState = useWorkspaceStore.getState();
    expect(
      restoredState.machineGroups.flatMap((group) => group.machines.map((machine) => machine.id)),
    ).not.toContain("machine-local-1");
    expect(restoredState.terminalPanes[0]).toMatchObject({
      id: "pane-local-1",
      machineId: "machine-local-1",
      mode: "local",
    });
    expect(restoredState.removedSidebarMachineIds).toEqual(["machine-local-1"]);
  });

  it("does not resurrect a removed Docker sidebar machine from restored panes", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      shell: "exec bash -l",
    });
    const containerId = useWorkspaceStore.getState().selectedMachineId;
    useWorkspaceStore.getState().openContainerTerminal(containerId);
    useWorkspaceStore.getState().removeSidebarMachine(containerId);

    const removedState = useWorkspaceStore.getState();
    expect(removedState.removedSidebarMachineIds).toEqual([containerId]);
    expect(
      removedState.machineGroups[0].machines.map((machine) => machine.id),
    ).toEqual(["host-lab"]);

    resetWorkspaceStore();
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: removedState.activeTabId,
      focusedPaneId: removedState.focusedPaneId,
      removedSidebarMachineIds: removedState.removedSidebarMachineIds,
      selectedMachineId: removedState.selectedMachineId,
      sidebarMachines: [],
      terminalPanes: removedState.terminalPanes,
      terminalTabs: removedState.terminalTabs,
    });

    const restoredState = useWorkspaceStore.getState();
    expect(restoredState.machineGroups[0].machines.map((machine) => machine.id)).toEqual([
      "host-lab",
    ]);
    expect(restoredState.terminalPanes[0]).toMatchObject({
      machineId: containerId,
      mode: "container",
      remoteHostId: "host-lab",
    });
    expect(restoredState.removedSidebarMachineIds).toEqual([containerId]);
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
    expect(state.selectedMachineId).toBe("");
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

  it("ignores unknown tool panel selection requests", () => {
    const before = useWorkspaceStore.getState();

    useWorkspaceStore.getState().setActiveTool("unknown" as never);

    expect(useWorkspaceStore.getState().activeTool).toBe(before.activeTool);
  });


});
