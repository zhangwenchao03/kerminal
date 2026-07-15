import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const EXTERNAL_SSH_LAUNCH_EVENT = "kerminal-external-ssh-launch";

type ExternalLaunchSourceTool =
  | "putty"
  | "mobaxterm"
  | "xshell"
  | "securecrt"
  | "openssh"
  | "kerminal-native";

type ExternalLaunchEntrypoint =
  "direct-argv" | "single-instance" | "shim-ipc" | "protocol" | "session-file";

type ExternalLaunchEventKind = "queued" | "rejected";

interface ExternalLaunchSource {
  tool: ExternalLaunchSourceTool;
  entrypoint: ExternalLaunchEntrypoint;
  persona?: string;
  argv0?: string;
}

interface ExternalSshRouteHop {
  host: string;
  port: number;
  username?: string;
}

interface ExternalSshTarget {
  host: string;
  port: number;
  username?: string;
  route: ExternalSshRouteHop[];
}

interface ExternalSshAuthMetadata {
  hasPassword: boolean;
  hasKeyPassphrase: boolean;
  identityFile?: string;
  passwordFilePresent: boolean;
  agent: boolean;
}

interface ExternalSshLaunchOptions {
  displayName?: string;
  remoteCommand?: string;
  remoteCommandFile?: string;
  openSftp: boolean;
  sessionName?: string;
}

interface ExternalLaunchRequestDiagnostics {
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
  production: boolean;
  safety: "restricted-unknown" | "known-non-production" | "production";
}

export interface ExternalHostKeyInspection {
  algorithm: string;
  fingerprint: string;
  host: string;
  launchId: string;
  port: number;
  status: "known" | "unknown" | "changed";
}

interface ExternalLaunchTargetSummary {
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

interface ExternalLaunchPolicySnapshot {
  enabled: boolean;
  acceptVendorArgs: boolean;
  shimBridgeEnabled: boolean;
  autoOpenSftp: boolean;
  disabledTools: ExternalLaunchSourceTool[];
  pendingCapacity: number;
  claimLeaseMs: number;
}

interface ExternalLaunchIntakeSnapshot {
  pendingCount: number;
  pendingRequestHashes: string[];
  claimedCount: number;
  claimedRequestHashes: string[];
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
  health: ExternalLaunchRuntimeHealthSnapshot;
}

interface ExternalLaunchRuntimeHealthSnapshot {
  bridgeListening: boolean;
  bridgeGenerationTag?: string;
  bridgeRestartCount: number;
  bridgeActiveClients: number;
  dedupCount: number;
  backpressureCount: number;
  expiryCount: number;
  cancelCount: number;
  oldestLaunchAgeMs: number;
  lastIntakeLatencyMs?: number;
}

interface ExternalLaunchTaskSnapshot {
  queuedCount: number;
  inFlightCount: number;
  connectedCount: number;
  cancelledCount: number;
  deadlineCount: number;
  lateCleanupCount: number;
  completedCount: number;
  oldestTaskAgeMs: number;
  lastConnectLatencyMs?: number;
}

interface ExternalLaunchSecretSnapshot {
  activeSecretCount: number;
  requestHashes: string[];
}

export interface ExternalLaunchSnapshot {
  intake: ExternalLaunchIntakeSnapshot;
  secrets: ExternalLaunchSecretSnapshot;
  tasks: ExternalLaunchTaskSnapshot;
}

type ExternalLaunchAliasTool = Exclude<
  ExternalLaunchSourceTool,
  "kerminal-native"
>;

type ExternalLaunchAliasState =
  | "missing"
  | "managed"
  | "blockedNonKerminal"
  | "staleMarker";

type ExternalLaunchAliasInstallMode = "hardLink" | "copy";

interface ExternalLaunchAliasInspection {
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

const externalLaunchAliasTools: ExternalLaunchAliasTool[] = [
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
    production: true,
    safety: "restricted-unknown",
    targetId: `external:${request.launchId}`,
    username: request.username ?? "preview",
  };
}

export interface ExternalLaunchDeepLinkStatus {
  registered: boolean;
  scheme: string;
  supported: boolean;
}

export async function inspectExternalLaunchHostKey(
  launchId: string,
): Promise<ExternalHostKeyInspection> {
  validateBrowserPreviewLaunchId(launchId);
  if (isTauri()) {
    return invoke<ExternalHostKeyInspection>("external_launch_host_key_inspect", {
      launchId,
    });
  }
  return {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:browser-preview",
    host: "preview.invalid",
    launchId,
    port: 22,
    status: "known",
  };
}

export async function trustExternalLaunchHostKey(
  launchId: string,
  expectedFingerprint: string,
): Promise<ExternalHostKeyInspection> {
  validateBrowserPreviewLaunchId(launchId);
  if (isTauri()) {
    return invoke<ExternalHostKeyInspection>("external_launch_host_key_trust", {
      expectedFingerprint,
      launchId,
    });
  }
  return {
    algorithm: "ssh-ed25519",
    fingerprint: expectedFingerprint,
    host: "preview.invalid",
    launchId,
    port: 22,
    status: "known",
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
      claimedCount: 0,
      claimedRequestHashes: [],
      noopCount: 0,
      pendingCount: 0,
      pendingRequestHashes: [],
      health: {
        backpressureCount: 0,
        bridgeActiveClients: 0,
        bridgeListening: false,
        bridgeRestartCount: 0,
        cancelCount: 0,
        dedupCount: 0,
        expiryCount: 0,
        oldestLaunchAgeMs: 0,
      },
      policy: {
        acceptVendorArgs: true,
        autoOpenSftp: false,
        disabledTools: [],
        enabled: true,
        shimBridgeEnabled: true,
        pendingCapacity: 128,
        claimLeaseMs: 30_000,
      },
      rejectedCount: 0,
    },
    secrets: {
      activeSecretCount: 0,
      requestHashes: [],
    },
    tasks: {
      cancelledCount: 0,
      completedCount: 0,
      connectedCount: 0,
      deadlineCount: 0,
      inFlightCount: 0,
      lateCleanupCount: 0,
      oldestTaskAgeMs: 0,
      queuedCount: 0,
    },
  };
}

export async function getExternalLaunchDeepLinkStatus(): Promise<ExternalLaunchDeepLinkStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchDeepLinkStatus>("external_launch_deep_link_status");
  }
  return { registered: false, scheme: "kerminal", supported: false };
}

export async function registerExternalLaunchDeepLink(): Promise<ExternalLaunchDeepLinkStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchDeepLinkStatus>("external_launch_deep_link_register");
  }
  return { registered: false, scheme: "kerminal", supported: false };
}

export async function unregisterExternalLaunchDeepLink(): Promise<ExternalLaunchDeepLinkStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchDeepLinkStatus>("external_launch_deep_link_unregister");
  }
  return { registered: false, scheme: "kerminal", supported: false };
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
