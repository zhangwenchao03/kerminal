import { vi } from "vitest";

export const localSidebarGroups = [
  {
    id: "__ungrouped__",
    machines: [
      {
        description: "本地会话",
        id: "local-powershell",
        kind: "local" as const,
        name: "PowerShell",
        remoteGroupId: "__ungrouped__",
        status: "online" as const,
        tags: ["local", "dev"],
      },
    ],
    title: "默认分组",
  },
];

export const remoteSidebarGroups = [
  ...localSidebarGroups,
  {
    id: "group-dev",
    machines: [
      {
        description: "ubuntu@10.0.0.12:22",
        id: "ubuntu-dev",
        kind: "ssh" as const,
        name: "ubuntu-dev",
        remoteGroupId: "group-dev",
        status: "offline" as const,
        tags: ["ssh", "dev"],
      },
    ],
    title: "开发主机",
  },
];

export const containerSidebarGroups = [
  {
    id: "group-dev",
    machines: [
      {
        description: "ubuntu@10.0.0.12:22",
        id: "ubuntu-dev",
        kind: "ssh" as const,
        name: "ubuntu-dev",
        remoteGroupId: "group-dev",
        status: "offline" as const,
        tags: ["ssh", "dev"],
      },
      {
        containerId: "c0ffee1234567890",
        containerName: "api",
        description: "kerminal/api:latest · Up 12 minutes",
        id: "docker:ubuntu-dev:c0ffee1234567890",
        kind: "dockerContainer" as const,
        name: "api",
        parentMachineId: "ubuntu-dev",
        status: "offline" as const,
        tags: ["container", "docker", "running"],
        target: {
          containerId: "c0ffee1234567890",
          containerName: "api",
          hostId: "ubuntu-dev",
          kind: "dockerContainer" as const,
          runtime: "docker" as const,
        },
      },
    ],
    title: "开发主机",
  },
];

export const rdpSidebarGroups = [
  {
    id: "group-office",
    machines: [
      {
        authType: "password" as const,
        description: "administrator@rdp.internal:3389",
        host: "rdp.internal",
        id: "rdp-office",
        kind: "rdp" as const,
        name: "office-rdp",
        port: 3389,
        remoteGroupId: "group-office",
        status: "offline" as const,
        tags: ["rdp", "office"],
        username: "administrator",
      },
    ],
    title: "办公主机",
  },
];

export const terminalTransportSidebarGroups = [
  {
    id: "group-console",
    machines: [
      {
        authType: "agent" as const,
        description: "lab.internal:2323",
        host: "lab.internal",
        id: "telnet-lab",
        kind: "telnet" as const,
        name: "lab telnet",
        port: 2323,
        remoteGroupId: "group-console",
        status: "offline" as const,
        tags: ["telnet"],
        target: { hostId: "telnet-lab", kind: "telnet" as const },
        username: "",
      },
      {
        authType: "agent" as const,
        description: "COM9 · 115200 bps",
        host: "COM9",
        id: "serial-console",
        kind: "serial" as const,
        name: "console serial",
        port: 1,
        remoteGroupId: "group-console",
        status: "offline" as const,
        tags: ["serial", "serial-port:COM9", "serial-baud:115200"],
        target: { hostId: "serial-console", kind: "serial" as const },
        username: "",
      },
    ],
    title: "控制台",
  },
];

export function mockElementFromPoint(element: Element) {
  const documentWithElementFromPoint = document as Document & {
    elementFromPoint?: Document["elementFromPoint"];
  };
  const originalElementFromPoint = documentWithElementFromPoint.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });

  return () => {
    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
      return;
    }
    Reflect.deleteProperty(documentWithElementFromPoint, "elementFromPoint");
  };
}
