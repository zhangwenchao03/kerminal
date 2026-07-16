import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MachineSidebarContainersView } from "../../../../src/features/machine-sidebar/MachineSidebarContainersView";
import type { DockerContainerSummary } from "../../../../src/lib/dockerApi";
import {
  dockerContainerTarget,
  dockerContainerTargetCapabilities,
} from "../../../../src/lib/targetModel";
import type {
  Machine,
  MachineGroup,
} from "../../../../src/features/workspace/types";

const firstHost = sshHost("host-a", "10.0.0.133");
const secondHost = sshHost("host-b", "10.0.0.166");
const secondHostContainer = container("host-b", "container-b", "api-b");
const groups: MachineGroup[] = [
  { id: "hosts", machines: [firstHost, secondHost], title: "主机" },
];

describe("MachineSidebarContainersView", () => {
  it("进入容器后继续显示该容器所属主机", async () => {
    const user = userEvent.setup();
    const onListDockerContainers = vi.fn(
      async ({ hostId }: { hostId: string }) =>
        hostId === secondHost.id ? [secondHostContainer] : [],
    );

    function Harness() {
      const [hostId, setHostId] = useState<string | null>(null);
      const [selectedMachineId, setSelectedMachineId] = useState(secondHost.id);
      return (
        <MachineSidebarContainersView
          groups={groups}
          hostId={hostId}
          onEnterContainer={(entry) =>
            setSelectedMachineId(`docker:${entry.hostId}:${entry.id}`)
          }
          onHostChange={setHostId}
          onListDockerContainers={onListDockerContainers}
          selectedMachineId={selectedMachineId}
        />
      );
    }

    render(<Harness />);
    const hostSearch = screen.getByRole("combobox", {
      name: "搜索容器主机",
    });
    expect(hostSearch).toHaveValue("host-b");

    await user.click(
      await screen.findByRole("button", { name: "进入容器 api-b" }),
    );

    await waitFor(() => expect(hostSearch).toHaveValue("host-b"));
    expect(onListDockerContainers).not.toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host-a" }),
    );
  });
});

function sshHost(id: string, host: string): Machine {
  return {
    description: `root@${host}:22`,
    host,
    id,
    kind: "ssh",
    name: id,
    port: 22,
    status: "online",
    tags: ["ssh"],
    username: "root",
  };
}

function container(
  hostId: string,
  id: string,
  name: string,
): DockerContainerSummary {
  return {
    capabilities: dockerContainerTargetCapabilities,
    hostId,
    id,
    image: "example/api:latest",
    name,
    ports: [],
    runtime: "docker",
    shortId: id,
    state: "running",
    status: "running",
    statusText: "Up 1 minute",
    target: dockerContainerTarget({ containerId: id, containerName: name, hostId }),
  };
}
