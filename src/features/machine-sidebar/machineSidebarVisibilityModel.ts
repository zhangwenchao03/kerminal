/**
 * Machine sidebar visibility model.
 *
 * @author kongweiguang
 */

import type { Machine, MachineGroup } from "../workspace/types";

export function buildVisibleMachineGroups(
  groups: MachineGroup[],
  normalizedSearch: string,
): MachineGroup[] {
  if (!normalizedSearch) {
    return groups;
  }

  return groups
    .map((group) => {
      const groupMatches = group.title.toLowerCase().includes(normalizedSearch);
      if (groupMatches) {
        return group;
      }

      return {
        ...group,
        machines: group.machines.filter((machine) =>
          machineMatchesSearch(machine, normalizedSearch),
        ),
      };
    })
    .filter((group) => {
      return (
        group.title.toLowerCase().includes(normalizedSearch) ||
        group.machines.length > 0
      );
    });
}

function machineMatchesSearch(machine: Machine, normalizedSearch: string) {
  const haystack = `${machine.name} ${machine.description} ${machine.tags.join(" ")}`;
  return haystack.toLowerCase().includes(normalizedSearch);
}
