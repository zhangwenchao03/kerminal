import { describe, expect, it } from "vitest";
import type { MachineGroup } from "../../../../src/features/workspace/types";
import { createSplitTargetOptions } from "../../../../src/features/terminal/terminalSplitTargets";

describe("terminal split targets", () => {
  it("includes terminal-capable machines and excludes non-terminal targets", () => {
    const groups: MachineGroup[] = [
      {
        id: "devices",
        machines: [
          {
            description: "Router shell",
            host: "10.0.0.10",
            id: "telnet-router",
            kind: "telnet",
            name: "Telnet Router",
            port: 23,
            status: "online",
            tags: [],
            username: "admin",
          },
          {
            containerId: "abc123",
            containerName: "api",
            description: "API container",
            id: "container-api",
            kind: "dockerContainer",
            name: "API Container",
            parentMachineId: "host-prod",
            runtime: "docker",
            status: "warning",
            tags: [],
          },
          {
            description: "Desktop session",
            id: "rdp-desktop",
            kind: "rdp",
            name: "RDP Desktop",
            status: "online",
            tags: [],
          },
        ],
        title: "Devices",
      },
    ];

    const targets = createSplitTargetOptions(groups);

    expect(targets.map((target) => target.id)).toEqual([
      "telnet-router",
      "container-api",
    ]);
    expect(targets[0]).toMatchObject({
      groupTitle: "Devices",
      hostLabel: "admin@10.0.0.10:23",
      kind: "telnet",
    });
    expect(targets[1]).toMatchObject({
      hostLabel: "docker · api · host-prod",
      kind: "dockerContainer",
      status: "warning",
    });
  });
});
