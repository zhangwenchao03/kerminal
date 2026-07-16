import { describe, expect, it } from "vitest";
import {
  addLocalProfileMachineState,
  moveSidebarMachineState,
  pinMachineGroupState,
  removeSidebarMachineState,
  renameMachineGroupState,
  updateLocalMachineState,
} from "../../../../src/features/workspace/workspaceMachineState";
import {
  machineGroups,
  terminalPanes,
  terminalTabs,
} from "../../../../src/features/workspace/workspaceData";
import { localMachineIdForProfile } from "../../../../src/features/workspace/workspaceMachineModel";
import { pwshProfile } from "../../support/workspace/workspaceStore.testSupport";

function state() {
  return {
    activeTabId: terminalTabs[0]?.id ?? "",
    focusedPaneId: terminalPanes[0]?.id ?? "",
    machineGroups: structuredClone(machineGroups),
    removedSidebarMachineIds: [] as string[],
    selectedMachineId: machineGroups[0]?.machines[0]?.id ?? "",
    terminalPanes: structuredClone(terminalPanes),
    terminalTabs: structuredClone(terminalTabs),
  };
}

describe("workspaceMachineState", () => {
  it("adds and moves a profile-backed local machine atomically", () => {
    const added = addLocalProfileMachineState(state(), pwshProfile, "local");
    const machineId = localMachineIdForProfile(pwshProfile.id);
    const next = { ...state(), ...added };
    const moved = moveSidebarMachineState(next, machineId, "remote");

    expect(added.selectedMachineId).toBe(machineId);
    expect(moved.machineGroups?.find((group) => group.id === "remote")?.machines)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: machineId })]));
  });

  it("pins and renames an existing group but rejects blank titles", () => {
    const current = {
      ...state(),
      ...addLocalProfileMachineState(state(), pwshProfile, "local"),
    };
    const groupId = "local";
    const pinned = pinMachineGroupState(current, groupId, true);

    expect(pinned.machineGroups?.find((group) => group.id === groupId)).toEqual(
      expect.objectContaining({ pinned: true }),
    );
    expect(renameMachineGroupState(current, groupId, "  常用主机  "))
      .toEqual({
        machineGroups: expect.arrayContaining([
          expect.objectContaining({ id: groupId, title: "常用主机" }),
        ]),
      });
    expect(renameMachineGroupState(current, groupId, "   ")).toEqual({});
  });

  it("removes only persistent sidebar machines and records their tombstone", () => {
    const added = addLocalProfileMachineState(state(), pwshProfile, "local");
    const current = { ...state(), ...added };
    const machineId = localMachineIdForProfile(pwshProfile.id);
    const removed = removeSidebarMachineState(current, machineId);

    expect(removed.removedSidebarMachineIds).toContain(machineId);
    expect(
      removed.machineGroups?.flatMap((group) => group.machines).some(
        (machine) => machine.id === machineId,
      ),
    ).toBe(false);
  });

  it("updates a local machine and every open pane/tab using it", () => {
    const current = {
      ...state(),
      ...addLocalProfileMachineState(state(), pwshProfile, "local"),
    };
    const localMachine = current.machineGroups
      .flatMap((group) => group.machines)
      .find((machine) => machine.kind === "local");
    expect(localMachine).toBeDefined();
    const patch = updateLocalMachineState(current, localMachine!.id, {
      cwd: "C:\\workspace",
      shell: "pwsh.exe",
      title: "开发终端",
    });

    expect(
      patch.machineGroups?.flatMap((group) => group.machines).find(
        (machine) => machine.id === localMachine!.id,
      ),
    ).toEqual(expect.objectContaining({ cwd: "C:\\workspace", name: "开发终端" }));
  });
});
