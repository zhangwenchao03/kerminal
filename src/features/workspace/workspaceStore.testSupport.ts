import type { DockerContainerSummary } from "../../lib/dockerApi";
import type { TerminalProfile } from "../../lib/profileApi";
import {
  createDefaultSshOptions,
  type RemoteHostGroupWithHosts,
} from "../../lib/remoteHostApi";
import { dockerContainerTarget } from "../../lib/targetModel";

export const pwshProfile: TerminalProfile = {
  args: ["-NoLogo"],
  createdAt: "2026-06-17 10:00:00",
  cwd: "C:\\dev",
  env: { TERM: "xterm-256color" },
  id: "profile-pwsh",
  isDefault: false,
  name: "PowerShell 7",
  shell: "pwsh.exe",
  sortOrder: 20,
  updatedAt: "2026-06-17 10:00:00",
};

export const bashProfile: TerminalProfile = {
  args: ["--login"],
  createdAt: "2026-06-17 10:00:00",
  env: { LANG: "zh_CN.UTF-8" },
  id: "profile-bash",
  isDefault: true,
  name: "Git Bash",
  shell: "C:\\Program Files\\Git\\bin\\bash.exe",
  sortOrder: 10,
  updatedAt: "2026-06-17 10:00:00",
};

export const remoteHostTree: RemoteHostGroupWithHosts[] = [
  {
    createdAt: "2026-06-17 10:00:00",
    hosts: [
      {
        authType: "key",
        createdAt: "2026-06-17 10:00:00",
        credentialSecret:
          "-----BEGIN OPENSSH PRIVATE KEY-----\nlab-test-key\n-----END OPENSSH PRIVATE KEY-----\n",
        groupId: "group-lab",
        host: "192.168.1.253",
        id: "host-lab",
        name: "lab server",
        port: 2222,
        production: true,
        sshOptions: createDefaultSshOptions(),
        sortOrder: 10,
        tags: ["ssh", "lab"],
        updatedAt: "2026-06-17 10:00:00",
        username: "root",
      },
    ],
    id: "group-lab",
    name: "实验室",
    sortOrder: 10,
    updatedAt: "2026-06-17 10:00:00",
  },
];

export const remoteHostTreeWithTools: RemoteHostGroupWithHosts[] = [
  ...remoteHostTree,
  {
    createdAt: "2026-06-17 10:00:00",
    hosts: [],
    id: "group-tools",
    name: "工具",
    sortOrder: 20,
    updatedAt: "2026-06-17 10:00:00",
  },
];

export const unorderedRemoteHostTree: RemoteHostGroupWithHosts[] = [
  {
    createdAt: "2026-06-17 10:00:00",
    hosts: [
      {
        authType: "agent",
        createdAt: "2026-06-17 10:00:00",
        groupId: "group-z",
        host: "10.0.0.20",
        id: "host-z-2",
        name: "zeta-b",
        port: 22,
        production: false,
        sshOptions: createDefaultSshOptions(),
        sortOrder: 20,
        tags: ["ssh"],
        updatedAt: "2026-06-17 10:00:00",
        username: "deploy",
      },
      {
        authType: "agent",
        createdAt: "2026-06-17 10:00:00",
        groupId: "group-z",
        host: "10.0.0.10",
        id: "host-z-1",
        name: "zeta-a",
        port: 22,
        production: false,
        sshOptions: createDefaultSshOptions(),
        sortOrder: 10,
        tags: ["ssh"],
        updatedAt: "2026-06-17 10:00:00",
        username: "deploy",
      },
    ],
    id: "group-z",
    name: "Zeta",
    sortOrder: 20,
    updatedAt: "2026-06-17 10:00:00",
  },
  {
    createdAt: "2026-06-17 10:00:00",
    hosts: [],
    id: "group-a",
    name: "Alpha",
    sortOrder: 10,
    updatedAt: "2026-06-17 10:00:00",
  },
];

export const remoteHostTreeWithRdp: RemoteHostGroupWithHosts[] = [
  {
    createdAt: "2026-06-19 10:00:00",
    hosts: [
      {
        authType: "password",
        createdAt: "2026-06-19 10:00:00",
        credentialRef: "credential:rdp/rdp-office/password",
        groupId: "group-office",
        host: "rdp.internal",
        id: "rdp-office",
        name: "office-rdp",
        port: 3389,
        production: false,
        sshOptions: createDefaultSshOptions(),
        sortOrder: 10,
        tags: ["rdp", "office"],
        updatedAt: "2026-06-19 10:00:00",
        username: "administrator",
      },
    ],
    id: "group-office",
    name: "办公主机",
    sortOrder: 10,
    updatedAt: "2026-06-19 10:00:00",
  },
];

export const remoteHostTreeWithTerminalTransports: RemoteHostGroupWithHosts[] = [
  {
    createdAt: "2026-06-20 10:00:00",
    hosts: [
      {
        authType: "agent",
        createdAt: "2026-06-20 10:00:00",
        groupId: "group-console",
        host: "legacy.internal",
        id: "telnet-legacy",
        name: "legacy telnet",
        port: 2323,
        production: false,
        sshOptions: createDefaultSshOptions(),
        sortOrder: 10,
        tags: ["telnet", "legacy"],
        updatedAt: "2026-06-20 10:00:00",
        username: "",
      },
      {
        authType: "agent",
        createdAt: "2026-06-20 10:00:00",
        groupId: "group-console",
        host: "COM3",
        id: "serial-console",
        name: "console serial",
        port: 1,
        production: false,
        sshOptions: createDefaultSshOptions(),
        sortOrder: 20,
        tags: [
          "serial",
          "serial-port:COM9",
          "serial-baud:115200",
          "serial-data-bits:8",
          "serial-stop-bits:1",
          "serial-parity:none",
          "serial-flow:none",
        ],
        updatedAt: "2026-06-20 10:00:00",
        username: "",
      },
    ],
    id: "group-console",
    name: "控制台",
    sortOrder: 10,
    updatedAt: "2026-06-20 10:00:00",
  },
];

const apiContainerTarget = dockerContainerTarget({
  containerId: "c0ffee1234567890",
  containerName: "api",
  hostId: "host-lab",
});

export const apiContainer: DockerContainerSummary = {
  capabilities: {
    download: true,
    exec: true,
    files: true,
    ports: false,
    terminal: true,
    upload: true,
  },
  hostId: "host-lab",
  id: "c0ffee1234567890",
  image: "kerminal/api:latest",
  name: "api",
  ports: ["0.0.0.0:8080->80/tcp"],
  runtime: "docker",
  shortId: "c0ffee123456",
  state: "running",
  status: "running",
  statusText: "Up 12 minutes",
  target: apiContainerTarget,
};
