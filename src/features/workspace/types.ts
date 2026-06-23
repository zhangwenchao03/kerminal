import type { RemoteTargetRef } from "../../lib/targetModel";
import type { SshOptions } from "../../lib/remoteHostApi";

export type MachineStatus = "online" | "offline" | "warning";

export type MachineKind =
  | "local"
  | "ssh"
  | "telnet"
  | "serial"
  | "rdp"
  | "dockerContainer"
  | "group";

export interface Machine {
  id: string;
  name: string;
  kind: MachineKind;
  status: MachineStatus;
  description: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: "password" | "key" | "agent";
  credentialRef?: string;
  credentialSecret?: string;
  profileId?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  target?: RemoteTargetRef;
  production?: boolean;
  sshOptions?: SshOptions;
  remoteGroupId?: string;
  parentMachineId?: string;
  containerId?: string;
  containerName?: string;
  runtime?: "docker" | "podman";
  user?: string;
  workdir?: string;
  latencyMs?: number;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  tags: string[];
}

export interface MachineGroup {
  id: string;
  title: string;
  pinned?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  machines: Machine[];
}

export interface TerminalSessionTab {
  kind?: "terminal";
  id: string;
  title: string;
  machineId: string;
  layout: TerminalLayoutNode;
}

export interface SftpTransferWorkspaceTab {
  kind: "sftpTransfer";
  id: string;
  title: string;
  machineId: string;
  leftHostId?: string;
  lockedLeftHostId?: string;
  rightHostId?: string;
}

export type TerminalTab = TerminalSessionTab | SftpTransferWorkspaceTab;

export const terminalTabGroupColorIds = [
  "blue",
  "pink",
  "purple",
  "mint",
  "amber",
  "teal",
  "orange",
  "gray",
] as const;

export type TerminalTabGroupColor = (typeof terminalTabGroupColorIds)[number];

export interface TerminalTabGroupPreference {
  color?: TerminalTabGroupColor;
  title?: string;
}

export type TerminalTabGroupPreferences = Record<
  string,
  TerminalTabGroupPreference
>;

export function isTerminalTabGroupColor(
  value: unknown,
): value is TerminalTabGroupColor {
  return (
    typeof value === "string" &&
    (terminalTabGroupColorIds as readonly string[]).includes(value)
  );
}

export function isTerminalSessionTab(
  tab: TerminalTab | undefined | null,
): tab is TerminalSessionTab {
  return Boolean(tab && (!tab.kind || tab.kind === "terminal"));
}

export function isSftpTransferWorkspaceTab(
  tab: TerminalTab | undefined | null,
): tab is SftpTransferWorkspaceTab {
  return tab?.kind === "sftpTransfer";
}

export type TerminalSplitDirection = "horizontal" | "vertical";

export type TerminalLayoutNode =
  | {
      type: "pane";
      paneId: string;
    }
  | {
      type: "split";
      id: string;
      direction: TerminalSplitDirection;
      children: TerminalLayoutNode[];
    };

export interface TerminalPane {
  id: string;
  title: string;
  machineId: string;
  mode: "local" | "ssh" | "telnet" | "serial" | "container" | "preview";
  target?: RemoteTargetRef;
  remoteHostId?: string;
  remoteHostProduction?: boolean;
  containerId?: string;
  profileId?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  currentCwd?: string;
  env?: Record<string, string>;
  prompt: string;
  status: MachineStatus;
  latencyMs?: number;
  lines: string[];
  outputHistory?: string;
}

export const toolIds = [
  "ai",
  "system",
  "sftp",
  "ports",
  "snippets",
  "logs",
  "settings",
] as const;

export type ToolId = (typeof toolIds)[number];

export function isToolId(value: string): value is ToolId {
  return (toolIds as readonly string[]).includes(value);
}

export interface ToolSummary {
  id: ToolId;
  title: string;
  description: string;
}
