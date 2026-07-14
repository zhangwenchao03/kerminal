import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKerminalShellContainerActions } from "../../../src/app/useKerminalShellContainerActions";
import { apiContainer } from "../support/workspace/workspaceStore.testSupport";
import type { MachineGroup } from "../../../src/features/workspace/types";

const machineGroups: MachineGroup[] = [
  {
    id: "group-host",
    machines: [
      {
        description: "SSH",
        id: apiContainer.hostId,
        kind: "ssh",
        name: "测试主机",
        remoteGroupId: "group-host",
        status: "online",
        tags: ["ssh"],
      },
    ],
    title: "测试组",
  },
];

describe("useKerminalShellContainerActions", () => {
  it("pins a container into the host group resolved by the shell", async () => {
    const addDockerContainer = vi.fn();
    const resolveTargetGroupId = vi.fn(async () => "group-resolved");
    const runtime = runtimePort();
    const { result } = renderHook(() =>
      useKerminalShellContainerActions({
        addDockerContainer,
        machineGroups,
        resolveTargetGroupId,
        runtime,
      }),
    );

    await act(() => result.current.pinHostContainer(apiContainer));

    expect(resolveTargetGroupId).toHaveBeenCalledWith("group-host");
    expect(addDockerContainer).toHaveBeenCalledWith(apiContainer, {
      groupId: "group-resolved",
    });
  });

  it.each(["start", "stop", "restart", "remove"] as const)(
    "dispatches the %s lifecycle command through the runtime port",
    async (action) => {
      const runtime = runtimePort();
      const { result } = renderHook(() =>
        useKerminalShellContainerActions({
          addDockerContainer: vi.fn(),
          machineGroups,
          resolveTargetGroupId: vi.fn(async () => undefined),
          runtime,
        }),
      );

      await act(() =>
        result.current.runHostContainerLifecycleAction(action, apiContainer, {
          force: true,
        }),
      );

      expect(runtime[action]).toHaveBeenCalledWith({
        containerId: apiContainer.id,
        force: true,
        hostId: apiContainer.hostId,
        runtime: apiContainer.runtime,
      });
    },
  );
});

function runtimePort() {
  return {
    fetchStats: vi.fn(),
    inspect: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(async () => lifecycleResult("remove")),
    restart: vi.fn(async () => lifecycleResult("restart")),
    start: vi.fn(async () => lifecycleResult("start")),
    stop: vi.fn(async () => lifecycleResult("stop")),
  };
}

function lifecycleResult(action: "start" | "stop" | "restart" | "remove") {
  return {
    action,
    containerId: apiContainer.id,
    hostId: apiContainer.hostId,
    output: "",
    runtime: apiContainer.runtime,
    success: true,
  };
}
