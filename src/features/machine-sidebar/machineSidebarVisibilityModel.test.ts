import { describe, expect, it } from "vitest";
import type { MachineGroup } from "../workspace/types";
import { buildVisibleMachineGroups } from "./machineSidebarVisibilityModel";

describe("buildVisibleMachineGroups", () => {
  it("keeps the original groups when there is no search", () => {
    const groups = largeMachineGroups(3, 4);

    expect(buildVisibleMachineGroups(groups, "")).toBe(groups);
  });

  it("keeps all machines when the group title matches", () => {
    const groups = largeMachineGroups(2, 3);

    const visibleGroups = buildVisibleMachineGroups(groups, "group 1");

    expect(visibleGroups).toHaveLength(1);
    expect(visibleGroups[0]?.id).toBe("group-1");
    expect(visibleGroups[0]?.machines).toHaveLength(3);
  });

  it("filters machines by name description and tags", () => {
    const groups = largeMachineGroups(2, 4);

    const visibleByName = buildVisibleMachineGroups(groups, "host-1-2");
    const visibleByDescription = buildVisibleMachineGroups(groups, "10.0.1.3");
    const visibleByTag = buildVisibleMachineGroups(groups, "batch-3");

    expect(visibleByName).toHaveLength(1);
    expect(visibleByName[0]?.machines.map((machine) => machine.id)).toEqual([
      "machine-1-2",
    ]);
    expect(visibleByDescription[0]?.machines.map((machine) => machine.id)).toEqual([
      "machine-1-3",
    ]);
    expect(visibleByTag.flatMap((group) => group.machines)).toHaveLength(2);
  });

  it("handles a large host tree without mutating the source groups", () => {
    const groups = largeMachineGroups(20, 100);

    const visibleGroups = buildVisibleMachineGroups(groups, "batch-42");

    expect(visibleGroups).toHaveLength(20);
    expect(visibleGroups.flatMap((group) => group.machines)).toHaveLength(20);
    expect(groups[0]?.machines).toHaveLength(100);
  });
});

function largeMachineGroups(
  groupCount: number,
  machinesPerGroup: number,
): MachineGroup[] {
  return Array.from({ length: groupCount }, (_, groupIndex) => ({
    id: `group-${groupIndex}`,
    machines: Array.from({ length: machinesPerGroup }, (_, machineIndex) => ({
      description: `deploy@10.0.${groupIndex}.${machineIndex}:22`,
      host: `10.0.${groupIndex}.${machineIndex}`,
      id: `machine-${groupIndex}-${machineIndex}`,
      kind: "ssh" as const,
      name: `host-${groupIndex}-${machineIndex}`,
      port: 22,
      remoteGroupId: `group-${groupIndex}`,
      status: "offline" as const,
      tags: ["ssh", `batch-${machineIndex}`],
      username: "deploy",
    })),
    title: `Group ${groupIndex}`,
  }));
}
