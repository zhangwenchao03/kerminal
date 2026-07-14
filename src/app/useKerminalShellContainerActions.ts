import { useCallback } from "react";
import {
  fetchDockerContainerStats,
  inspectDockerContainer,
  listDockerContainers,
  removeDockerContainer,
  restartDockerContainer,
  startDockerContainer,
  stopDockerContainer,
  type DockerContainerLifecycleAction,
  type DockerContainerSummary,
} from "../lib/dockerApi";
import type { MachineGroup } from "../features/workspace/types";

interface DockerContainerRuntimePort {
  fetchStats: typeof fetchDockerContainerStats;
  inspect: typeof inspectDockerContainer;
  list: typeof listDockerContainers;
  remove: typeof removeDockerContainer;
  restart: typeof restartDockerContainer;
  start: typeof startDockerContainer;
  stop: typeof stopDockerContainer;
}

interface UseKerminalShellContainerActionsOptions {
  addDockerContainer: (
    container: DockerContainerSummary,
    options?: { groupId?: string },
  ) => void;
  defaultRemoteGroupId?: string;
  machineGroups: MachineGroup[];
  resolveTargetGroupId: (preferredGroupId?: string) => Promise<string | undefined>;
  runtime?: DockerContainerRuntimePort;
}

const dockerContainerRuntime: DockerContainerRuntimePort = {
  fetchStats: fetchDockerContainerStats,
  inspect: inspectDockerContainer,
  list: listDockerContainers,
  remove: removeDockerContainer,
  restart: restartDockerContainer,
  start: startDockerContainer,
  stop: stopDockerContainer,
};

/** 组合 Shell 使用的容器查询、pin 和生命周期命令。 */
export function useKerminalShellContainerActions({
  addDockerContainer,
  defaultRemoteGroupId,
  machineGroups,
  resolveTargetGroupId,
  runtime = dockerContainerRuntime,
}: UseKerminalShellContainerActionsOptions) {
  const pinHostContainer = useCallback(
    async (container: DockerContainerSummary) => {
      const hostMachine = machineGroups
        .flatMap((group) => group.machines)
        .find((machine) => machine.id === container.hostId);
      const groupId = await resolveTargetGroupId(
        hostMachine?.remoteGroupId ?? defaultRemoteGroupId,
      );
      addDockerContainer(container, { groupId });
    },
    [
      addDockerContainer,
      defaultRemoteGroupId,
      machineGroups,
      resolveTargetGroupId,
    ],
  );

  const runHostContainerLifecycleAction = useCallback(
    async (
      action: DockerContainerLifecycleAction,
      container: DockerContainerSummary,
      options?: { force?: boolean },
    ) => {
      const request = {
        containerId: container.id,
        force: options?.force,
        hostId: container.hostId,
        runtime: container.runtime,
      };
      switch (action) {
        case "start":
          await runtime.start(request);
          return;
        case "stop":
          await runtime.stop(request);
          return;
        case "restart":
          await runtime.restart(request);
          return;
        case "remove":
          await runtime.remove(request);
      }
    },
    [runtime],
  );

  return {
    fetchContainerStats: runtime.fetchStats,
    inspectContainer: runtime.inspect,
    listDockerContainers: runtime.list,
    pinHostContainer,
    runHostContainerLifecycleAction,
  };
}
