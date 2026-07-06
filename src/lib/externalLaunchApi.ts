import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const EXTERNAL_SSH_LAUNCH_EVENT = "kerminal-external-ssh-launch";
export const EXTERNAL_TARGET_PREFIX = "external:";

export type ExternalLaunchSourceTool =
  | "putty"
  | "mobaxterm"
  | "xshell"
  | "securecrt"
  | "openssh"
  | "kerminal-native";

export type ExternalLaunchEntrypoint =
  "direct-argv" | "single-instance" | "shim-ipc" | "protocol" | "session-file";

export type ExternalLaunchEventKind = "queued" | "rejected";

export interface ExternalLaunchSource {
  tool: ExternalLaunchSourceTool;
  entrypoint: ExternalLaunchEntrypoint;
  persona?: string;
  argv0?: string;
}

export interface ExternalSshRouteHop {
  host: string;
  port: number;
  username?: string;
}

export interface ExternalSshTarget {
  host: string;
  port: number;
  username?: string;
  route: ExternalSshRouteHop[];
}

export interface ExternalSshAuthMetadata {
  hasPassword: boolean;
  hasKeyPassphrase: boolean;
  identityFile?: string;
  passwordFilePresent: boolean;
  agent: boolean;
}

export interface ExternalSshLaunchOptions {
  displayName?: string;
  remoteCommand?: string;
  remoteCommandFile?: string;
  openSftp: boolean;
  sessionName?: string;
}

export interface ExternalLaunchRequestDiagnostics {
  parser: string;
  argvRedacted: string[];
  rawHash: string;
  warnings: string[];
}

export interface ExternalSshLaunchRequest {
  id: string;
  source: ExternalLaunchSource;
  receivedAt: string;
  target: ExternalSshTarget;
  auth: ExternalSshAuthMetadata;
  options: ExternalSshLaunchOptions;
  diagnostics: ExternalLaunchRequestDiagnostics;
}

export interface ExternalLaunchMaterializeRequest {
  launchId: string;
  username?: string;
}

export interface ExternalLaunchMaterializedTarget {
  launchId: string;
  targetId: string;
  displayName: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key" | "agent";
}

export interface ExternalLaunchTargetSummary {
  host: string;
  port: number;
  username?: string;
  displayName: string;
}

export interface ExternalLaunchEventPayload {
  kind: ExternalLaunchEventKind;
  launchId?: string;
  sourceTool?: ExternalLaunchSourceTool;
  entrypoint: ExternalLaunchEntrypoint;
  target?: ExternalLaunchTargetSummary;
  pendingCount: number;
  message?: string;
}

export interface ExternalLaunchPolicySnapshot {
  enabled: boolean;
  acceptVendorArgs: boolean;
  shimBridgeEnabled: boolean;
  autoOpenSftp: boolean;
  disabledTools: ExternalLaunchSourceTool[];
}

export interface ExternalLaunchIntakeSnapshot {
  pendingCount: number;
  pendingLaunchIds: string[];
  acceptedCount: number;
  rejectedCount: number;
  noopCount: number;
  policy: ExternalLaunchPolicySnapshot;
  lastRejection?: {
    entrypoint: ExternalLaunchEntrypoint;
    sourceTool?: ExternalLaunchSourceTool;
    message: string;
    argCount: number;
    rawHash: string;
    cwdPresent: boolean;
  };
}

export interface ExternalLaunchSecretSnapshot {
  activeSecretCount: number;
  launchIds: string[];
}

export interface ExternalLaunchSnapshot {
  intake: ExternalLaunchIntakeSnapshot;
  secrets: ExternalLaunchSecretSnapshot;
}

export type ExternalLaunchAliasTool = Exclude<
  ExternalLaunchSourceTool,
  "kerminal-native"
>;

export type ExternalLaunchAliasState =
  | "missing"
  | "managed"
  | "blockedNonKerminal"
  | "staleMarker";

export type ExternalLaunchAliasInstallMode = "hardLink" | "copy";

export interface ExternalLaunchAliasInspection {
  tool: ExternalLaunchAliasTool;
  aliasPath: string;
  markerPath: string;
  state: ExternalLaunchAliasState;
  markerPresent: boolean;
}

export interface ExternalLaunchAliasStatus {
  installDirectory?: string;
  kerminalExecutable: string;
  shimExecutable: string;
  shimAvailable: boolean;
  aliasDirectory: string;
  aliases: ExternalLaunchAliasInspection[];
}

export interface ExternalLaunchAliasCommandRequest {
  tools?: ExternalLaunchAliasTool[];
  aliasDirectory?: string;
  shimExecutable?: string;
  preferHardLink?: boolean;
}

export interface ExternalLaunchAliasSummary {
  tool: ExternalLaunchAliasTool;
  aliasPath: string;
  markerPath: string;
  state: ExternalLaunchAliasState;
  installMode?: ExternalLaunchAliasInstallMode;
}

export interface ExternalLaunchAliasRemoval {
  tool: ExternalLaunchAliasTool;
  aliasPath: string;
  markerPath: string;
  removedAlias: boolean;
  removedMarker: boolean;
}

export const externalLaunchAliasTools: ExternalLaunchAliasTool[] = [
  "putty",
  "mobaxterm",
  "xshell",
  "securecrt",
  "openssh",
];

export async function takePendingExternalSshLaunches(): Promise<
  ExternalSshLaunchRequest[]
> {
  if (isTauri()) {
    return invoke<ExternalSshLaunchRequest[]>("external_launch_take_pending");
  }
  return [];
}

export async function ackExternalSshLaunch(launchId: string): Promise<number> {
  if (isTauri()) {
    return invoke<number>("external_launch_ack", { launchId });
  }
  validateBrowserPreviewLaunchId(launchId);
  return 0;
}

export async function materializeExternalSshLaunch(
  request: ExternalLaunchMaterializeRequest,
): Promise<ExternalLaunchMaterializedTarget> {
  validateBrowserPreviewLaunchId(request.launchId);
  if (isTauri()) {
    return invoke<ExternalLaunchMaterializedTarget>("external_launch_materialize", {
      request,
    });
  }
  return {
    authType: "agent",
    displayName: `External ${request.launchId}`,
    host: "preview.invalid",
    launchId: request.launchId,
    port: 22,
    targetId: `external:${request.launchId}`,
    username: request.username ?? "preview",
  };
}

export async function cancelExternalSshLaunch(
  launchId: string,
): Promise<number> {
  if (isTauri()) {
    return invoke<number>("external_launch_cancel", { launchId });
  }
  validateBrowserPreviewLaunchId(launchId);
  return 0;
}

export async function closeExternalSshLaunch(
  launchId: string,
): Promise<number> {
  if (isTauri()) {
    return invoke<number>("external_launch_close", { launchId });
  }
  validateBrowserPreviewLaunchId(launchId);
  return 0;
}

export async function getExternalLaunchSnapshot(): Promise<ExternalLaunchSnapshot> {
  if (isTauri()) {
    return invoke<ExternalLaunchSnapshot>("external_launch_snapshot");
  }
  return {
    intake: {
      acceptedCount: 0,
      noopCount: 0,
      pendingCount: 0,
      pendingLaunchIds: [],
      policy: {
        acceptVendorArgs: true,
        autoOpenSftp: false,
        disabledTools: [],
        enabled: true,
        shimBridgeEnabled: true,
      },
      rejectedCount: 0,
    },
    secrets: {
      activeSecretCount: 0,
      launchIds: [],
    },
  };
}

export async function getExternalLaunchAliasStatus(): Promise<ExternalLaunchAliasStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchAliasStatus>("external_launch_alias_status");
  }
  return browserPreviewExternalLaunchAliasStatus();
}

export async function generateExternalLaunchAliases(
  request: ExternalLaunchAliasCommandRequest = {},
): Promise<ExternalLaunchAliasSummary[]> {
  if (isTauri()) {
    return invoke<ExternalLaunchAliasSummary[]>("external_launch_alias_generate", {
      request,
    });
  }
  return browserPreviewExternalLaunchAliasStatus(request.aliasDirectory).aliases
    .filter((alias) => (request.tools ?? externalLaunchAliasTools).includes(alias.tool))
    .map((alias) => ({
      aliasPath: alias.aliasPath,
      installMode: "copy",
      markerPath: alias.markerPath,
      state: "managed",
      tool: alias.tool,
    }));
}

export async function deleteExternalLaunchAliases(
  request: ExternalLaunchAliasCommandRequest = {},
): Promise<ExternalLaunchAliasRemoval[]> {
  if (isTauri()) {
    return invoke<ExternalLaunchAliasRemoval[]>("external_launch_alias_delete", {
      request,
    });
  }
  return browserPreviewExternalLaunchAliasStatus(request.aliasDirectory).aliases
    .filter((alias) => (request.tools ?? externalLaunchAliasTools).includes(alias.tool))
    .map((alias) => ({
      aliasPath: alias.aliasPath,
      markerPath: alias.markerPath,
      removedAlias: alias.state === "managed",
      removedMarker: alias.markerPresent,
      tool: alias.tool,
    }));
}

export async function openExternalLaunchAliasDirectory(
  aliasDirectory?: string,
): Promise<string> {
  const resolvedPath =
    aliasDirectory?.trim() ||
    browserPreviewExternalLaunchAliasStatus().aliasDirectory;
  if (isTauri()) {
    return invoke<string>("external_launch_alias_open_directory", {
      aliasDirectory: resolvedPath,
    });
  }
  return resolvedPath;
}

export async function listenExternalSshLaunches(
  handler: (payload: ExternalLaunchEventPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }
  return listen<ExternalLaunchEventPayload>(
    EXTERNAL_SSH_LAUNCH_EVENT,
    (event) => {
      if (isExternalLaunchEventPayload(event.payload)) {
        handler(event.payload);
      }
    },
  );
}

function isExternalLaunchEventPayload(
  payload: unknown,
): payload is ExternalLaunchEventPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const value = payload as Partial<ExternalLaunchEventPayload>;
  return (
    (value.kind === "queued" || value.kind === "rejected") &&
    typeof value.entrypoint === "string" &&
    typeof value.pendingCount === "number"
  );
}

function validateBrowserPreviewLaunchId(launchId: string) {
  if (!launchId.trim()) {
    throw new Error("External SSH launch id cannot be empty");
  }
  if (launchId.includes("\n") || launchId.includes("\r")) {
    throw new Error("External SSH launch id cannot contain newline");
  }
}

function browserPreviewExternalLaunchAliasStatus(
  aliasDirectory = "C:\\Users\\kerminal\\.kerminal\\external-launch\\compatibility-aliases",
): ExternalLaunchAliasStatus {
  const installDirectory = "C:\\Program Files\\Kerminal";
  const shimExecutable = `${installDirectory}\\kerminal-launch-shim.exe`;
  return {
    aliasDirectory,
    aliases: externalLaunchAliasTools.map((tool) => {
      const aliasPath = `${aliasDirectory}\\${externalLaunchAliasFileName(tool)}`;
      return {
        aliasPath,
        markerPath: `${aliasPath}.kerminal-alias.json`,
        markerPresent: false,
        state: "missing",
        tool,
      };
    }),
    installDirectory,
    kerminalExecutable: `${installDirectory}\\kerminal.exe`,
    shimAvailable: false,
    shimExecutable,
  };
}

function externalLaunchAliasFileName(tool: ExternalLaunchAliasTool): string {
  switch (tool) {
    case "mobaxterm":
      return "MobaXterm.exe";
    case "openssh":
      return "ssh.exe";
    case "putty":
      return "putty.exe";
    case "securecrt":
      return "SecureCRT.exe";
    case "xshell":
      return "Xshell.exe";
  }
}
